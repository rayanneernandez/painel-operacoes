import { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { 
  Globe, 
  Activity, 
  Clock, 
  Shield, 
  Building2, 
  Video, 
  ChevronRight, 
  ChevronDown,
  MapPin, 
  LayoutGrid,
  Users,
  BarChart2,
  Image,
  Upload,
  Calendar,
  Settings,
  AlertCircle
} from 'lucide-react';
import { 
  AVAILABLE_WIDGETS, 
  WIDGET_MAP, 
  LineChart, 
  DonutChart, 
  HorizontalBarChart, 
  AgePyramid 
} from '../components/DashboardWidgets';
import type { WidgetType } from '../components/DashboardWidgets';

// Mock Data para Clientes (Simulando API) - REMOVIDO
// const CLIENT_DATA: Record<string, { name: string; logo?: string }> = {};

// Tipos para a hierarquia
type CameraType = {
  id: string;
  name: string;
  status: 'online' | 'offline';
  type: 'dome' | 'bullet' | 'ptz';
  resolution: '1080p' | '4k';
  lastEvent?: string;
  macAddress?: string; // ID da API (DisplayForce) usado para vínculo
};

type StoreType = {
  id: string;
  name: string;
  address: string;
  city: string;
  status: 'online' | 'offline';
  cameras: CameraType[];
};

type ClientApiConfig = {
  api_endpoint: string;
  analytics_endpoint: string;
  api_key: string;
  custom_header_key?: string | null;
  custom_header_value?: string | null;
  collection_start?: string | null;
  collection_end?: string | null;
  collect_tracks?: boolean;
  collect_face_quality?: boolean;
  collect_glasses?: boolean;
  collect_beard?: boolean;
  collect_hair_color?: boolean;
  collect_hair_type?: boolean;
  collect_headwear?: boolean;
};

import supabase from '../lib/supabase';

export function ClientDashboard() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  
  // Estado da visualização
  const [view, setView] = useState<'network' | 'store' | 'camera'>('network');
  const [selectedStore, setSelectedStore] = useState<StoreType | null>(null);
  const [selectedCamera, setSelectedCamera] = useState<CameraType | null>(null);

  // Estado para Lojas (buscando do Supabase)
  const [stores, setStores] = useState<StoreType[]>([]);
  // Dados do Cliente
  const [clientData, setClientData] = useState<{ name: string; logo?: string } | null>(null);

  // Configuração de API do Cliente (DisplayForce)
  const [apiConfig, setApiConfig] = useState<ClientApiConfig | null>(null);

  // Filtro de Data (fim)
  const [selectedStartDate, setSelectedStartDate] = useState<Date>(new Date('2025-01-01T00:00:00Z'));
  const [selectedEndDate, setSelectedEndDate] = useState<Date>(new Date('2025-12-31T23:59:59Z'));
  const [showDatePicker, setShowDatePicker] = useState(false);

  // Estado para Analytics (dados vindos da API)

  const [dailyStats, setDailyStats] = useState<number[]>([0, 0, 0, 0, 0, 0, 0]);
  const [hourlyStats, setHourlyStats] = useState<number[]>(new Array(24).fill(0));
  const [totalVisitors, setTotalVisitors] = useState(0);
  const [ageStats, setAgeStats] = useState<any[]>([]);
  const [genderStats, setGenderStats] = useState<any[]>([]);
  const [attributeStats, setAttributeStats] = useState<{ label: string; value: number }[]>([]);
  const [avgVisitSeconds, setAvgVisitSeconds] = useState(0);
  const [avgVisitorsPerDay, setAvgVisitorsPerDay] = useState(0);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    async function fetchAnalytics() {
      if (!id) return;
      try {
        const now = new Date();
        const defaultStart = new Date(now.getFullYear() - 1, 0, 1).toISOString();
        const endDate = new Date(selectedEndDate);
        endDate.setHours(23, 59, 59, 999);
        const startIso = selectedStartDate ? new Date(selectedStartDate).toISOString() : (apiConfig?.collection_start || defaultStart);
        const endIso = apiConfig?.collection_end || endDate.toISOString();

        let deviceIds: number[] | null = null;
        if (view === 'store' && selectedStore) {
          deviceIds = selectedStore.cameras.map(c => Number((c as any).macAddress)).filter(n => !isNaN(n));
        } else if (view === 'camera' && selectedCamera) {
          const n = Number((selectedCamera as any).macAddress);
          if (!isNaN(n)) deviceIds = [n];
        }

        const isDev = import.meta.env.DEV;
        if (!isDev) {
          const srvResp = await fetch('/api/sync-analytics', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer painel@2026*' },
            body: JSON.stringify({ client_id: id, start: startIso, end: endIso, devices: deviceIds || [] })
          });
          if (srvResp.ok) {
            const srv = await srvResp.json();
            const d = srv.dashboard || {};
            setTotalVisitors(Number(d.total_visitors || 0));
            setAvgVisitorsPerDay(Number(d.avg_visitors_per_day || 0));
            const perHour = d.visitors_per_hour_avg || {};
            setHourlyStats(Array.from({ length: 24 }, (_, h) => Number(perHour[String(h)] || 0)));
            const perDay = d.visitors_per_day || {};
            const week = [0,0,0,0,0,0,0];
            Object.keys(perDay).forEach(k => { const dd = new Date(`${k}T00:00:00Z`); const day = dd.getUTCDay(); const idx = day === 0 ? 6 : day - 1; week[idx] += Number(perDay[k] || 0); });
            setDailyStats(week);
            const g = d.gender_percent || {};
            setGenderStats([{ label: 'Masculino', value: Number(g.male || 0) }, { label: 'Feminino', value: Number(g.female || 0) }]);
            const attrs = d.attributes_percent || {};
            const pctTrue = (obj:any) => Math.round(Number(obj?.true || obj?.['true'] || 0));
            setAttributeStats([
              { label: 'Óculos', value: pctTrue(attrs.glasses) },
              { label: 'Barba', value: pctTrue(attrs.facial_hair) },
              { label: 'Chapéu/Boné', value: pctTrue(attrs.headwear) },
              { label: 'Máscara', value: 0 }
            ]);
            setAvgVisitSeconds(Number(d.avg_times_seconds?.avg_visit_time_seconds || 0));
            setLastUpdate(new Date());
            return;
          }
        }
        // 2) Fallback direto na API externa (dev)
        const baseUrl = isDev ? '/api-proxy' : (apiConfig?.api_endpoint || 'https://api.displayforce.ai');
        const path = apiConfig?.analytics_endpoint || '/public/v1/stats/visitor/list';
        const url = `${baseUrl}${path}`;
        const key = apiConfig?.api_key ? String(apiConfig.api_key) : null;
        const baseHeaders = { 'Content-Type': 'application/json', 'Accept': 'application/json' } as Record<string,string>;
        const headerVariants: Record<string,string>[] = [];
        if (apiConfig?.custom_header_key && apiConfig?.custom_header_value) {
          headerVariants.push({ ...baseHeaders, [String(apiConfig.custom_header_key)]: String(apiConfig.custom_header_value) });
        } else if (key) {
          headerVariants.push({ ...baseHeaders, 'X-API-Token': key });
          headerVariants.push({ ...baseHeaders, 'Authorization': `Bearer ${key}` });
        }
        if (import.meta.env.DEV) {
          const devKey = localStorage.getItem('df_api_token');
          const devHKey = localStorage.getItem('df_auth_header_key');
          const devHVal = localStorage.getItem('df_auth_header_value');
          if (devHKey && devHVal) {
            headerVariants.unshift({ ...baseHeaders, [String(devHKey)]: String(devHVal) });
          } else if (devKey) {
            headerVariants.unshift({ ...baseHeaders, 'Authorization': `Bearer ${String(devKey)}` });
            headerVariants.unshift({ ...baseHeaders, 'X-API-Token': String(devKey) });
          }
        }
        if (headerVariants.length === 0) headerVariants.push(baseHeaders);

        const pageSize = 1000;
        let offset = 0;
        const allRows: any[] = [];
        let chosenHeaders: Record<string,string> | null = null;
        for (;;) {
          const body: any = { start: startIso, end: endIso, limit: pageSize, offset, fields: ['start','end','age','sex','device','devices','face_quality','facial_hair','hair_color','hair_type','headwear','glasses','additional_attributes'] };
          if (deviceIds && deviceIds.length > 0) body.devices = deviceIds;

          let rows: any[] = [];
          const tryHeaders: Record<string,string>[] = chosenHeaders ? [chosenHeaders as Record<string,string>] : headerVariants;
          for (const h of tryHeaders) {
            // Tenta POST
            let resp = await fetch(url, { method: 'POST', headers: h, body: JSON.stringify(body) });
            if (resp.ok) {
              const json = await resp.json();
              rows = json.payload || json.data || [];
              chosenHeaders = h;
              break;
            }
            // Endpoint é POST-only; não usar GET fallback
            
            if (resp.status !== 401 && resp.status !== 403) {
              console.warn('API externa erro:', resp.status, await resp.text());
              rows = [];
              break;
            } else {
              const hk = Object.keys(h).find(x => x.toLowerCase() !== 'content-type' && x.toLowerCase() !== 'accept') || '';
              console.warn('Falha de auth', resp.status, hk);
            }
          }

          if (!Array.isArray(rows) || rows.length === 0) break;
          allRows.push(...rows);
          if (rows.length < pageSize) break;
          offset += pageSize;
          if (offset > 200000) break;
        }

        const combined = allRows.map((v:any) => ({ timestamp: v.start, age: typeof v.age === 'number' ? Math.round(v.age) : null, gender: typeof v.sex === 'number' ? v.sex : 0, raw_data: v }));
        void 0;

        let latest: Date | null = null;
        combined.forEach((row:any) => { const t = new Date(row.timestamp || row.raw_data?.start); if (!isNaN(t.getTime())) { if (!latest || t > latest) latest = t; } });
        setLastUpdate(latest);

        const days = [0,0,0,0,0,0,0];
        const hours = new Array(24).fill(0);
        const genderCount = { male: 0, female: 0 };
        let totalDur = 0; let durCount = 0;
        const ageMap: Record<string, { m: number, f: number }> = { '18-': { m:0,f:0 }, '18-24': { m:0,f:0 }, '25-34': { m:0,f:0 }, '35-44': { m:0,f:0 }, '45-54': { m:0,f:0 }, '55-64': { m:0,f:0 }, '65+': { m:0,f:0 } };
        let attrGlasses = 0, attrBeard = 0, attrMask = 0, attrHeadwear = 0;

        combined.forEach((visit:any) => {
          const baseTimestamp = visit.timestamp || visit.raw_data?.start;
          const date = new Date(baseTimestamp);
          if (!isNaN(date.getTime())) { const day = date.getDay(); const adjustedDay = day === 0 ? 6 : day - 1; days[adjustedDay]++; const hour = date.getHours(); hours[hour]++; }
          const startDt = new Date(visit.raw_data?.start || visit.timestamp);
          const endDt = new Date(visit.raw_data?.end || visit.timestamp);
          if (!isNaN(startDt.getTime()) && !isNaN(endDt.getTime()) && endDt > startDt) { totalDur += (endDt.getTime() - startDt.getTime())/1000; durCount++; }
          const sex = visit.gender ?? visit.raw_data?.sex; const isMale = sex === 1 || sex === 'male'; const isFemale = sex === 2 || sex === 'female'; if (isMale) genderCount.male++; if (isFemale) genderCount.female++;
          const ageValue = typeof visit.age === 'number' ? visit.age : (visit.raw_data?.age ?? 0); const age = typeof ageValue === 'number' ? ageValue : 0;
          let ageGroup = '18-'; if (age >= 18 && age <= 24) ageGroup = '18-24'; else if (age >= 25 && age <= 34) ageGroup = '25-34'; else if (age >= 35 && age <= 44) ageGroup = '35-44'; else if (age >= 45 && age <= 54) ageGroup = '45-54'; else if (age >= 55 && age <= 64) ageGroup = '55-64'; else if (age >= 65) ageGroup = '65+';
          if (isMale) ageMap[ageGroup].m++; if (isFemale) ageMap[ageGroup].f++;
          const raw = visit.raw_data || {};
          const hasGlasses = raw.glasses === true || raw.glasses === 1 || raw.glasses === '1' || (Array.isArray(raw.glasses) && raw.glasses.length > 0); if (hasGlasses) attrGlasses++;
          const facialHair = raw.facial_hair; if (facialHair && facialHair !== 'none') attrBeard++;
          const mask = raw.mask || raw.has_mask || raw.mask_on; if (mask) attrMask++;
          const headwear = raw.headwear; if (headwear && headwear !== 'none') attrHeadwear++;
        });

        setAvgVisitSeconds(durCount ? Math.round(totalDur / durCount) : 0);
        setDailyStats(days);
        setHourlyStats(hours);
        const dayCount = Math.max(1, Math.floor((new Date(endIso).getTime() - new Date(startIso).getTime()) / 86400000) + 1);
        const totalCombined = combined.length;
        setAvgVisitorsPerDay(dayCount ? Math.round(totalCombined / dayCount) : totalCombined);
        setTotalVisitors(totalCombined);
        setGenderStats([{ label: 'Masculino', value: genderCount.male }, { label: 'Feminino', value: genderCount.female }]);
        const base = Math.max(totalCombined, 1);
        setAttributeStats([
          { label: 'Óculos', value: base ? Math.round((attrGlasses / base) * 100) : 0 },
          { label: 'Barba', value: base ? Math.round((attrBeard / base) * 100) : 0 },
          { label: 'Máscara', value: base ? Math.round((attrMask / base) * 100) : 0 },
          { label: 'Chapéu/Boné', value: base ? Math.round((attrHeadwear / base) * 100) : 0 }
        ]);
        // Persistir rollup básico no Supabase (best-effort)
        try {
          if (!isDev) {
            const perHourAvgObj = Object.fromEntries(hours.map((v, i) => [String(i), v]));
            await supabase.from('visitor_analytics_rollups').upsert({
              client_id: id,
              start: startIso,
              end: endIso,
              total_visitors: totalCombined,
              avg_visitors_per_day: dayCount ? Math.round(totalCombined / dayCount) : totalCombined,
              visitors_per_day: { seg: days[0], ter: days[1], qua: days[2], qui: days[3], sex: days[4], sab: days[5], dom: days[6] },
              visitors_per_hour_avg: perHourAvgObj,
              updated_at: new Date().toISOString(),
            });
          }
        } catch(e) { /* ignore RLS */ }
        setAgeStats([
          { age: '65+', m: Math.round((ageMap['65+'].m / base) * 100), f: Math.round((ageMap['65+'].f / base) * 100) },
          { age: '55-64', m: Math.round((ageMap['55-64'].m / base) * 100), f: Math.round((ageMap['55-64'].f / base) * 100) },
          { age: '45-54', m: Math.round((ageMap['45-54'].m / base) * 100), f: Math.round((ageMap['45-54'].f / base) * 100) },
          { age: '35-44', m: Math.round((ageMap['35-44'].m / base) * 100), f: Math.round((ageMap['35-44'].f / base) * 100) },
          { age: '25-34', m: Math.round((ageMap['25-34'].m / base) * 100), f: Math.round((ageMap['25-34'].f / base) * 100) },
          { age: '18-24', m: Math.round((ageMap['18-24'].m / base) * 100), f: Math.round((ageMap['18-24'].f / base) * 100) },
          { age: '18-', m: Math.round((ageMap['18-'].m / base) * 100), f: Math.round((ageMap['18-'].f / base) * 100) }
        ]);
      } catch (err) {
        console.error('Erro inesperado ao buscar analytics (API externa):', err);
        void 0;
        setDailyStats([0,0,0,0,0,0,0]);
        setHourlyStats(new Array(24).fill(0));
        setTotalVisitors(0);
        setGenderStats([]);
        setAgeStats([]);
      }
    }
    fetchAnalytics();
  }, [id, view, selectedStore, selectedCamera, selectedStartDate, selectedEndDate, apiConfig, refreshTick]);

  useEffect(() => {
    async function fetchClientAndStores() {
      if (!id) return;
      
      // 1. Fetch Client Info
      const { data: client } = await supabase
        .from('clients')
        .select('name, logo_url')
        .eq('id', id)
        .single();
        
      if (client) {
        setClientData({
          name: client.name,
          logo: client.logo_url
        });
      }

      // 2. Fetch Stores and Devices (sem JOIN)
      const { data: storesData } = await supabase
        .from('stores')
        .select('id, name, city')
        .eq('client_id', id);

      const { data: devicesData } = await supabase
        .from('devices')
        .select('id, name, type, mac_address, status, store_id');

      // 3. Fetch Client API Config (DisplayForce)
      const { data: apiCfg } = await supabase
        .from('client_api_configs')
        .select(`
          api_endpoint,
          analytics_endpoint,
          api_key,
          custom_header_key,
          custom_header_value,
          collection_start,
          collection_end,
          collect_tracks,
          collect_face_quality,
          collect_glasses,
          collect_beard,
          collect_hair_color,
          collect_hair_type,
          collect_headwear
        `)
        .eq('client_id', id)
        .single();

      if (apiCfg) {
        setApiConfig(apiCfg as ClientApiConfig);
      }

      if (storesData) {
        const devicesByStore: Record<string, any[]> = {};
        (devicesData || []).forEach((device: any) => {
          const sid = device.store_id;
          if (!devicesByStore[sid]) devicesByStore[sid] = [];
          devicesByStore[sid].push({
            id: device.id,
            name: device.name,
            status: device.status || 'offline',
            type: device.type || 'dome',
            resolution: '1080p',
            macAddress: device.mac_address
          });
        });

        const formattedStores: StoreType[] = storesData.map((store: any) => ({
          id: store.id,
          name: store.name,
          address: '',
          city: store.city || '',
          status: 'online',
          cameras: devicesByStore[store.id] || []
        }));
        const seen = new Set<string>();
        const uniqueStores = formattedStores.filter(s => {
          const key = String(s.id);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        setStores(uniqueStores);
      }
    }
    
    fetchClientAndStores();
  }, [id]);

  const clientName = clientData?.name || 'Carregando...';
  const clientLogo = clientData?.logo;

  // Widget Configuration
  const [activeWidgets, setActiveWidgets] = useState<WidgetType[]>([]);
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);

  useEffect(() => {
    // Tenta carregar config do cliente, senão global, senão default
    const loadConfig = () => {
      // 1. Client specific
      const clientConfig = localStorage.getItem(`dashboard-config-${id}`);
      if (clientConfig) {
        const savedIds = JSON.parse(clientConfig) as string[];
        const widgets = savedIds.map(wid => AVAILABLE_WIDGETS.find(w => w.id === wid)).filter(Boolean) as WidgetType[];
        setActiveWidgets(widgets);
        setIsLoadingConfig(false);
        return;
      }

      // 2. Global
      const globalConfig = localStorage.getItem('dashboard-config-global');
      if (globalConfig) {
        const savedIds = JSON.parse(globalConfig) as string[];
        const widgets = savedIds.map(wid => AVAILABLE_WIDGETS.find(w => w.id === wid)).filter(Boolean) as WidgetType[];
        setActiveWidgets(widgets);
        setIsLoadingConfig(false);
        return;
      }

      // 3. Default
      const defaultIds = ['flow_trend', 'hourly_flow', 'age_pyramid', 'gender_dist', 'attributes', 'campaigns'];
      const widgets = defaultIds.map(wid => AVAILABLE_WIDGETS.find(w => w.id === wid)).filter(Boolean) as WidgetType[];
      setActiveWidgets(widgets);
      setIsLoadingConfig(false);
    };

    loadConfig();
  }, [id]);

  // Inicializar estado baseado na navegação
  useEffect(() => {
    if (location.state?.initialView === 'store' && location.state?.storeId) {
      const store = stores.find(s => s.id === location.state.storeId);
      if (store) {
        setSelectedStore(store);
        setView('store');
      }
    }
  }, [location.state]);

  // Handlers de Navegação
  const syncNow = async () => {
    setRefreshTick(t => t + 1);
  };

  const goToNetwork = () => {
    setView('network');
    setSelectedStore(null);
    setSelectedCamera(null);
  };

  const goToStore = (store: StoreType) => {
    setSelectedStore(store);
    setView('store');
    setSelectedCamera(null);
  };

  // Stats Dinâmicos
  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.round(s % 60);
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return h > 0
      ? `${String(h).padStart(2,'0')}:${String(mm).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
      : `${String(mm).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  };
  const getStats = () => {
    if (view === 'network') {
      return [
        { label: 'Total Visitantes', value: totalVisitors.toLocaleString(), icon: Users, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
        { label: 'Média Visitantes Dia', value: avgVisitorsPerDay.toLocaleString(), icon: BarChart2, color: 'text-blue-500', bg: 'bg-blue-500/10' },
        { label: 'Tempo Médio Visita', value: formatDuration(avgVisitSeconds), icon: Clock, color: 'text-orange-500', bg: 'bg-orange-500/10' },
        { label: 'Taxa Conversão', value: '0%', icon: Activity, color: 'text-purple-500', bg: 'bg-purple-500/10' },
      ];
    } else if (view === 'store' && selectedStore) {
      return [
        { label: 'TOTAL VISITANTES', value: totalVisitors.toLocaleString(), icon: Users, color: 'text-white', bg: 'bg-blue-600' },
        { label: 'MÉDIA VISITANTES DIA', value: avgVisitorsPerDay.toLocaleString(), icon: BarChart2, color: 'text-white', bg: 'bg-blue-600' },
        { label: 'TEMPO MED VISITA', value: formatDuration(avgVisitSeconds), icon: Clock, color: 'text-white', bg: 'bg-blue-600' },
      ];

    } else if (view === 'camera' && selectedCamera) {
      return [
        { label: 'Status', value: selectedCamera.status === 'online' ? 'Gravando' : 'Sem Sinal', icon: Activity, color: selectedCamera.status === 'online' ? 'text-emerald-500' : 'text-red-500', bg: selectedCamera.status === 'online' ? 'bg-emerald-500/10' : 'bg-red-500/10' },
        { label: 'Resolução', value: selectedCamera.resolution.toUpperCase(), icon: Video, color: 'text-blue-500', bg: 'bg-blue-500/10' },
        { label: 'Tipo', value: selectedCamera.type.toUpperCase(), icon: Shield, color: 'text-purple-500', bg: 'bg-purple-500/10' },
        { label: 'Retenção', value: '30 Dias', icon: Clock, color: 'text-orange-500', bg: 'bg-orange-500/10' },
      ];
    }
    return [];
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header com Breadcrumbs */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <button onClick={() => navigate('/clientes')} className="hover:text-emerald-400 transition-colors">
            Clientes
          </button>
          <ChevronRight size={14} />
          <button onClick={goToNetwork} className={`hover:text-emerald-400 transition-colors ${view === 'network' ? 'text-white font-medium' : ''}`}>
            {clientName}
          </button>
          {view !== 'network' && selectedStore && (
            <>
              <ChevronRight size={14} />
              <button onClick={() => goToStore(selectedStore)} className={`hover:text-emerald-400 transition-colors ${view === 'store' ? 'text-white font-medium' : ''}`}>
                {selectedStore.name}
              </button>
            </>
          )}
          {view === 'camera' && selectedCamera && (
            <>
              <ChevronRight size={14} />
              <span className="text-white font-medium">
                {selectedCamera.name}
              </span>
            </>
          )}
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6">
            {/* Área da Logo */}
            <div className="h-24 min-w-[100px] flex items-center justify-center overflow-hidden group relative cursor-pointer">
              {clientLogo ? (
                <img src={clientLogo} alt="Logo Cliente" className="h-full w-auto object-contain" />
              ) : (
                <div className="flex flex-col items-center justify-center text-gray-700 group-hover:text-gray-500 transition-colors w-20 h-20 bg-gray-900 border border-gray-800 rounded-xl">
                  <Image size={24} />
                  <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-xl">
                    <Upload size={16} className="text-white mb-1" />
                    <span className="text-[8px] text-white font-medium uppercase tracking-wider">Add Logo</span>
                  </div>
                </div>
              )}
            </div>

            <div>
              <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                {view === 'network' ? <Globe className="text-emerald-500" /> : 
                 view === 'store' ? <Building2 className="text-blue-500" /> : 
                 <Video className="text-purple-500" />}
                {view === 'network' ? 'Dashboard Geral' : 
                 view === 'store' ? selectedStore?.name : 
                 selectedCamera?.name}
              </h1>
              <p className="text-gray-400 mt-1">
                {view === 'network' ? `Monitorando ${stores.length} lojas nesta rede` : 
                 view === 'store' ? `${selectedStore?.address} - ${selectedStore?.city}` : 
                 'Feed ao vivo e histórico de eventos'}
              </p>
            </div>
          </div>

          {/* Filters Section */}
          <div className="flex items-center gap-3">
             {/* Store Filter */}
             <div className="relative">
               <select 
                  className="bg-gray-900 border border-gray-800 text-white pl-10 pr-8 py-2 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 appearance-none cursor-pointer text-sm min-w-[180px]"
                  onChange={(e) => {
                     const storeId = e.target.value;
                     if (storeId === 'all') {
                       goToNetwork();
                     } else {
                       const store = stores.find(s => s.id === storeId);
                       if (store) goToStore(store);
                     }
                  }}
                  value={view === 'network' ? 'all' : selectedStore?.id || 'all'}
               >
                  <option value="all">Todas as Lojas</option>
                  {stores.map(store => (
                    <option key={store.id} value={store.id}>{store.name}</option>
                  ))}
               </select>
               <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" size={16} />
               <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" size={14} />
             </div>

             {/* Date Filter */}
             <div className="relative">
               <button onClick={() => setShowDatePicker(!showDatePicker)} className="flex items-center gap-2 bg-gray-900 border border-gray-800 text-white px-4 py-2 rounded-lg hover:border-gray-700 transition-colors">
                 <Calendar size={16} className="text-gray-500" />
                 <span className="text-sm">Período: {new Date(selectedStartDate).toLocaleDateString('pt-BR')} → {new Date(selectedEndDate).toLocaleDateString('pt-BR')}</span>
                 <ChevronDown size={14} className="text-gray-500" />
               </button>
               {showDatePicker && (
                <div className="absolute z-10 mt-2 p-3 bg-gray-900 border border-gray-800 rounded-lg shadow-xl">
                  <div className="flex items-end gap-3">
                    <div>
                      <label className="block text-xs text-gray-400">Início</label>
                
                
                
                
                      <input
                        type="date"
                        value={new Date(selectedStartDate).toISOString().slice(0,10)}
                        onChange={(e) => {
                          const d = new Date(e.target.value + 'T00:00:00');
                          if (!isNaN(d.getTime())) setSelectedStartDate(d);
                        }}
                        className="bg-gray-800 text-white px-3 py-2 rounded-md border border-gray-700"
                      />
                    </div>
                    <span className="text-gray-500">→</span>
                    <div>
                      <label className="block text-xs text-gray-400">Fim</label>
                      <input
                        type="date"
                        value={new Date(selectedEndDate).toISOString().slice(0,10)}
                        onChange={(e) => {
                          const d = new Date(e.target.value + 'T00:00:00');
                          if (!isNaN(d.getTime())) setSelectedEndDate(d);
                        }}
                        className="bg-gray-800 text-white px-3 py-2 rounded-md border border-gray-700"
                      />
                    </div>
                    <button onClick={() => setShowDatePicker(false)} className="px-3 py-2 bg-emerald-600 text-white rounded-md">Aplicar</button>
                  </div>
                </div>
              )}
             </div>

             {lastUpdate && (
               <div className="text-xs text-gray-500 hidden md:block">
                 Última atualização: {lastUpdate.toLocaleString('pt-BR')}
               </div>
             )}

             {/* Config Button */}
             <button 
               onClick={() => navigate(`/clientes/${id}/dashboard-config`)}
               className="flex items-center gap-2 bg-gray-900 border border-gray-800 text-white px-4 py-2 rounded-lg hover:border-gray-700 transition-colors"
               title="Configurar Dashboard"
             >
               <Settings size={16} className="text-gray-500" />
               <span className="text-sm hidden md:inline">Configurar</span>
             </button>

             {/* Sync Button */}
             <button 
               onClick={syncNow}
               className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-500 transition-colors"
               title="Sincronizar Agora"
             >
               <Activity size={16} />
               <span className="text-sm hidden md:inline">Sincronizar</span>
             </button>
          </div>
        </div>
      </div>

      {/* Stats Cards - Simplified */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {getStats().map((stat, index) => (
          <div key={index} className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden group hover:border-gray-700 transition-all">
            <div className="bg-blue-600/20 p-2 text-center border-b border-blue-600/10">
               <p className="text-xs text-blue-400 font-bold uppercase tracking-wider">{stat.label}</p>
            </div>
            <div className="p-4 text-center">
               <p className="text-2xl font-bold text-white tracking-tight">{stat.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Content Area */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden min-h-[400px]">
        
        {/* NETWORK VIEW: General Dashboard Charts (Dynamic Layout) */}
        {view === 'network' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-6 p-6">
             {isLoadingConfig ? (
               <div className="col-span-full flex justify-center py-20">
                 <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" />
               </div>
             ) : activeWidgets.length > 0 ? (
               activeWidgets.map(widget => {
                  const Component = WIDGET_MAP[widget.id];
                  if (!Component) return null;

                  // Grid Span Logic
                  let colSpan = 'lg:col-span-6'; // half default
                  if (widget.size === 'full') colSpan = 'lg:col-span-12';
                  if (widget.size === 'third') colSpan = 'lg:col-span-4';
                  if (widget.size === 'quarter') colSpan = 'lg:col-span-3';
                  if (widget.size === '2/3') colSpan = 'lg:col-span-8';

                  const widgetProps: any = { view: 'network' };
                  if (widget.id === 'flow_trend') widgetProps.dailyData = dailyStats;
                  if (widget.id === 'hourly_flow') widgetProps.hourlyData = hourlyStats;
                  if (widget.id === 'age_pyramid') widgetProps.ageData = ageStats;
                  if (widget.id === 'gender_dist') {
                    widgetProps.genderData = genderStats;
                    widgetProps.totalVisitors = totalVisitors;
                  }
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
                 <button onClick={() => navigate(`/clientes/${id}/dashboard-config`)} className="text-emerald-500 hover:underline mt-2 text-sm">Configurar agora</button>
               </div>
             )}
          </div>
        )}

        {/* STORE VIEW: Analytics e Câmeras */}
        {view === 'store' && selectedStore && (
          <div className="space-y-6 bg-transparent border-none">
            
            {/* Linha 1: Tendências de Fluxo */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
               <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                 <h3 className="font-bold text-white mb-4 flex items-center gap-2 uppercase text-xs tracking-wider">
                   <Activity size={14} className="text-blue-500" />
                   Média Visitantes Dia - Dia da Semana
                 </h3>
                 <LineChart data={dailyStats} color="text-blue-500" height={100} />
                 <div className="flex justify-between text-[10px] text-gray-500 mt-2 uppercase">
                    <span>Seg</span><span>Ter</span><span>Qua</span><span>Qui</span><span>Sex</span><span>Sab</span><span>Dom</span>
                 </div>
               </div>

               <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                 <h3 className="font-bold text-white mb-4 flex items-center gap-2 uppercase text-xs tracking-wider">
                   <Clock size={14} className="text-emerald-500" />
                   Média Visitantes por Hora
                 </h3>
                 <LineChart data={hourlyStats} color="text-emerald-500" height={100} />
                 <div className="flex justify-between text-[10px] text-gray-500 mt-2">
                    <span>06h</span><span>09h</span><span>12h</span><span>15h</span><span>18h</span><span>21h</span>
                 </div>
               </div>
            </div>

            {/* Linha 2: Demografia e Atributos */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
               {/* Pirâmide Etária */}
               <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                 <h3 className="font-bold text-white mb-4 flex items-center gap-2 uppercase text-sm tracking-wider">
                   <Users size={16} className="text-purple-500" />
                   Pirâmide Etária
                 </h3>
                 <AgePyramid data={ageStats} />
               </div>

               {/* Gênero */}
               <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                 <h3 className="font-bold text-white mb-4 flex items-center gap-2 uppercase text-sm tracking-wider">
                   <Users size={16} className="text-pink-500" />
                   Gênero
                 </h3>
                 <DonutChart 
                    data={genderStats.length > 0 ? genderStats : [{ label: 'Masculino', value: 0 }, { label: 'Feminino', value: 0 }]} 
                    colors={['#1e40af', '#db2777']}
                 />
                 <div className="flex justify-center gap-4 mt-4 text-xs">
                    <span className="flex items-center gap-1 text-gray-400"><div className="w-2 h-2 bg-blue-800 rounded-full" /> Masculino ({totalVisitors > 0 ? Math.round((genderStats[0]?.value || 0) / totalVisitors * 100) : 0}%)</span>
                    <span className="flex items-center gap-1 text-gray-400"><div className="w-2 h-2 bg-pink-600 rounded-full" /> Feminino ({totalVisitors > 0 ? Math.round((genderStats[1]?.value || 0) / totalVisitors * 100) : 0}%)</span>
                 </div>
               </div>

               {/* Atributos Diversos (Ex: Cabelo/Barba) */}
               <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                 <h3 className="font-bold text-white mb-4 flex items-center gap-2 uppercase text-sm tracking-wider">
                   <Video size={16} className="text-orange-500" />
                   Atributos Identificados
                 </h3>
                 <div className="space-y-6">
                  <HorizontalBarChart 
                    data={attributeStats.map(a => ({ label: a.label, value: a.value }))} 
                    color="bg-emerald-500"
                  />
                </div>
               </div>
            </div>

            {/* Linha 3: Jornada e Engajamento */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
               <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 lg:col-span-1">
                 <h3 className="font-bold text-white mb-4 flex items-center gap-2 uppercase text-sm tracking-wider">
                   <MapPin size={16} className="text-blue-500" />
                   Jornada do Cliente (Entrada)
                 </h3>
                 <HorizontalBarChart 
                    data={[
                      { label: 'Entrada Princ.', value: 41.5 },
                      { label: 'Estacionamento', value: 19.5 },
                      { label: 'Totem 1', value: 11.9 },
                      { label: 'Totem 2', value: 6.1 },
                      { label: 'Gôndola A', value: 3.6 },
                    ]} 
                    color="bg-blue-600"
                 />
               </div>

               <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 lg:col-span-2">
                 <h3 className="font-bold text-white mb-4 flex items-center gap-2 uppercase text-sm tracking-wider">
                   <Activity size={16} className="text-emerald-500" />
                   Engajamento em Campanhas (Mídia Validada)
                 </h3>
                 <div className="overflow-x-auto">
                   <table className="w-full text-left text-xs text-gray-400">
                     <thead className="text-gray-500 uppercase border-b border-gray-800">
                       <tr>
                         <th className="pb-2 font-medium">Campanha</th>
                         <th className="pb-2 font-medium">Início</th>
                         <th className="pb-2 font-medium">Visitantes</th>
                         <th className="pb-2 font-medium">Tempo Médio</th>
                         <th className="pb-2 font-medium">Atenção</th>
                       </tr>
                     </thead>
                     <tbody className="divide-y divide-gray-800">
                       {[
                         { name: 'Promoção Verão', start: '06/01/2026', vis: 492, time: '18m', att: '15s' },
                         { name: 'Oferta Relâmpago', start: '01/01/2026', vis: 1205, time: '04m', att: '15s' },
                         { name: 'Lançamento X', start: '10/01/2026', vis: 591, time: '22m', att: '15s' },
                         { name: 'Queima de Estoque', start: '11/01/2026', vis: 538, time: '23m', att: '16s' },
                         { name: 'Fidelidade', start: '01/01/2026', vis: 604, time: '24m', att: '15s' },
                       ].map((row, i) => (
                         <tr key={i} className="group hover:bg-gray-800/50 transition-colors">
                           <td className="py-2 text-white font-medium">{row.name}</td>
                           <td className="py-2">{row.start}</td>
                           <td className="py-2 text-emerald-400">{row.vis}</td>
                           <td className="py-2">{row.time}</td>
                           <td className="py-2 text-orange-400">{row.att}</td>
                         </tr>
                       ))}
                     </tbody>
                   </table>
                 </div>
               </div>
            </div>

            {/* Câmeras Instaladas removidas */}
          </div>
        )}

        {/* CAMERA VIEW: Analytics Detalhado (Sem Vídeo) */}
        {view === 'camera' && selectedCamera && (
          <div className="space-y-6">
             <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                <div className="flex items-center gap-4 mb-6">
                  <div className={`p-3 rounded-xl ${selectedCamera.status === 'online' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}`}>
                    <Video size={32} />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white">{selectedCamera.name}</h2>
                    <p className="text-gray-400 text-sm flex items-center gap-2">
                       <span className={`w-2 h-2 rounded-full ${selectedCamera.status === 'online' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                       {selectedCamera.status === 'online' ? 'Operacional' : 'Offline'}
                       <span className="w-1 h-1 bg-gray-600 rounded-full" />
                       {selectedCamera.type.toUpperCase()}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                   <div className="bg-gray-950 border border-gray-800 rounded-lg p-4">
                      <h4 className="text-sm font-bold text-gray-400 mb-4 uppercase tracking-wider">Status do Dispositivo</h4>
                      <div className="space-y-3">
                         <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Resolução</span>
                            <span className="text-white">{selectedCamera.resolution.toUpperCase()}</span>
                         </div>
                         <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Taxa de Quadros</span>
                            <span className="text-white">30 FPS</span>
                         </div>
                         <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Bitrate</span>
                            <span className="text-white">4096 kbps</span>
                         </div>
                         <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Firmware</span>
                            <span className="text-white">v2.4.1</span>
                         </div>
                      </div>
                   </div>

                   <div className="bg-gray-950 border border-gray-800 rounded-lg p-4 md:col-span-2">
                      <h4 className="text-sm font-bold text-gray-400 mb-4 uppercase tracking-wider">Eventos Recentes</h4>
                      <div className="space-y-2">
                         {[1, 2, 3].map((_, i) => (
                           <div key={i} className="flex items-center justify-between p-3 bg-gray-900 rounded border border-gray-800/50">
                              <div className="flex items-center gap-3">
                                 <AlertCircle size={16} className="text-orange-500" />
                                 <span className="text-sm text-gray-300">Movimento detectado na zona de interesse</span>
                              </div>
                              <span className="text-xs text-gray-500">Há {i * 15 + 2} min</span>
                           </div>
                         ))}
                      </div>
                   </div>
                </div>
             </div>
          </div>
        )}

      </div>
    </div>
  );
}