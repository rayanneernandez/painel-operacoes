import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import {
  Globe, Clock, Building2, ChevronRight, ChevronDown,
  LayoutGrid, Users, BarChart2, Image, Upload, Calendar,
  Maximize2, Minimize2
} from 'lucide-react';

import { AVAILABLE_WIDGETS, WIDGET_MAP } from '../components/DashboardWidgets';
import type { WidgetType } from '../components/DashboardWidgets';
import supabase from '../lib/supabase';

const _rebuilding = new Set<string>();

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
  const { user } = useAuth();

  useEffect(() => {
    if (!user || !id) return;
    if (user.role === 'client' && user.clientId && user.clientId !== id) {
      navigate(`/clientes/${user.clientId}/dashboard`, { replace: true });
    }
  }, [id, navigate, user]);

  const [view, setView] = useState<'network' | 'store' | 'camera'>('network');
  const [selectedStore, setSelectedStore] = useState<StoreType | null>(null);
  const [selectedCamera, setSelectedCamera] = useState<CameraType | null>(null);
  const [stores, setStores] = useState<StoreType[]>([]);
  const [clientData, setClientData] = useState<{ name: string; logo?: string } | null>(null);
  const [apiConfig, setApiConfig] = useState<ClientApiConfig | null>(null);

  const [selectedStartDate, setSelectedStartDate] = useState<Date>(() => {
    const now = new Date(); now.setUTCHours(0, 0, 0, 0); return now;
  });
  const [selectedEndDate, setSelectedEndDate] = useState<Date>(() => {
    const now = new Date(); now.setUTCHours(23, 59, 59, 999); return now;
  });
  const [showDatePicker, setShowDatePicker] = useState(false);
  const autoTodayRef = useRef(true);

  const [isSyncing, setIsSyncing] = useState(false);
  const [isSyncingStores, setIsSyncingStores] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const syncingRef = useRef(false);
  const salesSourceRef = useRef<'unknown' | 'sales_daily' | 'sales' | 'none'>('unknown');

  // ── Fullscreen — apenas o container do dashboard, sem menu ───────────────
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

  useEffect(() => {
    const tick = () => {
      if (!autoTodayRef.current) return;
      const s = new Date(); s.setUTCHours(0, 0, 0, 0);
      const e = new Date(); e.setUTCHours(23, 59, 59, 999);
      if (selectedStartDate.getTime() !== s.getTime()) setSelectedStartDate(s);
      if (selectedEndDate.getTime() !== e.getTime()) setSelectedEndDate(e);
    };
    tick();
    const t = setInterval(tick, 60 * 1000);
    return () => clearInterval(t);
  }, [selectedStartDate, selectedEndDate]);

  // Dashboard data
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

    // Tempo de Atenção — tenta avg_attention_seconds ou avg_attention_sec
    setAvgAttentionSeconds(Math.round(
      rollup.avg_attention_seconds ?? rollup.avg_attention_sec ?? 0
    ));

    const vpd: Record<string, number> = rollup.visitors_per_day ?? {};
    setVisitorsPerDayMap(vpd);

    const vph: Record<string, number> = rollup.visitors_per_hour_avg ?? {};
    const hours = new Array(24).fill(0);
    Object.entries(vph).forEach(([h, v]) => { hours[Number(h)] = Math.round(Number(v)); });
    setHourlyStats(hours);

    const gp: Record<string, number> = rollup.gender_percent ?? {};
    setGenderStats([{ label: 'Masculino', value: Math.round(gp.male ?? 0) }, { label: 'Feminino', value: Math.round(gp.female ?? 0) }]);

    const ap: any = rollup.attributes_percent ?? {};

    const glassesRaw   = ap.glasses      ?? {};
    const facialRaw    = ap.facial_hair  ?? {};

    const glassesHasCats = Object.keys(glassesRaw).some(k => ['usual','dark','none'].includes(k));
    const facialHasCats  = Object.keys(facialRaw).some(k  => ['shaved','beard','goatee','bristle','mustache'].includes(k));

    const glassesTotal = glassesHasCats
      ? Math.round((Number(glassesRaw.usual ?? 0) + Number(glassesRaw.dark ?? 0)))
      : Math.round(glassesRaw.true ?? 0);
    const facialTotal = facialHasCats
      ? Math.round(Object.entries(facialRaw).filter(([k]) => k !== 'shaved').reduce((a, [, v]) => a + Number(v), 0))
      : Math.round(facialRaw.true ?? 0);

    const glassesData = glassesHasCats
      ? Object.entries(glassesRaw)
          .filter(([, v]) => Number(v) > 0)
          .map(([k, v]) => ({ label: k, value: Number(v) }))
      : [{ label: 'Óculos', value: glassesTotal }];

    const facialData = facialHasCats
      ? Object.entries(facialRaw)
          .filter(([, v]) => Number(v) > 0)
          .map(([k, v]) => ({ label: k, value: Number(v) }))
      : [{ label: 'Barba', value: facialTotal }];

    setHairTypeData(pctMapToTopData(ap.hair_type));
    setHairColorData(pctMapToTopData(ap.hair_color));

    setAttributeStats([
      { label: 'Óculos',      value: glassesTotal },
      { label: 'Barba',       value: facialTotal },
      { label: 'Máscara',     value: 0 },
      { label: 'Chapéu/Boné', value: Math.round(ap.headwear?.true ?? 0) },
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

  const loadData = useCallback(async () => {
    if (!id) return;
    setIsLoadingData(true);
    try {
      const startIso = selectedStartDate.toISOString();
      const endIso   = selectedEndDate.toISOString();
      const startDay = startIso.slice(0, 10);
      const endDay   = endIso.slice(0, 10);

      if (deviceIds.length > 0) {
        setSyncMessage('Calculando dados da loja...');
        const resp = await fetch('/api/sync-analytics', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: id, start: startIso, end: endIso, rebuild_rollup: true, devices: deviceIds }),
        });
        const json = resp.ok ? await resp.json() : null;
        if (json?.dashboard) {
          applyRollup({
            total_visitors:         json.dashboard.total_visitors,
            avg_visitors_per_day:   json.dashboard.avg_visitors_per_day,
            avg_visit_time_seconds: json.dashboard.avg_times_seconds?.avg_visit_time_seconds ?? 0,
            avg_attention_seconds:  json.dashboard.avg_times_seconds?.avg_attention_seconds ?? json.dashboard.avg_attention_seconds ?? 0,
            visitors_per_day:       json.dashboard.visitors_per_day,
            visitors_per_hour_avg:  json.dashboard.visitors_per_hour_avg,
            gender_percent:         json.dashboard.gender_percent,
            attributes_percent:     json.dashboard.attributes_percent,
            age_pyramid_percent:    json.dashboard.age_pyramid_percent,
          });
          setSyncMessage('');
        } else {
          setSyncMessage('');
          setTotalVisitors(0); setDailyStats([0,0,0,0,0,0,0]); setHourlyStats(new Array(24).fill(0));
          setAvgVisitorsPerDay(0); setAvgVisitSeconds(0); setAvgAttentionSeconds(0);
          setGenderStats([]); setAttributeStats([]); setAgeStats([]);
          setVisitorsPerDayMap({}); setHairTypeData([]); setHairColorData([]);
          setComparePrevVisitorsPerDay({});
        }
        setIsLoadingData(false);
        return;
      }

      const { data: rollups } = await supabase
        .from('visitor_analytics_rollups').select('*').eq('client_id', id)
        .lte('start', `${startDay}T00:00:00`).gte('end', `${endDay}T23:59:59.999Z`)
        .order('updated_at', { ascending: false }).limit(1);

      const rollup = rollups?.[0] ?? null;
      if (rollup) {
        console.log(`[Dashboard] Rollup carregado ✅ (${rollup.total_visitors} visitantes)`);
        applyRollup(rollup);
        setIsLoadingData(false);
        return;
      }

      console.log('[Dashboard] Sem rollup — acionando rebuild em background...');
      setTotalVisitors(0); setDailyStats([0,0,0,0,0,0,0]); setHourlyStats(new Array(24).fill(0));
      setAvgVisitorsPerDay(0); setAvgVisitSeconds(0); setAvgAttentionSeconds(0);
      setGenderStats([]); setAttributeStats([]); setAgeStats([]);
      setVisitorsPerDayMap({}); setHairTypeData([]); setHairColorData([]);
      setComparePrevVisitorsPerDay({});
      setIsLoadingData(false);

      const rebuildKey = `${id}:${startDay}:${endDay}:${deviceIds.join(',')}`;
      if (_rebuilding.has(rebuildKey)) return;
      _rebuilding.add(rebuildKey);
      setSyncMessage('Calculando dados do banco...');

      try {
        const resp = await fetch('/api/sync-analytics', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: id, start: startIso, end: endIso, rebuild_rollup: true }),
        });
        const json = resp.ok ? await resp.json() : null;
        if (json?.dashboard) {
          applyRollup({
            total_visitors:         json.dashboard.total_visitors,
            avg_visitors_per_day:   json.dashboard.avg_visitors_per_day,
            avg_visit_time_seconds: json.dashboard.avg_times_seconds?.avg_visit_time_seconds ?? 0,
            avg_attention_seconds:  json.dashboard.avg_times_seconds?.avg_attention_seconds ?? json.dashboard.avg_attention_seconds ?? 0,
            visitors_per_day:       json.dashboard.visitors_per_day,
            visitors_per_hour_avg:  json.dashboard.visitors_per_hour_avg,
            gender_percent:         json.dashboard.gender_percent,
            attributes_percent:     json.dashboard.attributes_percent,
            age_pyramid_percent:    json.dashboard.age_pyramid_percent,
          });
          setSyncMessage(`✅ ${json.dashboard.total_visitors.toLocaleString()} visitantes carregados.`);
        } else {
          setSyncMessage('');
        }
      } catch (e) {
        console.warn('[Dashboard] Rebuild falhou:', e);
        setSyncMessage('');
      } finally {
        _rebuilding.delete(rebuildKey);
      }
    } catch (err) {
      console.error('[Dashboard] Erro ao carregar dados:', err);
    } finally {
      setIsLoadingData(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, view, selectedStore?.id, selectedCamera?.id, selectedStartDate, selectedEndDate, deviceIds]);

  const syncFromApi = useCallback(async (silent = false) => {
    if (!id || syncingRef.current || document.visibilityState !== 'visible') return;
    syncingRef.current = true;
    setIsSyncing(true);
    if (!silent) setSyncMessage('Sincronizando...');

    try {
      let offset: number | null = 0;
      let loops = 0;
      let totalFetched = 0;

      while (offset !== null) {
        if (++loops > 300) { console.warn('[Sync] limite de loops atingido'); break; }
        const payload: any = { client_id: id, start: selectedStartDate.toISOString(), end: selectedEndDate.toISOString(), offset, force_full_sync: true };
        if (deviceIds.length > 0) payload.devices = deviceIds;

        const resp = await fetch('/api/sync-analytics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!resp.ok) { const txt = await resp.text(); console.error('[Sync] erro:', resp.status, txt); setSyncMessage(''); return; }

        const json = await resp.json();
        totalFetched += Number(json?.externalFetched || 0);
        const totalInDB = Number(json?.total_in_db || 0);

        if (json?.done === true || json?.next_offset == null) {
          offset = null;
          setSyncMessage('Calculando totais...');
          const _startDay = selectedStartDate.toISOString().slice(0, 10);
          const _endDay   = selectedEndDate.toISOString().slice(0, 10);
          const rebuildKey2 = `${id}:${_startDay}:${_endDay}:${deviceIds.join(',')}`;
          if (_rebuilding.has(rebuildKey2)) { setSyncMessage('✅ Sincronização concluída.'); }
          else {
            try {
              const rebuildResp = await fetch('/api/sync-analytics', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ client_id: id, start: selectedStartDate.toISOString(), end: selectedEndDate.toISOString(), rebuild_rollup: true, ...(deviceIds.length > 0 ? { devices: deviceIds } : {}) }),
              });
              const rebuildJson = rebuildResp.ok ? await rebuildResp.json() : null;
              if (rebuildJson?.dashboard) {
                applyRollup({
                  total_visitors:         rebuildJson.dashboard.total_visitors,
                  avg_visitors_per_day:   rebuildJson.dashboard.avg_visitors_per_day,
                  avg_visit_time_seconds: rebuildJson.dashboard.avg_times_seconds?.avg_visit_time_seconds ?? 0,
                  avg_attention_seconds:  rebuildJson.dashboard.avg_times_seconds?.avg_attention_seconds ?? rebuildJson.dashboard.avg_attention_seconds ?? 0,
                  visitors_per_day:       rebuildJson.dashboard.visitors_per_day,
                  visitors_per_hour_avg:  rebuildJson.dashboard.visitors_per_hour_avg,
                  gender_percent:         rebuildJson.dashboard.gender_percent,
                  attributes_percent:     rebuildJson.dashboard.attributes_percent,
                  age_pyramid_percent:    rebuildJson.dashboard.age_pyramid_percent,
                });
                setSyncMessage(`✅ ${rebuildJson.dashboard.total_visitors.toLocaleString()} visitantes sincronizados.`);
              } else {
                setSyncMessage(`✅ ${totalFetched.toLocaleString()} registros importados.`);
                await loadData();
              }
            } catch { setSyncMessage('✅ Sincronização concluída.'); await loadData(); }
          }
        } else {
          offset = Number(json.next_offset);
          const displayTotal = totalInDB > 0 ? totalInDB : totalFetched;
          setSyncMessage(`Sincronizando... ${displayTotal.toLocaleString()} registros`);
          await new Promise((r) => setTimeout(r, 150));
        }
      }
    } catch (err) {
      console.error('[Sync] erro inesperado:', err);
      setSyncMessage('');
    } finally {
      syncingRef.current = false;
      setIsSyncing(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, selectedStartDate, selectedEndDate, deviceIds]);

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
      const a = await sumSalesCount(table, 'date');    if (typeof a === 'number') return a; if (a === null) return null;
      const b = await sumSalesCount(table, 'created_at'); if (typeof b === 'number') return b; if (b === null) return null;
      const c = await countRows(table, 'created_at');  if (typeof c === 'number') return c; if (c === null) return null;
      const d = await countRows(table, 'date');        if (typeof d === 'number') return d; if (d === null) return null;
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
          if (Object.keys(merged).length > 0) {
            rollupVisitorsPerDay = merged;
          }
        }
      }

      if (!rollupVisitorsPerDay && deviceIds.length === 0) {
        try {
          const resp = await fetch('/api/sync-analytics', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ client_id: id, start: quarterStart, end: quarterEnd, rebuild_rollup: true }),
          });
          const json = resp.ok ? await resp.json() : null;
          if (json?.dashboard?.visitors_per_day) {
            const vpd = json.dashboard.visitors_per_day as Record<string, number>;
            rollupVisitorsPerDay = {};
            for (const [d, v] of Object.entries(vpd)) {
              if (d >= qStartDay && d <= qEndDay) rollupVisitorsPerDay[d] = Number(v) || 0;
            }
          }
        } catch (e) {
          console.warn('[Quarter] Rebuild falhou, usando contagem de linhas:', e);
        }
      }

      if (!rollupVisitorsPerDay && deviceIds.length === 0) {
        const merged: Record<string, number> = {};
        for (const month of months) {
          try {
            const resp = await fetch('/api/sync-analytics', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ client_id: id, start: month.startIso, end: month.endIso, rebuild_rollup: true }),
            });
            const json = resp.ok ? await resp.json() : null;
            if (json?.dashboard?.visitors_per_day) {
              const vpd = json.dashboard.visitors_per_day as Record<string, number>;
              for (const [d, v] of Object.entries(vpd)) {
                const ds = d.slice(0, 10);
                if (ds >= qStartDay && ds <= qEndDay && !(ds in merged)) merged[ds] = Number(v) || 0;
              }
            }
          } catch (e) {
            console.warn(`[Quarter] Rebuild mês ${month.label} falhou:`, e);
          }
        }
        if (Object.keys(merged).length > 0) rollupVisitorsPerDay = merged;
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
      console.warn('[Dashboard] Erro ao carregar último trimestre:', e);
      setQuarterBars([]); setQuarterVisitorsTotal(0); setQuarterSalesTotal(0);
    } finally {
      setIsLoadingQuarter(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, deviceIds, lastQuarterMonths, fetchSalesFromDb, fetchVisitorsFromDb]);

  useEffect(() => { loadData(); }, [loadData]);

  const loadCompareData = useCallback(async () => {
    if (!id) return;
    const dayCount = Math.max(1, Math.floor((selectedEndDate.getTime() - selectedStartDate.getTime()) / 86400000) + 1);
    const prevEnd   = new Date(selectedStartDate.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - (dayCount - 1) * 86400000);
    setIsLoadingCompare(true);
    try {
      if (deviceIds.length === 0) {
        const prevStartDay = prevStart.toISOString().slice(0, 10);
        const prevEndDay   = prevEnd.toISOString().slice(0, 10);
        const { data: rollups } = await supabase.from('visitor_analytics_rollups').select('visitors_per_day')
          .eq('client_id', id).lte('start', `${prevStartDay}T00:00:00`).gte('end', `${prevEndDay}T23:59:59.999Z`)
          .order('updated_at', { ascending: false }).limit(1);
        const found = rollups?.[0] as any;
        if (found?.visitors_per_day) {
          setComparePrevVisitorsPerDay(found.visitors_per_day || {});
        } else {
          const resp = await fetch('/api/sync-analytics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: id, start: prevStart.toISOString(), end: prevEnd.toISOString(), rebuild_rollup: true }) });
          const json = resp.ok ? await resp.json() : null;
          setComparePrevVisitorsPerDay(json?.dashboard?.visitors_per_day || {});
        }
      } else {
        const resp = await fetch('/api/sync-analytics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: id, start: prevStart.toISOString(), end: prevEnd.toISOString(), rebuild_rollup: true, devices: deviceIds }) });
        const json = resp.ok ? await resp.json() : null;
        setComparePrevVisitorsPerDay(json?.dashboard?.visitors_per_day || {});
      }
    } catch (e) { console.warn('[Dashboard] Erro ao carregar comparativo:', e); setComparePrevVisitorsPerDay({}); }
    finally { setIsLoadingCompare(false); }
  }, [id, selectedStartDate, selectedEndDate, deviceIds]);

  const loadWeekFlowData = useCallback(async () => {
    if (!id) return;
    const end = new Date(selectedEndDate); end.setUTCHours(23, 59, 59, 999);
    const dow = end.getUTCDay(); const offset = (dow + 6) % 7;
    const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - offset, 0, 0, 0, 0));
    const startIso = start.toISOString(); const endIso = end.toISOString();

    const toWeekDays = (vpd: Record<string, number>) => {
      const days = [0, 0, 0, 0, 0, 0, 0];
      Object.entries(vpd || {}).forEach(([dateStr, count]) => {
        const d = new Date(dateStr); if (isNaN(d.getTime())) return;
        const ud = d.getUTCDay(); const idx = ud === 0 ? 6 : ud - 1;
        days[idx] += Number(count) || 0;
      });
      return days;
    };

    try {
      if (deviceIds.length === 0) {
        const { data } = await supabase.from('visitor_analytics_rollups').select('visitors_per_day')
          .eq('client_id', id).eq('start', startIso).eq('end', endIso)
          .order('updated_at', { ascending: false }).limit(1);
        const found = data?.[0] as any;
        if (found?.visitors_per_day) { setDailyStats(toWeekDays(found.visitors_per_day || {})); return; }
        const resp = await fetch('/api/sync-analytics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: id, start: startIso, end: endIso, rebuild_rollup: true }) });
        const json = resp.ok ? await resp.json() : null;
        setDailyStats(toWeekDays(json?.dashboard?.visitors_per_day || {}));
        return;
      }
      const days = [0, 0, 0, 0, 0, 0, 0]; let from = 0; const page = 1000;
      while (true) {
        const { data, error } = await supabase.from('visitor_analytics').select('timestamp')
          .eq('client_id', id).gte('timestamp', startIso).lte('timestamp', endIso)
          .in('device_id', deviceIds).order('timestamp', { ascending: true }).range(from, from + page - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        (data as any[]).forEach((r: any) => {
          const t = new Date(r.timestamp); if (isNaN(t.getTime())) return;
          const ud = t.getUTCDay(); days[ud === 0 ? 6 : ud - 1] += 1;
        });
        if (data.length < page) break;
        from += page; if (from > 20000) break;
      }
      setDailyStats(days);
    } catch (e) { console.warn('[Dashboard] Erro ao carregar semana:', e); setDailyStats([0,0,0,0,0,0,0]); }
  }, [id, selectedEndDate, deviceIds]);

  useEffect(() => { loadWeekFlowData(); }, [loadWeekFlowData]);
  useEffect(() => { loadQuarterData(); }, [loadQuarterData]);
  useEffect(() => { loadCompareData(); }, [loadCompareData]);

  const refreshClientAndStores = useCallback(async () => {
    if (!id) return;
    const { data: client } = await supabase.from('clients').select('name, logo_url').eq('id', id).single();
    if (client) setClientData({ name: client.name, logo: client.logo_url });
    const { data: storesData }  = await supabase.from('stores').select('id, name, city').eq('client_id', id);
    const { data: devicesData } = await supabase.from('devices').select('id, name, type, mac_address, status, store_id');
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
        .map((store: any) => ({ id: store.id, name: store.name, address: '', city: store.city || '', status: 'online', cameras: devicesByStore[store.id] || [] }));
      setStores(uniqueStores);
    }
  }, [id]);

  const syncStoresFromServer = useCallback(async () => {
    if (!id) return;
    setIsSyncingStores(true);
    try {
      const resp = await fetch('/api/sync-analytics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: id, sync_stores: true }) });
      if (!resp.ok) { const txt = await resp.text(); console.warn('[Stores Sync] Erro API:', txt); setSyncMessage(''); return; }
      await resp.json();
      await refreshClientAndStores();
    } catch (e) { console.warn('[Stores Sync] Erro:', e); setSyncMessage(''); }
    finally { setIsSyncingStores(false); }
  }, [id, refreshClientAndStores]);

  useEffect(() => { refreshClientAndStores(); }, [refreshClientAndStores]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const run = async () => {
      if (cancelled || syncingRef.current || isSyncingStores || document.visibilityState !== 'visible') return;
      await refreshClientAndStores();
      await syncStoresFromServer();
      await syncFromApi(true);
      await loadData(); await loadWeekFlowData(); await loadQuarterData(); await loadCompareData();
      setLastUpdate(new Date());
    };
    void run();
    const t = setInterval(() => { void run(); }, 10 * 60 * 1000);
    return () => { cancelled = true; clearInterval(t); };
  }, [id, refreshClientAndStores, syncStoresFromServer, syncFromApi, isSyncingStores, loadData, loadWeekFlowData, loadQuarterData, loadCompareData]);

  useEffect(() => {
    let cancelled = false;

    const clampNum = (v: any, min: number, max: number, fallback: number) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return fallback;
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
          ? widgetsConfig.widget_ids.filter((x: any) => typeof x === 'string')
          : null;

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

      const fetchConfig = async (layoutName: string, clientId: string | null) => {
        const q = supabase
          .from('dashboard_configs')
          .select('widgets_config, updated_at')
          .eq('layout_name', layoutName)
          .order('updated_at', { ascending: false })
          .limit(1);
        const { data } = clientId == null ? await q.is('client_id', null) : await q.eq('client_id', clientId);
        return data?.[0]?.widgets_config ?? null;
      };

      const defaultIds = ['flow_trend', 'hourly_flow', 'age_pyramid', 'gender_dist', 'attributes', 'campaigns'];

      let allowedRaw = await fetchConfig('client', id);
      if (!allowedRaw) allowedRaw = await fetchConfig('global', null);

      let allowed = resolveDashboardConfig(allowedRaw);
      if (!allowed.ids) {
        const cc = localStorage.getItem(`dashboard-config-${id}`);
        const gc = localStorage.getItem('dashboard-config-global');
        allowed = resolveDashboardConfig(cc ? JSON.parse(cc) : null);
        if (!allowed.ids) allowed = resolveDashboardConfig(gc ? JSON.parse(gc) : null);
      }

      const allowedIds = allowed.ids && allowed.ids.length ? allowed.ids : defaultIds;
      const allowedSet = new Set(allowedIds);

      let userRaw: any = null;
      try {
        userRaw = await fetchConfig('client_user', id);
      } catch {
        userRaw = null;
      }

      let userCfg = resolveDashboardConfig(userRaw);
      if (!userCfg.ids) {
        const uc = localStorage.getItem(`dashboard-config-user-${id}`);
        userCfg = resolveDashboardConfig(uc ? JSON.parse(uc) : null);
      }

      const baseIds = userCfg.ids && userCfg.ids.length ? userCfg.ids : allowedIds;
      let finalIds = baseIds.filter((wid) => allowedSet.has(wid));
      if (!finalIds.length) finalIds = allowedIds;

      const mergedLayout: Record<string, { colSpanLg?: Span; heightPx?: number }> = { ...allowed.widgetLayout };
      for (const [wid, cfg] of Object.entries(userCfg.widgetLayout)) {
        if (allowedSet.has(wid)) mergedLayout[wid] = { ...(mergedLayout[wid] || {}), ...(cfg as any) };
      }

      const active = finalIds
        .map((wid) => AVAILABLE_WIDGETS.find((w) => w.id === wid))
        .filter(Boolean) as WidgetType[];

      if (!cancelled) {
        setActiveWidgets(active);
        setWidgetLayout(mergedLayout);
        setIsLoadingConfig(false);
      }
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
    { label: 'Total Visitantes',     value: totalVisitors.toLocaleString(),                                        icon: Users    },
    { label: 'Média Visitantes Dia', value: avgVisitorsPerDay.toLocaleString(),                                    icon: BarChart2 },
    { label: 'Tempo Médio Visita',   value: formatDuration(avgVisitSeconds),                                       icon: Clock    },
    { label: 'Tempo de Atenção',     value: avgAttentionSeconds > 0 ? formatDuration(avgAttentionSeconds) : '—',  icon: Clock    },
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
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <button onClick={() => navigate('/clientes')} className="hover:text-emerald-400 transition-colors">Clientes</button>
          <ChevronRight size={14} />
          <button onClick={goToNetwork} className={`hover:text-emerald-400 transition-colors ${view === 'network' && !selectedStore ? 'text-white font-medium' : ''}`}>{clientName}</button>
          {selectedStore && (<><ChevronRight size={14} /><button onClick={() => goToStore(selectedStore)} className="hover:text-emerald-400 transition-colors text-white font-medium">{selectedStore.name}</button></>)}
        </div>

        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          {/* Logo + título */}
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
                <p className={`text-xs mt-1 ${syncMessage.startsWith('✅') ? 'text-emerald-400' : syncMessage.startsWith('Erro') ? 'text-red-400' : 'text-yellow-400'}`}>{syncMessage}</p>
              )}
            </div>
          </div>

          {/* Controles direita */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-start gap-3 w-full lg:w-auto">
            {/* Seletor de loja */}
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

            {/* Botão Apresentação + Date Picker */}
            <div className="flex flex-row items-start gap-3 w-full sm:w-auto">
              {/* Botão Tela Cheia — só ícone */}
              <button
                onClick={toggleFullscreen}
                title={isFullscreen ? 'Sair da tela cheia' : 'Modo apresentação'}
                className="flex items-center justify-center bg-gray-900 border border-gray-800 text-white rounded-lg hover:border-gray-700 transition-colors flex-shrink-0 h-[38px] w-[38px]"
              >
                {isFullscreen
                  ? <Minimize2 size={16} className="text-emerald-400" />
                  : <Maximize2 size={16} className="text-gray-400" />}
              </button>

              {/* Date Picker */}
              <div className="flex flex-col items-end flex-1 sm:flex-none">
                <div className="relative w-full sm:w-auto">
                  <button onClick={() => setShowDatePicker(!showDatePicker)} className="w-full sm:w-auto flex items-center justify-between sm:justify-start gap-2 bg-gray-900 border border-gray-800 text-white px-4 py-2 rounded-lg hover:border-gray-700 transition-colors">
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
                          <input type="date" value={selectedStartDate.toISOString().slice(0, 10)}
                            onChange={(e) => { autoTodayRef.current = false; const d = new Date(`${e.target.value}T00:00:00.000Z`); if (!isNaN(d.getTime())) setSelectedStartDate(d); }}
                            className="bg-gray-800 text-white px-3 py-2 rounded-md border border-gray-700" />
                        </div>
                        <div className="w-full sm:w-auto">
                          <label className="block text-xs text-gray-400">Fim</label>
                          <input type="date" value={selectedEndDate.toISOString().slice(0, 10)}
                            onChange={(e) => { autoTodayRef.current = false; const d = new Date(`${e.target.value}T23:59:59.999Z`); if (!isNaN(d.getTime())) setSelectedEndDate(d); }}
                            className="w-full bg-gray-800 text-white px-3 py-2 rounded-md border border-gray-700" />
                        </div>
                        <button onClick={() => setShowDatePicker(false)} className="w-full sm:w-auto px-3 py-2 bg-emerald-600 text-white rounded-md">Aplicar</button>
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-3 p-4 items-start">
            {isLoadingConfig ? (
              <div className="col-span-full flex justify-center py-20">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" />
              </div>
            ) : activeWidgets.length > 0 ? (
              activeWidgets.map((widget) => {
                const Component = WIDGET_MAP[widget.id];
                if (!Component) return null;

                const defaultSpanForSize = (size: WidgetType['size']) => {
                  if (size === 'full') return 12;
                  if (size === 'third') return 4;
                  if (size === 'quarter') return 3;
                  if (size === '2/3') return 8;
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
                if (widget.id === 'flow_trend')             { widgetProps.dailyData = dailyStats; widgetProps.genderData = genderStats; }
                if (widget.id === 'hourly_flow')           { widgetProps.hourlyData = hourlyStats; widgetProps.genderData = genderStats; widgetProps.totalVisitors = totalVisitors; }
                if (widget.id === 'age_pyramid')           { widgetProps.ageData = ageStats; widgetProps.totalVisitors = totalVisitors; }
                if (widget.id === 'gender_dist')           { widgetProps.genderData = genderStats; widgetProps.totalVisitors = totalVisitors; }
                if (widget.id === 'attributes')              widgetProps.attrData = attributeStats;
                if (widget.id === 'kpi_flow_stats')        { widgetProps.totalVisitors = totalVisitors; widgetProps.avgVisitorsPerDay = avgVisitorsPerDay; widgetProps.avgVisitSeconds = avgVisitSeconds; }
                if (widget.id === 'chart_age_ranges')        widgetProps.ageData = ageStats;
                if (widget.id === 'chart_vision')            widgetProps.attrData = attributeStats;
                if (widget.id === 'chart_facial_hair')       widgetProps.attrData = attributeStats;
                if (widget.id === 'chart_hair_type')         widgetProps.hairTypeData = hairTypeData;
                if (widget.id === 'chart_hair_color')        widgetProps.hairColorData = hairColorData;
                if (widget.id === 'chart_sales_quarter')     { widgetProps.quarterData = quarterBars; widgetProps.loading = isLoadingQuarter; }
                if (widget.id === 'kpi_store_quarter')     { widgetProps.visitors = quarterVisitorsTotal; widgetProps.sales = quarterSalesTotal; widgetProps.loading = isLoadingQuarter; }
                if (widget.id === 'kpi_store_period')      { widgetProps.visitors = totalVisitors; widgetProps.sales = 0; widgetProps.loading = isLoadingData; }
                if (widget.id === 'campaigns')               widgetProps.clientId = id;
                if (widget.id === 'chart_sales_daily')     { widgetProps.labels = periodSeries.labels; widgetProps.visitors = periodSeries.values; widgetProps.loading = isLoadingData; }
                if (widget.id === 'chart_sales_period_bar')  { widgetProps.periodData = periodWeeks; widgetProps.loading = isLoadingData; }
                if (widget.id === 'chart_sales_period_line') { widgetProps.labels = compareSeries.labels; widgetProps.current = compareSeries.current; widgetProps.previous = compareSeries.previous; widgetProps.loading = isLoadingCompare; }

                const heightPx = Number(widgetLayout[widget.id]?.heightPx);
                const widgetStyle = Number.isFinite(heightPx) ? { height: Math.round(heightPx) } : undefined;

                return (
                  <div key={widget.id} style={widgetStyle} className={`col-span-1 ${mdSpan} ${lgSpan} self-start animate-in fade-in zoom-in-95 duration-500`}>
                    <div className="h-full">
                      <Component {...widgetProps} />
                    </div>
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