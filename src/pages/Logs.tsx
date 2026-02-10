import { useState } from 'react';
import { History, Search, Filter, Globe, Building2, ArrowRight, ShieldCheck, ShieldAlert, Clock, Download } from 'lucide-react';

export function Logs() {
  const [scope, setScope] = useState<'network' | 'store'>('network');
  const [selectedStore, setSelectedStore] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const stores = [
    { id: '1', name: 'Tech Solutions Ltda' },
    { id: '2', name: 'Kibon Alphaville' },
    { id: '3', name: 'Global IA Matriz' },
  ];

  // Mock data for logs
  const allLogs = [
    { id: 1, user: 'Admin Global', action: 'Login', status: 'success', time: 'Hoje, 10:23', ip: '192.168.1.1', store: 'Global IA Matriz', scope: 'network' },
    { id: 2, user: 'Roberto Silva', action: 'Login', status: 'success', time: 'Hoje, 09:45', ip: '192.168.1.15', store: 'Tech Solutions Ltda', scope: 'store' },
    { id: 3, user: 'Julia Costa', action: 'Tentativa de Login', status: 'failed', time: 'Hoje, 09:30', ip: '201.55.33.22', store: 'Kibon Alphaville', scope: 'store' },
    { id: 4, user: 'Carlos Santos', action: 'Logout', status: 'success', time: 'Hoje, 08:15', ip: '192.168.1.4', store: 'Tech Solutions Ltda', scope: 'store' },
    { id: 5, user: 'Admin Global', action: 'Alteração de Permissões', status: 'success', time: 'Ontem, 16:20', ip: '192.168.1.1', store: 'Global IA Matriz', scope: 'network' },
    { id: 6, user: 'Roberto Silva', action: 'Login', status: 'success', time: 'Ontem, 14:00', ip: '192.168.1.15', store: 'Tech Solutions Ltda', scope: 'store' },
  ];

  // Filter logs based on scope and selected store
  const filteredLogs = allLogs.filter(log => {
    // Text search filter
    const matchesSearch = log.user.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          log.action.toLowerCase().includes(searchTerm.toLowerCase());

    if (!matchesSearch) return false;

    // Scope filter
    if (scope === 'network') {
      return true; // Show all logs in network view
    } else {
      // Store view
      if (selectedStore) {
        return log.store === selectedStore;
      }
      return log.scope === 'store'; // Show all store logs if no specific store selected
    }
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <History className="text-orange-500" /> Logs de Acesso
          </h1>
          <p className="text-gray-400">Monitore as atividades de login e segurança em tempo real</p>
        </div>
        <div className="flex gap-3">
          <button className="bg-gray-800 hover:bg-gray-700 text-white font-medium px-4 py-2 rounded-lg flex items-center gap-2 transition-colors">
            <Download size={18} />
          </button>
        </div>
      </div>

      {/* Scope Selector */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">Filtrar Origem dos Logs</h2>
        <div className="flex flex-col md:flex-row gap-6 items-start md:items-center">
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
          {scope === 'store' && (
            <div className="flex items-center gap-2 animate-in fade-in slide-in-from-left-4 duration-300">
              <ArrowRight size={16} className="text-gray-600" />
              <select 
                value={selectedStore}
                onChange={(e) => setSelectedStore(e.target.value)}
                className="bg-gray-950 border border-gray-800 text-white rounded-lg px-4 py-2 outline-none focus:border-indigo-500 min-w-[200px]"
              >
                <option value="" disabled className="bg-gray-950 text-gray-500">Selecione uma loja...</option>
                {stores.map(store => (
                  <option key={store.id} value={store.name} className="bg-gray-950 text-white">{store.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        {/* Table Controls */}
        <div className="p-4 border-b border-gray-800 flex flex-col md:flex-row gap-4 justify-between items-center">
          <div className="relative w-full md:w-96">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
            <input 
              type="text" 
              placeholder="Buscar por usuário, ação..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-gray-950 border border-gray-800 text-white pl-10 pr-4 py-2 rounded-lg outline-none focus:border-orange-500 placeholder-gray-600"
            />
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <Filter size={16} />
            <span>Mostrando {filteredLogs.length} registros</span>
          </div>
        </div>

        {/* List */}
        <div className="w-full text-left">
            <div className="bg-gray-950/50 text-gray-400 text-xs uppercase tracking-wider font-medium flex border-b border-gray-800">
              <div className="p-4 w-1/4">Usuário / IP</div>
              <div className="p-4 w-1/4">Ação</div>
              <div className="p-4 w-1/4">Origem (Loja)</div>
              <div className="p-4 w-1/4 text-right">Data / Hora</div>
            </div>
            <div className="divide-y divide-gray-800">
              {filteredLogs.length > 0 ? (
                filteredLogs.map((log) => (
                  <div key={log.id} className="flex hover:bg-gray-800/30 transition-colors group">
                    <div className="p-4 w-1/4">
                      <div className="font-medium text-white">{log.user}</div>
                      <div className="text-xs text-gray-500 font-mono mt-1">{log.ip}</div>
                    </div>
                    <div className="p-4 w-1/4">
                      <div className="flex items-center gap-2">
                        {log.status === 'success' ? (
                          <ShieldCheck size={16} className="text-emerald-500" />
                        ) : (
                          <ShieldAlert size={16} className="text-red-500" />
                        )}
                        <span className={log.status === 'success' ? 'text-gray-300' : 'text-red-400'}>
                          {log.action}
                        </span>
                      </div>
                    </div>
                    <div className="p-4 w-1/4 flex items-center gap-2 text-gray-400">
                      <Building2 size={14} className="text-gray-600" />
                      <span className="text-sm">{log.store}</span>
                    </div>
                    <div className="p-4 w-1/4 text-right flex items-center justify-end gap-2 text-gray-400">
                      <Clock size={14} />
                      <span className="text-sm">{log.time}</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-8 text-center text-gray-500">
                  Nenhum registro encontrado para os filtros selecionados.
                </div>
              )}
            </div>
        </div>
      </div>
    </div>
  );
}