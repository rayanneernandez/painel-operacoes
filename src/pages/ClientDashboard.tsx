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
const SYNC_INTERVAL_MS = 10 * 60 * 1000;
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

function alignUtcStartOfDay(value: Date | string) {
  const d = value instanceof Date ? new Date(value) : new Date(value);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function alignUtcEndOfDay(value: Date | string) {
  const d = value instanceof Date ? new Date(value) : new Date(value);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

function alignUtcStartOfWeek(value: Date | string) {
  const d = alignUtcStartOfDay(value);
  const utcDay = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - utcDay + 1);
  return d;
}

function alignUtcEndOfWeek(value: Date | string) {
  const d = alignUtcStartOfWeek(value);
  d.setUTCDate(d.getUTCDate() + 6);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

function sumVisitorsPerDay(vpd: Record<string, number> | null | undefined) {
  return Object.values(vpd || {}).reduce((acc, value) => acc + (Number(value) || 0), 0);
}

function hasNestedMetricData(value: any): boolean {
  if (!value || typeof value !== 'object') return false;
  return Object.values(value).some((entry) => {
    if (entry && typeof entry === 'object') return hasNestedMetricData(entry);
    return Number(entry) > 0;
  });
}

function withTimeout<T>(promiseLike: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    Promise.resolve(promiseLike),
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`Timeout em ${label}`)), ms);
    }),
  ]);
}

