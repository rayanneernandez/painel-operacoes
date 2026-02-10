import { ChevronDown, Eye, BarChart2, Download, Settings, FileText } from 'lucide-react';
import { useState } from 'react';

// Componente Toggle
const Toggle = ({ checked, onChange }: { checked: boolean; onChange: () => void }) => (
  <button 
    onClick={onChange}
    className={`w-12 h-6 rounded-full transition-colors relative ${checked ? 'bg-purple-600' : 'bg-gray-700'}`}
  >
    <div className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform duration-200 ${checked ? 'translate-x-6' : 'translate-x-0'}`} />
  </button>
);

export function Permissions() {
  const [selectedClient, setSelectedClient] = useState('');

  // Estado fictício de permissões
  const [perms, setPerms] = useState({
    view_dashboard: true,
    view_reports: false,
    view_analytics: false,
    export_data: false,
    manage_settings: false
  });

  const toggle = (key: keyof typeof perms) => {
    setPerms(p => ({ ...p, [key]: !p[key] }));
  };

  return (
    <div className="h-[calc(100vh-100px)] flex items-center justify-center">
      
      {/* CARD CENTRALIZADO DE PERMISSÕES */}
      <div className="w-full max-w-md bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="p-6 border-b border-gray-800">
          <h2 className="text-xl font-bold text-white mb-6">Permissões de Acesso</h2>
          
          <div className="space-y-4">
             <div className="space-y-2">
                <label className="text-sm font-medium text-gray-400">Cliente *</label>
                <div className="relative">
                   <select 
                      className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-3 text-white appearance-none outline-none focus:border-purple-500 transition-colors cursor-pointer"
                      value={selectedClient}
                      onChange={(e) => setSelectedClient(e.target.value)}
                   >
                      <option value="" disabled>Selecione um cliente</option>
                      <option value="1">Global IA</option>
                      <option value="2">Tech Solutions</option>
                   </select>
                   <ChevronDown className="absolute right-4 top-3.5 text-gray-500 pointer-events-none" size={18} />
                </div>
             </div>
          </div>
        </div>

        {/* Permissions List */}
        <div className="p-4 space-y-2 bg-gray-900">
           
           <div className="flex items-center justify-between p-4 rounded-xl hover:bg-gray-800/50 transition-colors">
              <div className="flex items-center gap-4">
                 <div className="w-10 h-10 rounded-lg bg-gray-800 flex items-center justify-center text-gray-400">
                    <Eye size={20} />
                 </div>
                 <div>
                    <p className="font-medium text-white">Visualizar Dashboard</p>
                    <p className="text-xs text-gray-500">Acesso aos gráficos e métricas</p>
                 </div>
              </div>
              <Toggle checked={perms.view_dashboard} onChange={() => toggle('view_dashboard')} />
           </div>

           <div className="flex items-center justify-between p-4 rounded-xl hover:bg-gray-800/50 transition-colors">
              <div className="flex items-center gap-4">
                 <div className="w-10 h-10 rounded-lg bg-gray-800 flex items-center justify-center text-gray-400">
                    <FileText size={20} />
                 </div>
                 <div>
                    <p className="font-medium text-white">Visualizar Relatórios</p>
                    <p className="text-xs text-gray-500">Acesso aos relatórios detalhados</p>
                 </div>
              </div>
              <Toggle checked={perms.view_reports} onChange={() => toggle('view_reports')} />
           </div>

           <div className="flex items-center justify-between p-4 rounded-xl hover:bg-gray-800/50 transition-colors">
              <div className="flex items-center gap-4">
                 <div className="w-10 h-10 rounded-lg bg-gray-800 flex items-center justify-center text-gray-400">
                    <BarChart2 size={20} />
                 </div>
                 <div>
                    <p className="font-medium text-white">Visualizar Analytics</p>
                    <p className="text-xs text-gray-500">Acesso às análises avançadas</p>
                 </div>
              </div>
              <Toggle checked={perms.view_analytics} onChange={() => toggle('view_analytics')} />
           </div>

           <div className="flex items-center justify-between p-4 rounded-xl hover:bg-gray-800/50 transition-colors">
              <div className="flex items-center gap-4">
                 <div className="w-10 h-10 rounded-lg bg-gray-800 flex items-center justify-center text-gray-400">
                    <Download size={20} />
                 </div>
                 <div>
                    <p className="font-medium text-white">Exportar Dados</p>
                    <p className="text-xs text-gray-500">Permissão para baixar dados</p>
                 </div>
              </div>
              <Toggle checked={perms.export_data} onChange={() => toggle('export_data')} />
           </div>

           <div className="flex items-center justify-between p-4 rounded-xl hover:bg-gray-800/50 transition-colors">
              <div className="flex items-center gap-4">
                 <div className="w-10 h-10 rounded-lg bg-gray-800 flex items-center justify-center text-gray-400">
                    <Settings size={20} />
                 </div>
                 <div>
                    <p className="font-medium text-white">Gerenciar Configurações</p>
                    <p className="text-xs text-gray-500">Alterar configurações do cliente</p>
                 </div>
              </div>
              <Toggle checked={perms.manage_settings} onChange={() => toggle('manage_settings')} />
           </div>

        </div>

      </div>
    </div>
  );
}