import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Users, Globe, Activity, ArrowUp, ArrowDown, Server, Clock, ShieldCheck, Wallet, Zap, Cpu, BarChart2 } from 'lucide-react';
import supabase from '../lib/supabase';

export function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState([
    { label: 'Total de Clientes', value: '0', trend: '0', trendUp: true, icon: Users, color: 'text-blue-400', bg: 'bg-blue-500/10' },
    { label: 'APIs Conectadas', value: '0', trend: '0%', trendUp: true, icon: Globe, color: 'text-purple-400', bg: 'bg-purple-500/10' },
    { label: 'Usuários Cadastrados', value: '0', trend: '0', trendUp: true, icon: ShieldCheck, color: 'text-indigo-400', bg: 'bg-indigo-500/10' },
    { label: 'Maior Média Visitantes', value: 'N/A', trend: 'Em breve', trendUp: true, icon: BarChart2, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  ]);
  const [chartData, setChartData] = useState<{ month: string, count: number }[]>([]);
  const [recentClients, setRecentClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user?.role === 'client' && user.clientId) {
      navigate(`/clientes/${user.clientId}/dashboard`);
      return;
    }

    const fetchData = async () => {
      try {
        setLoading(true);
        
        // 1. Fetch Clients Count & Data for Chart
        const { data: clientsData, count: clientsCount } = await supabase
          .from('clients')
          .select('id, name, created_at, entry_date, logo_url, company', { count: 'exact' })
          .order('created_at', { ascending: false });

        // 2. Fetch Users Count
        const { count: usersCount } = await supabase
          .from('users')
          .select('id', { count: 'exact', head: true });

        // 3. Fetch APIs Connected Count (clients with non-null api_key in client_api_configs)
        // Since we can't easily join in one count query without foreign keys setup perfectly, 
        // we'll fetch the config table.
        const { count: apisCount } = await supabase
          .from('client_api_configs')
          .select('client_id', { count: 'exact', head: true })
          .not('api_key', 'is', null)
          .neq('api_key', '');

        // 4. Process Chart Data (Clients per Month)
        const monthsData: { y: number; m: number; label: string; count: number }[] = [];
        const now = new Date();
        const currentYear = now.getUTCFullYear();
        const currentMonth = now.getUTCMonth();

        for (let i = 11; i >= 0; i--) {
            let y = currentYear;
            let m = currentMonth - i;
            while (m < 0) {
                m += 12;
                y -= 1;
            }
            
            const d = new Date(Date.UTC(y, m, 1));
            const monthName = d.toLocaleString('pt-BR', { month: 'short', timeZone: 'UTC' });
            
            monthsData.push({
                y, m, label: monthName, count: 0
            });
        }

        if (clientsData) {
            clientsData.forEach(client => {
                const dateStr = client.entry_date || client.created_at;
                if (dateStr) {
                    const d = new Date(dateStr);
                    const y = d.getUTCFullYear();
                    const m = d.getUTCMonth();
                    
                    // Ajuste para fuso horário se necessário (caso a data venha como string simples YYYY-MM-DD)
                    // Mas como usamos ISO, o UTC deve funcionar.
                    // Vamos garantir que o mês bata com o label gerado.

                    const match = monthsData.find(item => item.y === y && item.m === m);
                    if (match) {
                        match.count++;
                    }
                }
            });
            setRecentClients(clientsData.slice(0, 5));
        }

        const processedChartData = monthsData.map(d => ({ month: d.label, count: d.count }));
        setChartData(processedChartData);

        // Update Stats
        setStats([
            { label: 'Total de Clientes', value: clientsCount?.toString() || '0', trend: '+12%', trendUp: true, icon: Users, color: 'text-blue-400', bg: 'bg-blue-500/10' },
            { label: 'APIs Conectadas', value: apisCount?.toString() || '0', trend: '100%', trendUp: true, icon: Globe, color: 'text-purple-400', bg: 'bg-purple-500/10' },
            { label: 'Usuários Cadastrados', value: usersCount?.toString() || '0', trend: '+5%', trendUp: true, icon: ShieldCheck, color: 'text-indigo-400', bg: 'bg-indigo-500/10' },
            { label: 'Maior Média Visitantes', value: '-', trend: '-', trendUp: true, icon: BarChart2, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
        ]);

      } catch (error) {
        console.error('Error fetching dashboard data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [user, navigate]);

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
               <p className="text-3xl font-bold text-white mb-1">{stat.value}</p>
               <p className="text-sm text-gray-500 font-medium">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
         {/* Main Chart Area */}
         <div className="lg:col-span-2 bg-gray-900 border border-gray-800 rounded-xl p-6">
            <div className="flex items-center justify-between mb-8">
               <h3 className="font-bold text-white flex items-center gap-2">
                  <Activity size={18} className="text-emerald-500" />
                  Entrada de Clientes por Mês
               </h3>
               <select className="bg-gray-950 border border-gray-800 text-xs text-gray-300 rounded-lg px-2 py-1 outline-none">
                  <option>Últimos 12 meses</option>
               </select>
            </div>
            
            {/* CSS Bar Chart Visualization */}
            <div className="h-64 flex items-end justify-between gap-2 px-2">
               {chartData.map((data, i) => {
                  const max = Math.max(...chartData.map(d => d.count), 1); // Avoid division by zero
                  const height = (data.count / max) * 100;
                  return (
                  <div key={i} className="w-full flex flex-col gap-2 group cursor-pointer">
                     <div className="relative w-full bg-gray-800 rounded-t-sm hover:bg-emerald-500/20 transition-all duration-300 overflow-hidden" style={{ height: `${height}%` }}>
                        <div className="absolute bottom-0 left-0 w-full bg-emerald-500/50 group-hover:bg-emerald-500 transition-colors h-full opacity-80"></div>
                        {/* Tooltip */}
                        <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-[10px] py-1 px-2 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 border border-gray-700 pointer-events-none">
                           {data.count} Clientes
                        </div>
                     </div>
                     <span className="text-[10px] text-center text-gray-600 group-hover:text-emerald-400 uppercase">{data.month}</span>
                  </div>
               )})}
            </div>
         </div>

         {/* Latest Clients */}
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
                       <div key={client.id} className="flex items-center gap-3 p-3 rounded-lg bg-gray-950/50 border border-gray-800/50 hover:bg-gray-900 transition-colors">
                           <div className="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center overflow-hidden border border-gray-700">
                               {client.logo_url ? (
                                   <img src={client.logo_url} alt={client.name} className="w-full h-full object-cover" />
                               ) : (
                                   <span className="text-xs font-bold text-gray-400">{client.name.substring(0, 2).toUpperCase()}</span>
                               )}
                           </div>
                           <div className="flex-1 min-w-0">
                               <p className="text-sm font-medium text-white truncate">{client.name}</p>
                               <p className="text-xs text-gray-500 truncate">{client.company}</p>
                           </div>
                           <div className="text-xs text-gray-600 whitespace-nowrap">
                               {client.entry_date ? new Date(client.entry_date).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : (client.created_at ? new Date(client.created_at).toLocaleDateString('pt-BR') : '-')}
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