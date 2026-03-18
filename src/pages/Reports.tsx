import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Building2, Globe, ArrowRight, Table, Smartphone, LayoutGrid } from 'lucide-react';
import { exportToExcel, exportToPDF, exportElementToPDF } from '../services/exportService';
import supabase from '../lib/supabase';

export function Reports() {
  const [scope, setScope] = useState<'global' | 'network' | 'store'>('global');
  const [selectedClient, setSelectedClient] = useState('');
  const [selectedStore, setSelectedStore] = useState('');
  const [reportType, setReportType] = useState<'general' | 'analytics' | 'clients' | 'stores' | 'devices'>('general');

  const [periodStart, setPeriodStart] = useState(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [periodEnd, setPeriodEnd] = useState(() => new Date().toISOString().slice(0, 10));

  const [analyticsSummary, setAnalyticsSummary] = useState<null | { totalVisitors: number; avgVisitorsPerDay: number; avgVisitSeconds: number; avgAttentionSeconds: number }>(null);
  const [analyticsPerDay, setAnalyticsPerDay] = useState<any[]>([]);
  const [analyticsPerHour, setAnalyticsPerHour] = useState<any[]>([]);

  const reportVisualRef = useRef<HTMLDivElement>(null);
  const [isExportingVisual, setIsExportingVisual] = useState(false);

  const [clients, setClients] = useState<{ id: string; name: string; status?: string | null }[]>([]);
  const [stores, setStores] = useState<{ id: string; name: string; address?: string | null; city?: string | null; status?: string | null; client_id?: string | null }[]>([]);

  const [clientsData, setClientsData] = useState<any[]>([]);
  const [storesData, setStoresData] = useState<any[]>([]);
  const [devicesData, setDevicesData] = useState<any[]>([]);

  const [stats, setStats] = useState<StatItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  interface StatItem {
    label: string;
    value: string;
    change: string;
    bg: string;
    color: string;
  }

  const storeById = useMemo(() => {
    const m = new Map<string, { id: string; name: string; city?: string | null; client_id?: string | null }>();
    stores.forEach((s) => m.set(s.id, s));
    return m;
  }, [stores]);

  useEffect(() => {
    let cancelled = false;

    const loadClients = async () => {
      try {
        const { data, error } = await supabase.from('clients').select('id, name, status').order('name');
        if (error) throw error;
        if (!cancelled) setClients(data || []);
      } catch (e: any) {
        if (!cancelled) setErrorMsg(e?.message || 'Erro ao carregar clientes');
      }
    };

    void loadClients();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (scope !== 'network') setSelectedClient('');
    if (scope !== 'store') setSelectedStore('');
    setErrorMsg(null);
  }, [scope]);

  useEffect(() => {
    let cancelled = false;

    const loadStoresForSelectors = async () => {
      try {
        if (scope === 'store' || (scope === 'network' && selectedClient)) {
          let q = supabase.from('stores').select('id, name, address, city, status, client_id').order('name').range(0, 9999);
          if (scope === 'network' && selectedClient) q = q.eq('client_id', selectedClient);
          const { data, error } = await q;
          if (error) throw error;
          if (!cancelled) setStores(data || []);
        } else {
          if (!cancelled) setStores([]);
        }
      } catch (e: any) {
        if (!cancelled) setErrorMsg(e?.message || 'Erro ao carregar lojas');
      }
    };

    void loadStoresForSelectors();
    return () => { cancelled = true; };
  }, [scope, selectedClient]);

  useEffect(() => {
    let cancelled = false;

    const loadReportData = async () => {
      setIsLoading(true);
      setErrorMsg(null);

      try {
        const now = new Date();
        const from30d = new Date(now.getTime() - 30 * 86400000).toISOString();
        const toIso = now.toISOString();

        const selectedStoreObj = selectedStore ? storeById.get(selectedStore) : undefined;
        const clientIdFromStore = selectedStoreObj?.client_id || null;

        const clientId = scope === 'network' ? (selectedClient || null) : scope === 'store' ? clientIdFromStore : null;
        const storeId = scope === 'store' ? (selectedStore || null) : null;

        const countExact = async (q: any) => {
          const { count, error } = await q;
          if (error) throw error;
          return Number(count) || 0;
        };

        const [clientsCount, storesCount] = await Promise.all([
          (async () => {
            let q: any = supabase.from('clients').select('*', { count: 'exact', head: true });
            if (clientId) q = q.eq('id', clientId);
            return await countExact(q);
          })(),
          (async () => {
            let q: any = supabase.from('stores').select('*', { count: 'exact', head: true });
            if (storeId) q = q.eq('id', storeId);
            else if (clientId) q = q.eq('client_id', clientId);
            return await countExact(q);
          })(),
        ]);

        let devicesCount = 0;
        if (storeId) {
          devicesCount = await countExact(supabase.from('devices').select('*', { count: 'exact', head: true }).eq('store_id', storeId));
        } else if (clientId) {
          const { data: storeIds, error: storeErr } = await supabase.from('stores').select('id').eq('client_id', clientId).range(0, 9999);
          if (storeErr) throw storeErr;
          const ids = (storeIds || []).map((s: any) => s.id);
          devicesCount = ids.length
            ? await countExact(supabase.from('devices').select('*', { count: 'exact', head: true }).in('store_id', ids))
            : 0;
        } else {
          devicesCount = await countExact(supabase.from('devices').select('*', { count: 'exact', head: true }));
        }

        let visitorsCount30d: number | null = null;
        try {
          let q: any = supabase.from('visitor_analytics').select('*', { count: 'exact', head: true });
          if (storeId) q = q.eq('store_id', storeId);
          else if (clientId) q = q.eq('client_id', clientId);
          q = q.gte('timestamp', from30d).lte('timestamp', toIso);
          visitorsCount30d = await countExact(q);
        } catch {
          visitorsCount30d = null;
        }

        if (!cancelled) {
          setStats([
            { label: 'Clientes', value: String(clientsCount), change: '-', bg: 'bg-indigo-500/10', color: 'text-indigo-400' },
            { label: 'Lojas', value: String(storesCount), change: '-', bg: 'bg-emerald-500/10', color: 'text-emerald-400' },
            { label: 'Dispositivos', value: String(devicesCount), change: '-', bg: 'bg-blue-500/10', color: 'text-blue-400' },
          ].concat(visitorsCount30d == null ? [] : [{ label: 'Visitantes (30d)', value: String(visitorsCount30d), change: '-', bg: 'bg-amber-500/10', color: 'text-amber-400' }]));
        }

        if (reportType === 'analytics') {
          const effectiveClientId = clientId || clientIdFromStore;
          if (!effectiveClientId) throw new Error('Selecione uma rede ou loja para gerar o relatório de Analytics.');

          const startIso = `${periodStart}T00:00:00.000Z`;
          const endIso = `${periodEnd}T23:59:59.999Z`;

          const payload: any = { client_id: effectiveClientId, start: startIso, end: endIso, rebuild_rollup: true };

          if (storeId) {
            const { data: devs, error: devErr } = await supabase.from('devices').select('id').eq('store_id', storeId).range(0, 9999);
            if (devErr) throw devErr;
            payload.devices = (devs || []).map((d: any) => d.id);
            if (!payload.devices.length) throw new Error('Loja sem dispositivos para calcular Analytics.');
          }

          const resp = await fetch('/api/sync-analytics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
          const json = resp.ok ? await resp.json() : null;
          const dash = json?.dashboard;
          if (!dash) throw new Error('Sem dados de Analytics para o período selecionado.');

          if (!cancelled) {
            setAnalyticsSummary({
              totalVisitors: Number(dash.total_visitors) || 0,
              avgVisitorsPerDay: Number(dash.avg_visitors_per_day) || 0,
              avgVisitSeconds: Number(dash.avg_times_seconds?.avg_visit_time_seconds ?? dash.avg_visit_time_seconds ?? 0) || 0,
              avgAttentionSeconds: Number(dash.avg_times_seconds?.avg_attention_seconds ?? dash.avg_attention_seconds ?? 0) || 0,
            });

            const vpd = dash.visitors_per_day || {};
            setAnalyticsPerDay(
              Object.entries(vpd)
                .map(([date, visitors]) => ({ Data: String(date).slice(0, 10), Visitantes: Number(visitors) || 0 }))
                .sort((a: any, b: any) => String(a.Data).localeCompare(String(b.Data)))
            );

            const vph = dash.visitors_per_hour_avg || {};
            setAnalyticsPerHour(
              Array.from({ length: 24 }, (_, h) => ({
                Hora: `${String(h).padStart(2, '0')}:00`,
                Média: Number((vph as any)[String(h)] ?? (vph as any)[h] ?? 0) || 0,
              }))
            );
          }
        } else {
          if (!cancelled) {
            setAnalyticsSummary(null);
            setAnalyticsPerDay([]);
            setAnalyticsPerHour([]);
          }
        }

        if (reportType === 'clients') {
          let q = supabase.from('clients').select('id, name, status').order('name');
          if (clientId) q = q.eq('id', clientId);
          const { data, error } = await q;
          if (error) throw error;
          if (!cancelled) {
            setClientsData((data || []).map((c: any) => ({ ID: c.id, Nome: c.name, Status: c.status || '' })));
          }
        }

        if (reportType === 'stores') {
          let q = supabase.from('stores').select('id, name, address, city, status, client_id').order('name').range(0, 9999);
          if (storeId) q = q.eq('id', storeId);
          else if (clientId) q = q.eq('client_id', clientId);
          const { data, error } = await q;
          if (error) throw error;
          if (!cancelled) {
            setStoresData((data || []).map((s: any) => ({ ID: s.id, Nome: s.name, Endereço: s.address || '', Cidade: s.city || '', Status: s.status || '' })));
          }
        }

        if (reportType === 'devices') {
          let devices: any[] = [];
          if (storeId) {
            const { data, error } = await supabase.from('devices').select('id, name, type, status, store_id').eq('store_id', storeId).range(0, 9999);
            if (error) throw error;
            devices = data || [];
          } else if (clientId) {
            const { data: storeIds, error: storeErr } = await supabase.from('stores').select('id').eq('client_id', clientId).range(0, 9999);
            if (storeErr) throw storeErr;
            const ids = (storeIds || []).map((s: any) => s.id);
            if (ids.length) {
              const { data, error } = await supabase.from('devices').select('id, name, type, status, store_id').in('store_id', ids).range(0, 9999);
              if (error) throw error;
              devices = data || [];
            }
          } else {
            const { data, error } = await supabase.from('devices').select('id, name, type, status, store_id').range(0, 9999);
            if (error) throw error;
            devices = data || [];
          }

          if (!cancelled) {
            setDevicesData(devices.map((d: any) => ({ ID: d.id, Nome: d.name, Tipo: d.type || '', Status: d.status || '', Loja: storeById.get(d.store_id)?.name || d.store_id || '' })));
          }
        }

        if (reportType !== 'clients') setClientsData([]);
        if (reportType !== 'stores') setStoresData([]);
        if (reportType !== 'devices') setDevicesData([]);

      } catch (e: any) {
        if (!cancelled) setErrorMsg(e?.message || 'Erro ao carregar relatório');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void loadReportData();
    return () => { cancelled = true; };
  }, [scope, selectedClient, selectedStore, reportType, storeById, periodStart, periodEnd]);

  const handleExport = (format: 'excel' | 'pdf') => {
    let data: any[] = [];
    let fileName = `relatorio_${reportType}_${new Date().toISOString().split('T')[0]}`;
    let title = '';
    let columns: string[] = [];

    switch (reportType) {
      case 'general':
        data = stats.map(s => ({ Label: s.label, Valor: s.value, Mudanca: s.change }));
        title = 'Relatório Geral (Dashboard)';
        columns = ['Label', 'Valor', 'Mudanca'];
        break;
      case 'analytics':
        data = analyticsPerDay;
        title = 'Analytics (Visitantes por Dia)';
        columns = ['Data', 'Visitantes'];
        break;
      case 'clients':
        data = clientsData;
        title = 'Lista de Clientes';
        columns = ['ID', 'Nome', 'Plano', 'Status'];
        break;
      case 'stores':
        data = storesData;
        title = 'Lista de Lojas';
        columns = ['ID', 'Nome', 'Endereço', 'Cidade', 'Status'];
        break;
      case 'devices':
        data = devicesData;
        title = 'Lista de Dispositivos';
        columns = ['ID', 'Nome', 'Tipo', 'Status', 'Loja'];
        break;
    }

    if (!data || data.length === 0) {
      window.alert('Nenhum dado disponível para exportação com os filtros atuais.');
      return;
    }

    if (format === 'excel') {
      exportToExcel(data, fileName);
    } else {
      exportToPDF(title, columns, data, fileName);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <FileText className="text-emerald-500" /> Relatórios
          </h1>
          <p className="text-gray-400">Extraia dados da Rede ou de Lojas específicas</p>
        </div>
      </div>

      {/* Scope Selector */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">Configuração da Fonte de Dados</h2>
        <div className="flex flex-col md:flex-row gap-6 items-start md:items-center">
          
          {/* Radio Group for Scope */}
          <div className="flex bg-gray-950 p-1 rounded-lg border border-gray-800 overflow-x-auto">
            <button
              onClick={() => setScope('global')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 whitespace-nowrap ${
                scope === 'global' 
                  ? 'bg-gray-800 text-white shadow-sm' 
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <Globe size={16} />
              Rede (Global)
            </button>
            <button
              onClick={() => setScope('network')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 whitespace-nowrap ${
                scope === 'network' 
                  ? 'bg-gray-800 text-white shadow-sm' 
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <LayoutGrid size={16} />
              Rede Específica
            </button>
            <button
              onClick={() => setScope('store')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 whitespace-nowrap ${
                scope === 'store' 
                  ? 'bg-gray-800 text-white shadow-sm' 
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <Building2 size={16} />
              Loja Específica
            </button>
          </div>

          {/* Client Selector (only visible if scope is network) */}
          {scope === 'network' && (
            <div className="flex items-center gap-2 animate-in fade-in slide-in-from-left-4 duration-300">
              <ArrowRight size={16} className="text-gray-600" />
              <select 
                value={selectedClient}
                onChange={(e) => setSelectedClient(e.target.value)}
                className="bg-gray-950 border border-gray-800 text-white rounded-lg px-4 py-2 outline-none focus:border-indigo-500 min-w-[200px]"
              >
                <option value="" disabled style={{ backgroundColor: '#111827', color: '#9CA3AF' }}>Selecione uma rede...</option>
                {clients.map(client => (
                  <option key={client.id} value={client.id} style={{ backgroundColor: '#111827', color: 'white' }}>{client.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Store Selector (only visible if scope is store) */}
          {scope === 'store' && (
            <div className="flex items-center gap-2 animate-in fade-in slide-in-from-left-4 duration-300">
              <ArrowRight size={16} className="text-gray-600" />
              <select 
                value={selectedStore}
                onChange={(e) => setSelectedStore(e.target.value)}
                className="bg-gray-950 border border-gray-800 text-white rounded-lg px-4 py-2 outline-none focus:border-indigo-500 min-w-[200px]"
              >
                <option value="" disabled style={{ backgroundColor: '#111827', color: '#9CA3AF' }}>Selecione uma loja...</option>
                {stores.map(store => (
                  <option key={store.id} value={store.id} style={{ backgroundColor: '#111827', color: 'white' }}>{store.name}{store.city ? ` - ${store.city}` : ''}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Report Type Selector */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">Tipo de Relatório</h2>
        <div className="flex flex-wrap gap-2">
          {[
            { id: 'general', label: 'Dashboard Geral', icon: FileText },
            { id: 'analytics', label: 'Analytics (Totais & Médias)', icon: LayoutGrid },
            { id: 'clients', label: 'Lista de Clientes', icon: Globe },
            { id: 'stores', label: 'Lista de Lojas', icon: Building2 },
            { id: 'devices', label: 'Lista de Dispositivos', icon: Smartphone },
          ].map((type) => (
            <button
              key={type.id}
              onClick={() => setReportType(type.id as any)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
                reportType === type.id
                  ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-900/20'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
              }`}
            >
              <type.icon size={16} />
              {type.label}
            </button>
          ))}
        </div>
      </div>

      {/* Export Actions */}
      <div className="flex flex-wrap justify-end gap-3">
        <button
          onClick={() => handleExport('excel')}
          className="bg-green-700 hover:bg-green-600 text-white font-medium px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
        >
          <Table size={18} />
          Exportar Excel
        </button>
        <button
          onClick={() => handleExport('pdf')}
          className="bg-red-700 hover:bg-red-600 text-white font-medium px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
        >
          <FileText size={18} />
          Exportar PDF
        </button>
        <button
          disabled={isExportingVisual || isLoading}
          onClick={async () => {
            const el = reportVisualRef.current;
            if (!el) return;
            setIsExportingVisual(true);
            try {
              const fileName = `dashboard_visual_${reportType}_${new Date().toISOString().split('T')[0]}`;
              await exportElementToPDF(el, fileName);
            } finally {
              setIsExportingVisual(false);
            }
          }}
          className="bg-indigo-700 hover:bg-indigo-600 disabled:opacity-60 text-white font-medium px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
        >
          <LayoutGrid size={18} />
          PDF (Visual)
        </button>
      </div>

      {reportType === 'analytics' && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">Período (Analytics)</h2>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-12">Início</span>
              <input
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                className="bg-gray-950 border border-gray-800 text-white rounded-lg px-3 py-2 outline-none focus:border-indigo-500"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-12">Fim</span>
              <input
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                className="bg-gray-950 border border-gray-800 text-white rounded-lg px-3 py-2 outline-none focus:border-indigo-500"
              />
            </div>
          </div>
        </div>
      )}

      <div ref={reportVisualRef} className="space-y-6">
        {/* Data Preview / Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {isLoading ? (
            <div className="col-span-3 flex justify-center py-20">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" />
            </div>
          ) : errorMsg ? (
            <div className="col-span-3 text-center p-8 text-red-400 border border-red-900/40 rounded-xl bg-red-900/10">
              {errorMsg}
            </div>
          ) : reportType === 'analytics' ? (
            analyticsSummary ? (
              [
                { label: 'Total Visitantes', value: analyticsSummary.totalVisitors.toLocaleString('pt-BR'), change: '-', bg: 'bg-emerald-500/10', color: 'text-emerald-400' },
                { label: 'Média Visitantes/Dia', value: analyticsSummary.avgVisitorsPerDay.toLocaleString('pt-BR'), change: '-', bg: 'bg-indigo-500/10', color: 'text-indigo-400' },
                { label: 'Tempo Médio Visita (s)', value: String(Math.round(analyticsSummary.avgVisitSeconds)), change: '-', bg: 'bg-blue-500/10', color: 'text-blue-400' },
              ].map((stat: any, index: number) => (
                <div key={index} className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className={`w-10 h-10 rounded-lg ${stat.bg} flex items-center justify-center ${stat.color}`}>
                      <FileText size={20} />
                    </div>
                    <span className={`text-xs font-medium ${stat.color} ${stat.bg} px-2 py-1 rounded`}>{stat.change}</span>
                  </div>
                  <h3 className="text-2xl font-bold text-white mb-1">{stat.value}</h3>
                  <p className="text-gray-400 text-sm">{stat.label}</p>
                </div>
              ))
            ) : (
              <div className="col-span-3 text-center p-8 text-gray-500 border border-gray-800 rounded-xl border-dashed">
                Nenhum dado de analytics disponível.
              </div>
            )
          ) : stats.length === 0 ? (
            <div className="col-span-3 text-center p-8 text-gray-500 border border-gray-800 rounded-xl border-dashed">
              Nenhum dado estatístico disponível.
            </div>
          ) : (
            stats.map((stat, index) => (
              <div key={index} className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className={`w-10 h-10 rounded-lg ${stat.bg} flex items-center justify-center ${stat.color}`}>
                    <FileText size={20} />
                  </div>
                  <span className={`text-xs font-medium ${stat.color} ${stat.bg} px-2 py-1 rounded`}>{stat.change}</span>
                </div>
                <h3 className="text-2xl font-bold text-white mb-1">{stat.value}</h3>
                <p className="text-gray-400 text-sm">{stat.label}</p>
              </div>
            ))
          )}
        </div>

        {reportType === 'analytics' && analyticsSummary && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">Visitantes por Dia</h3>
              <div className="max-h-[420px] overflow-auto border border-gray-800 rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-gray-950 text-gray-400">
                    <tr>
                      <th className="text-left px-4 py-2">Data</th>
                      <th className="text-right px-4 py-2">Visitantes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analyticsPerDay.map((r: any, i: number) => (
                      <tr key={i} className="border-t border-gray-800">
                        <td className="px-4 py-2 text-gray-200">{r.Data}</td>
                        <td className="px-4 py-2 text-right text-white font-medium">{Number(r.Visitantes).toLocaleString('pt-BR')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">Média de Visitantes por Hora</h3>
              <div className="max-h-[420px] overflow-auto border border-gray-800 rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-gray-950 text-gray-400">
                    <tr>
                      <th className="text-left px-4 py-2">Hora</th>
                      <th className="text-right px-4 py-2">Média</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analyticsPerHour.map((r: any, i: number) => (
                      <tr key={i} className="border-t border-gray-800">
                        <td className="px-4 py-2 text-gray-200">{r.Hora}</td>
                        <td className="px-4 py-2 text-right text-white font-medium">{Number(r.Média).toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}