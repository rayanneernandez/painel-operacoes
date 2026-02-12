import { useState, useEffect } from 'react';
import supabase from '../lib/supabase';
import { Search, Plus, User, Mail, Shield, Building, MoreVertical, ArrowDown, X, Lock, Eye, EyeOff, CheckSquare, Square, Settings, Users as UsersIcon, FileEdit, BarChart2, Download, FileText } from 'lucide-react';

// Componente Toggle
const Toggle = ({ checked, onChange }: { checked: boolean; onChange: () => void }) => (
  <button 
    onClick={onChange}
    className={`w-12 h-6 rounded-full transition-colors relative ${checked ? 'bg-indigo-500' : 'bg-gray-700'}`}
  >
    <div className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform duration-200 ${checked ? 'translate-x-6' : 'translate-x-0'}`} />
  </button>
);

type Client = {
  id: string;
  name: string;
};

type UserType = {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'client';
  clients: Client[]; // Array de clientes
  status: 'active' | 'inactive';
  last_login: string;
  permissions: {
    view_dashboard: boolean;
    view_reports: boolean;
    view_analytics: boolean;
    export_data: boolean;
    manage_settings: boolean;
  };
};

export function Users() {
  const [users, setUsers] = useState<UserType[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<UserType | null>(null);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [activeTab, setActiveTab] = useState<'details' | 'permissions' | 'clients'>('details');

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

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    role: 'client' as 'admin' | 'client',
    password: ''
  });

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase.from('users').select('*');
      if (error) throw error;
      setUsers(data || []);
    } catch (error) {
      console.error('Erro ao buscar usuários:', error);
    } finally {
      setLoading(false);
    }
  };

  // Estado para seleção múltipla de clientes no modal
  const [selectedClientIds, setSelectedClientIds] = useState<string[]>([]);
  const [isClientDropdownOpen, setIsClientDropdownOpen] = useState(false);

  const availableClients: { id: string; name: string }[] = [];

  const handleOpenModal = (user?: UserType, mode: 'create' | 'edit' = 'create', initialTab: 'details' | 'permissions' | 'clients' = 'details') => {
    setModalMode(mode);
    setActiveTab(initialTab);
    if (user) {
      setEditingUser(user);
      setFormData({
        name: user.name,
        email: user.email,
        role: user.role,
        password: ''
      });
      setSelectedClientIds(user.clients.map(c => c.id));
      // Carregar permissões do usuário
      if (user.permissions) {
        setPerms(user.permissions);
      } else {
        // Default se não tiver
        setPerms({
          view_dashboard: true,
          view_reports: false,
          view_analytics: false,
          export_data: false,
          manage_settings: false
        });
      }
    } else {
      setEditingUser(null);
      setFormData({
        name: '',
        email: '',
        role: 'client',
        password: ''
      });
      setSelectedClientIds([]);
      // Resetar permissões para default
      setPerms({
        view_dashboard: true,
        view_reports: false,
        view_analytics: false,
        export_data: false,
        manage_settings: false
      });
    }
    setIsModalOpen(true);
    setActiveMenu(null);
  };

  const handleDeleteUser = async (userId: string) => {
    if (confirm('Tem certeza que deseja excluir este usuário?')) {
      try {
        const { error } = await supabase.from('users').delete().eq('id', userId);
        if (error) throw error;
        setUsers(users.filter(u => u.id !== userId));
        setActiveMenu(null);
      } catch (error) {
        console.error('Erro ao excluir usuário:', error);
        alert('Erro ao excluir usuário');
      }
    }
  };

  const handleSaveUser = async () => {
    const selectedClientsList = availableClients.filter(c => selectedClientIds.includes(c.id));
    
    try {
      if (editingUser) {
        const updates: any = {
          name: formData.name,
          email: formData.email,
          role: formData.role,
          clients: selectedClientsList,
          permissions: perms
        };
        
        if (formData.password) {
          updates.password = formData.password;
        }

        const { error } = await supabase
          .from('users')
          .update(updates)
          .eq('id', editingUser.id);

        if (error) throw error;
        
        await fetchUsers();
      } else {
        if (!formData.password) {
          alert('Senha é obrigatória para novos usuários');
          return;
        }

        const newUser = {
          name: formData.name,
          email: formData.email,
          role: formData.role,
          password: formData.password,
          clients: selectedClientsList,
          status: 'active',
          last_login: new Date().toISOString(),
          permissions: perms
        };

        const { error } = await supabase.from('users').insert([newUser]);
        if (error) throw error;
        
        await fetchUsers();
      }
      setIsModalOpen(false);
    } catch (error) {
      console.error('Erro ao salvar usuário:', error);
      alert('Erro ao salvar usuário');
    }
  };

  const toggleClientSelection = (clientId: string) => {
    setSelectedClientIds(prev => 
      prev.includes(clientId) 
        ? prev.filter(id => id !== clientId)
        : [...prev, clientId]
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Shield className="text-indigo-500" /> Gestão de Usuários
          </h1>
          <p className="text-gray-400">Gerencie acessos e vincule usuários aos clientes</p>
        </div>
        <button 
          onClick={() => handleOpenModal(undefined, 'create')}
          className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-4 py-2 rounded-lg flex items-center gap-2 transition-colors shadow-lg shadow-indigo-900/20"
        >
          <Plus size={18} />
          Novo Usuário
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 bg-gray-900/50 p-2 rounded-xl border border-gray-800">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
          <input 
            type="text" 
            placeholder="Buscar por nome, email ou cliente..." 
            className="w-full bg-transparent text-white pl-10 pr-4 py-2 outline-none placeholder-gray-600"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Users List */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-950 border-b border-gray-800 text-gray-400 text-sm uppercase tracking-wider">
              <th className="p-4 font-medium first:rounded-tl-xl">Usuário</th>
              <th className="p-4 font-medium">Perfil</th>
              <th className="p-4 font-medium">Cliente Vinculado</th>
              <th className="p-4 font-medium">Status</th>
              <th className="p-4 font-medium">Último Acesso</th>
              <th className="p-4 font-medium text-right last:rounded-tr-xl">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {loading ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-gray-500">
                  <div className="flex justify-center items-center gap-2">
                    <div className="w-5 h-5 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
                    Carregando usuários...
                  </div>
                </td>
              </tr>
            ) : users.length === 0 ? (
                <tr>
                    <td colSpan={6} className="p-8 text-center text-gray-500">
                        Nenhum usuário encontrado. Adicione um novo usuário para começar.
                    </td>
                </tr>
            ) : (
                users.map((user) => (
              <tr key={user.id} className="hover:bg-gray-800/50 transition-colors group">
                <td className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center text-indigo-400 font-bold">
                      {user.name.charAt(0)}
                    </div>
                    <div>
                      <p className="font-medium text-white">{user.name}</p>
                      <p className="text-xs text-gray-500">{user.email}</p>
                    </div>
                  </div>
                </td>
                <td className="p-4">
                  <span className={`px-2 py-1 rounded-md text-xs font-medium border ${
                    user.role === 'admin' ? 'bg-purple-500/10 text-purple-400 border-purple-500/20' :
                    'bg-blue-500/10 text-blue-400 border-blue-500/20'
                  }`}>
                    {user.role === 'admin' ? 'Administrador' : 'Cliente'}
                  </span>
                </td>
                <td className="p-4">
                  {user.clients?.length > 0 ? (
                    <div className="flex flex-col gap-1">
                      {user.clients.slice(0, 2).map(client => (
                        <div key={client.id} className="flex items-center gap-2 text-gray-300">
                          <Building size={14} className="text-emerald-500" />
                          <span className="text-xs">{client.name}</span>
                        </div>
                      ))}
                      {user.clients.length > 2 && (
                        <span className="text-xs text-gray-500 pl-6">+{user.clients.length - 2} outros</span>
                      )}
                    </div>
                  ) : (
                    <span className="text-gray-600 text-sm italic">Sem vínculo (Global)</span>
                  )}
                </td>
                <td className="p-4">
                  <span className={`flex items-center gap-1.5 text-xs font-medium ${
                    user.status === 'active' ? 'text-emerald-400' : 'text-red-400'
                  }`}>
                    <div className={`w-1.5 h-1.5 rounded-full ${user.status === 'active' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                    {user.status === 'active' ? 'Ativo' : 'Inativo'}
                  </span>
                </td>
                <td className="p-4 text-sm text-gray-500">{user.last_login ? new Date(user.last_login).toLocaleString() : 'Nunca'}</td>
                <td className="p-4 text-right relative">
                  <button 
                    onClick={() => setActiveMenu(activeMenu === user.id ? null : user.id)}
                    className={`p-2 rounded-lg transition-colors ${activeMenu === user.id ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}
                  >
                    <MoreVertical size={18} />
                  </button>
                  
                  {/* Dropdown Menu */}
                  {activeMenu === user.id && (
                    <div className="absolute right-8 top-8 z-50 w-48 bg-gray-900 border border-gray-800 rounded-xl shadow-2xl py-1 animate-in fade-in zoom-in-95 duration-100">
                      <button 
                        onClick={() => handleOpenModal(user, 'edit', 'details')}
                        className="w-full text-left px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-800 hover:text-white flex items-center gap-2 transition-colors"
                      >
                        <FileEdit size={16} className="text-indigo-500" />
                        Editar Usuário
                      </button>
                      <button 
                        onClick={() => handleOpenModal(user, 'edit', 'permissions')}
                        className="w-full text-left px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-800 hover:text-white flex items-center gap-2 transition-colors"
                      >
                        <Shield size={16} className="text-purple-500" />
                        Permissões
                      </button>
                      <button 
                        onClick={() => handleOpenModal(user, 'edit', 'clients')}
                        className="w-full text-left px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-800 hover:text-white flex items-center gap-2 transition-colors"
                      >
                        <UsersIcon size={16} className="text-emerald-500" />
                        Gerenciar Clientes
                      </button>
                      <div className="h-px bg-gray-800 my-1"></div>
                      <button 
                        onClick={() => handleDeleteUser(user.id)}
                        className="w-full text-left px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 flex items-center gap-2 transition-colors"
                      >
                        <X size={16} />
                        Excluir
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            )))}
          </tbody>
        </table>
        
        {/* Backdrop for menu */}
        {activeMenu && (
          <div className="fixed inset-0 z-40 bg-transparent" onClick={() => setActiveMenu(null)}></div>
        )}
      </div>

      {/* Modal Placeholder (Visual apenas) */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-2xl shadow-2xl">
            <div className="p-6 border-b border-gray-800 bg-gray-900/50 rounded-t-2xl">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <User size={20} className="text-indigo-500" />
                  {modalMode === 'create' ? 'Novo Usuário' : 'Editar Usuário'}
                </h2>
                <button 
                  onClick={() => setIsModalOpen(false)} 
                  className="text-gray-400 hover:text-white transition-colors p-1 hover:bg-gray-800 rounded-lg"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Tabs */}
              <div className="flex gap-6">
                <button 
                  onClick={() => setActiveTab('details')}
                  className={`pb-3 text-sm font-medium transition-colors relative ${
                    activeTab === 'details' 
                      ? 'text-indigo-500 after:absolute after:bottom-0 after:left-0 after:w-full after:h-0.5 after:bg-indigo-500' 
                      : 'text-gray-400 hover:text-gray-300'
                  }`}
                >
                  Dados do Usuário
                </button>
                <button 
                  onClick={() => setActiveTab('permissions')}
                  className={`pb-3 text-sm font-medium transition-colors relative ${
                    activeTab === 'permissions' 
                      ? 'text-indigo-500 after:absolute after:bottom-0 after:left-0 after:w-full after:h-0.5 after:bg-indigo-500' 
                      : 'text-gray-400 hover:text-gray-300'
                  }`}
                >
                  Permissões
                </button>
                <button 
                  onClick={() => setActiveTab('clients')}
                  className={`pb-3 text-sm font-medium transition-colors relative ${
                    activeTab === 'clients' 
                      ? 'text-indigo-500 after:absolute after:bottom-0 after:left-0 after:w-full after:h-0.5 after:bg-indigo-500' 
                      : 'text-gray-400 hover:text-gray-300'
                  }`}
                >
                  Clientes Vinculados
                </button>
              </div>
            </div>
            
            <div className="p-8">
              {editingUser && (
                <div className="mb-6 p-4 bg-gray-950/50 rounded-lg border border-gray-800 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center text-indigo-400 font-bold">
                    {editingUser.name.charAt(0)}
                  </div>
                  <div>
                    <p className="font-medium text-white">{editingUser.name}</p>
                    <p className="text-xs text-gray-500">{editingUser.email}</p>
                  </div>
                </div>
              )}

              {/* DETAILS TAB */}
              {activeTab === 'details' && (
                <div className="grid grid-cols-2 gap-6 mb-8">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-400 flex items-center gap-2">
                        <User size={14} /> Nome Completo
                      </label>
                      <input 
                        type="text" 
                        value={formData.name}
                        onChange={(e) => setFormData({...formData, name: e.target.value})}
                        className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-3 text-white outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all placeholder-gray-600" 
                        placeholder="Ex: João Silva" 
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-400 flex items-center gap-2">
                        <Mail size={14} /> Email Corporativo
                      </label>
                      <input 
                        type="email" 
                        value={formData.email}
                        onChange={(e) => setFormData({...formData, email: e.target.value})}
                        className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-3 text-white outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all placeholder-gray-600" 
                        placeholder="Ex: joao@empresa.com" 
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-400 flex items-center gap-2">
                        <Lock size={14} /> Senha {modalMode === 'edit' && '(Opcional)'}
                      </label>
                      <div className="space-y-1">
                        <div className="relative">
                          <input 
                            type={showPassword ? "text" : "password"} 
                            value={formData.password}
                            onChange={(e) => setFormData({...formData, password: e.target.value})}
                            className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-3 text-white outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all placeholder-gray-600 pr-10" 
                            placeholder="••••••••" 
                          />
                          <button 
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors"
                          >
                            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                          </button>
                        </div>
                        {modalMode === 'create' && (
                          <p className="text-[11px] text-emerald-500/80 font-medium ml-1">
                            * Alteração obrigatória no primeiro acesso
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-400 flex items-center gap-2">
                        <Shield size={14} /> Perfil
                      </label>
                      <div className="relative">
                        <select 
                          value={formData.role}
                          onChange={(e) => setFormData({...formData, role: e.target.value as any})}
                          className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-3 text-white outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all appearance-none cursor-pointer"
                        >
                          <option value="client">Cliente</option>
                          <option value="admin">Administrador</option>
                        </select>
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500">
                          <ArrowDown size={14} />
                        </div>
                      </div>
                    </div>
                </div>
              )}

              {/* PERMISSIONS TAB */}
              {activeTab === 'permissions' && (
                <div className="border border-gray-800 rounded-xl bg-gray-950/50 overflow-hidden mb-8">
                  <div className="p-4 bg-gray-900/50 border-b border-gray-800">
                    <h3 className="text-sm font-bold text-indigo-400 flex items-center gap-2">
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
                          <p className="text-xs text-gray-500">Alterar configurações do usuário</p>
                        </div>
                      </div>
                      <Toggle checked={perms.manage_settings} onChange={() => togglePerm('manage_settings')} />
                    </div>
                  </div>
                </div>
              )}

              {/* CLIENTS TAB */}
              {activeTab === 'clients' && (
                <div className="space-y-2 relative mb-8">
                  <label className="text-sm font-medium text-gray-400 flex items-center gap-2">
                    <Building size={14} /> Vincular Clientes
                  </label>
                  
                  <div 
                    onClick={() => setIsClientDropdownOpen(!isClientDropdownOpen)}
                    className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-3 text-white cursor-pointer flex justify-between items-center hover:border-gray-700 transition-colors"
                  >
                    <span className={selectedClientIds.length === 0 ? "text-gray-600" : "text-white"}>
                      {selectedClientIds.length === 0 
                        ? "Nenhum (Acesso Global)" 
                        : `${selectedClientIds.length} cliente(s) selecionado(s)`}
                    </span>
                    <ArrowDown size={14} className={`text-gray-500 transition-transform ${isClientDropdownOpen ? 'rotate-180' : ''}`} />
                  </div>

                  {isClientDropdownOpen && (
                    <div className="absolute top-full left-0 w-full mt-2 bg-gray-900 border border-gray-800 rounded-xl shadow-xl z-50 overflow-hidden max-h-48 overflow-y-auto">
                      <div 
                        onClick={() => {
                          if (selectedClientIds.length === availableClients.length) {
                            setSelectedClientIds([]);
                          } else {
                            setSelectedClientIds(availableClients.map(c => c.id));
                          }
                        }}
                        className="px-4 py-3 hover:bg-gray-800 cursor-pointer flex items-center gap-3 transition-colors border-b border-gray-800 bg-gray-900/50 sticky top-0 backdrop-blur-sm z-10"
                      >
                        {selectedClientIds.length === availableClients.length && availableClients.length > 0
                          ? <CheckSquare size={18} className="text-indigo-500" />
                          : <Square size={18} className="text-gray-600" />
                        }
                        <span className={selectedClientIds.length === availableClients.length && availableClients.length > 0 ? "text-white font-medium" : "text-gray-400"}>
                          Selecionar Todos
                        </span>
                      </div>
                      {availableClients.map(client => (
                        <div 
                          key={client.id}
                          onClick={() => toggleClientSelection(client.id)}
                          className="px-4 py-3 hover:bg-gray-800 cursor-pointer flex items-center gap-3 transition-colors border-b border-gray-800/50 last:border-0"
                        >
                          {selectedClientIds.includes(client.id) 
                            ? <CheckSquare size={18} className="text-indigo-500" />
                            : <Square size={18} className="text-gray-600" />
                          }
                          <span className={selectedClientIds.includes(client.id) ? "text-white font-medium" : "text-gray-400"}>
                            {client.name}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {/* Backdrop for dropdown */}
                  {isClientDropdownOpen && (
                    <div className="fixed inset-0 z-40 bg-transparent" onClick={() => setIsClientDropdownOpen(false)}></div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-800">
                <button 
                  onClick={() => setIsModalOpen(false)}
                  className="px-6 py-2.5 rounded-xl text-gray-400 hover:text-white hover:bg-gray-800 transition-colors font-medium"
                >
                  Cancelar
                </button>
                <button 
                  onClick={() => handleSaveUser()}
                  className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl transition-all shadow-lg shadow-indigo-900/20 hover:shadow-indigo-900/40 transform hover:-translate-y-0.5"
                >
                  {modalMode === 'create' ? 'Cadastrar Usuário' : 'Salvar Alterações'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}