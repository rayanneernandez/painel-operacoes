import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  Globe, Activity, Clock, Building2, ChevronRight, ChevronDown,
  LayoutGrid, Users, BarChart2, Image, Upload, Calendar
} from 'lucide-react';

import { AVAILABLE_WIDGETS, WIDGET_MAP } from '../components/DashboardWidgets';
import type { WidgetType } from '../components/DashboardWidgets';
import supabase from '../lib/supabase';

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

  const [view, setView] = useState<'network' | 'store' | 'camera'>('network');
  const [selectedStore, setSelectedStore] = useState<StoreType | null>(null);
  const [selectedCamera, setSelectedCamera] = useState<CameraType | null>(null);
  const [stores, setStores] = useState<StoreType[]>([]);
  const [clientData, setClientData] = useState<{ name: string; logo?: string } | null>(null);
  const [apiConfig, setApiConfig] = useState<ClientApiConfig | null>(null);

  const [selectedStartDate, setSelectedStartDate] = useState<Date>(() => {
    const now = new Date();
    now.setUTCDate(now.getUTCDate() - 7);
    now.setUTCHours(0, 0, 0, 0);
    return now;
  });
  const [selectedEndDate, setSelectedEndDate] = useState<Date>(() => {
    const now = new Date();
    now.setUTCHours(23, 59, 59, 999);
    return now;
  });
  const [showDatePicker, setShowDatePicker] = useState(false);

  // ── Sync state ──────────────────────────────────────────────────────────────
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const syncingRef = useRef(false); // prevent overlapping syncs

  // ── Dashboard data ──────────────────────────────────────────────────────────
  const [totalVisitors, setTotalVisitors] = useState(0);
  const [dailyStats, setDailyStats] = useState<number[]>([0, 0, 0, 0, 0, 0, 0]);
  const [hourlyStats, setHourlyStats] = useState<number[]>(new Array(24).fill(0));
  const [avgVisitorsPerDay, setAvgVisitorsPerDay] = useState(0);
  const [avgVisitSeconds, setAvgVisitSeconds] = useState(0);
  const [genderStats, setGenderStats] = useState<{ label: string; value: number }[]>([]);
  const [attributeStats, setAttributeStats] = useState<{ label: string; value: number }[]>([]);
  const [ageStats, setAgeStats] = useState<{ age: string; m: number; f: number }[]>([]);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const [activeWidgets, setActiveWidgets] = useState<WidgetType[]>([]);
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  const [isLoadingData, setIsLoadingData] = useState(false);

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.round(s % 60);
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return h > 0
      ? `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
      : `${String(mm).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  const deviceIds = useMemo(() => {
    if (view === 'camera' && selectedCamera) {
      const n = Number((selectedCamera as any).macAddress);
      return Number.isFinite(n) ? [n] : [];
    }
    if ((view === 'store' || (view === 'network' && selectedStore)) && selectedStore) {
      return selectedStore.cameras
        .map((c) => Number((c as any).macAddress))
        .filter((n) => Number.isFinite(n));
    }
    return [];
  }, [view, selectedStore, selectedCamera]);

  // ── Apply rollup data to dashboard state ────────────────────────────────────
  function applyRollup(rollup: any) {
    if (!rollup) return false;

    setTotalVisitors(rollup.total_visitors ?? 0);
    setAvgVisitorsPerDay(Math.round(rollup.avg_visitors_per_day ?? 0));
    setAvgVisitSeconds(Math.round(rollup.avg_visit_time_seconds ?? 0));

    // visitors_per_day → dailyStats [Mon..Sun]
    const vpd: Record<string, number> = rollup.visitors_per_day ?? {};
    const days = [0, 0, 0, 0, 0, 0, 0];
    Object.entries(vpd).forEach(([dateStr, count]) => {
      const d = new Date(dateStr);
      if (!isNaN(d.getTime())) {
        const dow = d.getUTCDay(); // 0=Sun
        const idx = dow === 0 ? 6 : dow - 1; // Mon=0..Sun=6
        days[idx] += Number(count);
      }
    });
    setDailyStats(days);

    // visitors_per_hour_avg → hourlyStats
    const vph: Record<string, number> = rollup.visitors_per_hour_avg ?? {};
    const hours = new Array(24).fill(0);
    Object.entries(vph).forEach(([h, v]) => { hours[Number(h)] = Math.round(Number(v)); });
    setHourlyStats(hours);

    // gender
    const gp: Record<string, number> = rollup.gender_percent ?? {};
    setGenderStats([
      { label: 'Masculino', value: Math.round(gp.male ?? 0) },
      { label: 'Feminino', value: Math.round(gp.female ?? 0) },
    ]);

    // attributes
    const ap: any = rollup.attributes_percent ?? {};
    setAttributeStats([
      { label: 'Óculos', value: Math.round(ap.glasses?.true ?? 0) },
      { label: 'Barba', value: Math.round(ap.facial_hair?.true ?? 0) },
      { label: 'Máscara', value: 0 },
      { label: 'Chapéu/Boné', value: Math.round(ap.headwear?.true ?? 0) },
    ]);

    // age pyramid
    const agePct: Record<string, number> = rollup.age_pyramid_percent ?? {};
    const ageOrder = ['65+', '55-64', '45-54', '35-44', '25-34', '18-24', '18-'];
    const ageMap: Record<string, { m: number; f: number }> = {};
    // map DB buckets → display labels
    const bucketMap: Record<string, string> = {
      '65-74': '65+', '75+': '65+',
      '55-64': '55-64', '45-54': '45-54', '35-44': '35-44',
      '25-34': '25-34', '18-24': '18-24',
      '0-9': '18-', '10-17': '18-',
    };
    Object.entries(agePct).forEach(([bucket, pct]) => {
      const label = bucketMap[bucket] ?? bucket;
      if (!ageMap[label]) ageMap[label] = { m: 0, f: 0 };
      // age_pyramid_percent doesn't split by gender in rollup — show as neutral
      ageMap[label].m += Math.round(Number(pct) / 2);
      ageMap[label].f += Math.round(Number(pct) / 2);
    });
    setAgeStats(ageOrder.map((age) => ({ age, m: ageMap[age]?.m ?? 0, f: ageMap[age]?.f ?? 0 })));

    setLastUpdate(new Date());
    return true;
  }

  // ── Load from DB (raw rows) as fallback ─────────────────────────────────────
  function processRawRows(rows: any[]) {
    const days = [0, 0, 0, 0, 0, 0, 0];
    const hours = new Array(24).fill(0);
    const genderCount = { male: 0, female: 0 };
    let totalDur = 0; let durCount = 0;
    const ageMap: Record<string, { m: number; f: number }> = {
      '18-': { m: 0, f: 0 }, '18-24': { m: 0, f: 0 }, '25-34': { m: 0, f: 0 },
      '35-44': { m: 0, f: 0 }, '45-54': { m: 0, f: 0 }, '55-64': { m: 0, f: 0 }, '65+': { m: 0, f: 0 },
    };
    let attrGlasses = 0, attrBeard = 0, attrMask = 0, attrHeadwear = 0;
    const uniqueVisitors = new Set<string>();
    let latest: Date | null = null;

    rows.forEach((visit: any) => {
      const startVal = visit.start || visit.timestamp;
      if (!startVal) return;

      const date = new Date(startVal);
      if (!isNaN(date.getTime())) {
        if (!latest || date > latest) latest = date;
        const day = date.getUTCDay();
        days[day === 0 ? 6 : day - 1]++;
        hours[date.getUTCHours()]++;
      }

      const visitorId = visit.visitor_id || visit.raw_data?.visitor_id;
      if (visitorId) uniqueVisitors.add(String(visitorId));

      const endDt = visit.end ? new Date(visit.end) : null;
      if (endDt && !isNaN(date.getTime()) && !isNaN(endDt.getTime()) && endDt > date) {
        totalDur += (endDt.getTime() - date.getTime()) / 1000; durCount++;
      }

      const sex = visit.sex || visit.gender;
      if (sex === 1 || sex === 'male') genderCount.male++;
      if (sex === 2 || sex === 'female') genderCount.female++;

      const ageValue = typeof visit.age === 'number' ? visit.age : 0;
      let ageGroup = '18-';
      if (ageValue >= 18 && ageValue <= 24) ageGroup = '18-24';
      else if (ageValue >= 25 && ageValue <= 34) ageGroup = '25-34';
      else if (ageValue >= 35 && ageValue <= 44) ageGroup = '35-44';
      else if (ageValue >= 45 && ageValue <= 54) ageGroup = '45-54';
      else if (ageValue >= 55 && ageValue <= 64) ageGroup = '55-64';
      else if (ageValue >= 65) ageGroup = '65+';

      const isMale = sex === 1 || sex === 'male';
      const isFemale = sex === 2 || sex === 'female';
      if (isMale) ageMap[ageGroup].m++;
      if (isFemale) ageMap[ageGroup].f++;

      const attrs = visit.attributes || visit;
      const hasGlasses = attrs.glasses === true || attrs.glasses === 1 ||
        (typeof attrs.glasses === 'string' && ['yes', 'true', '1', 'y', 'on'].includes(attrs.glasses.toLowerCase()));
      if (hasGlasses) attrGlasses++;
      const facialHair = attrs.facial_hair;
      if (facialHair && facialHair !== 'none' && facialHair !== 'shaved') attrBeard++;
      const mask = attrs.mask || attrs.has_mask;
      if (mask) attrMask++;
      const headwear = attrs.headwear;
      if (headwear && headwear !== 'none' && headwear !== 'no') attrHeadwear++;
    });

    const totalProcessed = uniqueVisitors.size > 0 ? uniqueVisitors.size : rows.length;
    const dayCount = Math.max(1, Math.floor((selectedEndDate.getTime() - selectedStartDate.getTime()) / 86400000) + 1);

    setTotalVisitors(totalProcessed);
    setDailyStats([...days]);
    setHourlyStats([...hours]);
    setAvgVisitorsPerDay(Math.round(totalProcessed / dayCount));
    setAvgVisitSeconds(durCount ? Math.round(totalDur / durCount) : 0);
    setGenderStats([{ label: 'Masculino', value: genderCount.male }, { label: 'Feminino', value: genderCount.female }]);
    const base = Math.max(rows.length, 1);
    setAttributeStats([
      { label: 'Óculos', value: Math.round((attrGlasses / base) * 100) },
      { label: 'Barba', value: Math.round((attrBeard / base) * 100) },
      { label: 'Máscara', value: Math.round((attrMask / base) * 100) },
      { label: 'Chapéu/Boné', value: Math.round((attrHeadwear / base) * 100) },
    ]);
    setAgeStats([
      { age: '65+', m: Math.round((ageMap['65+'].m / base) * 100), f: Math.round((ageMap['65+'].f / base) * 100) },
      { age: '55-64', m: Math.round((ageMap['55-64'].m / base) * 100), f: Math.round((ageMap['55-64'].f / base) * 100) },
      { age: '45-54', m: Math.round((ageMap['45-54'].m / base) * 100), f: Math.round((ageMap['45-54'].f / base) * 100) },
      { age: '35-44', m: Math.round((ageMap['35-44'].m / base) * 100), f: Math.round((ageMap['35-44'].f / base) * 100) },
      { age: '25-34', m: Math.round((ageMap['25-34'].m / base) * 100), f: Math.round((ageMap['25-34'].f / base) * 100) },
      { age: '18-24', m: Math.round((ageMap['18-24'].m / base) * 100), f: Math.round((ageMap['18-24'].f / base) * 100) },
      { age: '18-', m: Math.round((ageMap['18-'].m / base) * 100), f: Math.round((ageMap['18-'].f / base) * 100) },
    ]);
    if (latest) setLastUpdate(latest);
  }

  // ── Load data: rollup first (fuzzy date match), fallback to paginated raw rows
  const loadData = useCallback(async () => {
    if (!id) return;
    setIsLoadingData(true);

    try {
      const startIso = selectedStartDate.toISOString();
      const endIso   = selectedEndDate.toISOString();
      // Start-of-day and end-of-day for the same calendar days (to find rollups
      // that were saved with slightly different milliseconds)
      const startDay = startIso.slice(0, 10); // "2025-01-01"
      const endDay   = endIso.slice(0, 10);   // "2026-03-10"

      // 1. Find the most recent rollup that covers this period
      //    We match by date prefix (YYYY-MM-DD) to avoid millisecond mismatches
      const { data: rollups } = await supabase
        .from('visitor_analytics_rollups')
        .select('*')
        .eq('client_id', id)
        .gte('start', `${startDay}T00:00:00`)
        .lte('start', `${startDay}T23:59:59.999Z`)
        .gte('end',   `${endDay}T00:00:00`)
        .order('updated_at', { ascending: false })
        .limit(1);

      const rollup = rollups?.[0] ?? null;

      if (rollup) {
        console.log(`[Dashboard] Loaded from rollup ✅ (${rollup.total_visitors} visitors)`);
        applyRollup(rollup);
        setIsLoadingData(false);

        if (Number(rollup.total_visitors) === 1000) {
          void (async () => {
            try {
              let q = supabase
                .from('visitor_analytics')
                .select('timestamp')
                .eq('client_id', id)
                .gte('timestamp', startIso)
                .lte('timestamp', endIso)
                .order('timestamp', { ascending: true })
                .range(1000, 1000);
              if (deviceIds.length > 0) q = q.in('device_id', deviceIds);

              const { data: probe, error: probeErr } = await q;
              if (probeErr || !probe || probe.length === 0) return;

              const resp = await fetch('/api/sync-analytics', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  client_id: id,
                  start: startIso,
                  end: endIso,
                  devices: deviceIds.length > 0 ? deviceIds : undefined,
                  rebuild_rollup: true,
                }),
              });

              if (!resp.ok) return;
              const json = await resp.json();
              if (json?.dashboard) {
                applyRollup({
                  total_visitors:         json.dashboard.total_visitors,
                  avg_visitors_per_day:   json.dashboard.avg_visitors_per_day,
                  avg_visit_time_seconds: json.dashboard.avg_times_seconds?.avg_visit_time_seconds ?? 0,
                  visitors_per_day:       json.dashboard.visitors_per_day,
                  visitors_per_hour_avg:  json.dashboard.visitors_per_hour_avg,
                  gender_percent:         json.dashboard.gender_percent,
                  attributes_percent:     json.dashboard.attributes_percent,
                  age_pyramid_percent:    json.dashboard.age_pyramid_percent,
                });
              }
            } catch (e) {
              console.warn('[Dashboard] Rollup rebuild failed:', e);
            }
          })();
        }

        return;
      }

      // 2. Fallback: read raw rows from DB in pages (no hard limit)
      console.log('[Dashboard] No rollup found, loading raw rows from DB...');

      const PAGE = 10000;
      let from = 0;
      const allData: any[] = [];

      while (true) {
        let q = supabase
          .from('visitor_analytics')
          .select('timestamp,end_timestamp,age,gender,attributes,raw_data,device_id,visit_time_seconds')
          .eq('client_id', id)
          .gte('timestamp', startIso)
          .lte('timestamp', endIso)
          .order('timestamp', { ascending: true })
          .range(from, from + PAGE - 1);
        if (deviceIds.length > 0) q = q.in('device_id', deviceIds);

        const { data: page, error } = await q;
        if (error) { console.error('[Dashboard] DB read error:', error); break; }
        if (!page || page.length === 0) break;
        allData.push(...page);
        if (page.length < PAGE) break;
        from += PAGE;
      }

      if (allData.length > 0) {
        console.log(`[Dashboard] Loaded ${allData.length} raw rows from DB.`);
        processRawRows(
          allData.map((d: any) => ({
            ...d.raw_data,
            start: d.timestamp, end: d.end_timestamp,
            age: d.age,
            sex: d.gender === 1 ? 'male' : d.gender === 2 ? 'female' : 'unknown',
            attributes: d.attributes,
            visitor_id: d.raw_data?.visitor_id,
          }))
        );
      } else {
        console.log('[Dashboard] No data in DB for this period — sync needed.');
        setTotalVisitors(0); setDailyStats([0,0,0,0,0,0,0]); setHourlyStats(new Array(24).fill(0));
        setAvgVisitorsPerDay(0); setAvgVisitSeconds(0);
        setGenderStats([]); setAttributeStats([]); setAgeStats([]);
      }
    } catch (err) {
      console.error('[Dashboard] Error loading data:', err);
    } finally {
      setIsLoadingData(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, view, selectedStore?.id, selectedCamera?.id, selectedStartDate, selectedEndDate, deviceIds]);

  // ── Sync from API → DB (backend does all the work) ──────────────────────────
  const syncFromApi = useCallback(async (silent = false) => {
    if (!id) return;
    if (syncingRef.current) return; // prevent overlap
    if (document.visibilityState !== 'visible') return;

    syncingRef.current = true;
    setIsSyncing(true);
    if (!silent) setSyncMessage('Sincronizando...');

    try {
      let offset: number | null = 0;
      let loops = 0;
      let totalFetched = 0;

      while (offset !== null) {
        if (++loops > 300) { console.warn('[Sync] loop limit reached'); break; }

        const payload: any = {
          client_id: id,
          start: selectedStartDate.toISOString(),
          end: selectedEndDate.toISOString(),
          offset,
        };
        if (deviceIds.length > 0) payload.devices = deviceIds;

        const resp = await fetch('/api/sync-analytics', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!resp.ok) {
          const txt = await resp.text();
          console.error('[Sync] error:', resp.status, txt);
          setSyncMessage(`Erro ao sincronizar (${resp.status})`);
          return;
        }

        const json = await resp.json();
        totalFetched += Number(json?.externalFetched || 0);
        const totalInDB = Number(json?.total_in_db || 0);

        if (json?.done === true || json?.next_offset == null) {
          offset = null;
          const displayTotal = totalInDB > 0 ? totalInDB : totalFetched;
          setSyncMessage(`✅ ${displayTotal.toLocaleString()} registros sincronizados.`);

          // Apply rollup returned by API — always has accurate total from full DB read
          if (json?.dashboard) {
            applyRollup({
              total_visitors:         json.dashboard.total_visitors,
              avg_visitors_per_day:   json.dashboard.avg_visitors_per_day,
              avg_visit_time_seconds: json.dashboard.avg_times_seconds?.avg_visit_time_seconds ?? 0,
              visitors_per_day:       json.dashboard.visitors_per_day,
              visitors_per_hour_avg:  json.dashboard.visitors_per_hour_avg,
              gender_percent:         json.dashboard.gender_percent,
              attributes_percent:     json.dashboard.attributes_percent,
              age_pyramid_percent:    json.dashboard.age_pyramid_percent,
            });
          } else {
            await loadData();
          }
        } else {
          offset = Number(json.next_offset);
          const displayTotal = totalInDB > 0 ? totalInDB : totalFetched;
          setSyncMessage(`Sincronizando... ${displayTotal.toLocaleString()} registros`);
          await new Promise((r) => setTimeout(r, 150));
        }
      }
    } catch (err) {
      console.error('[Sync] unexpected error:', err);
      setSyncMessage('Erro inesperado na sincronização');
    } finally {
      syncingRef.current = false;
      setIsSyncing(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, selectedStartDate, selectedEndDate, deviceIds]);

  // ── On mount / filter change: load DB first, then sync ──────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadData();
      if (!cancelled) {
        // Sync in background after initial load
        syncFromApi(true);
      }
    })();
    return () => { cancelled = true; };
  }, [loadData]); // loadData already memoizes all deps

  // ── Auto-refresh every 5 min ─────────────────────────────────────────────────
  useEffect(() => {
    if (!id) return;
    const t = setInterval(() => {
      if (!syncingRef.current && document.visibilityState === 'visible') {
        syncFromApi(true);
      }
    }, 5 * 60 * 1000); // 5 minutes
    return () => clearInterval(t);
  }, [id, syncFromApi]);

  // ── Fetch client info, stores, api config ────────────────────────────────────
  useEffect(() => {
    async function fetchClientAndStores() {
      if (!id) return;

      const { data: client } = await supabase
        .from('clients').select('name, logo_url').eq('id', id).single();
      if (client) setClientData({ name: client.name, logo: client.logo_url });

      const { data: storesData } = await supabase
        .from('stores').select('id, name, city').eq('client_id', id);
      const { data: devicesData } = await supabase
        .from('devices').select('id, name, type, mac_address, status, store_id');
      const { data: apiCfg } = await supabase
        .from('client_api_configs')
        .select(`api_endpoint, analytics_endpoint, api_key, custom_header_key,
          custom_header_value, collection_start, collection_end, collect_tracks,
          collect_face_quality, collect_glasses, collect_beard, collect_hair_color,
          collect_hair_type, collect_headwear`)
        .eq('client_id', id).single();

      if (apiCfg) setApiConfig(apiCfg as ClientApiConfig);

      if (storesData) {
        const devicesByStore: Record<string, any[]> = {};
        (devicesData || []).forEach((device: any) => {
          if (!devicesByStore[device.store_id]) devicesByStore[device.store_id] = [];
          devicesByStore[device.store_id].push({
            id: device.id, name: device.name, status: device.status || 'offline',
            type: device.type || 'dome', resolution: '1080p', macAddress: device.mac_address,
          });
        });

        const seen = new Set<string>();
        const uniqueStores: StoreType[] = storesData
          .filter((s: any) => { if (seen.has(String(s.id))) return false; seen.add(String(s.id)); return true; })
          .map((store: any) => ({
            id: store.id, name: store.name, address: '', city: store.city || '',
            status: 'online', cameras: devicesByStore[store.id] || [],
          }));
        setStores(uniqueStores);
      }
    }
    fetchClientAndStores();
  }, [id]);

  // ── Widget config from localStorage ─────────────────────────────────────────
  useEffect(() => {
    const clientConfig = localStorage.getItem(`dashboard-config-${id}`);
    const globalConfig = localStorage.getItem('dashboard-config-global');
    const raw = clientConfig || globalConfig;
    if (raw) {
      const savedIds = JSON.parse(raw) as string[];
      setActiveWidgets(savedIds.map((wid) => AVAILABLE_WIDGETS.find((w) => w.id === wid)).filter(Boolean) as WidgetType[]);
    } else {
      const defaultIds = ['flow_trend', 'hourly_flow', 'age_pyramid', 'gender_dist', 'attributes', 'campaigns'];
      setActiveWidgets(defaultIds.map((wid) => AVAILABLE_WIDGETS.find((w) => w.id === wid)).filter(Boolean) as WidgetType[]);
    }
    setIsLoadingConfig(false);
  }, [id]);

  // ── Navigation from location state ──────────────────────────────────────────
  useEffect(() => {
    if (location.state?.initialView === 'store' && location.state?.storeId) {
      const store = stores.find((s) => s.id === location.state.storeId);
      if (store) { setSelectedStore(store); setView('network'); }
    }
  }, [location.state, stores]);

  const goToNetwork = () => { setView('network'); setSelectedStore(null); setSelectedCamera(null); };
  const goToStore = (store: StoreType) => { setSelectedStore(store); setView('network'); setSelectedCamera(null); };

  const getStats = () => [
    { label: 'Total Visitantes', value: totalVisitors.toLocaleString(), icon: Users },
    { label: 'Média Visitantes Dia', value: avgVisitorsPerDay.toLocaleString(), icon: BarChart2 },
    { label: 'Tempo Médio Visita', value: formatDuration(avgVisitSeconds), icon: Clock },
    { label: 'Taxa Conversão', value: '0%', icon: Activity },
  ];

  const clientName = clientData?.name || 'Carregando...';
  const clientLogo = clientData?.logo;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col gap-4">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <button onClick={() => navigate('/clientes')} className="hover:text-emerald-400 transition-colors">
            Clientes
          </button>
          <ChevronRight size={14} />
          <button
            onClick={goToNetwork}
            className={`hover:text-emerald-400 transition-colors ${view === 'network' && !selectedStore ? 'text-white font-medium' : ''}`}
          >
            {clientName}
          </button>
          {selectedStore && (
            <>
              <ChevronRight size={14} />
              <button onClick={() => goToStore(selectedStore)} className="hover:text-emerald-400 transition-colors text-white font-medium">
                {selectedStore.name}
              </button>
            </>
          )}
        </div>

        {/* Header */}
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
              <h1 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2">
                <Globe className="text-emerald-500" />
                Dashboard Geral
              </h1>
              <p className="text-sm sm:text-base text-gray-400 mt-1">
                Monitorando {stores.length} lojas nesta rede
              </p>
              <p className="text-xs text-gray-500 mt-1">
                API configurada: {apiConfig?.api_key ? '✅' : '⚠️'}
              </p>
              {syncMessage && (
                <p className={`text-xs mt-1 ${syncMessage.startsWith('✅') ? 'text-emerald-400' : syncMessage.startsWith('Erro') ? 'text-red-400' : 'text-yellow-400'}`}>
                  {syncMessage}
                </p>
              )}
            </div>
          </div>

          {/* Controls */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full lg:w-auto">
            {/* Store selector */}
            <div className="relative w-full sm:w-auto">
              <select
                className="bg-gray-900 border border-gray-800 text-white pl-10 pr-8 py-2 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 appearance-none cursor-pointer text-sm w-full sm:min-w-[180px]"
                onChange={(e) => {
                  const storeId = e.target.value;
                  if (storeId === 'all') goToNetwork();
                  else { const store = stores.find((s) => s.id === storeId); if (store) goToStore(store); }
                }}
                value={selectedStore?.id || 'all'}
              >
                <option value="all" style={{ backgroundColor: '#111827', color: 'white' }}>Rede Global</option>
                {stores.map((store) => (
                  <option key={store.id} value={store.id} style={{ backgroundColor: '#111827', color: 'white' }}>
                    {store.name}
                  </option>
                ))}
              </select>
              <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" size={16} />
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" size={14} />
            </div>

            {/* Date picker */}
            <div className="relative w-full sm:w-auto">
              <button
                onClick={() => setShowDatePicker(!showDatePicker)}
                className="w-full sm:w-auto flex items-center justify-between sm:justify-start gap-2 bg-gray-900 border border-gray-800 text-white px-4 py-2 rounded-lg hover:border-gray-700 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Calendar size={16} className="text-gray-500" />
                  <span className="text-sm">
                    {selectedStartDate.toLocaleDateString('pt-BR')} → {selectedEndDate.toLocaleDateString('pt-BR')}
                  </span>
                </div>
                <ChevronDown size={14} className="text-gray-500" />
              </button>
              {showDatePicker && (
                <div className="absolute z-10 mt-2 p-3 bg-gray-900 border border-gray-800 rounded-lg shadow-xl right-0 w-full sm:w-auto">
                  <div className="flex flex-col sm:flex-row items-end gap-3">
                    <div className="w-full sm:w-auto">
                      <label className="block text-xs text-gray-400">Início</label>
                      <input type="date"
                        value={selectedStartDate.toISOString().slice(0, 10)}
                        onChange={(e) => { const d = new Date(`${e.target.value}T00:00:00.000Z`); if (!isNaN(d.getTime())) setSelectedStartDate(d); }}
                        className="bg-gray-800 text-white px-3 py-2 rounded-md border border-gray-700"
                      />
                    </div>
                    <div className="w-full sm:w-auto">
                      <label className="block text-xs text-gray-400">Fim</label>
                      <input type="date"
                        value={selectedEndDate.toISOString().slice(0, 10)}
                        onChange={(e) => { const d = new Date(`${e.target.value}T23:59:59.999Z`); if (!isNaN(d.getTime())) setSelectedEndDate(d); }}
                        className="w-full bg-gray-800 text-white px-3 py-2 rounded-md border border-gray-700"
                      />
                    </div>
                    <button onClick={() => setShowDatePicker(false)} className="w-full sm:w-auto px-3 py-2 bg-emerald-600 text-white rounded-md">
                      Aplicar
                    </button>
                  </div>
                </div>
              )}
            </div>

            {lastUpdate && (
              <div className="text-xs text-gray-500 hidden xl:block">
                Atualizado: {lastUpdate.toLocaleString('pt-BR')}
              </div>
            )}

            {/* Sync button */}
            <button
              onClick={() => syncFromApi(false)}
              disabled={isSyncing}
              className="flex items-center justify-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-500 transition-colors w-full sm:w-auto disabled:opacity-60"
            >
              <Activity size={16} className={isSyncing ? 'animate-pulse' : ''} />
              <span className="text-sm">{isSyncing ? 'Sincronizando...' : 'Sincronizar'}</span>
            </button>
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
              {isLoadingData ? (
                <div className="h-8 bg-gray-800 rounded animate-pulse mx-auto w-24" />
              ) : (
                <p className="text-2xl font-bold text-white tracking-tight">{stat.value}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Widgets */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden min-h-[400px]">
        {view === 'network' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-6 p-6">
            {isLoadingConfig ? (
              <div className="col-span-full flex justify-center py-20">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" />
              </div>
            ) : activeWidgets.length > 0 ? (
              activeWidgets.map((widget) => {
                const Component = WIDGET_MAP[widget.id];
                if (!Component) return null;

                let colSpan = 'lg:col-span-6';
                if (widget.size === 'full') colSpan = 'lg:col-span-12';
                if (widget.size === 'third') colSpan = 'lg:col-span-4';
                if (widget.size === 'quarter') colSpan = 'lg:col-span-3';
                if (widget.size === '2/3') colSpan = 'lg:col-span-8';

                const widgetProps: any = { view: 'network' };
                if (widget.id === 'flow_trend') widgetProps.dailyData = dailyStats;
                if (widget.id === 'hourly_flow') widgetProps.hourlyData = hourlyStats;
                if (widget.id === 'age_pyramid') widgetProps.ageData = ageStats;
                if (widget.id === 'gender_dist') { widgetProps.genderData = genderStats; widgetProps.totalVisitors = totalVisitors; }
                if (widget.id === 'attributes') widgetProps.attrData = attributeStats;

                return (
                  <div key={widget.id} className={`col-span-1 ${colSpan} animate-in fade-in zoom-in-95 duration-500`}>
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
