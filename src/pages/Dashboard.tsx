import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Users, Globe, ArrowUp, ArrowDown, ShieldCheck, BarChart2, Wifi, WifiOff, Monitor } from 'lucide-react';
import supabase from '../lib/supabase';

type DeviceStat = {
  clientId: string;
  clientName: string;
  online: number;
  offline: number;
  total: number;
  pctOnline: number;
};

export function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState([
    { label: 'Total de Clientes',     value: '0',   trend: '0',       trendUp: true,  icon: Users,       color: 'text-blue-400',    bg: 'bg-blue-500/10' },
    { label: 'APIs Conectadas',        value: '0',   trend: '0%',      trendUp: true,  icon: Globe,       color: 'text-purple-400',  bg: 'bg-purple-500/10' },
    { label: 'Usuários Cadastrados',   value: '0',   trend: '0',       trendUp: true,  icon: ShieldCheck, color: 'text-indigo-400',  bg: 'bg-indigo-500/10' },
    { label: 'Maior Média Visitantes', value: 'N/A', trend: 'Em breve',trendUp: true,  icon: BarChart2,   color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  ]);
  const [deviceStats, setDeviceStats] = useState<DeviceStat[]>([]);
  const [recentClients, setRecentClients] = useState<any[]>([]);

  useEffect(() => {
    if (user?.role === 'client' && user.clientId) {
      navigate(`/clientes/${user.clientId}/dashboard`);
      return;
    }

    const fetchData = async () => {
      try {
        // 1. Clientes
        const { data: clientsData, count: clientsCount } = await supabase
          .from('clients')
          .select('id, name, created_at, entry_date, logo_url, company', { count: 'exact' })
          .order('created_at', { ascending: false });

        // 2. Usuários
        const { count: usersCount } = await supabase
          .from('users')
          .select('id', { count: 'exact', head: true });

        // 3. APIs conectadas
        const { count: apisCount } = await supabase
          .from('client_api_configs')
          .select('client_id', { count: 'exact', head: true })
          .not('api_key', 'is', null)
          .neq('api_key', '');

        // 4. Maior Média de Visitantes do mês atual
        const now = new Date();
        const mesInicioISO = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const mesFimISO    = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();

        const { data: campaignRows } = await supabase
          .from('campaigns')
          .select('client_id, visitors')
          .gte('uploaded_at', mesInicioISO)
          .lte('uploaded_at', mesFimISO)
          .not('visitors', 'is', null);

        let maiorClienteNome  = '-';
        let maiorClienteTrend = '-';

        if (campaignRows && campaignRows.length > 0) {
          const totais: Record<string, number> = {};
          for (const row of campaignRows) {
            if (row.client_id)
              totais[row.client_id] = (totais[row.client_id] || 0) + (row.visitors || 0);
          }
          const maiorId = Object.entries(totais).sort((a, b) => b[1] - a[1])[0]?.[0];
          if (maiorId) {
            const total  = totais[maiorId];
            const client = clientsData?.find(c => c.id === maiorId);
            if (client) {
              maiorClienteNome  = client.name;
              maiorClienteTrend = total.toLocaleString('pt-BR') + ' visit.';
            }
          }
        }

        // 5. Dispositivos por cliente (via stores → devices)
        const { data: storesData } = await supabase
          .from('stores')
          .select('id, client_id');

        const { data: devicesData } = await supabase
          .from('devices')
          .select('id, status, store_id');

        if (clientsData && storesData && devicesData) {
          // Mapa store_id → client_id
          const storeToClient: Record<string, string> = {};
          for (const s of storesData) {
            if (s.id && s.client_id) storeToClient[s.id] = s.client_id;
          }

          // Conta online/offline por client_id
          const counts: Record<string, { online: number; offline: number }> = {};
          for (const d of devicesData) {
            const cid = storeToClient[d.store_id];
            if (!cid) continue;
            if (!counts[cid]) counts[cid] = { online: 0, offline: 0 };
            if (d.status === 'online') counts[cid].online++;
            else counts[cid].offline++;
          }

          const built: DeviceStat[] = clientsData.map(c => {
            const cnt = counts[c.id] || { online: 0, offline: 0 };
            const total = cnt.online + cnt.offline;
            return {
              clientId:   c.id,
              clientName: c.name,
              online:     cnt.online,
              offline:    cnt.offline,
              total,
              pctOnline:  total > 0 ? Math.round((cnt.online / total) * 100) : 0,
            };
          }).sort((a, b) => b.total - a.total);

          setDeviceStats(built);
        }

        if (clientsData) setRecentClients(clientsData.slice(0, 5));

        setStats([
          { label: 'Total de Clientes',     value: clientsCount?.toString() || '0', trend: '+12%',           trendUp: true, icon: Users,       color: 'text-blue-400',    bg: 'bg-blue-500/10' },
          { label: 'APIs Conectadas',        value: apisCount?.toString()    || '0', trend: '100%',           trendUp: true, icon: Globe,       color: 'text-purple-400',  bg: 'bg-purple-500/10' },
          { label: 'Usuários Cadastrados',   value: usersCount?.toString()   || '0', trend: '+5%',            trendUp: true, icon: ShieldCheck, color: 'text-indigo-400',  bg: 'bg-indigo-500/10' },
          { label: 'Maior Média Visitantes', value: maiorClienteNome,                trend: maiorClienteTrend, trendUp: true, icon: BarChart2,   color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
        ]);

      } catch (error) {
        console.error('Error fetching dashboard data:', error);
      }
    };

    fetchData();
  }, [user, navigate]);

  const totalOnline  = deviceStats.reduce((s, d) => s + d.online,  0);
  const totalOffline = deviceStats.reduce((s, d) => s + d.offline, 0);
  const totalDevices = totalOnline + totalOffline;
  const maxTotal     = Math.max(...deviceStats.map(d => d.total), 1);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard de Operações</h1>
          <p className="text-gray-400 text-sm">Monitoramento em tempo real da infraestrutura</p>
        </div>
        <div className="flex items-center gap-2 bg-gray-900 border border-gray-800 rounded-lg px-3 py-1.5">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
          <span className="text-xs text-emerald-400 font-medium">Sistema Online</span>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, index) => (
          <div key={index} className="bg-gray-900/50 border border-gray-800 p-6 rounded-xl hover:bg-gray-900 transition-colors group">
            <div className="flex items-center justify-between mb-4">
              <div className={`p-3 rounded-lg ${stat.bg} group-hover:scale-110 transition-transform`}>
                <stat.icon className={stat.color} size={24} />
              </div>
              <div className={`flex items-center gap-1 text-xs font-medium ${stat.trendUp ? 'text-emerald-400' : 'text-red-400'}`}>
                {stat.trendUp ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
                {stat.trend}
              </div>
            </div>
            <div>
              <p className={`font-bold text-white mb-1 leading-tight ${stat.value.length > 8 ? 'text-xl' : 'text-3xl'}`}>
                {stat.value}
              </p>
              <p className="text-sm text-gray-500 font-medium">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ── Dispositivos por Cliente ─────────────────────────── */}
        <div className="lg:col-span-2 bg-gray-900 border border-gray-800 rounded-xl p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-bold text-white flex items-center gap-2">
              <Monitor size={18} className="text-emerald-500" />
              Dispositivos por Cliente
            </h3>
            {/* Totalizadores */}
            <div className="flex items-center gap-4 text-xs">
              <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
                <Wifi size={13} />
                {totalOnline} online
              </span>
              <span className="flex items-center gap-1.5 text-red-400 font-medium">
                <WifiOff size={13} />
                {totalOffline} offline
              </span>
              <span className="text-gray-500">{totalDevices} total</span>
            </div>
          </div>

          {deviceStats.length === 0 ? (
            <div className="h-56 flex items-center justify-center">
              <p className="text-gray-600 text-sm">Nenhum dispositivo cadastrado</p>
            </div>
          ) : (
            <div className="space-y-4">
              {deviceStats.map((d) => (
                <div key={d.clientId} className="group">
                  {/* Cabeçalho da linha */}
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center">
                        <span className="text-[10px] font-bold text-gray-400">
                          {d.clientName.substring(0, 2).toUpperCase()}
                        </span>
                      </div>
                      <span className="text-sm font-medium text-white">{d.clientName}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="flex items-center gap-1 text-emerald-400">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>
                        {d.online}
                      </span>
                      <span className="flex items-center gap-1 text-red-400">
                        <span className="w-2 h-2 rounded-full bg-red-500 inline-block"></span>
                        {d.offline}
                      </span>
                      <span className="text-gray-500 w-16 text-right">{d.pctOnline}% online</span>
                    </div>
                  </div>

                  {/* Barra empilhada online + offline */}
                  <div className="relative h-7 w-full bg-gray-800 rounded-lg overflow-hidden">
                    {/* Barra proporcional ao máximo entre todos os clientes */}
                    <div
                      className="absolute left-0 top-0 h-full flex rounded-lg overflow-hidden transition-all duration-500"
                      style={{ width: `${(d.total / maxTotal) * 100}%` }}
                    >
                      {/* Segmento online */}
                      {d.online > 0 && (
                        <div
                          className="h-full bg-emerald-500 group-hover:bg-emerald-400 transition-colors"
                          style={{ width: d.total > 0 ? `${(d.online / d.total) * 100}%` : '0%' }}
                        />
                      )}
                      {/* Segmento offline */}
                      {d.offline > 0 && (
                        <div
                          className="h-full bg-red-500/70 group-hover:bg-red-400/80 transition-colors"
                          style={{ width: d.total > 0 ? `${(d.offline / d.total) * 100}%` : '0%' }}
                        />
                      )}
                    </div>
                    {/* Rótulo total dentro da barra */}
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-gray-400">
                      {d.total} disp.
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Últimos Clientes ──────────────────────────────────── */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 flex flex-col">
          <h3 className="font-bold text-white mb-6 flex items-center gap-2">
            <Users size={18} className="text-blue-500" />
            Últimos Clientes
          </h3>

          <div className="space-y-4 overflow-y-auto max-h-[300px] pr-2 custom-scrollbar">
            {recentClients.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">Nenhum cliente recente.</p>
            ) : (
              recentClients.map((client) => (
                <div
                  key={client.id}
                  className="flex items-center gap-3 p-3 rounded-lg bg-gray-950/50 border border-gray-800/50 hover:bg-gray-900 transition-colors"
                >
                  <div className="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center overflow-hidden border border-gray-700">
                    {client.logo_url ? (
                      <img src={client.logo_url} alt={client.name} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-xs font-bold text-gray-400">
                        {client.name.substring(0, 2).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{client.name}</p>
                    <p className="text-xs text-gray-500 truncate">{client.company}</p>
                  </div>
                  <div className="text-xs text-gray-600 whitespace-nowrap">
                    {client.entry_date
                      ? new Date(client.entry_date).toLocaleDateString('pt-BR', { timeZone: 'UTC' })
                      : client.created_at
                        ? new Date(client.created_at).toLocaleDateString('pt-BR')
                        : '-'}
                  </div>
                </div>
              ))
            )}
          </div>

          <button
            onClick={() => navigate('/clientes')}
            className="mt-6 w-full py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-medium rounded-lg transition-colors border border-gray-700"
          >
            Ver Todos
          </button>
        </div>
      </div>
    </div>
  );
}
