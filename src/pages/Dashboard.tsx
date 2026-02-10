import { Users, Globe, Activity, ArrowUp, ArrowDown, Server, CheckCircle2, AlertTriangle, Clock, ShieldCheck, Wallet, Zap, Cpu } from 'lucide-react';

export function Dashboard() {
  const stats = [
    { label: 'Total de Clientes', value: '24', trend: '+2', trendUp: true, icon: Users, color: 'text-blue-400', bg: 'bg-blue-500/10' },
    { label: 'Receita Mensal', value: 'R$ 142.5k', trend: '+12%', trendUp: true, icon: Wallet, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    { label: 'APIs Conectadas', value: '142', trend: '+15%', trendUp: true, icon: Globe, color: 'text-purple-400', bg: 'bg-purple-500/10' },
    { label: 'Usuários Ativos', value: '89', trend: '+5', trendUp: true, icon: ShieldCheck, color: 'text-indigo-400', bg: 'bg-indigo-500/10' },
  ];

  
  // Dados simulados para o gráfico de barras (CSS)
  const chartData = [40, 65, 45, 80, 55, 90, 70, 85, 60, 75, 50, 95];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
           <h1 className="text-2xl font-bold text-white">Painel de Operações</h1>
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
                  Volume de Requisições
               </h3>
               <select className="bg-gray-950 border border-gray-800 text-xs text-gray-300 rounded-lg px-2 py-1 outline-none">
                  <option>Últimas 24h</option>
                  <option>Últimos 7 dias</option>
                  <option>Últimos 30 dias</option>
               </select>
            </div>
            
            {/* CSS Bar Chart Visualization */}
            <div className="h-64 flex items-end justify-between gap-2 px-2">
               {chartData.map((height, i) => (
                  <div key={i} className="w-full flex flex-col gap-2 group cursor-pointer">
                     <div className="relative w-full bg-gray-800 rounded-t-sm hover:bg-emerald-500/20 transition-all duration-300 overflow-hidden" style={{ height: `${height}%` }}>
                        <div className="absolute bottom-0 left-0 w-full bg-emerald-500/50 group-hover:bg-emerald-500 transition-colors h-full opacity-80"></div>
                     </div>
                     <span className="text-[10px] text-center text-gray-600 group-hover:text-emerald-400">{i * 2}h</span>
                  </div>
               ))}
            </div>
         </div>

         {/* Operational Insights / Infrastructure */}
         <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 flex flex-col justify-between">
            <div>
               <h3 className="font-bold text-white mb-6 flex items-center gap-2">
                  <Zap size={18} className="text-yellow-500" />
                  Insights Operacionais
               </h3>
               
               <div className="grid grid-cols-2 gap-4 mb-6">
                  <div className="bg-gray-950/50 p-4 rounded-xl border border-gray-800">
                     <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">Custo Infra</p>
                     <p className="text-xl font-bold text-white">R$ 8.2k</p>
                     <div className="w-full bg-gray-800 h-1 mt-2 rounded-full overflow-hidden">
                        <div className="bg-yellow-500 h-full w-[65%]"></div>
                     </div>
                  </div>
                  <div className="bg-gray-950/50 p-4 rounded-xl border border-gray-800">
                     <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">Uptime Global</p>
                     <p className="text-xl font-bold text-emerald-400">99.9%</p>
                     <div className="w-full bg-gray-800 h-1 mt-2 rounded-full overflow-hidden">
                        <div className="bg-emerald-500 h-full w-[99%]"></div>
                     </div>
                  </div>
               </div>

               <div className="space-y-4">
                  <div className="flex items-center justify-between p-3 rounded-lg bg-gray-950 border border-gray-800/50">
                     <div className="flex items-center gap-3">
                        <Cpu size={16} className="text-blue-500" />
                        <span className="text-sm text-gray-300">Uso de CPU (Cluster)</span>
                     </div>
                     <span className="text-xs font-mono text-blue-400">34%</span>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg bg-gray-950 border border-gray-800/50">
                     <div className="flex items-center gap-3">
                        <Server size={16} className="text-purple-500" />
                        <span className="text-sm text-gray-300">Memória Disponível</span>
                     </div>
                     <span className="text-xs font-mono text-purple-400">6.2 TB</span>
                  </div>
               </div>
            </div>

            <div className="mt-6 pt-6 border-t border-gray-800">
               <h4 className="text-xs font-semibold text-gray-500 uppercase mb-3">Atividade Recente</h4>
               <div className="space-y-3">
                  <div className="flex gap-3">
                     <div className="mt-1"><div className="w-1.5 h-1.5 rounded-full bg-blue-500"></div></div>
                     <div>
                        <p className="text-xs text-gray-300">Novo cliente <span className="text-white">TechLabs</span> registrado.</p>
                        <p className="text-[10px] text-gray-600 flex items-center gap-1 mt-0.5"><Clock size={10} /> 12 min atrás</p>
                     </div>
                  </div>
                  <div className="flex gap-3">
                     <div className="mt-1"><div className="w-1.5 h-1.5 rounded-full bg-orange-500"></div></div>
                     <div>
                        <p className="text-xs text-gray-300">Alerta de CPU alto em <span className="text-white">Node-04</span>.</p>
                        <p className="text-[10px] text-gray-600 flex items-center gap-1 mt-0.5"><Clock size={10} /> 45 min atrás</p>
                     </div>
                  </div>
               </div>
            </div>
         </div>
      </div>
    </div>
  );
}