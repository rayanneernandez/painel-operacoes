import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BellRing,
  Building2,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  MapPin,
  MessageSquare,
  Phone,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  WifiOff,
  X,
} from 'lucide-react';
import supabase from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

type DbClient = { id: string; name: string };
type DeviceStatus = 'online' | 'offline' | 'not_connected';
type DeviceRow = {
  id: string;
  name: string;
  type: string;
  mac_address: string | null;
  status: DeviceStatus;
  store_id: string;
};
type StoreRow = {
  id: string;
  name: string;
  city: unknown;
  client_id: string;
};
type StoreOption = {
  id: string;
  name: string;
  city: string;
};

type UiDevice = {
  id: string;
  name: string;
  type: string;
  macAddress: string;
  status: DeviceStatus;
};

type UiStore = {
  id: string;
  name: string;
  city: string;
  devices: UiDevice[];
};

type DevicesOnlinePageMode = 'overview' | 'whatsapp';
type ContactScope = 'network' | 'store';
type FeedbackTone = 'success' | 'error' | 'info';

type FeedbackState = {
  title: string;
  message: string;
  tone: FeedbackTone;
};

type WhatsappContactRow = {
  id: string;
  client_id: string;
  store_id: string | null;
  scope_type: ContactScope;
  responsible_name: string;
  phone_number: string;
  phone_e164: string;
  enabled: boolean;
  receive_offline_alerts: boolean;
  created_at?: string | null;
};

type OfflineAlertRow = {
  id: string;
  client_id: string;
  store_id: string | null;
  device_id: string;
  alert_type: 'offline';
  status: 'pending' | 'notified' | 'resolved' | 'cancelled';
  client_name: string | null;
  store_name: string | null;
  device_name: string;
  mac_address: string | null;
  first_detected_at: string;
  last_seen_offline_at: string | null;
  last_seen_online_at: string | null;
  notified_at: string | null;
  last_notification_sent_at?: string | null;
  notified_contact_count: number | null;
  resolution_sent_at: string | null;
  resolved_at: string | null;
  notification_attempts: number | null;
  last_notification_error: string | null;
  offline_reason: string | null;
  offline_reason_updated_at: string | null;
  offline_reason_sent_at: string | null;
  created_at: string;
};

type IntegrationStatus = {
  configured: boolean;
  missing: string[];
  departmentId: string | null;
  departmentName: string;
  phoneLabel: string;
};

const EMPTY_INTEGRATION_STATUS: IntegrationStatus = {
  configured: false,
  missing: [],
  departmentId: null,
  departmentName: 'Global IA Chat',
  phoneLabel: 'Global IA',
};

const SELECTED_CLIENT_STORAGE_KEY = 'globalia-monitoring-selected-client-id';
const DISPLAY_SYNC_META_KEY_PREFIX = 'globalia-display-sync-meta:';
const DISPLAY_SYNC_AUTO_INTERVAL_MS = 10 * 60 * 1000;
const DISPLAY_SYNC_SHARED_COOLDOWN_MS = 10 * 60 * 1000;
const DISPLAY_SYNC_RUNNING_TTL_MS = 45 * 1000;
const OVERVIEW_DB_POLL_MS = 15 * 1000;
const WHATSAPP_DB_POLL_MS = 30 * 1000;
const OFFLINE_VALIDATION_MINUTES = 60;
const OFFLINE_REPEAT_AFTER_FIRST_HOURS = 24;
const OFFLINE_REPEAT_AFTER_THIRD_DAYS = 3;

const OFFLINE_REASON_SUGGESTIONS = [
  'Manutencao programada na loja',
  'Queda de energia no local',
  'Internet da loja indisponivel',
  'Troca ou reinicio do equipamento',
  'Aguardando suporte tecnico local',
];

