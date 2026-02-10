import { useState } from 'react';
import { FileText, Download, Calendar, Filter, Search, Building2, Globe, ArrowRight } from 'lucide-react';

export function Reports() {
  const [scope, setScope] = useState<'network' | 'store'>('network');
  const [selectedStore, setSelectedStore] = useState('');

  // Dados simulados das lojas (mesmos do sistema)
  const stores = [
    { id: '1', name: 'Tech Solutions Ltda' },
    { id: '2', name: 'Kibon Alphaville' },
    { id: '3', name: 'Global IA Matriz' },
  ];

  // Simulação de dados: Se for REDE pega dados globais, se for LOJA pega dados específicos
  const stats = scope === 'network' ? [
    { label: 'Total na Rede', value: '24 Clientes', change: '+2 este mês', color: 'text-blue-400', bg: 'bg-blue-500/10' },
    { label: 'Requisições Global', value: '1.2M', change: '+15%', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    { label: 'Lojas Ativas', value: '22/24', change: '92% uptime', color: 'text-indigo-400', bg: 'bg-indigo-500/10' },
  ] : [
    { label: 'Requisições (Loja)', value: '45.2k', change: '+5% vs ontem', color: 'text-blue-400', bg: 'bg-blue-500/10' },
    { label: 'Status da Loja', value: 'Online', change: 'Latency: 45ms', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    { label: 'Erros Registrados', value: '0.01%', change: '-0.05%', color: 'text-indigo-400', bg: 'bg-indigo-500/10' },
  ];

  const reports = [
    { id: 1, title: scope === 'network' ? 'Relatório Consolidado de Rede' : `Performance - ${selectedStore || 'Loja Selecionada'}`, date: '04/02/2026', type: 'performance', size: '2.4 MB' },
    { id: 2, title: scope === 'network' ? 'Auditoria Global de Acessos' : `Acessos - ${selectedStore || 'Loja Selecionada'}`, date: '01/02/2026', type: 'security', size: '5.1 MB' },
    { id: 3, title: 'Fechamento Mensal - Jan/26', date: '31/01/2026', type: 'finance', size: '1.8 MB' },
    { id: 4, title: 'Logs de Erros do Sistema', date: '30/01/2026', type: 'audit', size: '3.2 MB' },
  ];

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
        <button className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium px-4 py-2 rounded-lg flex items-center gap-2 transition-colors shadow-lg shadow-emerald-900/20">
          <FileText size={18} />
          Novo Relatório
        </button>
      </div>

      {/* Scope Selector */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">Configuração da Fonte de Dados</h2>
        <div className="flex flex-col md:flex-row gap-6 items-start md:items-center">
          
          {/* Radio Group for Scope */}
          <div className="flex bg-gray-950 p-1 rounded-lg border border-gray-800">
            <button
              onClick={() => setScope('network')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${
                scope === 'network' 
                  ? 'bg-gray-800 text-white shadow-sm' 
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <Globe size={16} />
              Rede (Global)
            </button>
            <button
              onClick={() => setScope('store')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${
                scope === 'store' 
                  ? 'bg-gray-800 text-white shadow-sm' 
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <Building2 size={16} />
              Loja Específica
            </button>
          </div>

          {/* Store Selector (only visible if scope is store) */}
          {scope === 'store' && (
            <div className="flex items-center gap-2 animate-in fade-in slide-in-from-left-4 duration-300">
              <ArrowRight size={16} className="text-gray-600" />
              <select 
                value={selectedStore}
                onChange={(e) => setSelectedStore(e.target.value)}
                className="bg-gray-950 border border-gray-800 text-white rounded-lg px-4 py-2 outline-none focus:border-indigo-500 min-w-[200px]"
              >
                <option value="" disabled>Selecione uma loja...</option>
                {stores.map(store => (
                  <option key={store.id} value={store.name}>{store.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Data Preview / Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {stats.map((stat, index) => (
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
        ))}
      </div>

      {/* Filters & List */}
      <div className="flex flex-col md:flex-row gap-4 bg-gray-900/50 p-2 rounded-xl border border-gray-800">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
          <input 
            type="text" 
            placeholder={scope === 'network' ? "Buscar relatórios globais..." : "Buscar relatórios desta loja..."}
            className="w-full bg-transparent text-white pl-10 pr-4 py-2 outline-none placeholder-gray-600"
          />
        </div>
        <div className="flex gap-2">
          <button className="px-4 py-2 bg-gray-800 text-gray-300 rounded-lg text-sm font-medium hover:bg-gray-700 transition-colors flex items-center gap-2">
            <Filter size={16} />
            Filtrar
          </button>
          <button className="px-4 py-2 bg-gray-800 text-gray-300 rounded-lg text-sm font-medium hover:bg-gray-700 transition-colors flex items-center gap-2">
            <Calendar size={16} />
            Data
          </button>
        </div>
      </div>

      {/* Reports List */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-gray-800 bg-gray-950/50 flex items-center justify-between">
          <h3 className="font-bold text-white flex items-center gap-2">
            <FileText size={18} className="text-gray-400" />
            {scope === 'network' ? 'Relatórios da Rede' : 'Relatórios da Loja'}
          </h3>
        </div>
        <div className="divide-y divide-gray-800">
          {reports.map((report) => (
            <div key={report.id} className="p-4 flex items-center justify-between hover:bg-gray-800/50 transition-colors group">
              <div className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                  report.type === 'security' ? 'bg-red-500/10 text-red-400' :
                  report.type === 'finance' ? 'bg-emerald-500/10 text-emerald-400' :
                  report.type === 'audit' ? 'bg-amber-500/10 text-amber-400' :
                  'bg-blue-500/10 text-blue-400'
                }`}>
                  <FileText size={20} />
                </div>
                <div>
                  <h4 className="font-medium text-white">{report.title}</h4>
                  <div className="flex items-center gap-3 text-xs text-gray-500 mt-0.5">
                    <span>{report.date}</span>
                    <span>•</span>
                    <span>{report.size}</span>
                  </div>
                </div>
              </div>
              <button className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors">
                <Download size={20} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}