import { useState } from 'react';
import { FileText, Building2, Globe, ArrowRight, Table, Smartphone, LayoutGrid } from 'lucide-react';
import { exportToExcel, exportToPDF } from '../services/exportService';

export function Reports() {
  const [scope, setScope] = useState<'global' | 'network' | 'store'>('global');
  const [selectedClient, setSelectedClient] = useState('');
  const [selectedStore, setSelectedStore] = useState('');
  const [reportType, setReportType] = useState<'general' | 'clients' | 'stores' | 'devices'>('general');

  // Dados simulados
  const clients: { id: string; name: string }[] = [];
  const stores: { id: string; name: string }[] = [];
  
  // Dados para exportação (vazios inicialmente conforme solicitação de limpeza)
  const clientsData: any[] = [];
  const storesData: any[] = [];
  const devicesData: any[] = [];

  interface StatItem {
    label: string;
    value: string;
    change: string;
    bg: string;
    color: string;
  }

  // Simulação de dados: Se for REDE pega dados globais, se for LOJA pega dados específicos
  const stats: StatItem[] = scope === 'global' ? [] : [];

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
                <option value="" disabled className="bg-white text-gray-900">Selecione uma rede...</option>
                {clients.map(client => (
                  <option key={client.id} value={client.name} className="bg-white text-gray-900">{client.name}</option>
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
                <option value="" disabled className="bg-white text-gray-900">Selecione uma loja...</option>
                {stores.map(store => (
                  <option key={store.id} value={store.name} className="bg-white text-gray-900">{store.name}</option>
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
      <div className="flex justify-end gap-3">
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
      </div>

      {/* Data Preview / Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {stats.length === 0 ? (
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
    </div>
  );
}