function normalizeBrazilPhone(value: string) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';

  const localDigits = digits.startsWith('55') ? digits.slice(2) : digits;
  if (localDigits.length === 10 || localDigits.length === 11) {
    return `55${localDigits}`;
  }

  return digits;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '-';

  try {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function diffMinutesFromNow(value: string | null | undefined) {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 0;
  return Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
}

function isMissingTableError(message: string) {
  const normalized = String(message || '').toLowerCase();
  return (
    normalized.includes('does not exist') ||
    normalized.includes('relation') ||
    normalized.includes('42p01') ||
    normalized.includes('cache de esquema') ||
    normalized.includes('schema cache') ||
    normalized.includes('nao foi possivel encontrar a tabela') ||
    (normalized.includes('column') && normalized.includes('offline_reason'))
  );
}

function joinMessageLines(lines: string[]) {
  return lines.join('\n');
}

function formatUnknownErrorDetail(value: unknown): string {
  if (value == null) return 'Erro nao detalhado';
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message;

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const preferred =
      record.details ||
      record.message ||
      record.error ||
      record.hint ||
      null;

    if (typeof preferred === 'string' && preferred.trim()) return preferred;

    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return String(value);
}

function normalizeStatusToken(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function normalizeDeviceStatus(value: unknown): DeviceStatus {
  const token = normalizeStatusToken(value);

  if (!token) return 'not_connected';

  if (
    [
      'not connected',
      'notconnected',
      'nao conectado',
      'nao conectada',
      'disconnected',
      'desconectado',
      'desconectada',
      'inactive',
      'inativo',
      'inativa',
      'disabled',
      'desabilitado',
      'desabilitada',
    ].includes(token)
  ) {
    return 'not_connected';
  }

  if (
    [
      'offline',
      'off',
      'problem',
      'problema',
      'error',
      'erro',
      'failed',
      'failure',
      'unreachable',
      'stopped',
      'stop',
      'standby',
      'idle',
    ].includes(token)
  ) {
    return 'offline';
  }

  if (
    [
      'online',
      'playback',
      'reproducao',
      'reproduction',
      'playing',
      'reproduzindo',
      'vazio',
      'empty',
      'pause',
      'paused',
      'pausado',
      'normal',
      'connected',
      'active',
      'ativo',
      'confirmado',
      'confirmed',
      'true',
      '1',
    ].includes(token)
  ) {
    return 'online';
  }

  return 'not_connected';
}

function getDeviceStatusPriority(status: DeviceStatus) {
  if (status === 'offline') return 3;
  if (status === 'not_connected') return 2;
  return 0;
}

function getDeviceStatusLabel(status: DeviceStatus) {
  if (status === 'not_connected') return 'Nao conectado';
  if (status === 'offline') return 'Offline';
  return 'Online';
}

function getDeviceStatusDotClass(status: DeviceStatus) {
  if (status === 'offline') return 'bg-red-500';
  if (status === 'not_connected') return 'bg-amber-400';
  return 'bg-emerald-500 animate-pulse';
}

function getDeviceStatusBadgeClass(status: DeviceStatus) {
  if (status === 'offline') return 'bg-red-950/30 text-red-300 border-red-800';
  if (status === 'not_connected') return 'bg-amber-950/30 text-amber-300 border-amber-800';
  return 'bg-emerald-950/30 text-emerald-300 border-emerald-800';
}

type DisplaySyncMeta = {
  startedAt?: number;
  finishedAt?: number;
  status?: 'running' | 'success' | 'error';
};

function getDisplaySyncMetaKey(clientId: string) {
  return `${DISPLAY_SYNC_META_KEY_PREFIX}${clientId}`;
}

function readDisplaySyncMeta(clientId: string): DisplaySyncMeta | null {
  if (typeof window === 'undefined' || !clientId) return null;

  try {
    const raw = window.localStorage.getItem(getDisplaySyncMetaKey(clientId));
    if (!raw) return null;
    return JSON.parse(raw) as DisplaySyncMeta;
  } catch {
    return null;
  }
}

function writeDisplaySyncMeta(clientId: string, meta: DisplaySyncMeta) {
  if (typeof window === 'undefined' || !clientId) return;

  try {
    window.localStorage.setItem(getDisplaySyncMetaKey(clientId), JSON.stringify(meta));
  } catch {
    // noop
  }
}

type DevicesOnlineProps = {
  pageMode?: DevicesOnlinePageMode;
};

export function DevicesOnline({ pageMode = 'overview' }: DevicesOnlineProps) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isWhatsappPage = pageMode === 'whatsapp';

  const [clients, setClients] = useState<DbClient[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(SELECTED_CLIENT_STORAGE_KEY) || '';
  });
  const [selectedClientName, setSelectedClientName] = useState<string>('');
  const [currentClientName, setCurrentClientName] = useState<string>('');

  const activeClientId = useMemo(() => {
    if (isAdmin) return selectedClientId || '';
    return user?.clientId || '';
  }, [isAdmin, selectedClientId, user?.clientId]);

  const activeClientName = useMemo(() => {
    return isAdmin ? selectedClientName : currentClientName;
  }, [currentClientName, isAdmin, selectedClientName]);

  const [stores, setStores] = useState<UiStore[]>([]);
  const [storeOptions, setStoreOptions] = useState<StoreOption[]>([]);
  const [expandedStore, setExpandedStore] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

  const [contacts, setContacts] = useState<WhatsappContactRow[]>([]);
  const [alerts, setAlerts] = useState<OfflineAlertRow[]>([]);
  const [integrationStatus, setIntegrationStatus] = useState<IntegrationStatus>(EMPTY_INTEGRATION_STATUS);
  const [monitoringLoading, setMonitoringLoading] = useState(false);
  const [monitoringTablesReady, setMonitoringTablesReady] = useState(true);
  const [monitoringMessage, setMonitoringMessage] = useState<string | null>(null);
  const [savingContact, setSavingContact] = useState(false);
  const [testingContactId, setTestingContactId] = useState<string | null>(null);
  const [deletingContactId, setDeletingContactId] = useState<string | null>(null);
  const [togglingContactId, setTogglingContactId] = useState<string | null>(null);
  const [savingReasonId, setSavingReasonId] = useState<string | null>(null);
  const [sendingAlertId, setSendingAlertId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [reasonDrafts, setReasonDrafts] = useState<Record<string, string>>({});
  const [expandedReasonAlerts, setExpandedReasonAlerts] = useState<Record<string, boolean>>({});
  const [manualAlertContactIds, setManualAlertContactIds] = useState<Record<string, string>>({});
  const [manualAlertPhones, setManualAlertPhones] = useState<Record<string, string>>({});
  const [isGuideExpanded, setIsGuideExpanded] = useState(false);
  const [syncWarning, setSyncWarning] = useState<string | null>(null);
  const [isSyncingDisplay, setIsSyncingDisplay] = useState(false);
  const syncInFlightRef = useRef(false);
  const pendingDispatchInFlightRef = useRef(false);
  const lastPendingDispatchAtRef = useRef<Record<string, number>>({});
  const [contactForm, setContactForm] = useState({
    responsibleName: '',
    phoneNumber: '',
    scopeType: 'network' as ContactScope,
    storeId: '',
  });

  useEffect(() => {
    if (!feedback) return;
    const timeoutId = window.setTimeout(() => setFeedback(null), 4200);
    return () => window.clearTimeout(timeoutId);
  }, [feedback]);

  useEffect(() => {
    if (!isAdmin || typeof window === 'undefined') return;
    window.localStorage.setItem(SELECTED_CLIENT_STORAGE_KEY, selectedClientId || '');
  }, [isAdmin, selectedClientId]);

  useEffect(() => {
    setReasonDrafts((previous) => {
      const next: Record<string, string> = {};
      for (const alert of alerts) {
        next[alert.id] = previous[alert.id] ?? alert.offline_reason ?? '';
      }
      return next;
    });
  }, [alerts]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!isAdmin) return;

      const { data, error } = await supabase
        .from('clients')
        .select('id, name')
        .order('name', { ascending: true });

      if (cancelled) return;
      if (!error && data) setClients(data as DbClient[]);
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    const client = clients.find((item) => item.id === selectedClientId);
    setSelectedClientName(client?.name || '');
  }, [clients, isAdmin, selectedClientId]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (isAdmin || !activeClientId) {
        setCurrentClientName('');
        return;
      }

      const { data, error } = await supabase
        .from('clients')
        .select('name')
        .eq('id', activeClientId)
        .maybeSingle();

      if (cancelled) return;
      if (!error) {
        setCurrentClientName(String(data?.name || '').trim());
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [activeClientId, isAdmin]);

  const loadMonitoringData = async (clientId: string) => {
    if (!clientId) {
      setContacts([]);
      setAlerts([]);
      return;
    }

    setMonitoringLoading(true);
    setMonitoringMessage(null);

    try {
      const [contactsResult, alertsResult, integrationResult] = await Promise.all([
        supabase
          .from('monitoring_whatsapp_contacts')
          .select('id, client_id, store_id, scope_type, responsible_name, phone_number, phone_e164, enabled, receive_offline_alerts, created_at')
          .eq('client_id', clientId)
          .order('created_at', { ascending: false }),
        supabase
          .from('device_offline_alerts')
          .select('id, client_id, store_id, device_id, alert_type, status, client_name, store_name, device_name, mac_address, first_detected_at, last_seen_offline_at, last_seen_online_at, notified_at, last_notification_sent_at, notified_contact_count, resolution_sent_at, resolved_at, notification_attempts, last_notification_error, offline_reason, offline_reason_updated_at, offline_reason_sent_at, created_at')
          .eq('client_id', clientId)
          .order('created_at', { ascending: false })
          .limit(150),
        fetch('/api/whatsapp-monitoring'),
      ]);

      if (contactsResult.error) throw contactsResult.error;
      if (alertsResult.error) throw alertsResult.error;

      const integrationJson = integrationResult.ok
        ? await integrationResult.json()
        : EMPTY_INTEGRATION_STATUS;

      setContacts((contactsResult.data || []) as WhatsappContactRow[]);
      setAlerts((alertsResult.data || []) as OfflineAlertRow[]);
      setIntegrationStatus({
        configured: Boolean(integrationJson?.configured),
        missing: Array.isArray(integrationJson?.missing) ? integrationJson.missing : [],
        departmentId: integrationJson?.departmentId || null,
        departmentName: integrationJson?.departmentName || 'Global IA Chat',
        phoneLabel: integrationJson?.phoneLabel || 'Global IA',
      });
      setMonitoringTablesReady(true);
    } catch (error: any) {
      const message = error?.message || String(error);

      if (isMissingTableError(message)) {
        setMonitoringTablesReady(false);
        setMonitoringMessage('Execute o script monitoring_whatsapp_setup.sql ou, se a aba ja existia, rode monitoring_whatsapp_add_reason.sql no Supabase para liberar todos os campos do WhatsApp.');
      } else {
        setMonitoringMessage(message);
      }

      setContacts([]);
      setAlerts([]);
    } finally {
      setMonitoringLoading(false);
    }
  };

  const triggerStoreSync = async (
    clientId: string,
    options?: { force?: boolean; waitForCompletion?: boolean }
  ) => {
    if (!clientId) return null;

    const force = Boolean(options?.force);
    const waitForCompletion = Boolean(options?.waitForCompletion);
    const nowMs = Date.now();
    const syncMeta = readDisplaySyncMeta(clientId);
    const lastStartedAt = Number(syncMeta?.startedAt || 0);
    const lastFinishedAt = Number(syncMeta?.finishedAt || 0);
    const sharedSyncRunning = lastStartedAt > lastFinishedAt && nowMs - lastStartedAt < DISPLAY_SYNC_RUNNING_TTL_MS;
    const withinCooldown = lastFinishedAt > 0 && nowMs - lastFinishedAt < DISPLAY_SYNC_SHARED_COOLDOWN_MS;

    if (!force) {
      if (syncInFlightRef.current || sharedSyncRunning) {
        return { skipped: true, reason: 'in-flight' as const };
      }

      if (withinCooldown) {
        return { skipped: true, reason: 'cooldown' as const };
      }
    }

    const scheduleFollowUpRefreshes = () => {
      setTimeout(() => refresh(), 20000);
      setTimeout(() => refresh(), 65000);
    };

    syncInFlightRef.current = true;
    if (waitForCompletion) setIsSyncingDisplay(true);
    writeDisplaySyncMeta(clientId, { startedAt: nowMs, finishedAt: lastFinishedAt, status: 'running' });
    setSyncWarning(null);

    // Fire-and-forget: não bloqueia a UI aguardando o sync.
    // Redes grandes (ex: Assai com 134 devices) podem demorar > 60s → 504.
    // O painel exibe o último status do banco enquanto o sync roda em background.
    // Refreshes automáticos em 20s e 65s buscam os dados atualizados.
    const syncRequest = fetch('/api/sync-analytics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, sync_stores: true }),
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (response.ok) {
          setSyncWarning(null);
          writeDisplaySyncMeta(clientId, { startedAt: nowMs, finishedAt: Date.now(), status: 'success' });
          return {
            ok: true as const,
            payload,
            status: response.status,
          };
        }
          // 504 é esperado para redes grandes — não exibe erro nesses casos
        const detail = payload?.details || payload?.error || payload?.message || `HTTP ${response.status}`;

        if (response.status === 504) {
          scheduleFollowUpRefreshes();
          setSyncWarning('A atualizacao da DisplayForce continua em background. Vou refletir no painel assim que o banco terminar de receber os dados.');
          return {
            ok: false as const,
            payload,
            detail,
            status: response.status,
          };
        }

        setSyncWarning(`Status atualizado do banco. Detalhe do sync: ${detail}`);
        writeDisplaySyncMeta(clientId, { startedAt: nowMs, finishedAt: lastFinishedAt, status: 'error' });
        return {
          ok: false as const,
          payload,
          detail,
          status: response.status,
        };
      })
      .catch((error) => {
        writeDisplaySyncMeta(clientId, { startedAt: nowMs, finishedAt: lastFinishedAt, status: 'error' });
        return {
          ok: false as const,
          detail: error instanceof Error ? error.message : String(error),
          status: 0,
        };
      })
      .finally(() => {
        syncInFlightRef.current = false;
        setIsSyncingDisplay(false);
      });

    // Refreshes agendados para capturar dados após o sync terminar em background
    if (waitForCompletion) {
      return syncRequest;
    }

    void syncRequest;
    scheduleFollowUpRefreshes();

    return { skipped: false, reason: 'started-background' as const };
  };

  const refresh = async () => {
    if (!activeClientId) {
      setStores([]);
      setStoreOptions([]);
      setExpandedStore(null);
      return;
    }

    setLoading(true);
    try {
      const { data: storesData, error: storesError } = await supabase
        .from('stores')
        .select('id, name, city, client_id')
        .eq('client_id', activeClientId)
        .range(0, 9999);

      if (storesError) throw storesError;

      const storeRows = (storesData || []) as unknown as StoreRow[];

      const options = storeRows
        .map((store) => ({
          id: String(store.id),
          name: String(store.name || '').trim(),
          city: typeof store.city === 'string' && store.city.trim() ? store.city.trim() : 'Nao informada',
        }))
        .sort((a, b) => `${a.name} ${a.city}`.localeCompare(`${b.name} ${b.city}`, 'pt-BR'));

      setStoreOptions(options);

      const norm = (value: unknown) =>
        String(value ?? '')
          .trim()
          .toLowerCase()
          .replace(/\s+/g, ' ');

      const toCity = (value: unknown) => {
        const city = typeof value === 'string' ? value.trim() : '';
        return city ? city : 'Nao informada';
      };

      const storeGroups = new Map<string, { ids: string[]; name: string; city: string }>();
      for (const store of storeRows) {
        const city = toCity(store.city);
        const key = `${norm(store.name)}|${norm(city)}`;
        const existing = storeGroups.get(key);
        if (!existing) {
          storeGroups.set(key, { ids: [store.id], name: store.name, city });
        } else {
          existing.ids.push(store.id);
        }
      }

      const storeIds = [...new Set(storeRows.map((store) => store.id))];
      const devicesByStore: Record<string, DeviceRow[]> = {};

      if (storeIds.length > 0) {
        const { data: devicesData, error: devicesError } = await supabase
          .from('devices')
          .select('id, name, type, mac_address, status, store_id')
          .in('store_id', storeIds)
          .range(0, 9999);

        if (devicesError) throw devicesError;

        (devicesData || []).forEach((device: any) => {
          const row: DeviceRow = {
            id: String(device?.id ?? ''),
            name: String(device?.name ?? ''),
            type: String(device?.type ?? ''),
            mac_address: device?.mac_address == null ? null : String(device.mac_address),
            status: normalizeDeviceStatus(device?.status),
            store_id: String(device?.store_id ?? ''),
          };

          if (!devicesByStore[row.store_id]) devicesByStore[row.store_id] = [];
          devicesByStore[row.store_id].push(row);
        });
      }

      const dedupeDevices = (rows: DeviceRow[]): UiDevice[] => {
        const map = new Map<string, DeviceRow>();
        for (const row of rows) {
          const mac = String(row.mac_address ?? '').trim();
          const key = mac ? `mac:${mac}` : `id:${row.id}`;
          const previous = map.get(key);
          if (!previous) map.set(key, row);
          else if (getDeviceStatusPriority(row.status) > getDeviceStatusPriority(previous.status)) map.set(key, row);
        }

        return [...map.values()]
          .map((device) => ({
            id: device.id,
            name: device.name,
            type: device.type,
            macAddress: String(device.mac_address ?? ''),
            status: device.status,
          }))
          .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
      };

      const formatted: UiStore[] = [...storeGroups.values()].map((group) => {
        const mergedRows = group.ids.flatMap((storeId) => devicesByStore[storeId] || []);
        return {
          id: group.ids.join('|'),
          name: group.name,
          city: group.city,
          devices: dedupeDevices(mergedRows),
        };
      });

      setStores(formatted);
      setLastUpdatedAt(new Date());

      if (expandedStore && !formatted.some((store) => store.id === expandedStore)) {
        setExpandedStore(null);
      }

      if (isWhatsappPage) {
        await loadMonitoringData(activeClientId);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!activeClientId) return;
      if (!isWhatsappPage) {
        await triggerStoreSync(activeClientId);
      }
      if (cancelled) return;
      await refresh();
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [activeClientId, isWhatsappPage]);

  useEffect(() => {
    if (!activeClientId) return;

    const dbPollId = window.setInterval(() => {
      void refresh();
    }, isWhatsappPage ? WHATSAPP_DB_POLL_MS : OVERVIEW_DB_POLL_MS);

    const apiSyncId = !isWhatsappPage
      ? window.setInterval(() => {
          void triggerStoreSync(activeClientId).then(() => refresh());
        }, DISPLAY_SYNC_AUTO_INTERVAL_MS)
      : null;

    const onFocus = () => {
      if (isWhatsappPage) {
        void refresh();
        return;
      }

      void triggerStoreSync(activeClientId).then(() => refresh());
    };

    window.addEventListener('focus', onFocus);

    return () => {
      window.clearInterval(dbPollId);
      if (apiSyncId) window.clearInterval(apiSyncId);
      window.removeEventListener('focus', onFocus);
    };
  }, [activeClientId, isWhatsappPage]);

  const activeAlerts = useMemo(
    () => alerts.filter((alert) => !alert.notified_at && !alert.resolved_at),
    [alerts]
  );

  const duePendingAlerts = useMemo(
    () => activeAlerts.filter((alert) => diffMinutesFromNow(alert.first_detected_at) >= OFFLINE_VALIDATION_MINUTES),
    [activeAlerts]
  );

  useEffect(() => {
    if (!isWhatsappPage || !activeClientId) return;
    if (duePendingAlerts.length === 0) return;
    if (pendingDispatchInFlightRef.current) return;

    const lastRunAt = lastPendingDispatchAtRef.current[activeClientId] || 0;
    if (Date.now() - lastRunAt < 60 * 1000) return;

    pendingDispatchInFlightRef.current = true;
    lastPendingDispatchAtRef.current[activeClientId] = Date.now();

    void handleDispatchPendingAlerts(activeClientId, { silentWhenNoop: true })
      .catch(() => {
        // handled by toast on explicit actions; automatic cycle stays quiet
      })
      .finally(() => {
        pendingDispatchInFlightRef.current = false;
      });
  }, [activeClientId, duePendingAlerts, isWhatsappPage]);

  const headerSubtitle = useMemo(() => {
    if (isAdmin) {
      if (!selectedClientId) {
        return isWhatsappPage
          ? 'Selecione uma rede para ver contatos, incidentes e alertas do WhatsApp.'
          : 'Selecione uma rede para ver lojas e dispositivos online.';
      }
      return selectedClientName ? `Rede: ${selectedClientName}` : 'Rede selecionada';
    }

    if (activeClientName) return `Sua rede: ${activeClientName}`;

    return isWhatsappPage
      ? 'Sua rede: monitoramento e alertas do WhatsApp'
      : 'Sua rede: lojas e dispositivos online';
  }, [activeClientName, isAdmin, isWhatsappPage, selectedClientId, selectedClientName]);

  const deviceStats = useMemo(() => {
    const total = stores.reduce((acc, store) => acc + store.devices.length, 0);
    const online = stores.reduce(
      (acc, store) => acc + store.devices.filter((device) => device.status === 'online').length,
      0
    );
    const offline = stores.reduce(
      (acc, store) => acc + store.devices.filter((device) => device.status === 'offline').length,
      0
    );
    const notConnected = stores.reduce(
      (acc, store) => acc + store.devices.filter((device) => device.status === 'not_connected').length,
      0
    );

    return {
      total,
      online,
      offline,
      notConnected,
      confirmed: online + offline,
      onlinePct: total > 0 ? (online / total) * 100 : 0,
      offlinePct: total > 0 ? (offline / total) * 100 : 0,
      notConnectedPct: total > 0 ? (notConnected / total) * 100 : 0,
      confirmedPct: total > 0 ? ((online + offline) / total) * 100 : 0,
    };
  }, [stores]);

  const monitoringStats = useMemo(() => {
    const enabledContacts = contacts.filter((contact) => contact.enabled).length;
    const pendingAlerts = activeAlerts.length;
    const notifiedAlerts = alerts.filter((alert) => Boolean(alert.notified_at) && !alert.resolved_at).length;
    const resolvedAlerts = alerts.filter((alert) => Boolean(alert.resolved_at)).length;

    return {
      contacts: contacts.length,
      enabledContacts,
      pendingAlerts,
      notifiedAlerts,
      resolvedAlerts,
    };
  }, [activeAlerts, alerts, contacts]);

  const resolveStoreName = (storeId: string | null) => {
    if (!storeId) return 'Rede inteira';
    const store = storeOptions.find((item) => item.id === storeId);
    return store ? `${store.name} - ${store.city}` : 'Loja vinculada';
  };

  const showFeedback = (title: string, message: string, tone: FeedbackTone = 'info') => {
    setFeedback({ title, message, tone });
  };

  const getContactScopeLabel = (contact: WhatsappContactRow) => {
    if (contact.scope_type === 'store') {
      return resolveStoreName(contact.store_id);
    }

    return activeClientName ? `Rede inteira (${activeClientName})` : 'Rede inteira';
  };

  const getManualContactsForAlert = (alert: OfflineAlertRow) =>
    contacts
      .filter((contact) => contact.enabled)
      .sort((a, b) => {
        const aMatchesStore = Boolean(alert.store_id && a.store_id === alert.store_id);
        const bMatchesStore = Boolean(alert.store_id && b.store_id === alert.store_id);
        if (aMatchesStore !== bMatchesStore) return aMatchesStore ? -1 : 1;
        return a.responsible_name.localeCompare(b.responsible_name, 'pt-BR');
      });

  const whatsappMessagePreview = useMemo(() => {
    const previewClientName = activeClientName || 'Panvel';
    const previewStoreName =
      contactForm.scopeType === 'store' && contactForm.storeId
        ? resolveStoreName(contactForm.storeId)
        : `Todas as lojas da rede ${previewClientName}`;
    const previewResponsible = contactForm.responsibleName.trim() || 'Responsavel da operacao';
    const previewOfflineAtA = formatDateTime(new Date(Date.now() - 65 * 60 * 1000).toISOString());
    const previewOfflineAtB = formatDateTime(new Date(Date.now() - 63 * 60 * 1000).toISOString());
    const previewOfflineAtC = formatDateTime(new Date(Date.now() - 60 * 60 * 1000).toISOString());
    const previewReason = 'Internet da loja indisponivel';

    return {
      test: joinMessageLines([
        'Teste de integracao do monitoramento Global IA',
        '',
        `Contato: ${previewResponsible}`,
        `Rede: ${previewClientName}`,
        `Escopo: ${previewStoreName}`,
        '',
        'Se voce recebeu esta mensagem, o canal do ZapResponder esta pronto para os alertas automaticos de dispositivos offline.',
      ]),
      offline: joinMessageLines([
        'ALERTA: dispositivos offline',
        '',
        `Rede: ${previewClientName}`,
        `Loja: ${previewStoreName}`,
        'Dispositivo: Player vitrine entrada',
        'MAC/ID: 00:1B:44:11:3A:B7',
        `Offline desde: ${previewOfflineAtA}`,
        '',
        'Dispositivo: Player vitrine lateral',
        'MAC/ID: 00:1B:44:11:3A:B8',
        `Offline desde: ${previewOfflineAtB}`,
        '',
        'Dispositivo: Totem autoatendimento',
        'MAC/ID: 00:1B:44:11:3A:B9',
        `Offline desde: ${previewOfflineAtC}`,
        '',
        `Tempo minimo confirmado: ${OFFLINE_VALIDATION_MINUTES / 60}h`,
        '',
        'O dispositivo segue offline apos a janela de validacao do monitoramento.',
        'Monitoramento Global IA',
      ]),
      reasonUpdate: joinMessageLines([
        'ATUALIZACAO DO ALERTA OFFLINE',
        '',
        `Rede: ${previewClientName}`,
        `Loja: ${previewStoreName}`,
        'Dispositivo: Player vitrine entrada',
        `Motivo informado: ${previewReason}`,
        '',
        'Monitoramento Global IA',
      ]),
      resolved: joinMessageLines([
        'RESOLVIDO: dispositivo voltou online',
        '',
        `Rede: ${previewClientName}`,
        `Loja: ${previewStoreName}`,
        'Dispositivo: Player vitrine entrada',
        `Normalizado em: ${formatDateTime(new Date().toISOString())}`,
        '',
        'Monitoramento Global IA',
      ]),
    };
  }, [activeClientName, contactForm.responsibleName, contactForm.scopeType, contactForm.storeId, storeOptions]);

  const resetContactForm = () => {
    setContactForm({
      responsibleName: '',
      phoneNumber: '',
      scopeType: 'network',
      storeId: '',
    });
  };

  const handleSaveContact = async () => {
    if (!activeClientId) return;

    const responsibleName = contactForm.responsibleName.trim();
    const phoneNumber = contactForm.phoneNumber.trim();
    const phoneE164 = normalizeBrazilPhone(phoneNumber);

    if (!responsibleName || !phoneE164) {
      showFeedback('Dados incompletos', 'Informe o nome do responsavel e um numero de WhatsApp valido.', 'info');
      return;
    }

    if (contactForm.scopeType === 'store' && !contactForm.storeId) {
      showFeedback('Loja obrigatoria', 'Selecione a loja que vai receber o alerta antes de salvar.', 'info');
      return;
    }

    setSavingContact(true);
    try {
      const { error } = await supabase.from('monitoring_whatsapp_contacts').insert({
        client_id: activeClientId,
        store_id: contactForm.scopeType === 'store' ? contactForm.storeId : null,
        scope_type: contactForm.scopeType,
        responsible_name: responsibleName,
        phone_number: phoneNumber,
        phone_e164: phoneE164,
        enabled: true,
        receive_offline_alerts: true,
        updated_at: new Date().toISOString(),
      });

      if (error) throw error;

      resetContactForm();
      await loadMonitoringData(activeClientId);
      await handleDispatchPendingAlerts(activeClientId, { silentWhenNoop: true });
      showFeedback('Responsavel salvo', 'O contato foi cadastrado com sucesso e ja pode receber alertas.', 'success');
    } catch (error: any) {
      const message = error?.message || String(error);
      showFeedback('Erro ao salvar', message, 'error');
    } finally {
      setSavingContact(false);
    }
  };

  const handleToggleContact = async (contact: WhatsappContactRow) => {
    setTogglingContactId(contact.id);
    try {
      const { error } = await supabase
        .from('monitoring_whatsapp_contacts')
        .update({
          enabled: !contact.enabled,
          updated_at: new Date().toISOString(),
        })
        .eq('id', contact.id);

      if (error) throw error;
      await loadMonitoringData(activeClientId);
      showFeedback(
        contact.enabled ? 'Contato pausado' : 'Contato ativado',
        contact.enabled
          ? 'O contato nao recebera novos alertas ate ser reativado.'
          : 'O contato voltou a receber alertas automaticamente.',
        'success'
      );
    } catch (error: any) {
      showFeedback('Erro ao atualizar contato', error?.message || String(error), 'error');
    } finally {
      setTogglingContactId(null);
    }
  };

  const handleDeleteContact = async (contact: WhatsappContactRow) => {
    const confirmed = window.confirm(`Excluir o contato ${contact.responsible_name}?`);
    if (!confirmed) return;

    setDeletingContactId(contact.id);
    try {
      const { error } = await supabase
        .from('monitoring_whatsapp_contacts')
        .delete()
        .eq('id', contact.id);

      if (error) throw error;
      await loadMonitoringData(activeClientId);
      showFeedback('Contato excluido', 'O responsavel foi removido da lista de alertas.', 'success');
    } catch (error: any) {
      showFeedback('Erro ao excluir contato', error?.message || String(error), 'error');
    } finally {
      setDeletingContactId(null);
    }
  };

  const handleTestContact = async (contact: WhatsappContactRow) => {
    setTestingContactId(contact.id);
    try {
      const response = await fetch('/api/whatsapp-monitoring', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'test',
          number: contact.phone_e164 || contact.phone_number,
          responsibleName: contact.responsible_name,
          clientName: activeClientName || 'Rede selecionada',
          storeName: resolveStoreName(contact.store_id),
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || 'Falha ao enviar o teste do WhatsApp.');
      }

      showFeedback(
        'Teste enviado',
        'Mensagem de teste enviada com sucesso para o WhatsApp selecionado.',
        'success'
      );
    } catch (error: any) {
      showFeedback('Falha no teste', error?.message || String(error), 'error');
    } finally {
      setTestingContactId(null);
    }
  };

  const handleDispatchPendingAlerts = async (
    clientId: string,
    options?: {
      alertId?: string;
      force?: boolean;
      contactId?: string;
      manualNumber?: string;
      manualResponsibleName?: string;
      silentWhenNoop?: boolean;
      successTitle?: string;
      successMessage?: string;
    }
  ) => {
    const response = await fetch('/api/whatsapp-monitoring', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: options?.force ? 'send_offline_now' : 'dispatch_pending',
        clientId,
        alertId: options?.alertId || '',
        force: Boolean(options?.force),
        contactId: options?.contactId || '',
        manualNumber: options?.manualNumber || '',
        manualResponsibleName: options?.manualResponsibleName || '',
      }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || 'Falha ao processar os alertas pendentes.');
    }

    const summary = payload?.summary || {};
    await loadMonitoringData(clientId);

    if (Number(summary.sent || 0) > 0) {
      showFeedback(
        options?.successTitle || 'WhatsApp enviado',
        options?.successMessage || 'O alerta offline foi enviado com sucesso.',
        'success'
      );
    } else if (!options?.silentWhenNoop) {
      showFeedback(
        'Nenhum envio realizado',
        Number(summary.skippedWaiting || 0) > 0
          ? 'Esse incidente ainda esta dentro da janela de 1 hora antes do envio automatico.'
          : 'Ainda nao havia nenhum alerta elegivel para envio.',
        'info'
      );
    }

    return summary;
  };

  const handleSendAlertNow = async (alert: OfflineAlertRow) => {
    if (!activeClientId) return;

    const manualPhoneInput = String(manualAlertPhones[alert.id] || '').trim();
    const manualNumber = normalizeBrazilPhone(manualPhoneInput);
    if (manualPhoneInput && (manualNumber.length < 12 || manualNumber.length > 13)) {
      showFeedback(
        'Numero invalido',
        'Informe um WhatsApp valido com DDD para usar o envio avulso.',
        'error'
      );
      return;
    }

    setSendingAlertId(alert.id);
    try {
      const selectedContactId = String(manualAlertContactIds[alert.id] || '').trim();
      const selectedContact = selectedContactId
        ? contacts.find((contact) => contact.id === selectedContactId)
        : null;

      await handleDispatchPendingAlerts(activeClientId, {
        alertId: alert.id,
        force: true,
        contactId: selectedContactId,
        manualNumber,
        manualResponsibleName: manualNumber ? 'Contato avulso' : '',
        successTitle: 'Alerta enviado agora',
        successMessage: manualNumber
          ? `O alerta foi enviado imediatamente para ${manualPhoneInput}. Se houver outros dispositivos offline da mesma loja, eles foram consolidados na mesma mensagem.`
          : selectedContact
          ? `O alerta foi enviado imediatamente para ${selectedContact.responsible_name}. Se houver outros dispositivos offline da mesma loja, eles foram consolidados na mesma mensagem.`
          : 'O alerta foi enviado imediatamente usando o contato padrao da loja/rede. Se houver outros dispositivos offline da mesma loja, eles foram consolidados na mesma mensagem.',
      });
    } catch (error: any) {
      showFeedback('Falha no envio imediato', error?.message || String(error), 'error');
    } finally {
      setSendingAlertId(null);
    }
  };

  const handleSaveReason = async (alert: OfflineAlertRow) => {
    if (!activeClientId) return;

    const offlineReason = String(reasonDrafts[alert.id] || '').trim();
    setSavingReasonId(alert.id);

    try {
      const { error } = await supabase
        .from('device_offline_alerts')
        .update({
          offline_reason: offlineReason || null,
          offline_reason_updated_at: new Date().toISOString(),
          offline_reason_sent_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', alert.id);

      if (error) throw error;

      await triggerStoreSync(activeClientId, { force: true });
      await loadMonitoringData(activeClientId);

      showFeedback(
        offlineReason ? 'Motivo salvo' : 'Motivo removido',
        offlineReason
          ? 'O motivo foi salvo no painel. Se o alerta ja tiver sido enviado e voce tiver atualizado esse motivo depois do envio, o sistema manda uma atualizacao complementar.'
          : 'O motivo foi removido deste incidente offline.',
        'success'
      );
    } catch (error: any) {
      showFeedback('Erro ao salvar motivo', error?.message || String(error), 'error');
    } finally {
      setSavingReasonId(null);
    }
  };

  const renderOverview = () => (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
      <div className="space-y-3">
        {stores.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-10 text-center text-gray-500">
            Nenhuma loja encontrada para esta rede.
          </div>
        ) : (
          stores.map((store) => {
            const onlineCount = store.devices.filter((device) => device.status === 'online').length;
            const offlineCount = store.devices.filter((device) => device.status === 'offline').length;
            const notConnectedCount = store.devices.filter((device) => device.status === 'not_connected').length;

            return (
              <div key={store.id} className="bg-gray-950 rounded-xl border border-gray-800 overflow-hidden">
                <div
                  className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-900 transition-colors"
                  onClick={() => setExpandedStore(expandedStore === store.id ? null : store.id)}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-gray-900 flex items-center justify-center text-gray-500">
                      <Building2 size={18} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">{store.name}</p>
                      <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                        <MapPin size={10} /> {store.city}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="inline-flex items-center gap-1 text-emerald-400">
                        <span className="w-2 h-2 rounded-full bg-emerald-500" />
                        {onlineCount}
                      </span>
                      <span className="inline-flex items-center gap-1 text-red-400">
                        <span className="w-2 h-2 rounded-full bg-red-500" />
                        {offlineCount}
                      </span>
                      <span className="inline-flex items-center gap-1 text-amber-300">
                        <span className="w-2 h-2 rounded-full bg-amber-400" />
                        {notConnectedCount}
                      </span>
                    </div>
                    {expandedStore === store.id ? (
                      <ChevronUp size={18} className="text-gray-500" />
                    ) : (
                      <ChevronDown size={18} className="text-gray-500" />
                    )}
                  </div>
                </div>

                {expandedStore === store.id && (
                  <div className="bg-gray-900/50 border-t border-gray-800 p-4 animate-in slide-in-from-top-2 duration-200">
                    <h5 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                      <Camera size={12} /> Dispositivos
                    </h5>

                    {store.devices.length > 0 ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {store.devices.map((device) => (
                          <div
                            key={device.id}
                            className="flex items-center justify-between bg-gray-950 p-3 rounded border border-gray-800"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <div
                                className={`w-2 h-2 rounded-full ${getDeviceStatusDotClass(device.status)}`}
                              />
                              <div className="min-w-0">
                                <p className="text-xs font-medium text-gray-200 truncate">{device.name}</p>
                                <p className="text-[10px] text-gray-600 font-mono truncate">
                                  {device.macAddress || '-'}
                                </p>
                              </div>
                            </div>

                            <span className={`text-[10px] px-2 py-0.5 rounded border uppercase ${getDeviceStatusBadgeClass(device.status)}`}>
                              {getDeviceStatusLabel(device.status)}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-500 italic">Nenhum dispositivo vinculado a esta loja.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <aside className="bg-gray-900 border border-gray-800 rounded-xl p-4 h-fit lg:sticky lg:top-6">
        <h3 className="text-sm font-bold text-white mb-4">Estatisticas dos dispositivos</h3>
        <p className="text-[11px] text-gray-500 mb-3">
          Confirmados: {deviceStats.confirmed.toLocaleString()} / {deviceStats.total.toLocaleString()}
        </p>

        <div className="grid grid-cols-1 gap-3">
          <div className="bg-gray-950 border border-gray-800 rounded-lg p-3">
            <div className="flex items-center justify-between">
              <p className="text-[10px] uppercase tracking-wider text-gray-500">Dispositivos online</p>
              <p className="text-xs text-gray-300 font-medium">
                {deviceStats.online.toLocaleString()} / {deviceStats.total.toLocaleString()}
              </p>
            </div>
            <div className="mt-2 h-2 rounded bg-gray-800 overflow-hidden">
              <div className="h-full bg-emerald-500" style={{ width: `${deviceStats.onlinePct}%` }} />
            </div>
          </div>

          <div className="bg-gray-950 border border-gray-800 rounded-lg p-3">
            <div className="flex items-center justify-between">
              <p className="text-[10px] uppercase tracking-wider text-gray-500">Offline</p>
              <p className="text-xs text-gray-300 font-medium">
                {deviceStats.offline.toLocaleString()} / {deviceStats.total.toLocaleString()}
              </p>
            </div>
            <div className="mt-2 h-2 rounded bg-gray-800 overflow-hidden">
              <div className="h-full bg-red-500" style={{ width: `${deviceStats.offlinePct}%` }} />
            </div>
          </div>

          <div className="bg-gray-950 border border-gray-800 rounded-lg p-3">
            <div className="flex items-center justify-between">
              <p className="text-[10px] uppercase tracking-wider text-gray-500">Nao conectados</p>
              <p className="text-xs text-gray-300 font-medium">
                {deviceStats.notConnected.toLocaleString()} / {deviceStats.total.toLocaleString()}
              </p>
            </div>
            <div className="mt-2 h-2 rounded bg-gray-800 overflow-hidden">
              <div className="h-full bg-amber-400" style={{ width: `${deviceStats.notConnectedPct}%` }} />
            </div>
          </div>
        </div>
      </aside>
    </div>
  );

  const renderWhatsappTab = () => (
    <div className="space-y-4">
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        <div className={`rounded-xl border p-4 ${integrationStatus.configured ? 'border-emerald-700 bg-emerald-950/30' : 'border-amber-700 bg-amber-950/20'}`}>
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            {integrationStatus.configured ? <CheckCircle2 size={16} className="text-emerald-400" /> : <AlertTriangle size={16} className="text-amber-400" />}
            Integracao ZapResponder
          </div>
          <p className="text-xs text-gray-300 mt-2">
            {integrationStatus.configured
              ? `${integrationStatus.phoneLabel} / ${integrationStatus.departmentName}`
              : 'Configuracao pendente no backend'}
          </p>
          {!integrationStatus.configured && integrationStatus.missing.length > 0 && (
            <p className="text-[11px] text-amber-300 mt-2">{integrationStatus.missing.join(', ')}</p>
          )}
        </div>

        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Phone size={16} className="text-sky-400" />
            Contatos ativos
          </div>
          <p className="text-2xl font-bold text-white mt-3">{monitoringStats.enabledContacts}</p>
          <p className="text-xs text-gray-500 mt-1">{monitoringStats.contacts} contatos cadastrados</p>
        </div>

        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <BellRing size={16} className="text-amber-400" />
            Alertas pendentes
          </div>
          <p className="text-2xl font-bold text-white mt-3">{monitoringStats.pendingAlerts}</p>
          <p className="text-xs text-gray-500 mt-1">Aguardando janela de 1 hora ou contato</p>
        </div>

        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <MessageSquare size={16} className="text-emerald-400" />
            Alertas disparados
          </div>
          <p className="text-2xl font-bold text-white mt-3">{monitoringStats.notifiedAlerts}</p>
          <p className="text-xs text-gray-500 mt-1">{monitoringStats.resolvedAlerts} resolvidos no historico recente</p>
        </div>
      </div>

      {monitoringMessage && (
        <div className={`rounded-xl border p-4 text-sm ${monitoringTablesReady ? 'border-amber-700 bg-amber-950/20 text-amber-200' : 'border-red-800 bg-red-950/20 text-red-200'}`}>
          {monitoringMessage}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-4">
        <section className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-white">Cadastrar responsavel</h3>
              <p className="text-xs text-gray-500 mt-1">
                Primeiro selecione a rede. Depois escolha se o numero vale para a rede inteira ou para uma loja dessa rede.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-xs uppercase tracking-wider text-gray-500 block mb-1">Rede</label>
              {isAdmin ? (
                <select
                  value={selectedClientId}
                  onChange={(event) => {
                    setSelectedClientId(event.target.value);
                    setContactForm((prev) => ({ ...prev, storeId: '' }));
                  }}
                  className="w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-emerald-500"
                >
                  <option value="">Selecione a rede</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white">
                  {activeClientName || 'Rede nao vinculada'}
                </div>
              )}
              <p className="text-[11px] text-gray-600 mt-1">
                O responsavel sera salvo dentro da rede selecionada.
              </p>
            </div>

            <div>
              <label className="text-xs uppercase tracking-wider text-gray-500 block mb-1">Responsavel</label>
              <input
                value={contactForm.responsibleName}
                onChange={(event) => setContactForm((prev) => ({ ...prev, responsibleName: event.target.value }))}
                placeholder="Ex.: Operacao Panvel"
                className="w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="text-xs uppercase tracking-wider text-gray-500 block mb-1">WhatsApp</label>
              <input
                value={contactForm.phoneNumber}
                onChange={(event) => setContactForm((prev) => ({ ...prev, phoneNumber: event.target.value }))}
                placeholder="(51) 99999-9999"
                className="w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-emerald-500"
              />
              <p className="text-[11px] text-gray-600 mt-1">O backend normaliza para o formato 55DDDNumero.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs uppercase tracking-wider text-gray-500 block mb-1">Escopo</label>
                <select
                  value={contactForm.scopeType}
                  onChange={(event) =>
                    setContactForm((prev) => ({
                      ...prev,
                      scopeType: event.target.value as ContactScope,
                      storeId: event.target.value === 'network' ? '' : prev.storeId,
                    }))
                  }
                  className="w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-emerald-500"
                >
                  <option value="network">
                    {activeClientName ? `Rede inteira (${activeClientName})` : 'Rede inteira'}
                  </option>
                  <option value="store">
                    {activeClientName ? `Loja da rede ${activeClientName}` : 'Loja da rede selecionada'}
                  </option>
                </select>
              </div>

              <div>
                <label className="text-xs uppercase tracking-wider text-gray-500 block mb-1">Loja</label>
                <select
                  value={contactForm.storeId}
                  disabled={contactForm.scopeType !== 'store'}
                  onChange={(event) => setContactForm((prev) => ({ ...prev, storeId: event.target.value }))}
                  className="w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-emerald-500 disabled:opacity-50"
                >
                  <option value="">
                    {activeClientName ? `Selecione a loja de ${activeClientName}` : 'Selecione a loja'}
                  </option>
                  {storeOptions.map((store) => (
                    <option key={store.id} value={store.id}>
                      {store.name} - {store.city}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <button
              onClick={() => void handleSaveContact()}
              disabled={savingContact || !activeClientId || !monitoringTablesReady}
              className="w-full inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
            >
              {savingContact ? <RefreshCw size={16} className="animate-spin" /> : <Plus size={16} />}
              {savingContact ? 'Salvando...' : 'Salvar responsavel'}
            </button>
          </div>
        </section>

        <section className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-white">Contatos cadastrados</h3>
              <p className="text-xs text-gray-500 mt-1">
                Rede atual: {activeClientName || 'Nao informada'}. Loja tem prioridade. Se nao houver contato da loja, o monitor usa o contato da rede.
              </p>
            </div>
            {monitoringLoading && <RefreshCw size={16} className="animate-spin text-gray-500" />}
          </div>

          {contacts.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-800 bg-gray-950/50 p-8 text-center text-sm text-gray-500">
              Nenhum contato cadastrado para esta rede.
            </div>
          ) : (
            <div className="space-y-3">
              {contacts.map((contact) => (
                <div
                  key={contact.id}
                  className="rounded-xl border border-gray-800 bg-gray-950 p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-white">{contact.responsible_name}</p>
                      <span className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded-full border ${contact.enabled ? 'border-emerald-700 text-emerald-300 bg-emerald-950/30' : 'border-gray-700 text-gray-400 bg-gray-900'}`}>
                        {contact.enabled ? 'Ativo' : 'Pausado'}
                      </span>
                      <span className="text-[10px] uppercase tracking-wider px-2 py-1 rounded-full border border-gray-700 text-gray-300 bg-gray-900">
                        {contact.scope_type === 'store' ? 'Loja' : 'Rede'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      {contact.phone_number} • Rede: {activeClientName || 'Nao informada'} • {resolveStoreName(contact.store_id)}
                    </p>
                    <p className="text-[11px] text-gray-600 mt-1">
                      Formato monitorado: {contact.phone_e164 || normalizeBrazilPhone(contact.phone_number)}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => void handleToggleContact(contact)}
                      disabled={togglingContactId === contact.id}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-700 text-xs text-gray-200 hover:border-emerald-500 transition-colors disabled:opacity-50"
                    >
                      {togglingContactId === contact.id ? <RefreshCw size={14} className="animate-spin" /> : <BellRing size={14} />}
                      {contact.enabled ? 'Pausar' : 'Ativar'}
                    </button>

                    <button
                      onClick={() => void handleTestContact(contact)}
                      disabled={testingContactId === contact.id || !integrationStatus.configured}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-sky-700/70 text-xs text-sky-200 hover:border-sky-500 transition-colors disabled:opacity-50"
                    >
                      {testingContactId === contact.id ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
                      Testar envio
                    </button>

                    <button
                      onClick={() => void handleDeleteContact(contact)}
                      disabled={deletingContactId === contact.id}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-red-800/70 text-xs text-red-200 hover:border-red-500 transition-colors disabled:opacity-50"
                    >
                      {deletingContactId === contact.id ? <RefreshCw size={14} className="animate-spin" /> : <Trash2 size={14} />}
                      Excluir
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="bg-gray-900 border border-gray-800 rounded-xl">
        <button
          type="button"
          onClick={() => setIsGuideExpanded((current) => !current)}
          className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left transition-colors hover:bg-gray-800/40"
        >
          <div>
            <h3 className="text-sm font-bold text-white">Como acompanhar os envios</h3>
            <p className="text-xs text-gray-500 mt-1">
              O teste manual e o alerta real aparecem de formas diferentes para evitar confusao.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs text-gray-400">
            <span>{isGuideExpanded ? 'Recolher' : 'Expandir'}</span>
            {isGuideExpanded ? <ChevronUp size={18} className="text-gray-500" /> : <ChevronDown size={18} className="text-gray-500" />}
          </div>
        </button>

        {isGuideExpanded && (
          <div className="border-t border-gray-800 px-4 pb-4 pt-4 space-y-4 animate-in slide-in-from-top-2 duration-200">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="rounded-xl border border-sky-800/60 bg-sky-950/20 p-4">
                <p className="text-sm font-semibold text-sky-200">Teste manual</p>
                <p className="text-xs text-sky-100/80 mt-2">
                  Ao clicar em <strong>Testar envio</strong>, a mensagem sai na hora para aquele contato.
                  Hoje o painel confirma com popup de sucesso/erro, mas esse teste nao entra no historico de incidentes.
                </p>
              </div>

              <div className="rounded-xl border border-amber-800/60 bg-amber-950/20 p-4">
                <p className="text-sm font-semibold text-amber-200">Alerta real</p>
                <p className="text-xs text-amber-100/80 mt-2">
                  Se o dispositivo ficar offline e continuar assim por 1 hora, o primeiro WhatsApp sai com os
                  devices daquela loja consolidados em uma unica mensagem. Depois disso, se continuar offline, o
                  reenvio acontece {OFFLINE_REPEAT_AFTER_FIRST_HOURS}h depois; a partir do terceiro envio, o intervalo vira para a cada {OFFLINE_REPEAT_AFTER_THIRD_DAYS} dias.
                </p>
              </div>

              <div className="rounded-xl border border-emerald-800/60 bg-emerald-950/20 p-4">
                <p className="text-sm font-semibold text-emerald-200">Resolucao</p>
                <p className="text-xs text-emerald-100/80 mt-2">
                  Quando o dispositivo volta ao normal, ele sai da lista principal e passa a aparecer em
                  <strong> Logs de Acesso &gt; Monitoramento offline</strong>, com o horario final em <strong>Voltou online</strong>.
                </p>
              </div>
            </div>

              <div className="rounded-xl border border-violet-800/60 bg-violet-950/20 p-4">
                <p className="text-sm font-semibold text-violet-200">Motivo do offline</p>
                <p className="text-xs text-violet-100/80 mt-2">
                  Agora cada incidente pode receber um <strong>Motivo</strong> para registro. Esse motivo nao entra na mensagem inicial de offline.
                  Se o alerta ja tiver sido enviado e voce atualizar o motivo depois disso, o sistema manda uma mensagem complementar com a justificativa.
                </p>
              </div>

            <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
              <div className="rounded-xl border border-gray-800 bg-gray-950 p-4">
                <p className="text-sm font-semibold text-white">Mensagem de teste</p>
                <pre className="mt-3 whitespace-pre-wrap break-words text-xs text-gray-300 font-mono leading-5">
                  {whatsappMessagePreview.test}
                </pre>
              </div>

              <div className="rounded-xl border border-gray-800 bg-gray-950 p-4">
                <p className="text-sm font-semibold text-white">Mensagem de alerta offline agrupada</p>
                <pre className="mt-3 whitespace-pre-wrap break-words text-xs text-gray-300 font-mono leading-5">
                  {whatsappMessagePreview.offline}
                </pre>
              </div>

              <div className="rounded-xl border border-gray-800 bg-gray-950 p-4">
                <p className="text-sm font-semibold text-white">Mensagem complementar com motivo</p>
                <pre className="mt-3 whitespace-pre-wrap break-words text-xs text-gray-300 font-mono leading-5">
                  {whatsappMessagePreview.reasonUpdate}
                </pre>
              </div>

              <div className="rounded-xl border border-gray-800 bg-gray-950 p-4">
                <p className="text-sm font-semibold text-white">Mensagem de resolucao</p>
                <pre className="mt-3 whitespace-pre-wrap break-words text-xs text-gray-300 font-mono leading-5">
                  {whatsappMessagePreview.resolved}
                </pre>
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-white">Pendentes de envio</h3>
            <p className="text-xs text-gray-500 mt-1">So dispositivos offline que ainda nao tiveram o primeiro WhatsApp disparado.</p>
          </div>
        </div>

        {activeAlerts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-800 bg-gray-950/50 p-8 text-center text-sm text-gray-500 mt-4">
            Nenhum alerta offline aguardando envio para esta rede no momento.
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {activeAlerts.map((alert) => {
              const offlineMinutes = diffMinutesFromNow(alert.first_detected_at);
              const waitingWindow = !alert.notified_at && offlineMinutes < OFFLINE_VALIDATION_MINUTES;
              const scheduledNotificationAt = new Date(
                Date.parse(alert.first_detected_at) + OFFLINE_VALIDATION_MINUTES * 60 * 1000
              ).toISOString();
              const availableContacts = getManualContactsForAlert(alert);
              const isReasonExpanded = Boolean(expandedReasonAlerts[alert.id]);

              const badgeClass = waitingWindow
                ? 'border-amber-700 bg-amber-950/30 text-amber-200'
                : 'border-emerald-700 bg-emerald-950/30 text-emerald-200';

              const badgeLabel = waitingWindow
                ? `Envia em ${Math.max(0, OFFLINE_VALIDATION_MINUTES - offlineMinutes)} min`
                : 'Pronto para enviar';

              return (
                <div key={alert.id} className="rounded-xl border border-gray-800 bg-gray-950 p-4">
                  <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-white">{alert.device_name}</p>
                        <span className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded-full border ${badgeClass}`}>
                          {badgeLabel}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 mt-1">
                        {alert.store_name || 'Loja nao informada'} • {alert.client_name || activeClientName || 'Rede selecionada'}
                      </p>
                      <p className="text-[11px] text-gray-600 mt-1">
                        Detectado em {formatDateTime(alert.first_detected_at)}
                        {alert.mac_address ? ` • ${alert.mac_address}` : ''}
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-gray-300 min-w-[260px]">
                      <div className="rounded-lg border border-gray-800 bg-gray-900 px-3 py-2">
                        <p className="text-[10px] uppercase tracking-wider text-gray-500">Previsao do envio</p>
                        <p className="mt-1">
                          {waitingWindow ? formatDateTime(scheduledNotificationAt) : `Pronto desde ${formatDateTime(scheduledNotificationAt)}`}
                        </p>
                      </div>
                      <div className="rounded-lg border border-gray-800 bg-gray-900 px-3 py-2">
                        <p className="text-[10px] uppercase tracking-wider text-gray-500">Ultima leitura offline</p>
                        <p className="mt-1">{formatDateTime(alert.last_seen_offline_at || alert.first_detected_at)}</p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 rounded-xl border border-gray-800 bg-gray-900/60 p-3">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedReasonAlerts((prev) => ({
                              ...prev,
                              [alert.id]: !prev[alert.id],
                            }))
                          }
                          className="flex w-full items-center justify-between gap-3 rounded-lg border border-gray-800 bg-gray-950/70 px-3 py-2 text-left transition-colors hover:border-emerald-600"
                        >
                          <div>
                            <p className="text-[11px] uppercase tracking-wider text-gray-500">Motivo do offline</p>
                            <p className="mt-1 text-xs text-gray-400">
                              {reasonDrafts[alert.id]?.trim()
                                ? 'Motivo preenchido. Clique para revisar ou editar.'
                                : 'Clique para abrir e registrar o motivo deste incidente.'}
                            </p>
                          </div>

                          {isReasonExpanded ? (
                            <ChevronUp size={16} className="text-gray-500" />
                          ) : (
                            <ChevronDown size={16} className="text-gray-500" />
                          )}
                        </button>

                        {isReasonExpanded && (
                          <>
                        <textarea
                          value={reasonDrafts[alert.id] ?? ''}
                          onChange={(event) =>
                            setReasonDrafts((prev) => ({
                              ...prev,
                              [alert.id]: event.target.value,
                            }))
                          }
                          placeholder="Ex.: manutencao programada, internet da loja indisponivel, queda de energia..."
                          rows={3}
                          className="mt-2 w-full resize-none rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500 disabled:opacity-50"
                        />
                        <div className="mt-2 flex flex-wrap gap-2">
                          {OFFLINE_REASON_SUGGESTIONS.map((reason) => (
                            <button
                              key={`${alert.id}-${reason}`}
                              type="button"
                              onClick={() =>
                                setReasonDrafts((prev) => ({
                                  ...prev,
                                  [alert.id]: reason,
                                }))
                              }
                              className="rounded-full border border-gray-700 bg-gray-950 px-2.5 py-1 text-[11px] text-gray-300 transition-colors hover:border-emerald-500 hover:text-white"
                            >
                              {reason}
                            </button>
                          ))}
                        </div>
                        {alert.offline_reason_updated_at && (
                          <p className="mt-2 text-[11px] text-gray-600">
                            Ultima atualizacao do motivo: {formatDateTime(alert.offline_reason_updated_at)}
                            {alert.offline_reason_sent_at ? ` • enviado em ${formatDateTime(alert.offline_reason_sent_at)}` : ''}
                          </p>
                        )}
                          </>
                        )}
                      </div>

                      <div className="lg:pl-3 lg:min-w-[280px] space-y-2">
                        <button
                          type="button"
                          onClick={() => void handleSaveReason(alert)}
                          disabled={savingReasonId === alert.id}
                          className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-700 bg-emerald-950/30 px-3 py-2 text-sm font-medium text-emerald-200 transition-colors hover:border-emerald-500 hover:text-white disabled:opacity-50"
                        >
                          {savingReasonId === alert.id ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
                          {savingReasonId === alert.id ? 'Salvando motivo...' : 'Salvar motivo'}
                        </button>
                        <div className="rounded-lg border border-gray-800 bg-gray-950/80 p-3">
                          <p className="text-[11px] uppercase tracking-wider text-gray-500">Enviar agora</p>
                          <select
                            value={manualAlertContactIds[alert.id] ?? ''}
                            onChange={(event) =>
                              setManualAlertContactIds((prev) => ({
                                ...prev,
                                [alert.id]: event.target.value,
                              }))
                            }
                            className="mt-2 w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-emerald-500"
                          >
                            <option value="">Usar contato padrao da loja/rede</option>
                            {availableContacts.map((contact) => (
                              <option key={`${alert.id}-${contact.id}`} value={contact.id}>
                                {contact.responsible_name} - {getContactScopeLabel(contact)}
                              </option>
                            ))}
                          </select>
                          <input
                            type="tel"
                            value={manualAlertPhones[alert.id] ?? ''}
                            onChange={(event) =>
                              setManualAlertPhones((prev) => ({
                                ...prev,
                                [alert.id]: event.target.value,
                              }))
                            }
                            placeholder="Ou envie uma unica vez para outro numero"
                            className="mt-2 w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-emerald-500"
                          />
                          <p className="mt-2 text-[11px] leading-5 text-gray-500">
                            Se preencher um numero aqui, o envio imediato usa esse WhatsApp so desta vez, sem cadastrar contato.
                            Se houver outros devices offline da mesma loja, eles vao juntos na mesma mensagem.
                          </p>

                          <button
                            type="button"
                            onClick={() => void handleSendAlertNow(alert)}
                            disabled={sendingAlertId === alert.id || !integrationStatus.configured}
                            className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-sky-700/70 bg-sky-950/20 px-3 py-2 text-sm font-medium text-sky-200 transition-colors hover:border-sky-500 hover:text-white disabled:opacity-50"
                          >
                            {sendingAlertId === alert.id ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
                            {sendingAlertId === alert.id ? 'Enviando agora...' : 'Enviar agora'}
                          </button>
                        </div>
                        <p className="mt-2 text-[11px] leading-5 text-gray-500">
                          O motivo fica registrado no painel. O envio imediato permite disparar esse alerta agora, sem esperar a janela automatica de 1 hora.
                        </p>
                      </div>
                    </div>
                  </div>

                  {alert.last_notification_error && (
                    <div className="mt-3 rounded-lg border border-amber-800/70 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-200">
                      Ultimo retorno do monitor: {alert.last_notification_error}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

    </div>
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {feedback && (
        <div className="fixed top-6 right-6 z-50 w-full max-w-sm animate-in slide-in-from-top-2 duration-300">
          <div
            className={`rounded-2xl border shadow-2xl backdrop-blur-sm overflow-hidden ${
              feedback.tone === 'success'
                ? 'border-emerald-700 bg-emerald-950/95'
                : feedback.tone === 'error'
                  ? 'border-red-700 bg-red-950/95'
                  : 'border-sky-700 bg-sky-950/95'
            }`}
          >
            <div className="flex items-start gap-3 p-4">
              <div
                className={`mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl ${
                  feedback.tone === 'success'
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : feedback.tone === 'error'
                      ? 'bg-red-500/15 text-red-300'
                      : 'bg-sky-500/15 text-sky-300'
                }`}
              >
                {feedback.tone === 'success' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white">{feedback.title}</p>
                <p className="mt-1 text-xs leading-5 text-gray-200">{feedback.message}</p>
              </div>

              <button
                type="button"
                onClick={() => setFeedback(null)}
                className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-white/5 hover:text-white"
                aria-label="Fechar aviso"
              >
                <X size={16} />
              </button>
            </div>

            <div
              className={`h-1 w-full ${
                feedback.tone === 'success'
                  ? 'bg-emerald-500/70'
                  : feedback.tone === 'error'
                    ? 'bg-red-500/70'
                    : 'bg-sky-500/70'
              }`}
            />
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            {isWhatsappPage ? (
              <WifiOff className="text-emerald-500" size={22} />
            ) : (
              <Building2 className="text-emerald-500" size={22} />
            )}
            {isWhatsappPage ? 'Alertas WhatsApp' : 'Dispositivos Online'}
          </h1>
          <p className="text-gray-400 text-sm">{headerSubtitle}</p>
          {lastUpdatedAt && (
            <p className="text-gray-600 text-xs mt-1">
              Atualizado em {lastUpdatedAt.toLocaleTimeString('pt-BR')}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isAdmin && (
            <select
              value={selectedClientId}
              onChange={(event) => setSelectedClientId(event.target.value)}
              className="bg-gray-950 border border-gray-800 text-white rounded-lg px-3 py-2 outline-none focus:border-emerald-500 min-w-[260px]"
            >
              <option value="" style={{ backgroundColor: '#111827', color: '#9CA3AF' }}>
                Selecione uma rede...
              </option>
              {clients.map((client) => (
                <option
                  key={client.id}
                  value={client.id}
                  style={{ backgroundColor: '#111827', color: 'white' }}
                >
                  {client.name}
                </option>
              ))}
            </select>
          )}

          <button
            onClick={() => {
              if (!activeClientId) return;

              void (async () => {
                try {
                  await triggerStoreSync(activeClientId, { force: true, waitForCompletion: true });
                  await refresh();

                  if (isWhatsappPage) {
                    await handleDispatchPendingAlerts(activeClientId, { silentWhenNoop: true });
                  }
                } catch (error: any) {
                  showFeedback('Falha na atualizacao', error?.message || String(error), 'error');
                }
              })();
            }}
            disabled={loading || isSyncingDisplay || !activeClientId}
            className="h-[40px] w-[40px] flex items-center justify-center bg-gray-900 border border-gray-800 text-white rounded-lg hover:border-emerald-600 hover:text-emerald-400 transition-colors disabled:opacity-50"
            title="Atualizar agora"
          >
            {loading || isSyncingDisplay ? (
              <span className="inline-block w-3.5 h-3.5 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              <RefreshCw size={16} className="text-gray-400" />
            )}
          </button>
        </div>
      </div>

      {syncWarning && (
        <div className="rounded-xl border border-amber-700 bg-amber-950/20 px-4 py-3 text-sm text-amber-200">
          {syncWarning}
        </div>
      )}

      {!activeClientId ? (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-10 text-center text-gray-500">
          {isAdmin
            ? 'Selecione uma rede acima para carregar os dispositivos.'
            : 'Seu usuario nao esta vinculado a uma rede.'}
        </div>
      ) : (
        <>
          {isWhatsappPage ? renderWhatsappTab() : renderOverview()}
        </>
      )}
    </div>
  );
}
