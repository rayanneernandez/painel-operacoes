import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  Globe, Clock, Building2, ChevronRight, ChevronDown,
  LayoutGrid, Users, BarChart2, Image, Upload, Calendar,
  Maximize2, Minimize2
} from 'lucide-react';

import { AVAILABLE_WIDGETS, WIDGET_MAP } from '../components/DashboardWidgets';
import type { WidgetType } from '../components/DashboardWidgets';
import { ExportButton } from '../components/ExportButton';
import supabase from '../lib/supabase';

// ── Controle de rebuild em andamento (nível de módulo) ───────────────────────
const _rebuilding = new Set<string>();

// ── Intervalo mínimo entre syncs background (1 hora) ─────────────────────────
const SYNC_INTERVAL_MS = 60 * 60 * 1000;
const lastSyncKey = (cid: string) => `last_bg_sync_${cid}`;

function shouldSync(clientId: string): boolean {
  try {
    const raw = localStorage.getItem(lastSyncKey(clientId));
    if (!raw) return true;
    const last = Number(raw);
    return Number.isFinite(last) && Date.now() - last > SYNC_INTERVAL_MS;
  } catch { return true; }
}
function markSynced(clientId: string) {
  try { localStorage.setItem(lastSyncKey(clientId), String(Date.now())); } catch {}
}

type CameraType = {
  id: string; name: string; status: 'online' | 'offline';
  type: 'dome' | 'bullet' | 'ptz'; resolution: '1080p' | '4k';
  lastEvent?: string; macAddress?: string;
};
type StoreType = {
  id: string; name: string; address: string; city: string;
  status: 'online' | 'offline'; cameras: CameraType[];
};
type ClientApiConfig = {
  api_endpoint: string; analytics_endpoint: string; api_key: string;
  custom_header_key?: string | null; custom_header_value?: string | null;
  collection_start?: string | null; collection_end?: string | null;
  collect_tracks?: boolean; collect_face_quality?: boolean;
  collect_glasses?: boolean; collect_beard?: boolean;
  collect_hair_color?: boolean; collect_hair_type?: boolean;
  collect_headwear?: boolean;
};