async function fetchJsonWithTimeout<T = any>(input: RequestInfo | URL, init: RequestInit, ms: number, label: string): Promise<T | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);
  try {
    const resp = await fetch(input, { ...init, signal: controller.signal });
    return resp.ok ? await resp.json() as T : null;
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error(`Timeout em ${label}`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function rollupMetadataScore(rollup: any): number {
  if (!rollup || typeof rollup !== 'object') return 0;
  let score = 0;
  if (hasNestedMetricData(rollup.gender_percent)) score += 10;
  if (hasNestedMetricData(rollup.age_pyramid_percent)) score += 10;
  if (hasNestedMetricData(rollup.attributes_percent)) score += 20 + countPositiveMetricLeaves(rollup.attributes_percent) * 3;
  if (Number(rollup.avg_visit_time_seconds) > 0) score += 2;
  if (Number(rollup.avg_contact_time_seconds) > 0) score += 2;
  return score;
}

const ATTRIBUTE_CATEGORIES = ['glasses', 'facial_hair', 'hair_color', 'hair_type', 'headwear'] as const;

function countPositiveMetricLeaves(value: any): number {
  if (!value || typeof value !== 'object') return 0;
  let total = 0;
  for (const entry of Object.values(value)) {
    if (entry && typeof entry === 'object') {
      total += countPositiveMetricLeaves(entry);
      continue;
    }
    if (Number(entry) > 0) total += 1;
  }
  return total;
}

function mergeAttributeCategories(baseAttributes: any, fallbackAttributes: any) {
  const base = baseAttributes && typeof baseAttributes === 'object' ? baseAttributes : {};
  const fallback = fallbackAttributes && typeof fallbackAttributes === 'object' ? fallbackAttributes : {};
  const merged: Record<string, any> = { ...fallback, ...base };

  for (const category of ATTRIBUTE_CATEGORIES) {
    const baseCategory = base?.[category];
    const fallbackCategory = fallback?.[category];
    const baseHasData = hasNestedMetricData(baseCategory);
    const fallbackHasData = hasNestedMetricData(fallbackCategory);
    const baseRichness = countPositiveMetricLeaves(baseCategory);
    const fallbackRichness = countPositiveMetricLeaves(fallbackCategory);

    const shouldPreferFallback =
      fallbackHasData &&
      (
        !baseHasData ||
        (baseRichness <= 1 && fallbackRichness > baseRichness) ||
        (baseRichness > 0 && fallbackRichness >= baseRichness + 2)
      );

    merged[category] = shouldPreferFallback
      ? (fallbackCategory ?? {})
      : (baseHasData ? baseCategory : (fallbackCategory ?? {}));
  }

  return merged;
}

function hydrateRollupMetadata(baseRollup: any, fallbackRollup: any) {
  if (!baseRollup || !fallbackRollup) return baseRollup;
  return {
    ...fallbackRollup,
    ...baseRollup,
    gender_percent: hasNestedMetricData(baseRollup.gender_percent) ? baseRollup.gender_percent : (fallbackRollup.gender_percent ?? {}),
    age_pyramid_percent: hasNestedMetricData(baseRollup.age_pyramid_percent) ? baseRollup.age_pyramid_percent : (fallbackRollup.age_pyramid_percent ?? {}),
    attributes_percent: mergeAttributeCategories(baseRollup.attributes_percent, fallbackRollup.attributes_percent),
    avg_visit_time_seconds: Number(baseRollup.avg_visit_time_seconds) > 0 ? baseRollup.avg_visit_time_seconds : (fallbackRollup.avg_visit_time_seconds ?? baseRollup.avg_visit_time_seconds ?? null),
    avg_contact_time_seconds: Number(baseRollup.avg_contact_time_seconds) > 0 ? baseRollup.avg_contact_time_seconds : (fallbackRollup.avg_contact_time_seconds ?? baseRollup.avg_contact_time_seconds ?? null),
  };
}

function countInclusiveUtcDays(startValue: Date | string, endValue: Date | string) {
  const start = startValue ? alignUtcStartOfDay(startValue) : null;
  const end = endValue ? alignUtcStartOfDay(endValue) : null;
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
}

function countRollupDays(rollup: any) {
  return countInclusiveUtcDays(rollup?.start, rollup?.end);
}

function overlapVisitorsForRange(rollup: any, startDay: string, endDay: string) {
  const vpd: Record<string, number> = rollup?.visitors_per_day ?? {};
  let total = 0;
  for (const [day, value] of Object.entries(vpd)) {
    const normalizedDay = day.slice(0, 10);
    if (normalizedDay < startDay || normalizedDay > endDay) continue;
    total += Number(value) || 0;
  }
  return total > 0 ? total : Number(rollup?.total_visitors ?? 0);
}

function aggregateAttributesFromRollups(rollups: any[], startDay: string, endDay: string) {
  const categories = ['glasses', 'facial_hair', 'hair_color', 'hair_type', 'headwear'];
  const targetDays = countInclusiveUtcDays(`${startDay}T00:00:00.000Z`, `${endDay}T00:00:00.000Z`);
  const candidateRollups = (rollups || []).filter((rollup) => {
    if (!hasNestedMetricData(rollup?.attributes_percent)) return false;
    const days = countRollupDays(rollup);
    return days <= 7 || days === targetDays;
  });
  const out: Record<string, Record<string, number>> = {};

  for (const category of categories) {
    const weightedTotals: Record<string, number> = {};
    let totalWeight = 0;

    for (const rollup of candidateRollups) {
      const source = rollup?.attributes_percent?.[category];
      const weight = overlapVisitorsForRange(rollup, startDay, endDay);
      if (!source || typeof source !== 'object' || weight <= 0) continue;
      const entries = Object.entries(source).filter(([, value]) => Number(value) > 0);
      if (entries.length === 0) continue;
      totalWeight += weight;
      for (const [key, value] of entries) {
        weightedTotals[key] = (weightedTotals[key] || 0) + Number(value) * weight;
      }
    }

    out[category] = totalWeight > 0
      ? Object.fromEntries(
          Object.entries(weightedTotals).map(([key, value]) => [key, Number((value / totalWeight).toFixed(2))])
        )
      : {};
  }

  return out;
}

const DISPLAYFORCE_AGE_ORDER = ['1-19', '20-29', '30-45', '46-100'] as const;
const LEGACY_AGE_ORDER = ['18-', '18-24', '25-34', '35-44', '45-54', '55-64', '65+'] as const;

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
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    return today;
  });
  const [selectedEndDate, setSelectedEndDate] = useState<Date>(() => {
    const today = new Date();
    today.setUTCHours(23, 59, 59, 999);
    return today;
  });
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [draftStartDate, setDraftStartDate] = useState<Date>(() => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    return today;
  });
  const [draftEndDate, setDraftEndDate] = useState<Date>(() => {
    const today = new Date();
    today.setUTCHours(23, 59, 59, 999);
    return today;
  });
  const autoTodayRef = useRef(true);
  const didApplyD1DefaultRef = useRef(false);
  const loadSeqRef = useRef(0);
  const latestLoadDataRef = useRef<null | (() => Promise<void>)>(null);
  const bgReloadTimeoutsRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const activeFilterKeyRef = useRef('');
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

  // Intervalo padrão do dashboard: sempre começa em "hoje".
  // O filtro aplicado continua respeitado na sessão atual, mas um reload não deve
  // reabrir a tela em um período antigo e mascarar o dia atual.
  useEffect(() => {
    const tick = () => {
      if (!autoTodayRef.current) return;
      const s = new Date(); s.setUTCHours(0, 0, 0, 0);
      const e = new Date(); e.setUTCHours(23, 59, 59, 999);
      if (selectedStartDate.getTime() !== s.getTime()) setSelectedStartDate(s);
      if (selectedEndDate.getTime() !== e.getTime()) setSelectedEndDate(e);
      setDraftStartDate(s);
      setDraftEndDate(e);
    };
    tick();
    const t = setInterval(tick, 60 * 1000);
    return () => clearInterval(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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

  useEffect(() => {
    activeFilterKeyRef.current = [
      id || '',
      selectedStartDate.toISOString(),
      selectedEndDate.toISOString(),
      deviceIds.join(','),
    ].join('|');

    bgReloadTimeoutsRef.current.forEach(clearTimeout);
    bgReloadTimeoutsRef.current = [];
  }, [id, selectedStartDate, selectedEndDate, deviceIds]);

  function applyRollup(rollup: any, options?: { updatedAt?: string | Date | null }) {
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
    const ageMap: Record<string, { m: number; f: number }> = {};
    const bucketMap: Record<string, string> = {
      '1-19': '1-19', '20-29': '20-29', '30-45': '30-45', '46-100': '46-100',
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
    const hasDisplayforceAgeBuckets = DISPLAYFORCE_AGE_ORDER.some((age) => age in ageMap);
    const orderedAges = hasDisplayforceAgeBuckets ? [...DISPLAYFORCE_AGE_ORDER] : [...LEGACY_AGE_ORDER];
    setAgeStats(
      orderedAges
        .map((age) => ({ age, m: ageMap[age]?.m ?? 0, f: ageMap[age]?.f ?? 0 }))
        .filter((age) => hasDisplayforceAgeBuckets || age.m > 0 || age.f > 0 || orderedAges.length === LEGACY_AGE_ORDER.length)
    );
    const updatedAtRaw = options?.updatedAt ?? rollup?.updated_at ?? null;
    if (updatedAtRaw) {
      const updatedAt = updatedAtRaw instanceof Date ? updatedAtRaw : new Date(updatedAtRaw);
      if (!Number.isNaN(updatedAt.getTime())) {
        setLastUpdate(updatedAt);
      }
    }
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
      const startAligned = alignUtcStartOfDay(selectedStartDate);
      const endAligned = alignUtcEndOfDay(selectedEndDate);
      const startIso = startAligned.toISOString();
      const endIso   = endAligned.toISOString();
      const startDay = startIso.slice(0, 10);
      const endDay   = endIso.slice(0, 10);
      const todayDay = alignUtcStartOfDay(new Date()).toISOString().slice(0, 10);
      const rangeTouchesToday = startDay <= todayDay && endDay >= todayDay;

      // ── Filtro por dispositivo (loja selecionada com dispositivos) ───────
      // Se há IDs de dispositivo, filtra exclusivamente por eles.
      // Mostra zeros se não houver dados — NÃO cai nos dados da rede global.
      if (deviceIds.length > 0) {
        try {
          const json = await fetchJsonWithTimeout('/api/sync-analytics', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ client_id: id, start: startIso, end: endIso, rebuild_rollup: true, devices: deviceIds }),
          }, 15000, 'sync-analytics devices');
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
            }, { updatedAt: json?.dashboard?.updated_at ?? null });
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
      const selectedDays = Math.max(
        1,
        Math.ceil((selectedEndDate.getTime() - selectedStartDate.getTime()) / 86400000) + 1
      );

      const { data: exactRollups } = await withTimeout(
        supabase
          .from('visitor_analytics_rollups')
          .select('*')
          .eq('client_id', id)
          .eq('start', startIso)
          .eq('end', endIso)
          .gt('total_visitors', 0)
          .order('updated_at', { ascending: false })
          .limit(1),
        10000,
        'rollup exato'
      );

      if (!isCurrent()) return;

      const exactRollup = exactRollups?.[0];
      let exactRollupCandidate: any = null;
      let exactRollupCandidateTotal = 0;
      if (exactRollup && !rangeTouchesToday) {
        const exactRollupDailyTotal = sumVisitorsPerDay(exactRollup.visitors_per_day);
        const exactRollupTotal = Number(exactRollup.total_visitors ?? 0);
        const exactRollupLooksConsistent =
          exactRollupTotal > 0 &&
          exactRollupDailyTotal > 0 &&
          Math.abs(exactRollupTotal - exactRollupDailyTotal) <= Math.max(5, Math.ceil(exactRollupTotal * 0.01));

        if (!exactRollupLooksConsistent) {
          console.warn(
            `[loadData] Ignorando rollup inconsistente ${exactRollupTotal} vs soma diária ${exactRollupDailyTotal} (${startDay}→${endDay})`
          );
        } else {
          exactRollupCandidate = exactRollup;
          exactRollupCandidateTotal = exactRollupTotal;
        }
      }

      const { data: allRollups } = await withTimeout(
        supabase
          .from('visitor_analytics_rollups')
          .select('*')
          .eq('client_id', id)
          .lte('start', endIso)
          .gte('end', startIso)
          .gt('total_visitors', 0)
          .order('updated_at', { ascending: false })
          .limit(50),
        10000,
        'rollups do periodo'
      );

      if (!isCurrent()) return;

      const { data: metadataRollups } = await withTimeout(
        supabase
          .from('visitor_analytics_rollups')
          .select('*')
          .eq('client_id', id)
          .gt('total_visitors', 0)
          .order('updated_at', { ascending: false })
          .limit(20),
        10000,
        'rollups metadata fallback'
      );

      if (!isCurrent()) return;

      const metadataFallbackRollup =
        [exactRollupCandidate, ...(allRollups || []), ...(metadataRollups || [])]
          .filter(Boolean)
          .sort((a, b) => rollupMetadataScore(b) - rollupMetadataScore(a))[0] ?? null;
      const aggregatedAttributesFallback = aggregateAttributesFromRollups(
        [exactRollupCandidate, ...(allRollups || []), ...(metadataRollups || [])].filter(Boolean),
        startDay,
        endDay
      );
      const hydrateForApply = (rollup: any) => {
        const hydrated = hydrateRollupMetadata(rollup, metadataFallbackRollup);
        if (!hydrated) return hydrated;
        if (!hasNestedMetricData(aggregatedAttributesFallback)) {
          return hydrated;
        }
        return {
          ...hydrated,
          attributes_percent: mergeAttributeCategories(hydrated.attributes_percent, aggregatedAttributesFallback),
        };
      };

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
          const preferMergedOverExact =
            !!exactRollupCandidate &&
            Math.abs(mergedTotal - exactRollupCandidateTotal) >
              Math.max(25, Math.ceil(Math.max(mergedTotal, exactRollupCandidateTotal) * 0.01));

          if (exactRollupCandidate && !preferMergedOverExact) {
            console.log(`[loadData] exact rollup: ${exactRollupCandidateTotal}`);
            applyRollup(hydrateForApply(exactRollupCandidate), { updatedAt: exactRollupCandidate.updated_at ?? null });
            return;
          }

          if (preferMergedOverExact) {
            console.warn(
              `[loadData] Ignorando rollup exato defasado ${exactRollupCandidateTotal} e usando soma diária ${mergedTotal} (${startDay}→${endDay})`
            );
          }

          const daysInPeriod = selectedDays;
          console.log(`[loadData] ✅ ${mergedTotal} visitantes (${startDay}→${endDay})`);
          const mergedRollup = hydrateForApply({
            ...metaRollup,
            total_visitors:       mergedTotal,
            avg_visitors_per_day: Math.round(mergedTotal / daysInPeriod),
            visitors_per_day:     mergedVpd,
          });
          applyRollup(mergedRollup, { updatedAt: metaRollup?.updated_at ?? exactRollupCandidate?.updated_at ?? null });
          return;
        }

        // Rollups encontrados mas sem dados para o período específico
        // → NÃO retornar zero aqui: continua para tentar rebuild via backend
        // (ex: rollup histórico existe mas ainda não tem dados de "hoje" → busca da API)
        console.log('[loadData] Rollups sem dados para o período, tentando rebuild:', startDay, '→', endDay);
      }

      // ── Sem rollups úteis: tenta rebuild via backend ───────────────────
      if (exactRollupCandidate) {
        console.log(`[loadData] exact rollup fallback: ${exactRollupCandidateTotal}`);
        applyRollup(hydrateForApply(exactRollupCandidate), { updatedAt: exactRollupCandidate.updated_at ?? null });
        return;
      }

      const rebuildKey = `${id}:${startDay}:${endDay}`;
      if (_rebuilding.has(rebuildKey)) {
        setIsLoadingData(false);
        return;
      }

      _rebuilding.add(rebuildKey);
      setSyncMessage('Calculando dados...');
      try {
        const json = await fetchJsonWithTimeout('/api/sync-analytics', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: id, start: startIso, end: endIso, rebuild_rollup: true }),
        }, 20000, 'sync-analytics rebuild');
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
          }, { updatedAt: json?.dashboard?.updated_at ?? null });
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
  useEffect(() => {
    latestLoadDataRef.current = loadData;
  }, [loadData]);

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
          const scheduledFilterKey = activeFilterKeyRef.current;
          bgReloadTimeoutsRef.current.forEach(clearTimeout);
          bgReloadTimeoutsRef.current = [];
          delays.forEach((delay, idx) => {
            const timeoutId = setTimeout(async () => {
              if (loaded || document.visibilityState !== 'visible') return;
              if (scheduledFilterKey !== activeFilterKeyRef.current) {
                console.log('[BgSync] Ignorando recarga antiga apÃ³s troca de filtro');
                return;
              }
              await latestLoadDataRef.current?.();
              if (scheduledFilterKey !== activeFilterKeyRef.current) return;
              loaded = true;
              console.log(`[BgSync] Dados recarregados (tentativa ${idx + 1})`);
            }, delay);
            bgReloadTimeoutsRef.current.push(timeoutId);
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

  const selectedCalendarMonths = useCallback((rangeStart: Date, rangeEnd: Date) => {
    const out: { label: string; startIso: string; endIso: string }[] = [];
    const startMonth = new Date(Date.UTC(rangeStart.getUTCFullYear(), rangeStart.getUTCMonth(), 1, 0, 0, 0, 0));
    const endMonth = new Date(Date.UTC(rangeEnd.getUTCFullYear(), rangeEnd.getUTCMonth(), 1, 0, 0, 0, 0));
    for (let cursor = startMonth; cursor <= endMonth; cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1, 0, 0, 0, 0))) {
      const yy = cursor.getUTCFullYear();
      const mm = cursor.getUTCMonth();
      out.push({
        label: cursor.toLocaleString('pt-BR', { month: 'short', timeZone: 'UTC' }).replace('.', '').toUpperCase(),
        startIso: new Date(Date.UTC(yy, mm, 1, 0, 0, 0, 0)).toISOString(),
        endIso: new Date(Date.UTC(yy, mm + 1, 0, 23, 59, 59, 999)).toISOString(),
      });
    }
    return out;
  }, []);

  const quarterMonthsForFilter = useCallback((rangeStart: Date, rangeEnd: Date) => {
    const explicitMonths = selectedCalendarMonths(rangeStart, rangeEnd);
    if (explicitMonths.length === 3) return explicitMonths;
    return lastQuarterMonths(alignUtcEndOfDay(rangeEnd));
  }, [lastQuarterMonths, selectedCalendarMonths]);

  const refreshLastUpdate = useCallback(async () => {
    if (!id) return;
    try {
      const { data: syncState } = await withTimeout<{ data: { last_synced_at: string | null } | null }>(
        supabase
          .from('client_sync_state')
          .select('last_synced_at')
          .eq('client_id', id)
          .maybeSingle() as any,
        5000,
        'ultimo sync'
      );

      const syncedAt = syncState?.last_synced_at ? new Date(syncState.last_synced_at) : null;
      if (syncedAt && !Number.isNaN(syncedAt.getTime())) {
        setLastUpdate(syncedAt);
        return;
      }

      const { data: latestRollups } = await withTimeout<{ data: Array<{ updated_at: string | null }> | null }>(
        supabase
          .from('visitor_analytics_rollups')
          .select('updated_at')
          .eq('client_id', id)
          .order('updated_at', { ascending: false })
          .limit(1) as any,
        5000,
        'ultimo rollup atualizado'
      );

      const fallbackAt = latestRollups?.[0]?.updated_at ? new Date(latestRollups[0].updated_at) : null;
      if (fallbackAt && !Number.isNaN(fallbackAt.getTime())) {
        setLastUpdate(fallbackAt);
      }
    } catch (error) {
      console.warn('[Dashboard] Erro ao carregar timestamp de atualização:', error);
    }
  }, [id]);

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
        const { data, error } = await withTimeout<{ data: any[] | null; error: any }>(
          applySalesFilter(supabase.from(table).select(`${dateCol},sales_count`).eq('client_id', id).gte(dateCol, rangeStartIso).lte(dateCol, rangeEndIso).range(0, 9999), mode) as any,
          8000,
          `${table}.${dateCol}.${mode}`
        );
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
        const { count, error } = await withTimeout<{ count: number | null; error: any }>(
          applySalesFilter(supabase.from(table).select('*', { count: 'exact', head: true }).eq('client_id', id).gte(dateCol, rangeStartIso).lte(dateCol, rangeEndIso), mode) as any,
          8000,
          `${table}.${dateCol}.${mode}.count`
        );
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
    let count: number | null = 0;
    let error = null as any;
    try {
      ({ count, error } = await withTimeout<{ count: number | null; error: any }>(q as any, 8000, 'visitor_analytics trimestre'));
    } catch (timeoutError) {
      console.warn('[Dashboard] Timeout ao contar visitantes (trimestre):', timeoutError);
      return 0;
    }
    if (error) { console.warn('[Dashboard] Erro ao contar visitantes (trimestre):', error); return 0; }
    return Number(count) || 0;
  }, [id, deviceIds]);

  const loadQuarterData = useCallback(async () => {
    if (!id) return;
    setIsLoadingQuarter(true);
    try {
      const months = quarterMonthsForFilter(selectedStartDate, selectedEndDate);
      const quarterStart = months[0].startIso;
      const quarterEnd   = months[months.length - 1].endIso;
      const qStartDay    = quarterStart.slice(0, 10);
      const qEndDay      = quarterEnd.slice(0, 10);

      let rollupVisitorsPerDay: Record<string, number> | null = null;

      if (deviceIds.length === 0) {
        const { data: rollups } = await withTimeout(
          supabase
            .from('visitor_analytics_rollups')
            .select('visitors_per_day, start, end, updated_at')
            .eq('client_id', id)
            .lte('start', quarterEnd)
            .gte('end', quarterStart)
            .order('updated_at', { ascending: false })
            .limit(200),
          10000,
          'rollups trimestre'
        );

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
          const json = await fetchJsonWithTimeout('/api/sync-analytics', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              client_id: id, start: quarterStart, end: quarterEnd, rebuild_rollup: true,
              ...(deviceIds.length > 0 ? { devices: deviceIds } : {}),
            }),
          }, 20000, 'sync-analytics trimestre');
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
        let coveredDays = 0;
        if (rollupVisitorsPerDay) {
          const mStart = month.startIso.slice(0, 10);
          const mEnd   = month.endIso.slice(0, 10);
          for (const [dateStr, count] of Object.entries(rollupVisitorsPerDay)) {
            if (dateStr >= mStart && dateStr <= mEnd) {
              visitors += Number(count) || 0;
              coveredDays += 1;
            }
          }
        }
        if (!rollupVisitorsPerDay || coveredDays === 0) {
          visitors = await fetchVisitorsFromDb(month.startIso, month.endIso);
        }
        let sales = 0;
        try {
          sales = await fetchSalesFromDb(month.startIso, month.endIso);
        } catch (salesError) {
          console.warn(`[Quarter] Erro ao carregar vendas de ${month.label}:`, salesError);
        }
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
  }, [id, deviceIds, selectedStartDate, selectedEndDate, quarterMonthsForFilter, fetchSalesFromDb, fetchVisitorsFromDb]);

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
        const { data: rollups } = await withTimeout(
          supabase
            .from('visitor_analytics_rollups')
            .select('visitors_per_day')
            .eq('client_id', id)
            .eq('start', prevStartIso)
            .eq('end', prevEndIso)
            .order('updated_at', { ascending: false })
            .limit(1),
          10000,
          'rollup comparativo'
        );
        const found = rollups?.[0] as any;
        if (found?.visitors_per_day) {
          setComparePrevVisitorsPerDay(found.visitors_per_day || {});
        } else {
          const json = await fetchJsonWithTimeout('/api/sync-analytics', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ client_id: id, start: prevStartIso, end: prevEndIso, rebuild_rollup: true }),
          }, 20000, 'sync-analytics comparativo');
          setComparePrevVisitorsPerDay(json?.dashboard?.visitors_per_day || {});
        }
      } else {
        const json = await fetchJsonWithTimeout('/api/sync-analytics', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: id, start: prevStartIso, end: prevEndIso, rebuild_rollup: true, devices: deviceIds }),
        }, 20000, 'sync-analytics comparativo devices');
        setComparePrevVisitorsPerDay(json?.dashboard?.visitors_per_day || {});
      }
    } catch (e) { console.warn('[Dashboard] Erro comparativo:', e); setComparePrevVisitorsPerDay({}); }
    finally { setIsLoadingCompare(false); }
  }, [id, selectedStartDate, selectedEndDate, deviceIds]);

  const loadWeekFlowData = useCallback(async () => {
    if (!id) return;

    // ── Regra do gráfico/KPI "Média Visitantes" ───────────────────────────
    // O gráfico e a média devem respeitar exatamente o período filtrado.
    const weekAnchor = alignUtcStartOfDay(selectedEndDate);
    const s = alignUtcStartOfWeek(weekAnchor);
    const e = alignUtcEndOfWeek(weekAnchor);
    const startIso = s.toISOString();
    const endIso   = e.toISOString();
    const startDay = startIso.slice(0, 10);
    const endDay   = endIso.slice(0, 10);

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
          .limit(30);

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
            return;
          }
        } catch (_) { /* ignora e cai no zero */ }

        setDailyStats([0, 0, 0, 0, 0, 0, 0]);
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
    } catch (e) {
      console.warn('[Dashboard] Erro semana:', e);
      setDailyStats([0, 0, 0, 0, 0, 0, 0]);
    }
  }, [id, selectedEndDate, deviceIds]);

  useEffect(() => { loadWeekFlowData(); }, [loadWeekFlowData]);
  useEffect(() => { loadQuarterData(); }, [loadQuarterData]);
  useEffect(() => { loadCompareData(); }, [loadCompareData]);
  useEffect(() => { refreshLastUpdate(); }, [refreshLastUpdate]);

  const refreshClientAndStores = useCallback(async () => {
    if (!id) return;
    try {
      const { data: client } = await withTimeout(
        supabase.from('clients').select('name, logo_url').eq('id', id).single(),
        10000,
        'clients'
      );
      if (client) {
        setClientData({ name: client.name, logo: client.logo_url });
        useD2DefaultRef.current = false;
        didApplyD1DefaultRef.current = true;
      }

      const { data: storesData } = await withTimeout(
        supabase.from('stores').select('id, name, city').eq('client_id', id),
        10000,
        'stores'
      );
      const storeIds = (storesData || []).map((s: any) => s.id).filter(Boolean);
      const { data: devicesData } = storeIds.length > 0
        ? await withTimeout(
            supabase.from('devices').select('id, name, type, mac_address, status, store_id').in('store_id', storeIds),
            10000,
            'devices'
          )
        : { data: [] };
      const { data: apiCfg } = await withTimeout(
        supabase.from('client_api_configs')
          .select('api_endpoint, analytics_endpoint, api_key, custom_header_key, custom_header_value, collection_start, collection_end, collect_tracks, collect_face_quality, collect_glasses, collect_beard, collect_hair_color, collect_hair_type, collect_headwear')
          .eq('client_id', id).single(),
        10000,
        'client_api_configs'
      );
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
    } catch (error) {
      console.warn('[Dashboard] Erro ao carregar cliente/lojas:', error);
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
    return () => {
      bgReloadTimeoutsRef.current.forEach(clearTimeout);
      bgReloadTimeoutsRef.current = [];
    };
  }, []);

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
        try {
          const q = supabase.from('dashboard_configs').select('widgets_config, updated_at').eq('layout_name', scope).order('updated_at', { ascending: false }).limit(1);
          const { data } = scope === 'global'
            ? await withTimeout(q.is('client_id', null), 8000, `dashboard_configs.${scope}`)
            : await withTimeout(q.eq('client_id', id), 8000, `dashboard_configs.${scope}`);
          return data?.[0]?.widgets_config ?? null;
        } catch (error) {
          console.warn(`[Dashboard] Erro ao carregar config ${scope}:`, error);
          return null;
        }
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
      if (!cancelled) { setActiveWidgets(active); setWidgetLayout(mergedLayout); }
    })()
      .catch((error) => {
        console.warn('[Dashboard] Erro ao resolver widgets, usando fallback padrao:', error);
        if (!cancelled) {
          const defaultIds = ['flow_trend', 'hourly_flow', 'age_pyramid', 'gender_dist', 'attributes', 'campaigns'];
          setActiveWidgets(defaultIds.map((wid) => AVAILABLE_WIDGETS.find((w) => w.id === wid)).filter(Boolean) as WidgetType[]);
          setWidgetLayout({});
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingConfig(false);
      });
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
                            // Persiste o período selecionado para não resetar ao navegar
                            try { localStorage.setItem(`dash_range_${id}`, JSON.stringify({ start: nextStart.toISOString(), end: nextEnd.toISOString(), savedAt: new Date().toISOString() })); } catch {}
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
