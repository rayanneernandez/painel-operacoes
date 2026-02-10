import { useState } from 'react';
import { Search, Plus, LayoutDashboard, Link as LinkIcon, Edit, Trash2, X, Building, Mail, Phone, Key, Server, Settings, Upload, FileText, Lock, Shield, Eye, BarChart2, Download, ChevronDown, ChevronUp, MapPin, Building2, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

// Componente Toggle
const Toggle = ({ checked, onChange }: { checked: boolean; onChange: () => void }) => (
  <button 
    onClick={onChange}
    className={`w-12 h-6 rounded-full transition-colors relative ${checked ? 'bg-emerald-500' : 'bg-gray-700'}`}
  >
    <div className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform duration-200 ${checked ? 'translate-x-6' : 'translate-x-0'}`} />
  </button>
);

// Tipo fictício para clientes
type Client = {
  id: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  status: 'active' | 'inactive' | 'pending';
  plan: 'enterprise' | 'pro' | 'basic';
  apisConnected: number;
  createdAt: string;
  initials: string;
  color: string;
};

const MOCK_CLIENTS: Client[] = [
  { 
    id: '1', name: 'Tech Solutions Ltda', company: 'Tech Solutions', email: 'contato@techsolutions.com', phone: '(11) 99999-1234',
    status: 'active', plan: 'enterprise', apisConnected: 5, createdAt: '14/01/2024', 
    initials: 'T', color: 'bg-indigo-600' 
  },
  { 
    id: '2', name: 'Kibon Alphaville', company: 'Unilever', email: 'kibon@alphaville.com', phone: '(11) 98888-5555',
    status: 'active', plan: 'pro', apisConnected: 3, createdAt: '19/01/2024', 
    initials: 'K', color: 'bg-teal-600' 
  },
];

export function Clients() {
  const navigate = useNavigate();
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [expandedClient, setExpandedClient] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'details' | 'permissions' | 'api'>('details');

  // Mock data for client stores
  const getClientStores = (clientId: string) => [
    { id: 'store-1', name: 'Loja Matriz - Centro', city: 'São Paulo, SP' },
    { id: 'store-2', name: 'Filial Shopping Morumbi', city: 'São Paulo, SP' },
    { id: 'store-3', name: 'Filial Campinas', city: 'Campinas, SP' },
  ];

  // Estado de permissões (mock)
  const [perms, setPerms] = useState({
    view_dashboard: true,
    view_reports: false,
    view_analytics: false,
    export_data: false,
    manage_settings: false
  });

  const togglePerm = (key: keyof typeof perms) => {
    setPerms(p => ({ ...p, [key]: !p[key] }));
  };

  const handleEdit = (client: Client, initialTab: 'details' | 'permissions' | 'api' = 'details') => {
    setSelectedClient(client);
    setActiveTab(initialTab);
    setIsEditModalOpen(true);
    setActiveMenu(null);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Building className="text-emerald-500" /> Clientes
          </h1>
          <p className="text-gray-400">Gerencie seus clientes e APIs</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
            <input 
              type="text" 
              placeholder="Buscar clientes..." 
              className="bg-gray-900 border border-gray-800 text-white pl-10 pr-4 py-2 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 w-64 placeholder-gray-600"
            />
          </div>
          <button 
            onClick={() => { setSelectedClient(null); setIsEditModalOpen(true); }}
            className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium px-4 py-2 rounded-lg flex items-center gap-2 transition-colors shadow-lg shadow-emerald-900/20"
          >
            <Plus size={18} />
            Novo Cliente
          </button>
        </div>
      </div>

      {/* Client List */}
      <div className="space-y-4">
        {MOCK_CLIENTS.map((client) => (
          <div key={client.id} className="bg-gray-900 border border-gray-800 rounded-xl p-6 hover:border-gray-700 transition-all group relative flex flex-col gap-4">
            
            <div className="w-full flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className={`w-14 h-14 rounded-2xl ${client.color} flex items-center justify-center text-white font-bold text-2xl shadow-inner`}>
                  <Building size={24} />
                </div>
                <div>
                  <div className="flex items-center gap-3">
                    <h3 className="font-bold text-white text-lg">{client.name}</h3>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium border ${
                      client.status === 'active' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-gray-800 text-gray-400 border-gray-700'
                    }`}>
                      {client.status === 'active' ? 'Ativo' : 'Inativo'}
                    </span>
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20">
                      {client.plan === 'enterprise' ? 'Enterprise' : 'Pro'}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 mt-1">{client.company}</p>
                  
                  <div className="flex items-center gap-4 mt-3 text-sm text-gray-400">
                    <span className="flex items-center gap-1.5"><Mail size={14} /> {client.email}</span>
                    <span className="flex items-center gap-1.5"><Phone size={14} /> {client.phone}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-4 h-full">
                 <button 
                  onClick={() => setExpandedClient(expandedClient === client.id ? null : client.id)}
                  className={`p-2 rounded-lg border transition-colors ${
                    expandedClient === client.id 
                      ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' 
                      : 'border-gray-700 hover:bg-gray-800 text-gray-300'
                  }`}
                 >
                   {expandedClient === client.id ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                 </button>

                 <button 
                  onClick={() => navigate(`/clientes/${client.id}/dashboard`)}
                  className="px-4 py-2 rounded-lg border border-gray-700 hover:bg-gray-800 text-gray-300 text-sm font-medium flex items-center gap-2 transition-colors whitespace-nowrap"
                 >
                   <LayoutDashboard size={16} className="text-emerald-500" />
                   Dashboard
                 </button>
                 
                 <div className="relative">
                  <button 
                      onClick={() => setActiveMenu(activeMenu === client.id ? null : client.id)}
                      className="p-2 text-gray-500 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
                  >
                      <Settings size={20} />
                  </button>
                  
                  {/* Dropdown Menu */}
                  {activeMenu === client.id && (
                      <div className="absolute right-0 top-12 w-48 bg-gray-900 border border-gray-800 rounded-lg shadow-xl z-10 overflow-hidden">
                      <div className="p-1">
                          <button 
                          onClick={() => handleEdit(client, 'details')}
                          className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white rounded-md flex items-center gap-2"
                          >
                          <Edit size={16} /> Editar Cliente
                          </button>
                          <button 
                          onClick={() => handleEdit(client, 'api')}
                          className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white rounded-md flex items-center gap-2"
                          >
                          <LinkIcon size={16} /> Configurar APIs
                          </button>
                          <div className="h-px bg-gray-800 my-1"></div>
                          <button className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-red-900/20 rounded-md flex items-center gap-2">
                          <Trash2 size={16} /> Excluir
                          </button>
                      </div>
                      </div>
                  )}
                 </div>
              </div>
            </div>

            {/* Stores Expansion */}
            {expandedClient === client.id && (
              <div className="pt-4 border-t border-gray-800 animate-in slide-in-from-top-2 duration-200 w-full">
                <h4 className="text-sm font-medium text-gray-400 mb-3 flex items-center gap-2">
                  <Building2 size={14} /> Lojas da Rede
                </h4>
                <div className="flex flex-col gap-2">
                  {getClientStores(client.id).map(store => (
                    <button 
                      key={store.id}
                      onClick={() => navigate(`/clientes/${client.id}/dashboard`, { state: { initialView: 'store', storeId: store.id } })}
                      className="flex items-center justify-between p-3 bg-gray-950 rounded-lg border border-gray-800 hover:border-emerald-500/50 hover:bg-gray-900 transition-all group text-left w-full"
                    >
                      <div className="flex items-center gap-4">
                         <div className="w-8 h-8 rounded-lg bg-gray-900 flex items-center justify-center text-gray-500 group-hover:text-emerald-500 transition-colors">
                           <Building2 size={16} />
                         </div>
                         <div>
                          <p className="text-sm font-medium text-white group-hover:text-emerald-400">{store.name}</p>
                          <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                            <MapPin size={10} /> {store.city}
                          </p>
                         </div>
                      </div>
                      <ArrowRight size={14} className="text-gray-600 group-hover:text-emerald-500 opacity-0 group-hover:opacity-100 transition-all transform group-hover:translate-x-1" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* MODAL DE EDIÇÃO */}
      {isEditModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="sticky top-0 bg-gray-900 border-b border-gray-800 z-10">
              <div className="p-6 flex items-center justify-between pb-4">
                <h2 className="text-xl font-bold text-white">
                  {selectedClient ? 'Editar Cliente' : 'Novo Cliente'}
                </h2>
                <button 
                  onClick={() => setIsEditModalOpen(false)}
                  className="text-gray-500 hover:text-white transition-colors"
                >
                  <X size={24} />
                </button>
              </div>
              
              {/* Tabs */}
              <div className="flex px-6 gap-6">
                <button 
                  onClick={() => setActiveTab('details')}
                  className={`pb-3 text-sm font-medium transition-colors relative ${
                    activeTab === 'details' 
                      ? 'text-emerald-500 after:absolute after:bottom-0 after:left-0 after:w-full after:h-0.5 after:bg-emerald-500' 
                      : 'text-gray-400 hover:text-gray-300'
                  }`}
                >
                  Dados Gerais
                </button>
                <button 
                  onClick={() => setActiveTab('permissions')}
                  className={`pb-3 text-sm font-medium transition-colors relative ${
                    activeTab === 'permissions' 
                      ? 'text-emerald-500 after:absolute after:bottom-0 after:left-0 after:w-full after:h-0.5 after:bg-emerald-500' 
                      : 'text-gray-400 hover:text-gray-300'
                  }`}
                >
                  Permissões
                </button>
                <button 
                  onClick={() => setActiveTab('api')}
                  className={`pb-3 text-sm font-medium transition-colors relative ${
                    activeTab === 'api' 
                      ? 'text-emerald-500 after:absolute after:bottom-0 after:left-0 after:w-full after:h-0.5 after:bg-emerald-500' 
                      : 'text-gray-400 hover:text-gray-300'
                  }`}
                >
                  Configuração API
                </button>
              </div>
            </div>
            
            <div className="p-6 space-y-6">
              {/* Basic Info */}
              {activeTab === 'details' && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-400">Nome *</label>
                      <input 
                        type="text" 
                        defaultValue={selectedClient?.name}
                        className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-2.5 text-white focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-400">Email *</label>
                      <input 
                        type="email" 
                        defaultValue={selectedClient?.email}
                        className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-2.5 text-white focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-400">Telefone</label>
                      <input 
                        type="text" 
                        defaultValue={selectedClient?.phone}
                        className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-2.5 text-white focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-400">Empresa</label>
                      <input 
                        type="text" 
                        defaultValue={selectedClient?.company}
                        className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-2.5 text-white focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-400">Status</label>
                      <select className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-2.5 text-white focus:ring-1 focus:ring-emerald-500 outline-none">
                        <option value="active">Ativo</option>
                        <option value="inactive">Inativo</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-400">Plano</label>
                      <select className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-2.5 text-white focus:ring-1 focus:ring-emerald-500 outline-none">
                        <option value="enterprise">Enterprise</option>
                        <option value="pro">Pro</option>
                        <option value="basic">Basic</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-400">Logo da Empresa</label>
                    <div className="relative">
                        <input 
                            type="file" 
                            accept="image/*"
                            className="w-full bg-gray-950 border border-gray-800 rounded-lg pl-4 pr-10 py-2 text-white focus:ring-1 focus:ring-emerald-500 outline-none file:mr-4 file:py-1 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-gray-800 file:text-emerald-500 hover:file:bg-gray-700 cursor-pointer text-sm"
                        />
                        <Upload className="absolute right-3 top-2.5 text-gray-600 pointer-events-none" size={16} />
                    </div>
                    <p className="text-xs text-gray-500">Formatos aceitos: PNG, JPG, SVG (Máx. 2MB)</p>
                  </div>
                  
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-400">Observações</label>
                    <textarea 
                        rows={3}
                        placeholder="Notas adicionais sobre o cliente..."
                        className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-2.5 text-white focus:ring-1 focus:ring-emerald-500 outline-none resize-none"
                    />
                  </div>
                </>
              )}

              {/* Permissions Tab */}
              {activeTab === 'permissions' && (
                <div className="border border-gray-800 rounded-xl bg-gray-950/50 overflow-hidden">
                  <div className="p-4 bg-gray-900/50 border-b border-gray-800">
                    <h3 className="text-sm font-bold text-emerald-400 flex items-center gap-2">
                      <Shield size={16} /> Permissões de Acesso
                    </h3>
                  </div>
                  
                  <div className="p-2">
                    <div className="flex items-center justify-between p-4 hover:bg-gray-900/50 rounded-lg transition-colors">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-lg bg-gray-800 flex items-center justify-center text-gray-400">
                          <Eye size={20} />
                        </div>
                        <div>
                          <p className="font-medium text-white text-sm">Visualizar Dashboard</p>
                          <p className="text-xs text-gray-500">Acesso aos gráficos e métricas</p>
                        </div>
                      </div>
                      <Toggle checked={perms.view_dashboard} onChange={() => togglePerm('view_dashboard')} />
                    </div>

                    <div className="flex items-center justify-between p-4 hover:bg-gray-900/50 rounded-lg transition-colors">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-lg bg-gray-800 flex items-center justify-center text-gray-400">
                          <FileText size={20} />
                        </div>
                        <div>
                          <p className="font-medium text-white text-sm">Visualizar Relatórios</p>
                          <p className="text-xs text-gray-500">Acesso aos relatórios detalhados</p>
                        </div>
                      </div>
                      <Toggle checked={perms.view_reports} onChange={() => togglePerm('view_reports')} />
                    </div>

                    <div className="flex items-center justify-between p-4 hover:bg-gray-900/50 rounded-lg transition-colors">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-lg bg-gray-800 flex items-center justify-center text-gray-400">
                          <BarChart2 size={20} />
                        </div>
                        <div>
                          <p className="font-medium text-white text-sm">Visualizar Analytics</p>
                          <p className="text-xs text-gray-500">Acesso às análises avançadas</p>
                        </div>
                      </div>
                      <Toggle checked={perms.view_analytics} onChange={() => togglePerm('view_analytics')} />
                    </div>

                    <div className="flex items-center justify-between p-4 hover:bg-gray-900/50 rounded-lg transition-colors">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-lg bg-gray-800 flex items-center justify-center text-gray-400">
                          <Download size={20} />
                        </div>
                        <div>
                          <p className="font-medium text-white text-sm">Exportar Dados</p>
                          <p className="text-xs text-gray-500">Permissão para baixar dados</p>
                        </div>
                      </div>
                      <Toggle checked={perms.export_data} onChange={() => togglePerm('export_data')} />
                    </div>

                    <div className="flex items-center justify-between p-4 hover:bg-gray-900/50 rounded-lg transition-colors">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-lg bg-gray-800 flex items-center justify-center text-gray-400">
                          <Settings size={20} />
                        </div>
                        <div>
                          <p className="font-medium text-white text-sm">Gerenciar Configurações</p>
                          <p className="text-xs text-gray-500">Alterar configurações do cliente</p>
                        </div>
                      </div>
                      <Toggle checked={perms.manage_settings} onChange={() => togglePerm('manage_settings')} />
                    </div>
                  </div>
                </div>
              )}

              {/* API Config Section */}
              {activeTab === 'api' && (
                <div className="border border-gray-800 rounded-xl p-5 bg-gray-950/50">
                  <h3 className="text-sm font-bold text-emerald-400 flex items-center gap-2 mb-4">
                    <Key size={16} /> Configuração da API
                  </h3>
                  
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Ambiente</label>
                        <select className="w-full bg-gray-900 border border-gray-800 rounded-lg px-4 py-2.5 text-gray-300 text-sm focus:ring-1 focus:ring-emerald-500 outline-none">
                          <option value="production">Produção</option>
                          <option value="sandbox">Sandbox / Staging</option>
                          <option value="development">Desenvolvimento</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Método de Autenticação</label>
                        <select className="w-full bg-gray-900 border border-gray-800 rounded-lg px-4 py-2.5 text-gray-300 text-sm focus:ring-1 focus:ring-emerald-500 outline-none">
                          <option value="bearer">Bearer Token</option>
                          <option value="apikey_header">API Key (Header)</option>
                          <option value="basic">Basic Auth</option>
                          <option value="oauth2">OAuth 2.0</option>
                        </select>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Endpoint da API (Base URL)</label>
                      <div className="relative">
                          <input 
                              type="text" 
                              defaultValue="https://api.techsolutions.com/v1"
                              className="w-full bg-gray-900 border border-gray-800 rounded-lg pl-4 pr-10 py-2.5 text-gray-300 font-mono text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
                          />
                          <Server className="absolute right-3 top-2.5 text-gray-600" size={16} />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Chave da API / Token</label>
                      <div className="relative">
                          <input 
                              type="text" 
                              placeholder="sk-xxxxxxxxxxxxxxxx" 
                              className="w-full bg-gray-900 border border-gray-800 rounded-lg pl-4 pr-10 py-2.5 text-gray-300 font-mono text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
                          />
                          <Lock className="absolute right-3 top-2.5 text-gray-600" size={16} />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Header Personalizado (Opcional)</label>
                      <div className="relative">
                          <input 
                              type="text" 
                              placeholder="X-Custom-Auth: value" 
                              className="w-full bg-gray-900 border border-gray-800 rounded-lg pl-4 pr-10 py-2.5 text-gray-300 font-mono text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
                          />
                          <Key className="absolute right-3 top-2.5 text-gray-600" size={16} />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">URL da Documentação</label>
                      <div className="relative">
                          <input 
                              type="text" 
                              placeholder="https://docs.api.com" 
                              className="w-full bg-gray-900 border border-gray-800 rounded-lg pl-4 pr-10 py-2.5 text-gray-300 font-mono text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
                          />
                          <FileText className="absolute right-3 top-2.5 text-gray-600" size={16} />
                      </div>
                    </div>
                  </div>
                </div>
              )}

            </div>

            <div className="p-6 border-t border-gray-800 flex justify-end gap-3 bg-gray-900 sticky bottom-0 z-10">
              <button 
                onClick={() => setIsEditModalOpen(false)}
                className="px-4 py-2 rounded-lg text-gray-300 hover:text-white hover:bg-gray-800 transition-colors"
              >
                Cancelar
              </button>
              <button className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium shadow-lg shadow-emerald-900/20 transition-colors">
                Salvar Alterações
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Overlay to close menus */}
      {activeMenu && (
        <div className="fixed inset-0 z-0" onClick={() => setActiveMenu(null)} />
      )}
    </div>
  );
}