export function ClientDashboard() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user: authUser } = useAuth();

  const [view, setView] = useState<'network' | 'store' | 'camera'>('network');
  const [selectedStore, setSelectedStore] = useState<StoreType | null>(null);
  const [selectedCamera, setSelectedCamera] = useState<CameraType | null>(null);
  const [stores, setStores] = useState<StoreType[]>([]);
  const [clientData, setClientData] = useState<{ name: string; logo?: string } | null>(null);
  const [apiConfig, setApiConfig] = useState<ClientApiConfig | null>(null);

  const [selectedStartDate, setSelectedStartDate] = useState<Date>(() => {
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setUTCHours(0, 0, 0, 0); return yesterday;
  });
  const [selectedEndDate, setSelectedEndDate] = useState<Date>(() => {
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setUTCHours(23, 59, 59, 999); return yesterday;
  });
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [draftStartDate, setDraftStartDate] = useState<Date>(() => {
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setUTCHours(0, 0, 0, 0); return yesterday;
  });
  const [draftEndDate, setDraftEndDate] = useState<Date>(() => {
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setUTCHours(23, 59, 59, 999); return yesterday;
  });
  const autoTodayRef = useRef(true);
  const didApplyD1DefaultRef = useRef(false);
  const loadSeqRef = useRef(0);
  // Flag para clientes que usam D-2 como data padrão (ex: Panvel)
  const useD2DefaultRef = useRef(false);

  const [syncMessage, setSyncMessage] = useState('');
  const [isSyncingStores, setIsSyncingStores] = useState(false);
  const syncingRef = useRef(false);
  const salesSourceRef = useRef<'unknown' | 'sales_daily' | 'sales' | 'none'>('unknown');

  const [isFullscreen, setIsFullscreen] = useState(false);
  const dashboardRef = useRef<HTMLDivElement>(null);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      dashboardRef.current?.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  useEffect(() => {
    if (!syncMessage || !syncMessage.startsWith('✅')) return;
    const t = setTimeout(() => setSyncMessage(''), 5000);
    return () => clearTimeout(t);
  }, [syncMessage]);

  // Auto-D1 (ontem)
  useEffect(() => {
    const tick = () => {
      if (!autoTodayRef.current) return;
      const s = new Date(); s.setDate(s.getDate() - 1); s.setUTCHours(0, 0, 0, 0);
      const e = new Date(); e.setDate(e.getDate() - 1); e.setUTCHours(23, 59, 59, 999);
      if (selectedStartDate.getTime() !== s.getTime()) setSelectedStartDate(s);
      if (selectedEndDate.getTime() !== e.getTime()) setSelectedEndDate(e);
      setDraftStartDate(s);
      setDraftEndDate(e);
    };
    tick();
    const t = setInterval(tick, 60 * 1000);
    return () => clearInterval(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!showDatePicker) {
      setDraftStartDate(selectedStartDate);
      setDraftEndDate(selectedEndDate);
    }
  }, [selectedStartDate, selectedEndDate, showDatePicker]);

  // Dashboard state
  const [totalVisitors, setTotalVisitors] = useState(0);
  const [dailyStats, setDailyStats] = useState<number[]>([0, 0, 0, 0, 0, 0, 0]);
  const [hourlyStats, setHourlyStats] = useState<number[]>(new Array(24).fill(0));
  const [avgVisitorsPerDay, setAvgVisitorsPerDay] = useState(0);
  const [avgVisitSeconds, setAvgVisitSeconds] = useState(0);
  const [avgAttentionSeconds, setAvgAttentionSeconds] = useState(0);
  const [genderStats, setGenderStats] = useState<{ label: string; value: number }[]>([]);
  const [attributeStats, setAttributeStats] = useState<{ label: string; value: number }[]>([]);
  const [ageStats, setAgeStats] = useState<{ age: string; m: number; f: number }[]>([]);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const SPANS = [3, 4, 6, 8, 12] as const;
  type Span = typeof SPANS[number];
  const [widgetLayout, setWidgetLayout] = useState<Record<string, { colSpanLg?: Span; heightPx?: number }>>({});
  const [activeWidgets, setActiveWidgets] = useState<WidgetType[]>([]);
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  const [isLoadingData, setIsLoadingData] = useState(false);

  const [isLoadingQuarter, setIsLoadingQuarter] = useState(false);
  const [quarterBars, setQuarterBars] = useState<{ label: string; visitors: number; sales: number }[]>([]);
  const [quarterVisitorsTotal, setQuarterVisitorsTotal] = useState(0);
  const [quarterSalesTotal, setQuarterSalesTotal] = useState(0);

  const [visitorsPerDayMap, setVisitorsPerDayMap] = useState<Record<string, number>>({});
  const [hairTypeData, setHairTypeData] = useState<{ label: string; value: number }[]>([]);
  const [hairColorData, setHairColorData] = useState<{ label: string; value: number }[]>([]);
  const [isLoadingCompare, setIsLoadingCompare] = useState(false);
  const [comparePrevVisitorsPerDay, setComparePrevVisitorsPerDay] = useState<Record<string, number>>({});

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60); const sec = Math.round(s % 60);
    const h = Math.floor(m / 60); const mm = m % 60;
    return h > 0
      ? `${String(h).padStart(2,'0')}:${String(mm).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
      : `${String(mm).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  };

  const pctMapToTopData = (m: any, maxItems = 3) => {
    const entries = Object.entries(m || {})
      .map(([k, v]) => ({ label: String(k), value: Number(v) || 0 }))
      .filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
    const top = entries.slice(0, maxItems);
    const rest = entries.slice(maxItems);
    const restSum = rest.reduce((acc, r) => acc + r.value, 0);
    if (restSum > 0) top.push({ label: 'Outros', value: restSum });
    return top;
  };

  const deviceIds = useMemo(() => {
    if (view === 'camera' && selectedCamera) {
      const n = Number((selectedCamera as any).macAddress);
      return Number.isFinite(n) ? [n] : [];
    }
    if ((view === 'store' || (view === 'network' && selectedStore)) && selectedStore) {
      return selectedStore.cameras.map((c) => Number((c as any).macAddress)).filter((n) => Number.isFinite(n));
    }
    return [];
  }, [view, selectedStore, selectedCamera]);

  function applyRollup(rollup: any) {
    if (!rollup) return false;
    setTotalVisitors(rollup.total_visitors ?? 0);
    setAvgVisitorsPerDay(Math.round(rollup.avg_visitors_per_day ?? 0));
    setAvgVisitSeconds(Math.round(rollup.avg_visit_time_seconds ?? 0));
    setAvgAttentionSeconds(Math.round(
      rollup.avg_attention_seconds ?? rollup.avg_contact_time_seconds ?? rollup.avg_attention_sec ?? 0
    ));
    const vpd: Record<string, number> = rollup.visitors_per_day ?? {};
    setVisitorsPerDayMap(vpd);
    const vph: Record<string, number> = rollup.visitors_per_hour_avg ?? {};
    const hours = new Array(24).fill(0);
    Object.entries(vph).forEach(([h, v]) => { hours[Number(h)] = Math.round(Number(v)); });
    setHourlyStats(hours);
    const gp: Record<string, number> = rollup.gender_percent ?? {};
    setGenderStats([
      { label: 'Masculino', value: Math.round(gp.male ?? 0) },
      { label: 'Feminino',  value: Math.round(gp.female ?? 0) },
    ]);
    const ap: any = rollup.attributes_percent ?? {};
    const glassesRaw = ap.glasses ?? {};
    const facialRaw  = ap.facial_hair ?? {};
    const glassesHasCats = Object.keys(glassesRaw).some(k => ['usual','dark','none'].includes(k));
    const facialHasCats  = Object.keys(facialRaw).some(k  => ['shaved','beard','goatee','stubble','mustache'].includes(k));
    const glassesWithPct = glassesHasCats
      ? Number(glassesRaw.usual ?? 0) + Number(glassesRaw.dark ?? 0)
      : Number(glassesRaw.true ?? 0);
    const glassesTotal = Math.round(glassesWithPct);
    const facialTotal = facialHasCats
      ? Math.round(Object.entries(facialRaw).filter(([k]) => k !== 'shaved').reduce((a, [, v]) => a + Number(v), 0))
      : Math.round(facialRaw.true ?? 0);
    const glassesData: { label: string; value: number }[] = glassesHasCats
      ? Object.entries(glassesRaw).filter(([, v]) => Number(v) > 0).map(([k, v]) => ({ label: k, value: Number(v) }))
      : glassesTotal > 0 ? [{ label: 'true', value: glassesTotal }, { label: 'false', value: Math.max(0, 100 - glassesTotal) }] : [];
    const facialData: { label: string; value: number }[] = facialHasCats
      ? Object.entries(facialRaw).filter(([, v]) => Number(v) > 0).map(([k, v]) => ({ label: k, value: Number(v) }))
      : facialTotal > 0 ? [{ label: 'beard', value: facialTotal }, { label: 'shaved', value: Math.max(0, 100 - facialTotal) }] : [];
    setHairTypeData(pctMapToTopData(ap.hair_type));
    setHairColorData(pctMapToTopData(ap.hair_color));
    const headwearPct = Math.round(Number(ap.headwear?.true ?? 0));
    setAttributeStats([
      { label: 'Óculos',      value: glassesTotal },
      { label: 'Barba',       value: facialTotal },
      { label: 'Máscara',     value: 0 },
      { label: 'Chapéu/Boné', value: headwearPct },
      ...glassesData.map(d => ({ label: `_glasses_${d.label}`, value: d.value })),
      ...facialData.map(d  => ({ label: `_facial_${d.label}`,  value: d.value })),
    ]);
    const agePct: Record<string, number> = rollup.age_pyramid_percent ?? {};
    const ageOrder = ['65+', '55-64', '45-54', '35-44', '25-34', '18-24', '18-'];
    const ageMap: Record<string, { m: number; f: number }> = {};
    const bucketMap: Record<string, string> = {
      '65-74': '65+', '75+': '65+', '55-64': '55-64', '45-54': '45-54',
      '35-44': '35-44', '25-34': '25-34', '18-24': '18-24', '0-9': '18-', '10-17': '18-',
    };
    const genderPct: Record<string, number> = rollup.gender_percent ?? {};
    const maleRatio   = (genderPct.male   ?? 50) / 100;
    const femaleRatio = (genderPct.female ?? 50) / 100;
    Object.entries(agePct).forEach(([bucket, pct]) => {
      const label = bucketMap[bucket] ?? bucket;
      if (!ageMap[label]) ageMap[label] = { m: 0, f: 0 };
      const p = Number(pct);
      ageMap[label].m += Number((p * maleRatio).toFixed(1));
      ageMap[label].f += Number((p * femaleRatio).toFixed(1));
    });
    setAgeStats(ageOrder.map((age) => ({ age, m: ageMap[age]?.m ?? 0, f: ageMap[age]?.f ?? 0 })));
    setLastUpdate(new Date());
    return true;
  }

  function zeroAll() {
    setTotalVisitors(0); setDailyStats([0,0,0,0,0,0,0]); setHourlyStats(new Array(24).fill(0));
    setAvgVisitorsPerDay(0); setAvgVisitSeconds(0); setAvgAttentionSeconds(0);
    setGenderStats([]); setAttributeStats([]); setAgeStats([]);
    setVisitorsPerDayMap({}); setHairTypeData([]); setHairColorData([]);
    setComparePrevVisitorsPerDay({});
  }

  // ── loadData: busca dados respeitando o período selecionado ──────────────
  const loadData = useCallback(async () => {
    if (!id) return;
    const seq = ++loadSeqRef.current;
    const isCurrent = () => seq === loadSeqRef.current;

    setIsLoadingData(true);
    try {
      const startIso = selectedStartDate.toISOString();
      const endIso   = selectedEndDate.toISOString();
      const startDay = startIso.slice(0, 10);
      const endDay   = endIso.slice(0, 10);

      // ── Filtro por dispositivo (loja selecionada com dispositivos) ───────
      // Se há IDs de dispositivo, filtra exclusivamente por eles.
      // Mostra zeros se não houver dados — NÃO cai nos dados da rede global.
      if (deviceIds.length > 0) {
        try {
          const resp = await fetch('/api/sync-analytics', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ client_id: id, start: startIso, end: endIso, rebuild_rollup: true, devices: deviceIds }),
          });
          const json = resp.ok ? await resp.json() : null;
          if (!isCurrent()) return;
          if (json?.dashboard && Number(json.dashboard.total_visitors) > 0) {
            applyRollup({
              total_visitors:         json.dashboard.total_visitors,
              avg_visitors_per_day:   json.dashboard.avg_visitors_per_day,
              avg_visit_time_seconds: json.dashboard.avg_times_seconds?.avg_visit_time_seconds ?? 0,
              avg_attention_seconds:  json.dashboard.avg_times_seconds?.avg_attention_seconds ?? 0,
              visitors_per_day:       json.dashboard.visitors_per_day,
              visitors_per_hour_avg:  json.dashboard.visitors_per_hour_avg,
              gender_percent:         json.dashboard.gender_percent,
              attributes_percent:     json.dashboard.attributes_percent,
              age_pyramid_percent:    json.dashboard.age_pyramid_percent,
            });
          } else {
            // Sem dados para esses dispositivos no período → exibe zeros
            console.log('[loadData] Sem dados para os dispositivos da loja:', deviceIds);
            zeroAll();
          }
        } catch (e) {
          console.warn('[loadData] Erro no filtro por dispositivo:', e);
          zeroAll();
        }
        return;
      }

      // ── Rede global ────────────────────────────────────────────────────
      // Busca rollups que se sobrepõem ao período selecionado
      // e extrai apenas os dias dentro do período
      const { data: allRollups } = await supabase
        .from('visitor_analytics_rollups')
        .select('*')
        .eq('client_id', id)
        .lte('start', endIso)
        .gte('end', startIso)
        .gt('total_visitors', 0)
        .order('updated_at', { ascending: false })
        .limit(20);

      if (!isCurrent()) return;

      if (allRollups && allRollups.length > 0) {
        // Mescla visitors_per_day de todos os rollups, filtrando pelo período
        const mergedVpd: Record<string, number> = {};
        let mergedTotal = 0;
        const metaRollup = allRollups[0];

        for (const r of allRollups) {
          const vpd: Record<string, number> = r.visitors_per_day ?? {};
          for (const [day, cnt] of Object.entries(vpd)) {
            const d = day.slice(0, 10);
            if (d < startDay || d > endDay) continue;

            const val = Number(cnt) || 0;
            const prev = mergedVpd[d];
            if (prev === undefined) {
              mergedVpd[d] = val;
              mergedTotal += val;
            } else if (val > prev) {
              mergedVpd[d] = val;
              mergedTotal += (val - prev);
            }
          }
        }

        if (mergedTotal > 0) {
          const daysInPeriod = Math.max(1,
            Math.ceil((selectedEndDate.getTime() - selectedStartDate.getTime()) / 86400000) + 1
          );
          console.log(`[loadData] ✅ ${mergedTotal} visitantes (${startDay}→${endDay})`);
          applyRollup({
            ...metaRollup,
            total_visitors:       mergedTotal,
            avg_visitors_per_day: Math.round(mergedTotal / daysInPeriod),
            visitors_per_day:     mergedVpd,
          });
          return;
        }

        // Rollups encontrados mas sem dados para o período específico
        // → NÃO retornar zero aqui: continua para tentar rebuild via backend
        // (ex: rollup histórico existe mas ainda não tem dados de "hoje" → busca da API)
        console.log('[loadData] Rollups sem dados para o período, tentando rebuild:', startDay, '→', endDay);
      }

      // ── Sem rollups úteis: tenta rebuild via backend ───────────────────
      const rebuildKey = `${id}:${startDay}:${endDay}`;
      if (_rebuilding.has(rebuildKey)) {
        setIsLoadingData(false);
        return;
      }

      _rebuilding.add(rebuildKey);
      setSyncMessage('Calculando dados...');
      try {
        const resp = await fetch('/api/sync-analytics', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: id, start: startIso, end: endIso, rebuild_rollup: true }),
        });
        const json = resp.ok ? await resp.json() : null;
        if (!isCurrent()) return;

        if (json?.dashboard && Number(json.dashboard.total_visitors) > 0) {
          console.log('[loadData] ✅ Rebuild:', json.dashboard.total_visitors);
          applyRollup({
            total_visitors:         json.dashboard.total_visitors,
            avg_visitors_per_day:   json.dashboard.avg_visitors_per_day,
            avg_visit_time_seconds: json.dashboard.avg_times_seconds?.avg_visit_time_seconds ?? 0,
            avg_attention_seconds:  json.dashboard.avg_times_seconds?.avg_attention_seconds ?? 0,
            visitors_per_day:       json.dashboard.visitors_per_day,
            visitors_per_hour_avg:  json.dashboard.visitors_per_hour_avg,
            gender_percent:         json.dashboard.gender_percent,
            attributes_percent:     json.dashboard.attributes_percent,
            age_pyramid_percent:    json.dashboard.age_pyramid_percent,
          });
          setSyncMessage(`✅ ${Number(json.dashboard.total_visitors).toLocaleString()} visitantes.`);
        } else {
          zeroAll();
          setSyncMessage('');
        }
      } catch (e) {
        console.warn('[loadData] rebuild falhou:', e);
        zeroAll();
        setSyncMessage('');
      } finally {
        _rebuilding.delete(rebuildKey);
      }
    } catch (err) {
      console.error('[loadData] erro:', err);
    } finally {
      if (isCurrent()) setIsLoadingData(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, selectedStartDate, selectedEndDate, deviceIds]);

  // ── triggerBackgroundSync — dispara sync silencioso via background_sync ───
  const triggerBackgroundSync = useCallback(async (force = false) => {
    if (!id || syncingRef.current) return;
    if (!force && !shouldSync(id)) return;
    if (document.visibilityState !== 'visible') return;

    syncingRef.current = true;
    console.log(`[BgSync] Disparando sync (force=${force})...`);

    try {
      // Para clientes D-2 (ex: Panvel), o sync começa em D-2 para garantir que esses dados
      // sejam buscados da API e salvos no banco antes de serem exibidos no dashboard
      const syncStartDate = useD2DefaultRef.current
        ? (() => { const d = new Date(); d.setDate(d.getDate() - 2); d.setUTCHours(0, 0, 0, 0); return d.toISOString(); })()
        : undefined;

      const resp = await fetch('/api/sync-analytics', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: id,
          ...(syncStartDate ? { start: syncStartDate } : {}),
          end: new Date().toISOString(),
          background_sync: true,
          force_full_sync: force,
          ...(deviceIds.length > 0 ? { devices: deviceIds } : {}),
        }),
      });

      if (resp.ok) {
        const json = await resp.json();
        if (json.started) {
          markSynced(id);
          console.log('[BgSync] Iniciado. Recarregará em 15s...');
          // Recarrega dados após o sync processar — começa em 15s e tenta mais vezes
          const delays = [15_000, 30_000, 60_000, 120_000, 240_000];
          let loaded = false;
          delays.forEach((delay, idx) => {
            setTimeout(async () => {
              if (loaded || document.visibilityState !== 'visible') return;
              await loadData();
              if (totalVisitors > 0) loaded = true;
              console.log(`[BgSync] Dados recarregados (tentativa ${idx + 1})`);
            }, delay);
          });
        }
      }
    } catch (e) {
      console.warn('[BgSync] erro:', e);
    } finally {
      syncingRef.current = false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, deviceIds]);

  // ── loadData quando período muda ──────────────────────────────────────────
  useEffect(() => { loadData(); }, [loadData]);

  const lastQuarterMonths = useCallback((anchor: Date) => {
    const y = anchor.getUTCFullYear();
    const endMonth = anchor.getUTCMonth();
    const out: { label: string; startIso: string; endIso: string }[] = [];
    for (let i = 2; i >= 0; i--) {
      const d = new Date(Date.UTC(y, endMonth - i, 1, 0, 0, 0, 0));
      const yy = d.getUTCFullYear(); const m2 = d.getUTCMonth();
      const label = d.toLocaleString('pt-BR', { month: 'short', timeZone: 'UTC' }).replace('.', '').toUpperCase();
      out.push({
        label,
        startIso: new Date(Date.UTC(yy, m2, 1, 0, 0, 0, 0)).toISOString(),
        endIso:   new Date(Date.UTC(yy, m2 + 1, 0, 23, 59, 59, 999)).toISOString(),
      });
    }
    return out;
  }, []);

  const fetchSalesFromDb = useCallback(async (rangeStartIso: string, rangeEndIso: string) => {
    if (!id) return 0;
    if (salesSourceRef.current === 'none') return 0;
    const storeId = selectedStore?.id || null;
    const isNotFound = (err: any) => { const s = err?.status ?? err?.statusCode; const m = String(err?.message || ''); return s === 404 || /not found/i.test(m) || /does not exist/i.test(m); };
    const applySalesFilter = (q: any, mode: 'device' | 'store' | 'none') => {
      if (mode === 'device' && deviceIds.length > 0) return q.in('device_id', deviceIds);
      if (mode === 'store' && storeId) return q.eq('store_id', storeId);
      return q;
    };
    const sumSalesCount = async (table: 'sales_daily' | 'sales', dateCol: 'date' | 'created_at') => {
      const attempts: ('device' | 'store' | 'none')[] = [];
      if (deviceIds.length > 0) attempts.push('device');
      if (storeId) attempts.push('store');
      attempts.push('none');
      for (const mode of attempts) {
        const { data, error } = await applySalesFilter(supabase.from(table).select(`${dateCol},sales_count`).eq('client_id', id).gte(dateCol, rangeStartIso).lte(dateCol, rangeEndIso).range(0, 9999), mode);
        if (error) { if (isNotFound(error)) return null; continue; }
        return ((data as any[]) || []).reduce((acc, r) => acc + (Number(r?.sales_count) || 0), 0);
      }
      return undefined;
    };
    const countRows = async (table: 'sales_daily' | 'sales', dateCol: 'date' | 'created_at') => {
      const attempts: ('device' | 'store' | 'none')[] = [];
      if (deviceIds.length > 0) attempts.push('device');
      if (storeId) attempts.push('store');
      attempts.push('none');
      for (const mode of attempts) {
        const { count, error } = await applySalesFilter(supabase.from(table).select('*', { count: 'exact', head: true }).eq('client_id', id).gte(dateCol, rangeStartIso).lte(dateCol, rangeEndIso), mode);
        if (error) { if (isNotFound(error)) return null; continue; }
        return Number(count) || 0;
      }
      return undefined;
    };
    const readFrom = async (table: 'sales_daily' | 'sales') => {
      const a = await sumSalesCount(table, 'date');       if (typeof a === 'number') return a; if (a === null) return null;
      const b = await sumSalesCount(table, 'created_at'); if (typeof b === 'number') return b; if (b === null) return null;
      const c = await countRows(table, 'created_at');     if (typeof c === 'number') return c; if (c === null) return null;
      const d = await countRows(table, 'date');           if (typeof d === 'number') return d; if (d === null) return null;
      return 0;
    };
    if (salesSourceRef.current === 'sales_daily') { const v = await readFrom('sales_daily'); if (v === null) { salesSourceRef.current = 'none'; return 0; } return v ?? 0; }
    if (salesSourceRef.current === 'sales')       { const v = await readFrom('sales');       if (v === null) { salesSourceRef.current = 'none'; return 0; } return v ?? 0; }
    const vd = await readFrom('sales_daily'); if (typeof vd === 'number') { salesSourceRef.current = 'sales_daily'; return vd; }
    const vs = await readFrom('sales');       if (typeof vs === 'number') { salesSourceRef.current = 'sales';       return vs; }
    salesSourceRef.current = 'none';
    return 0;
  }, [id, deviceIds, selectedStore?.id]);

  const fetchVisitorsFromDb = useCallback(async (rangeStartIso: string, rangeEndIso: string) => {
    if (!id) return 0;
    let q = supabase.from('visitor_analytics').select('*', { count: 'exact', head: true })
      .eq('client_id', id).gte('timestamp', rangeStartIso).lte('timestamp', rangeEndIso);
    if (deviceIds.length > 0) q = q.in('device_id', deviceIds);
    const { count, error } = await q;
    if (error) { console.warn('[Dashboard] Erro ao contar visitantes (trimestre):', error); return 0; }
    return Number(count) || 0;
  }, [id, deviceIds]);

  const loadQuarterData = useCallback(async () => {
    if (!id) return;
    setIsLoadingQuarter(true);
    try {
      const today = new Date();
      const months = lastQuarterMonths(today);
      const quarterStart = months[0].startIso;
      const quarterEnd   = months[months.length - 1].endIso;
      const qStartDay    = quarterStart.slice(0, 10);
      const qEndDay      = quarterEnd.slice(0, 10);

      let rollupVisitorsPerDay: Record<string, number> | null = null;

      if (deviceIds.length === 0) {
        const { data: rollups } = await supabase
          .from('visitor_analytics_rollups')
          .select('visitors_per_day, start, end, updated_at')
          .eq('client_id', id)
          .lte('start', quarterEnd)
          .gte('end', quarterStart)
          .order('updated_at', { ascending: false })
          .limit(20);

        if (rollups && rollups.length > 0) {
          const merged: Record<string, number> = {};
          for (const r of rollups as any[]) {
            const vpd = r.visitors_per_day as Record<string, number> | null;
            if (!vpd) continue;
            for (const [dateStr, count] of Object.entries(vpd)) {
              const d = dateStr.slice(0, 10);
              if (d >= qStartDay && d <= qEndDay && !(d in merged)) {
                merged[d] = Number(count) || 0;
              }
            }
          }
          if (Object.keys(merged).length > 0) rollupVisitorsPerDay = merged;
        }
      }

      if (!rollupVisitorsPerDay) {
        try {
          const resp = await fetch('/api/sync-analytics', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              client_id: id, start: quarterStart, end: quarterEnd, rebuild_rollup: true,
              ...(deviceIds.length > 0 ? { devices: deviceIds } : {}),
            }),
          });
          const json = resp.ok ? await resp.json() : null;
          if (json?.dashboard?.visitors_per_day) {
            const vpd = json.dashboard.visitors_per_day as Record<string, number>;
            rollupVisitorsPerDay = {};
            for (const [d, v] of Object.entries(vpd)) {
              if (d >= qStartDay && d <= qEndDay) rollupVisitorsPerDay[d] = Number(v) || 0;
            }
          }
        } catch (e) { console.warn('[Quarter] Rebuild falhou:', e); }
      }

      const rows: { label: string; visitors: number; sales: number }[] = [];
      for (const month of months) {
        let visitors = 0;
        if (rollupVisitorsPerDay) {
          const mStart = month.startIso.slice(0, 10);
          const mEnd   = month.endIso.slice(0, 10);
          for (const [dateStr, count] of Object.entries(rollupVisitorsPerDay)) {
            if (dateStr >= mStart && dateStr <= mEnd) visitors += Number(count) || 0;
          }
        } else {
          visitors = await fetchVisitorsFromDb(month.startIso, month.endIso);
        }
        const sales = await fetchSalesFromDb(month.startIso, month.endIso);
        rows.push({ label: month.label, visitors, sales });
      }

      setQuarterBars(rows);
      setQuarterVisitorsTotal(rows.reduce((acc, r) => acc + (Number(r.visitors) || 0), 0));
      setQuarterSalesTotal(rows.reduce((acc, r)    => acc + (Number(r.sales)    || 0), 0));
    } catch (e) {
      console.warn('[Dashboard] Erro ao carregar trimestre:', e);
      setQuarterBars([]); setQuarterVisitorsTotal(0); setQuarterSalesTotal(0);
    } finally {
      setIsLoadingQuarter(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, deviceIds, lastQuarterMonths, fetchSalesFromDb, fetchVisitorsFromDb]);

  const loadCompareData = useCallback(async () => {
    if (!id) return;
    const dayCount = Math.max(1, Math.floor((selectedEndDate.getTime() - selectedStartDate.getTime()) / 86400000) + 1);
    const prevEnd   = new Date(selectedStartDate.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - (dayCount - 1) * 86400000);
    setIsLoadingCompare(true);
    try {
      const prevStartAligned = new Date(prevStart); prevStartAligned.setUTCHours(0, 0, 0, 0);
      const prevEndAligned   = new Date(prevEnd);   prevEndAligned.setUTCHours(23, 59, 59, 999);
      const prevStartIso = prevStartAligned.toISOString();
      const prevEndIso   = prevEndAligned.toISOString();

      if (deviceIds.length === 0) {
        const { data: rollups } = await supabase
          .from('visitor_analytics_rollups')
          .select('visitors_per_day')
          .eq('client_id', id)
          .eq('start', prevStartIso)
          .eq('end', prevEndIso)
          .order('updated_at', { ascending: false })
          .limit(1);
        const found = rollups?.[0] as any;
        if (found?.visitors_per_day) {
          setComparePrevVisitorsPerDay(found.visitors_per_day || {});
        } else {
          const resp = await fetch('/api/sync-analytics', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ client_id: id, start: prevStartIso, end: prevEndIso, rebuild_rollup: true }),
          });
          const json = resp.ok ? await resp.json() : null;
          setComparePrevVisitorsPerDay(json?.dashboard?.visitors_per_day || {});
        }
      } else {
        const resp = await fetch('/api/sync-analytics', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: id, start: prevStartIso, end: prevEndIso, rebuild_rollup: true, devices: deviceIds }),
        });
        const json = resp.ok ? await resp.json() : null;
        setComparePrevVisitorsPerDay(json?.dashboard?.visitors_per_day || {});
      }
    } catch (e) { console.warn('[Dashboard] Erro comparativo:', e); setComparePrevVisitorsPerDay({}); }
    finally { setIsLoadingCompare(false); }
  }, [id, selectedStartDate, selectedEndDate, deviceIds]);

  const loadWeekFlowData = useCallback(async () => {
    if (!id) return;

    // ── Regra do gráfico/KPI "Média Visitantes" ───────────────────────────
    // Até 7 dias selecionados: sempre usa os ÚLTIMOS 7 DIAS (rolling) até o fim selecionado.
    // Mais de 7 dias: respeita o período selecionado.
    const selectedDays = Math.max(
      1,
      Math.ceil((selectedEndDate.getTime() - selectedStartDate.getTime()) / 86400000) + 1
    );
    const useSelectedPeriod = selectedDays > 7;

    let startIso: string, endIso: string, startDay: string, endDay: string;
    if (useSelectedPeriod) {
      const s = new Date(selectedStartDate); s.setUTCHours(0, 0, 0, 0);
      const e = new Date(selectedEndDate);   e.setUTCHours(23, 59, 59, 999);
      startIso = s.toISOString();
      endIso   = e.toISOString();
      startDay = s.toISOString().slice(0, 10);
      endDay   = e.toISOString().slice(0, 10);
    } else {
      const e = new Date(selectedEndDate); e.setUTCHours(23, 59, 59, 999);
      const s = new Date(e.getTime() - 6 * 86400000); s.setUTCHours(0, 0, 0, 0);
      startIso = s.toISOString();
      endIso   = e.toISOString();
      startDay = s.toISOString().slice(0, 10);
      endDay   = e.toISOString().slice(0, 10);
    }

    // ── Agrega visitors_per_day por dia da semana (sempre SOMA) ───────────
    const toWeekDays = (vpd: Record<string, number>) => {
      const totals = [0, 0, 0, 0, 0, 0, 0];
      Object.entries(vpd || {}).forEach(([dateStr, count]) => {
        const d = new Date(dateStr + 'T00:00:00Z');
        if (isNaN(d.getTime())) return;
        const ud = d.getUTCDay();
        const idx = ud === 0 ? 6 : ud - 1;
        totals[idx] += Number(count) || 0;
      });
      return totals;
    };

    try {
      if (deviceIds.length === 0) {
        // ── Rede global (sem filtro de dispositivo) ───────────────────────
        // 1ª tentativa: usa rollups já salvos (rápido)
        const { data: rollups } = await supabase
          .from('visitor_analytics_rollups')
          .select('visitors_per_day')
          .eq('client_id', id)
          .lte('start', endIso)
          .gte('end', startIso)
          .gt('total_visitors', 0)
          .order('updated_at', { ascending: false })
          .limit(useSelectedPeriod ? 30 : 10);

        if (rollups && rollups.length > 0) {
          const mergedVpd: Record<string, number> = {};
          for (const r of rollups) {
            const vpd: Record<string, number> = (r as any).visitors_per_day ?? {};
            for (const [day, cnt] of Object.entries(vpd)) {
              const d = day.slice(0, 10);
              if (d >= startDay && d <= endDay && !(d in mergedVpd)) {
                mergedVpd[d] = Number(cnt) || 0;
              }
            }
          }
          if (Object.keys(mergedVpd).length > 0) {
            const weekDays = toWeekDays(mergedVpd);
            setDailyStats(weekDays);
            if (!useSelectedPeriod) setAvgVisitorsPerDay(Math.round(weekDays.reduce((a, b) => a + b, 0) / 7));
            return;
          }
        }

        // 2ª tentativa: busca direto na visitor_analytics para o período
        // (cobertura de períodos não incluídos em rollups existentes)
        try {
          const visPerDay: Record<string, number> = {};
          let from2 = 0; const page2 = 1000;
          while (true) {
            const { data: rows, error: rowErr } = await supabase
              .from('visitor_analytics')
              .select('timestamp')
              .eq('client_id', id)
              .gte('timestamp', startIso)
              .lte('timestamp', endIso)
              .order('timestamp', { ascending: true })
              .range(from2, from2 + page2 - 1);
            if (rowErr || !rows || rows.length === 0) break;
            (rows as any[]).forEach((r: any) => {
              const dk = (r.timestamp || '').slice(0, 10);
              if (dk) visPerDay[dk] = (visPerDay[dk] ?? 0) + 1;
            });
            if (rows.length < page2) break;
            from2 += page2; if (from2 > 50000) break;
          }
          if (Object.keys(visPerDay).length > 0) {
            const weekDays = toWeekDays(visPerDay);
            setDailyStats(weekDays);
            if (!useSelectedPeriod) setAvgVisitorsPerDay(Math.round(weekDays.reduce((a, b) => a + b, 0) / 7));
            return;
          }
        } catch (_) { /* ignora e cai no zero */ }

        setDailyStats([0, 0, 0, 0, 0, 0, 0]);
        if (!useSelectedPeriod) setAvgVisitorsPerDay(0);
        return;
      }

      // ── Filtro por dispositivo (loja selecionada) ─────────────────────
      const days = [0, 0, 0, 0, 0, 0, 0];
      let from = 0; const page = 1000;
      while (true) {
        const { data, error } = await supabase.from('visitor_analytics').select('timestamp')
          .eq('client_id', id).gte('timestamp', startIso).lte('timestamp', endIso)
          .in('device_id', deviceIds).order('timestamp', { ascending: true }).range(from, from + page - 1);
        if (error || !data || data.length === 0) break;
        (data as any[]).forEach((r: any) => {
          const t = new Date(r.timestamp); if (isNaN(t.getTime())) return;
          const ud = t.getUTCDay(); const idx = ud === 0 ? 6 : ud - 1;
          days[idx] += 1;
        });
        if (data.length < page) break;
        from += page; if (from > 20000) break;
      }

      setDailyStats(days);
      if (!useSelectedPeriod) setAvgVisitorsPerDay(Math.round(days.reduce((a, b) => a + b, 0) / 7));
    } catch (e) {
      console.warn('[Dashboard] Erro semana:', e);
      setDailyStats([0, 0, 0, 0, 0, 0, 0]);
      if (selectedDays <= 7) setAvgVisitorsPerDay(0);
    }
  }, [id, selectedStartDate, selectedEndDate, deviceIds]);

  useEffect(() => { loadWeekFlowData(); }, [loadWeekFlowData]);
  useEffect(() => { loadQuarterData(); }, [loadQuarterData]);
  useEffect(() => { loadCompareData(); }, [loadCompareData]);

  const refreshClientAndStores = useCallback(async () => {
    if (!id) return;
    const { data: client } = await supabase.from('clients').select('name, logo_url').eq('id', id).single();
    if (client) {
      setClientData({ name: client.name, logo: client.logo_url });

      const isPanvel = String(client.name || '').toLowerCase().includes('panvel');
      if (isPanvel) {
        useD2DefaultRef.current = true; // marca para usar D-2 no sync
      }
      if (isPanvel && !didApplyD1DefaultRef.current && autoTodayRef.current) {
        didApplyD1DefaultRef.current = true;
        autoTodayRef.current = false;
        // Panvel: usa D-2 (2 dias atrás) como padrão, pois os dados do dia anterior
        // ainda não estão processados — o sistema trabalha com D-2
        const twoDaysAgo = new Date(); twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
        const s = new Date(twoDaysAgo); s.setUTCHours(0, 0, 0, 0);
        const e = new Date(twoDaysAgo); e.setUTCHours(23, 59, 59, 999);
        setSelectedStartDate(s);
        setSelectedEndDate(e);
        setDraftStartDate(s);
        setDraftEndDate(e);
      }
    }
    const { data: storesData }  = await supabase.from('stores').select('id, name, city').eq('client_id', id);
    // Busca apenas dispositivos das lojas deste cliente (via store_id IN)
    const storeIds = (storesData || []).map((s: any) => s.id).filter(Boolean);
    const { data: devicesData } = storeIds.length > 0
      ? await supabase.from('devices').select('id, name, type, mac_address, status, store_id').in('store_id', storeIds)
      : { data: [] };
    const { data: apiCfg }      = await supabase.from('client_api_configs')
      .select('api_endpoint, analytics_endpoint, api_key, custom_header_key, custom_header_value, collection_start, collection_end, collect_tracks, collect_face_quality, collect_glasses, collect_beard, collect_hair_color, collect_hair_type, collect_headwear')
      .eq('client_id', id).single();
    if (apiCfg) setApiConfig(apiCfg as ClientApiConfig);
    if (storesData) {
      const devicesByStore: Record<string, any[]> = {};
      (devicesData || []).forEach((device: any) => {
        if (!devicesByStore[device.store_id]) devicesByStore[device.store_id] = [];
        devicesByStore[device.store_id].push({ id: device.id, name: device.name, status: device.status || 'offline', type: device.type || 'dome', resolution: '1080p', macAddress: device.mac_address });
      });
      const seen = new Set<string>();
      const uniqueStores: StoreType[] = storesData
        .filter((s: any) => { if (seen.has(String(s.id))) return false; seen.add(String(s.id)); return true; })
        .map((store: any) => {
          const cams = devicesByStore[store.id] || [];
          const storeOnline = cams.some((c: any) => c.status === 'online');
          return { id: store.id, name: store.name, address: '', city: store.city || '', status: (storeOnline ? 'online' : 'offline') as 'online' | 'offline', cameras: cams };
        });
      setStores(uniqueStores);
    }
  }, [id]);

  const syncStoresFromServer = useCallback(async (force = false) => {
    if (!id) return;
    // Verifica se deve sincronizar: sempre na primeira vez, ou se forçado,
    // ou se a última sync foi há mais de 5 minutos
    const SYNC_TTL_MS = 5 * 60 * 1000;
    const lastSync = Number(localStorage.getItem(`stores_synced_${id}`) || '0');
    if (!force && Date.now() - lastSync < SYNC_TTL_MS) return;

    setIsSyncingStores(true);
    try {
      const resp = await fetch('/api/sync-analytics', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: id, sync_stores: true }),
      });
      const json = resp.ok ? await resp.json() : null;
      if (json) {
        console.log(`[Stores Sync] ${json.stores_upserted ?? 0} lojas, ${json.devices_upserted ?? 0} dispositivos sincronizados`);
        localStorage.setItem(`stores_synced_${id}`, String(Date.now()));
        await refreshClientAndStores(); // recarrega do banco após sync
      }
    } catch (e) { console.warn('[Stores Sync] Erro:', e); }
    finally { setIsSyncingStores(false); }
  }, [id, refreshClientAndStores]);

  useEffect(() => { refreshClientAndStores(); }, [refreshClientAndStores]);

  // ── Inicialização principal — roda 1x ao montar ──────────────────────────
  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    const run = async () => {
      refreshClientAndStores();
      syncStoresFromServer();

      if (cancelled) return;

      if (shouldSync(id)) {
        triggerBackgroundSync(false);
      }
    };

    void run();

    const t = setInterval(async () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      await loadData();
      if (shouldSync(id)) triggerBackgroundSync(false);
    }, 10 * 60 * 1000);

    const syncInterval = setInterval(() => {
      if (!cancelled && document.visibilityState === 'visible' && shouldSync(id)) {
        triggerBackgroundSync(false);
      }
    }, 30 * 60 * 1000);

    return () => { cancelled = true; clearInterval(t); clearInterval(syncInterval); };
  }, [id, loadData, refreshClientAndStores, syncStoresFromServer, triggerBackgroundSync]);

  // ── Config de widgets ────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const clampNum = (v: any, min: number, max: number, fallback: number) => {
      const n = Number(v); if (!Number.isFinite(n)) return fallback;
      return Math.min(max, Math.max(min, n));
    };
    const normalizeSpan = (v: any) => {
      const n = Number(v);
      return (SPANS as readonly number[]).includes(n) ? (n as (typeof SPANS)[number]) : null;
    };
    const resolveDashboardConfig = (widgetsConfig: any): { ids: string[] | null; widgetLayout: Record<string, { colSpanLg?: Span; heightPx?: number }> } => {
      const ids = Array.isArray(widgetsConfig)
        ? widgetsConfig.filter((x) => typeof x === 'string')
        : widgetsConfig && Array.isArray(widgetsConfig.widget_ids)
          ? widgetsConfig.widget_ids.filter((x: any) => typeof x === 'string') : null;
      const rawLayout = widgetsConfig && typeof widgetsConfig === 'object' ? (widgetsConfig.widget_layout ?? widgetsConfig.widgetLayout) : null;
      const wl: Record<string, { colSpanLg?: Span; heightPx?: number }> = {};
      if (rawLayout && typeof rawLayout === 'object') {
        for (const [wid, cfg] of Object.entries(rawLayout)) {
          const wId = String(wid);
          const span = normalizeSpan((cfg as any)?.colSpanLg ?? cfg);
          const heightPx = clampNum((cfg as any)?.heightPx, 180, 1200, NaN);
          if (span) wl[wId] = { ...(wl[wId] || {}), colSpanLg: span };
          if (Number.isFinite(heightPx)) wl[wId] = { ...(wl[wId] || {}), heightPx: Math.round(heightPx) };
        }
      }
      return { ids, widgetLayout: wl };
    };
    (async () => {
      if (!id) return;
      const fetchConfig = async (scope: 'global' | 'client' | 'client_user') => {
        const q = supabase.from('dashboard_configs').select('widgets_config, updated_at').eq('layout_name', scope).order('updated_at', { ascending: false }).limit(1);
        const { data } = scope === 'global' ? await q.is('client_id', null) : await q.eq('client_id', id);
        return data?.[0]?.widgets_config ?? null;
      };

      // 1. Widgets permitidos pelo admin (layout 'client' ou 'global')
      let allowedConfig = await fetchConfig('client');
      if (!allowedConfig) allowedConfig = await fetchConfig('global');
      let allowedResolved = resolveDashboardConfig(allowedConfig);
      if (!allowedResolved.ids) {
        const cc = localStorage.getItem(`dashboard-config-${id}`);
        const gc = localStorage.getItem('dashboard-config-global');
        allowedResolved = resolveDashboardConfig(cc ? JSON.parse(cc) : null);
        if (!allowedResolved.ids) allowedResolved = resolveDashboardConfig(gc ? JSON.parse(gc) : null);
      }
      const defaultIds = ['flow_trend', 'hourly_flow', 'age_pyramid', 'gender_dist', 'attributes', 'campaigns'];
      const allowedIds = allowedResolved.ids && allowedResolved.ids.length ? allowedResolved.ids : defaultIds;
      const allowedSet = new Set(allowedIds);

      // 2. Seleção ativa do usuário (layout 'client_user') — pode remover widgets permitidos
      let userConfig = await fetchConfig('client_user');
      let userResolved = resolveDashboardConfig(userConfig);
      if (!userResolved.ids) {
        const uc = localStorage.getItem(`dashboard-config-user-${id}`);
        userResolved = resolveDashboardConfig(uc ? JSON.parse(uc) : null);
      }

      // Se o usuário tem seleção salva, usa ela (filtrada pelos permitidos); senão usa todos os permitidos.
      // Sempre garante que TODOS os widgets permitidos pelo admin apareçam (novos widgets entram automaticamente).
      const baseActiveIds = userResolved.ids && userResolved.ids.length
        ? userResolved.ids.filter((wid) => allowedSet.has(wid))
        : allowedIds;

      const activeIds = [...baseActiveIds];
      for (const wid of allowedIds) {
        if (!activeIds.includes(wid)) activeIds.push(wid);
      }

      // Layout: combina allowed + user (user sobrescreve)
      const mergedLayout = { ...allowedResolved.widgetLayout, ...userResolved.widgetLayout };

      const active = activeIds.map((wid) => AVAILABLE_WIDGETS.find((w) => w.id === wid)).filter(Boolean) as WidgetType[];
      if (!cancelled) { setActiveWidgets(active); setWidgetLayout(mergedLayout); setIsLoadingConfig(false); }
    })();
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    if (location.state?.initialView === 'store' && location.state?.storeId) {
      const store = stores.find((s) => s.id === location.state.storeId);
      if (store) { setSelectedStore(store); setView('network'); }
    }
  }, [location.state, stores]);

  const goToNetwork = () => { setView('network'); setSelectedStore(null); setSelectedCamera(null); };
  const goToStore = (store: StoreType) => { setSelectedStore(store); setView('network'); setSelectedCamera(null); };

  const periodSeries = useMemo(() => {
    const labels: string[] = []; const values: number[] = [];
    const start = new Date(selectedStartDate); start.setUTCHours(0, 0, 0, 0);
    const end   = new Date(selectedEndDate);   end.setUTCHours(0, 0, 0, 0);
    for (let d = start; d.getTime() <= end.getTime(); d = new Date(d.getTime() + 86400000)) {
      const key = d.toISOString().slice(0, 10);
      labels.push(d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' }));
      values.push(Number(visitorsPerDayMap[key] || 0));
    }
    return { labels, values };
  }, [selectedStartDate, selectedEndDate, visitorsPerDayMap]);

  const periodWeeks = useMemo(() => {
    const weeks: { label: string; visitors: number; sales: number }[] = [];
    periodSeries.values.forEach((v, i) => {
      const w = Math.floor(i / 7);
      if (!weeks[w]) weeks[w] = { label: `Sem ${w + 1}`, visitors: 0, sales: 0 };
      weeks[w].visitors += Number(v) || 0;
    });
    return weeks;
  }, [periodSeries.values]);

  const compareSeries = useMemo(() => {
    const dayCount = Math.max(1, periodSeries.values.length);
    const prevEnd   = new Date(selectedStartDate.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - (dayCount - 1) * 86400000);
    const prev: number[] = [];
    const start = new Date(prevStart); start.setUTCHours(0, 0, 0, 0);
    const end   = new Date(prevEnd);   end.setUTCHours(0, 0, 0, 0);
    for (let d = start; d.getTime() <= end.getTime(); d = new Date(d.getTime() + 86400000)) {
      prev.push(Number(comparePrevVisitorsPerDay[d.toISOString().slice(0, 10)] || 0));
    }
    while (prev.length < dayCount) prev.push(0);
    return { labels: periodSeries.labels, current: periodSeries.values, previous: prev.slice(0, dayCount) };
  }, [periodSeries.labels, periodSeries.values, selectedStartDate, comparePrevVisitorsPerDay]);

  const getStats = () => [
    { label: 'Total Visitantes',     value: totalVisitors.toLocaleString(),                                       icon: Users     },
    { label: 'Média Visitantes Dia', value: avgVisitorsPerDay.toLocaleString(),                                   icon: BarChart2 },
    { label: 'Tempo Médio Visita',   value: formatDuration(avgVisitSeconds),                                      icon: Clock     },
    { label: 'Tempo de Atenção',     value: avgAttentionSeconds > 0 ? formatDuration(avgAttentionSeconds) : '—', icon: Clock     },
  ];

  const clientName = clientData?.name || 'Carregando...';
  const clientLogo = clientData?.logo;

  return (
    <div
      ref={dashboardRef}
      className="space-y-6 animate-in fade-in duration-500"
      style={isFullscreen ? { background: '#030712', padding: '24px', overflowY: 'auto', height: '100%' } : undefined}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <button onClick={() => navigate('/clientes')} className="hover:text-emerald-400 transition-colors">Clientes</button>
          <ChevronRight size={14} />
          <button onClick={goToNetwork} className={`hover:text-emerald-400 transition-colors ${view === 'network' && !selectedStore ? 'text-white font-medium' : ''}`}>{clientName}</button>
          {selectedStore && (<><ChevronRight size={14} /><button onClick={() => goToStore(selectedStore)} className="hover:text-emerald-400 transition-colors text-white font-medium">{selectedStore.name}</button></>)}
        </div>

        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div className="flex items-center gap-4 sm:gap-6">
            <div className="h-16 w-16 sm:h-24 sm:min-w-[100px] flex items-center justify-center overflow-hidden group relative cursor-pointer">
              {clientLogo ? (
                <img src={clientLogo} alt="Logo Cliente" className="h-full w-auto object-contain" />
              ) : (
                <div className="flex flex-col items-center justify-center text-gray-700 w-16 h-16 sm:w-20 sm:h-20 bg-gray-900 border border-gray-800 rounded-xl">
                  <Image size={24} />
                  <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-xl">
                    <Upload size={16} className="text-white mb-1" />
                    <span className="text-[8px] text-white font-medium uppercase tracking-wider">Add Logo</span>
                  </div>
                </div>
              )}
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2"><Globe className="text-emerald-500" />Dashboard Geral</h1>
              <p className="text-sm sm:text-base text-gray-400 mt-1">Monitorando {stores.length} lojas nesta rede</p>
              {!apiConfig?.api_key && <p className="text-xs text-yellow-400 mt-1">API não configurada ⚠️</p>}
              {syncMessage && (
                <p className={`text-xs mt-1 ${syncMessage.startsWith('✅') ? 'text-emerald-400' : 'text-blue-400'} flex items-center gap-1`}>
                  {!syncMessage.startsWith('✅') && <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />}
                  {syncMessage}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-start gap-3 w-full lg:w-auto">
            <div className="relative w-full sm:w-auto">
              <select
                className="bg-gray-900 border border-gray-800 text-white pl-10 pr-8 py-2 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 appearance-none cursor-pointer text-sm w-full sm:min-w-[180px]"
                onChange={(e) => { const sid = e.target.value; if (sid === 'all') goToNetwork(); else { const s = stores.find((s) => s.id === sid); if (s) goToStore(s); } }}
                value={selectedStore?.id || 'all'}
              >
                <option value="all" style={{ backgroundColor: '#111827', color: 'white' }}>Rede Global</option>
                {stores.map((store) => <option key={store.id} value={store.id} style={{ backgroundColor: '#111827', color: 'white' }}>{store.name}</option>)}
              </select>
              <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" size={16} />
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" size={14} />
            </div>

            {/* Botão para forçar atualização das lojas do DisplayForce */}
            <button
              onClick={() => syncStoresFromServer(true)}
              disabled={isSyncingStores}
              title="Atualizar lista de lojas do DisplayForce"
              className="flex items-center justify-center bg-gray-900 border border-gray-800 text-white rounded-lg hover:border-emerald-600 hover:text-emerald-400 transition-colors flex-shrink-0 h-[38px] w-[38px] disabled:opacity-50"
            >
              {isSyncingStores
                ? <span className="inline-block w-3.5 h-3.5 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                : <Building2 size={16} className="text-gray-400" />
              }
            </button>

            <div className="flex flex-row items-start gap-2 w-full sm:w-auto">
              {/* Fullscreen */}
              <button
                onClick={toggleFullscreen}
                title={isFullscreen ? 'Sair da tela cheia' : 'Modo apresentação'}
                className="flex items-center justify-center bg-gray-900 border border-gray-800 text-white rounded-lg hover:border-gray-700 transition-colors flex-shrink-0 h-[38px] w-[38px]"
              >
                {isFullscreen ? <Minimize2 size={16} className="text-emerald-400" /> : <Maximize2 size={16} className="text-gray-400" />}
              </button>

              {/* Upload campanhas (apenas admin) */}
              {authUser?.role === 'admin' && (
                <button
                  onClick={() => navigate(`/clientes/${id}/campanhas`)}
                  title="Importar relatório de campanhas do e-mail"
                  className="flex items-center justify-center bg-gray-900 border border-gray-800 text-white rounded-lg hover:border-blue-500 hover:text-blue-400 transition-colors flex-shrink-0 h-[38px] w-[38px]"
                >
                  <Upload size={16} className="text-gray-400" />
                </button>
              )}

              {/* Sync manual */}
              <button
                onClick={() => triggerBackgroundSync(true)}
                disabled={syncingRef.current}
                title="Forçar sincronização agora"
                className="flex items-center justify-center bg-gray-900 border border-gray-800 text-white rounded-lg hover:border-emerald-600 hover:text-emerald-400 transition-colors flex-shrink-0 h-[38px] w-[38px] disabled:opacity-50"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 4v6h-6" /><path d="M1 20v-6h6" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
              </button>

              {/* Export */}
              <ExportButton
                data={{
                  clientName,
                  period: { start: selectedStartDate, end: selectedEndDate },
                  kpis: { totalVisitors, avgVisitorsPerDay, avgVisitSeconds, avgAttentionSeconds },
                  dailyStats, hourlyStats, genderStats, ageStats, attributeStats,
                  hairTypeData, hairColorData, visitorsPerDayMap, quarterBars, dashboardRef,
                }}
              />

              {/* Date Picker */}
              <div className="flex flex-col items-end flex-1 sm:flex-none">
                <div className="relative w-full sm:w-auto">
                  <button
                    onClick={() => {
                      const next = !showDatePicker;
                      if (next) {
                        setDraftStartDate(selectedStartDate);
                        setDraftEndDate(selectedEndDate);
                      }
                      setShowDatePicker(next);
                    }}
                    className="w-full sm:w-auto flex items-center justify-between sm:justify-start gap-2 bg-gray-900 border border-gray-800 text-white px-4 py-2 rounded-lg hover:border-gray-700 transition-colors"
                  >
                    <div className="flex items-center gap-2 flex-nowrap">
                      <Calendar size={16} className="text-gray-500" />
                      <span className="text-sm whitespace-nowrap">{selectedStartDate.toLocaleDateString('pt-BR', { timeZone: 'UTC' })} → {selectedEndDate.toLocaleDateString('pt-BR', { timeZone: 'UTC' })}</span>
                    </div>
                    <ChevronDown size={14} className="text-gray-500" />
                  </button>
                  {showDatePicker && (
                    <div className="absolute z-10 mt-2 p-3 bg-gray-900 border border-gray-800 rounded-lg shadow-xl right-0 w-full sm:w-auto">
                      <div className="flex flex-col sm:flex-row items-end gap-3">
                        <div className="w-full sm:w-auto">
                          <label className="block text-xs text-gray-400">Início</label>
                          <input type="date" value={draftStartDate.toISOString().slice(0, 10)}
                            onChange={(e) => { const d = new Date(`${e.target.value}T00:00:00.000Z`); if (!isNaN(d.getTime())) setDraftStartDate(d); }}
                            className="bg-gray-800 text-white px-3 py-2 rounded-md border border-gray-700" />
                        </div>
                        <div className="w-full sm:w-auto">
                          <label className="block text-xs text-gray-400">Fim</label>
                          <input type="date" value={draftEndDate.toISOString().slice(0, 10)}
                            onChange={(e) => { const d = new Date(`${e.target.value}T23:59:59.999Z`); if (!isNaN(d.getTime())) setDraftEndDate(d); }}
                            className="w-full bg-gray-800 text-white px-3 py-2 rounded-md border border-gray-700" />
                        </div>
                        <button
                          onClick={() => {
                            autoTodayRef.current = false;
                            let nextStart = new Date(draftStartDate); nextStart.setUTCHours(0, 0, 0, 0);
                            let nextEnd = new Date(draftEndDate); nextEnd.setUTCHours(23, 59, 59, 999);
                            if (nextEnd.getTime() < nextStart.getTime()) nextEnd = new Date(nextStart.getTime() + 86399999);
                            setSelectedStartDate(nextStart);
                            setSelectedEndDate(nextEnd);
                            setShowDatePicker(false);
                          }}
                          className="w-full sm:w-auto px-3 py-2 bg-emerald-600 text-white rounded-md"
                        >
                          Aplicar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                {lastUpdate && <div className="mt-1 text-[10px] text-gray-500 w-full sm:w-auto text-right">Atualizado: {lastUpdate.toLocaleString('pt-BR')}</div>}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {getStats().map((stat, index) => (
          <div key={index} className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden group hover:border-gray-700 transition-all">
            <div className="bg-blue-600/20 p-2 text-center border-b border-blue-600/10">
              <p className="text-xs text-blue-400 font-bold uppercase tracking-wider">{stat.label}</p>
            </div>
            <div className="p-4 text-center">
              {isLoadingData
                ? <div className="h-8 bg-gray-800 rounded animate-pulse mx-auto w-24" />
                : <p className="text-2xl font-bold text-white tracking-tight">{stat.value}</p>}
            </div>
          </div>
        ))}
      </div>

      {/* Widgets */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden min-h-[400px]">
        {view === 'network' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 items-start">
            {isLoadingConfig ? (
              <div className="col-span-full flex justify-center py-20">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" />
              </div>
            ) : activeWidgets.length > 0 ? (
              activeWidgets.map((widget) => {
                const Component = WIDGET_MAP[widget.id];
                if (!Component) return null;
                const defaultSpanForSize = (size: WidgetType['size']) => {
                  if (size === 'full') return 12; if (size === 'third') return 4;
                  if (size === 'quarter') return 3; if (size === '2/3') return 8;
                  return 6;
                };
                let spanLg = Number(widgetLayout[widget.id]?.colSpanLg) || defaultSpanForSize(widget.size);
                if (![3, 4, 6, 8, 12].includes(spanLg)) spanLg = defaultSpanForSize(widget.size);
                let lgSpan = 'lg:col-span-6';
                if (spanLg === 12) lgSpan = 'lg:col-span-12';
                if (spanLg === 8)  lgSpan = 'lg:col-span-8';
                if (spanLg === 4)  lgSpan = 'lg:col-span-4';
                if (spanLg === 3)  lgSpan = 'lg:col-span-3';
                const mdSpan = spanLg >= 8 ? 'md:col-span-2' : 'md:col-span-1';
                const widgetProps: any = { view: 'network' };
                if (widget.id === 'flow_trend')              { widgetProps.dailyData = dailyStats; widgetProps.genderData = genderStats; }
                if (widget.id === 'hourly_flow')             { widgetProps.hourlyData = hourlyStats; widgetProps.genderData = genderStats; widgetProps.totalVisitors = totalVisitors; }
                if (widget.id === 'age_pyramid')             { widgetProps.ageData = ageStats; widgetProps.totalVisitors = totalVisitors; }
                if (widget.id === 'gender_dist')             { widgetProps.genderData = genderStats; widgetProps.totalVisitors = totalVisitors; }
                if (widget.id === 'attributes')                widgetProps.attrData = attributeStats;
                if (widget.id === 'kpi_flow_stats')          { widgetProps.totalVisitors = totalVisitors; widgetProps.avgVisitorsPerDay = avgVisitorsPerDay; widgetProps.avgVisitSeconds = avgVisitSeconds; }
                if (widget.id === 'chart_age_ranges')          widgetProps.ageData = ageStats;
                if (widget.id === 'chart_vision')              widgetProps.attrData = attributeStats;
                if (widget.id === 'chart_facial_hair')         widgetProps.attrData = attributeStats;
                if (widget.id === 'chart_hair_type')           widgetProps.hairTypeData = hairTypeData;
                if (widget.id === 'chart_hair_color')          widgetProps.hairColorData = hairColorData;
                if (widget.id === 'kpi_store_quarter')       { widgetProps.visitors = quarterVisitorsTotal; widgetProps.sales = quarterSalesTotal; widgetProps.loading = isLoadingQuarter; }
                if (widget.id === 'chart_sales_quarter')     { widgetProps.quarterData = quarterBars; widgetProps.loading = isLoadingQuarter; }
                if (widget.id === 'kpi_store_period')        { widgetProps.visitors = totalVisitors; widgetProps.sales = 0; widgetProps.loading = isLoadingData; }
                if (widget.id === 'campaigns') { widgetProps.clientId = id; widgetProps.lojaFilter = selectedStore?.name ?? null; }
                if (widget.id === 'chart_sales_daily')       { widgetProps.labels = periodSeries.labels; widgetProps.visitors = periodSeries.values; widgetProps.loading = isLoadingData; }
                if (widget.id === 'chart_sales_period_bar')  { widgetProps.periodData = periodWeeks; widgetProps.loading = isLoadingData; }
                if (widget.id === 'chart_sales_period_line') { widgetProps.labels = compareSeries.labels; widgetProps.current = compareSeries.current; widgetProps.previous = compareSeries.previous; widgetProps.loading = isLoadingCompare; }
                const heightPx = Number(widgetLayout[widget.id]?.heightPx);
                const defaultHeightPx = widget.id === 'campaigns' ? 560 : NaN;
                const resolvedHeightPx = Number.isFinite(heightPx) ? heightPx : defaultHeightPx;
                const widgetStyle = Number.isFinite(resolvedHeightPx) ? { height: Math.round(resolvedHeightPx) } : undefined;
                return (
                  <div key={widget.id} style={widgetStyle} className={`col-span-1 ${mdSpan} ${lgSpan} animate-in fade-in zoom-in-95 duration-500`}>
                    <Component {...widgetProps} />
                  </div>
                );
              })
            ) : (
              <div className="col-span-full text-center py-20 text-gray-500">
                <LayoutGrid size={48} className="mx-auto mb-4 opacity-20" />
                <p>Nenhum widget configurado para este dashboard.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}