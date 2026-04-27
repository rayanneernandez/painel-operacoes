import { useState, useEffect } from 'react';
import supabase from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Search, Plus, User, Mail, Shield, Building, MoreVertical, ArrowDown, X, Lock, Unlock, Eye, EyeOff, CheckSquare, Square, Settings, Users as UsersIcon, FileEdit, BarChart2, Download, FileText, Wifi, Calendar, Clock, AlertTriangle } from 'lucide-react';

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
  client_id?: string | null;
  clients: Client[]; // sempre um array (pode ser vazio)
  status?: 'active' | 'inactive';
  last_login: string | null;
  // Bloqueio agendado — preenchido pelo modal "Bloquear Acesso"
  block_starts_at?: string | null;
  block_ends_at?: string | null;
  block_reason?: string | null;
  blocked_at?: string | null;
  blocked_by?: string | null;
  permissions: {
    view_dashboard: boolean;
    view_devices_online: boolean;
    view_reports: boolean;
    view_analytics: boolean;
    export_data: boolean;
    manage_settings: boolean;
  };
};

// Espelha a lógica do AuthContext.assertAccessAllowed para mostrar badge na lista.
function isUserStatusBlocked(status: unknown): boolean {
  const normalized = String(status || '').trim().toLowerCase();
  return ['inactive', 'inativo', 'blocked', 'bloqueado', 'suspended', 'suspenso'].includes(normalized);
}

function isWithinBlockWindow(startsAt?: string | null, endsAt?: string | null, now: Date = new Date()): boolean {
  const startMs = startsAt ? Date.parse(startsAt) : NaN;
  const endMs = endsAt ? Date.parse(endsAt) : NaN;
  const nowMs = now.getTime();
  if (!Number.isFinite(startMs) && !Number.isFinite(endMs)) return false;
  if (Number.isFinite(endMs) && nowMs >= endMs) return false;
  if (Number.isFinite(startMs) && nowMs < startMs) return false;
  return true;
}

function getBlockState(user: UserType, now: Date = new Date()) {
  const statusBlocked = isUserStatusBlocked(user.status);
  const windowActive = isWithinBlockWindow(user.block_starts_at, user.block_ends_at, now);
  const startMs = user.block_starts_at ? Date.parse(user.block_starts_at) : NaN;
  const scheduledFuture =
    Number.isFinite(startMs) && now.getTime() < startMs && !statusBlocked;
  return {
    isBlockedNow: statusBlocked || windowActive,
    isScheduledFuture: scheduledFuture,
  };
}

// Converte ISO (UTC) para o formato esperado pelo input datetime-local (YYYY-MM-DDTHH:mm).
function isoToLocalInput(value?: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Converte string de datetime-local (interpretado no fuso local do browser) para ISO UTC.
function localInputToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function Users() {
  const { user: authedUser } = useAuth();
  const [users, setUsers] = useState<UserType[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<UserType | null>(null);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [activeTab, setActiveTab] = useState<'details' | 'permissions' | 'clients'>('details');

  // ── Modal de bloqueio agendado ──────────────────────────────────────────
  const [blockModalUser, setBlockModalUser] = useState<UserType | null>(null);
  const [blockMode, setBlockMode] = useState<'now' | 'schedule'>('now');
  const [blockStartsAt, setBlockStartsAt] = useState('');   // datetime-local
  const [blockEndsAt, setBlockEndsAt] = useState('');       // datetime-local
  const [blockReason, setBlockReason] = useState('');
  const [savingBlock, setSavingBlock] = useState(false);

  // Estado de permissões (mock)
  const [perms, setPerms] = useState({
    view_dashboard: true,
    view_devices_online: false,
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
    status: 'active' as 'active' | 'inactive',
    password: ''
  });

  // Estado para clientes disponíveis
  const [availableClients, setAvailableClients] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const clients = await fetchClients();
      if (cancelled) return;
      await fetchUsers(clients);
    };

    void run();
    return () => { cancelled = true; };
  }, []);

  const fetchClients = async () => {
    try {
      const { data, error } = await supabase.from('clients').select('id, name');
      if (error) throw error;
      const list = data || [];
      setAvailableClients(list);
      return list;
    } catch (error) {
      console.error('Erro ao buscar clientes:', error);
      setAvailableClients([]);
      return [] as { id: string; name: string }[];
    }
  };

  const fetchUsers = async (clients?: { id: string; name: string }[]) => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('users')
        .select('*');
      
      if (error) throw error;

      const clientList = clients ?? availableClients;
      const formattedUsers: UserType[] = (data || []).map((user: any) => {
        const linkedClient = user.client_id
          ? clientList.find(c => c.id === user.client_id)
          : undefined;
        return {
          ...user,
          clients: linkedClient ? [linkedClient] : []
        };
      });

      setUsers(formattedUsers);
    } catch (error) {
      console.error('Erro ao buscar usuários:', error);
    } finally {
      setLoading(false);
    }
  };

  // Estado para seleção múltipla de clientes no modal
  const [selectedClientIds, setSelectedClientIds] = useState<string[]>([]);
  const [isClientDropdownOpen, setIsClientDropdownOpen] = useState(false);

  const handleOpenModal = (user?: UserType, mode: 'create' | 'edit' = 'create', initialTab: 'details' | 'permissions' | 'clients' = 'details') => {
    setModalMode(mode);
    setActiveTab(initialTab);
    if (user) {
      setEditingUser(user);
      setFormData({
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status || 'active',
        password: ''
      });
      setSelectedClientIds(user.client_id ? [user.client_id] : user.clients.map(c => c.id));
      const p = user.permissions || {
        view_dashboard: true,
        view_devices_online: false,
        view_reports: false,
        view_analytics: false,
        export_data: false,
        manage_settings: false
      };
      setPerms({
        view_dashboard: p.view_dashboard ?? true,
        view_devices_online: p.view_devices_online ?? false,
        view_reports: p.view_reports ?? false,
        view_analytics: p.view_analytics ?? false,
        export_data: p.export_data ?? false,
        manage_settings: p.manage_settings ?? false
      });
    } else {
      setEditingUser(null);
      setFormData({
        name: '',
        email: '',
        role: 'client',
        status: 'active',
        password: ''
      });
      setSelectedClientIds([]);
      setPerms({
        view_dashboard: true,
        view_devices_online: false,
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

  // ── Bloqueio agendado: abre modal preenchendo com o estado atual do usuário ─
  const handleOpenBlockModal = (user: UserType) => {
    setBlockModalUser(user);
    setBlockReason(user.block_reason || '');
    // Se já tem janela definida, abre em modo "schedule" com os valores; senão, "now".
    if (user.block_starts_at || user.block_ends_at) {
      setBlockMode('schedule');
      setBlockStartsAt(isoToLocalInput(user.block_starts_at));
      setBlockEndsAt(isoToLocalInput(user.block_ends_at));
    } else {
      setBlockMode('now');
      setBlockStartsAt('');
      setBlockEndsAt('');
    }
    setActiveMenu(null);
  };

  const handleCloseBlockModal = () => {
    setBlockModalUser(null);
    setBlockMode('now');
    setBlockStartsAt('');
    setBlockEndsAt('');
    setBlockReason('');
    setSavingBlock(false);
  };

  // Aplica o bloqueio escolhido (imediato ou agendado) no banco.
  // IMPORTANTE: Em users NÃO mexemos na coluna `status` (pode não existir nessa
  // instalação). Usamos só a janela block_starts_at / block_ends_at — o
  // AuthContext.assertAccessAllowed considera "bloqueado agora" se now() está
  // dentro da janela. Isso cobre tanto "Bloquear Agora" (start = now, end = null)
  // quanto agendamentos futuros.
  const handleSaveBlock = async () => {
    if (!blockModalUser) return;
    try {
      setSavingBlock(true);

      let startsIso: string | null = null;
      let endsIso: string | null = null;

      if (blockMode === 'now') {
        // Bloqueio imediato indefinido — janela começa agora, sem fim.
        startsIso = new Date().toISOString();
        endsIso = null;
      } else {
        startsIso = localInputToIso(blockStartsAt);
        endsIso = localInputToIso(blockEndsAt);
        if (!startsIso && !endsIso) {
          alert('Defina pelo menos uma data — início ou fim do bloqueio.');
          setSavingBlock(false);
          return;
        }
        if (startsIso && endsIso && Date.parse(endsIso) <= Date.parse(startsIso)) {
          alert('A data de fim precisa ser posterior à data de início.');
          setSavingBlock(false);
          return;
        }
      }

      const payload: any = {
        block_starts_at: startsIso,
        block_ends_at: endsIso,
        block_reason: blockReason.trim() || null,
        blocked_at: new Date().toISOString(),
        blocked_by: authedUser?.id || null,
      };

      const { error } = await supabase
        .from('users')
        .update(payload)
        .eq('id', blockModalUser.id);

      if (error) throw error;

      // Atualiza estado local sem refetch.
      setUsers(prev => prev.map(u => u.id === blockModalUser.id ? { ...u, ...payload } : u));
      handleCloseBlockModal();
    } catch (error) {
      console.error('Erro ao bloquear usuário:', error);
      alert('Erro ao bloquear usuário: ' + (error as any).message);
      setSavingBlock(false);
    }
  };

  // Limpa bloqueio — só zera a janela, sem tocar no status.
  const handleClearBlock = async (user: UserType) => {
    if (!confirm(`Liberar acesso de ${user.name}?`)) return;
    try {
      const payload: any = {
        block_starts_at: null,
        block_ends_at: null,
        block_reason: null,
        blocked_at: null,
        blocked_by: null,
      };
      const { error } = await supabase.from('users').update(payload).eq('id', user.id);
      if (error) throw error;
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, ...payload } : u));
      setActiveMenu(null);
    } catch (error) {
      console.error('Erro ao desbloquear usuário:', error);
      alert('Erro ao desbloquear usuário: ' + (error as any).message);
    }
  };

  const handleSaveUser = async () => {
    try {
      // Não enviamos `status` no save do form — o bloqueio é controlado exclusivamente
      // pelo modal de "Bloquear Acesso" (campos block_starts_at / block_ends_at).
      // Isso evita exigir a coluna `status` na tabela users do Supabase.
      const payload: any = {
        name: formData.name,
        email: formData.email,
        role: formData.role,
        permissions: perms,
        // Assuming single client relationship via client_id for now based on common patterns
        // If supporting multiple clients, this logic needs to be adjusted based on DB schema
        client_id: formData.role === 'client' && selectedClientIds.length > 0 ? selectedClientIds[0] : null
      };
      
      if (formData.password) {
        payload.password_hash = formData.password;
      }

      if (editingUser) {
        const { error } = await supabase
          .from('users')
          .update(payload)
          .eq('id', editingUser.id);

        if (error) throw error;
      } else {
        if (!formData.password) {
          alert('Senha é obrigatória para novos usuários');
          return;
        }

        // payload.status = 'active';
        // payload.last_login = null;
        payload.id = crypto.randomUUID();

        const { error } = await supabase.from('users').insert([payload]);
        if (error) throw error;
      }
      
      await fetchUsers();
      setIsModalOpen(false);
    } catch (error) {
      console.error('Erro ao salvar usuário:', error);
      alert('Erro ao salvar usuário: ' + (error as any).message);
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
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-white">{user.name}</p>
                        {(() => {
                          const { isBlockedNow, isScheduledFuture } = getBlockState(user);
                          if (isBlockedNow) {
                            return (
                              <span title={user.block_reason || 'Acesso bloqueado'} className="px-1.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-red-500/15 text-red-400 border border-red-500/30 inline-flex items-center gap-1">
                                <Lock size={10} /> Bloqueado
                              </span>
                            );
                          }
                          if (isScheduledFuture) {
                            return (
                              <span title={`Bloqueio agendado para ${new Date(user.block_starts_at!).toLocaleString('pt-BR')}`} className="px-1.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-amber-500/15 text-amber-400 border border-amber-500/30 inline-flex items-center gap-1">
                                <Clock size={10} /> Agendado
                              </span>
                            );
                          }
                          return null;
                        })()}
                      </div>
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
                <td className="p-4 text-sm text-gray-500">
                  {user.last_login 
                    ? new Date(user.last_login.endsWith('Z') || user.last_login.includes('+') ? user.last_login : user.last_login + 'Z').toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) 
                    : 'Nunca'}
                </td>
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
                      {(() => {
                        const { isBlockedNow, isScheduledFuture } = getBlockState(user);
                        const hasAnyBlock = isBlockedNow || isScheduledFuture;
                        return (
                          <>
                            <button
                              onClick={() => handleOpenBlockModal(user)}
                              className="w-full text-left px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-800 hover:text-white flex items-center gap-2 transition-colors"
                            >
                              <Lock size={16} className="text-amber-500" />
                              {hasAnyBlock ? 'Editar Bloqueio' : 'Bloquear Acesso'}
                            </button>
                            {hasAnyBlock && (
                              <button
                                onClick={() => handleClearBlock(user)}
                                className="w-full text-left px-4 py-2.5 text-sm text-emerald-400 hover:bg-emerald-500/10 flex items-center gap-2 transition-colors"
                              >
                                <Unlock size={16} />
                                Liberar Acesso
                              </button>
                            )}
                          </>
                        );
                      })()}
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
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-2xl shadow-2xl max-h-[90vh] flex flex-col overflow-hidden">
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
            
            <div className="p-8 overflow-y-auto flex-1 min-h-0">
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
                          <Wifi size={20} />
                        </div>
                        <div>
                          <p className="font-medium text-white text-sm">Dispositivos Online</p>
                          <p className="text-xs text-gray-500">Acesso à rede/lojas/dispositivos e status</p>
                        </div>
                      </div>
                      <Toggle checked={perms.view_devices_online} onChange={() => togglePerm('view_devices_online')} />
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

              <div className="mt-6 pt-4 border-t border-gray-800 flex items-center justify-end gap-3">
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

      {/* ── Modal de Bloqueio Agendado ─────────────────────────────────── */}
      {blockModalUser && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-lg shadow-2xl flex flex-col overflow-hidden">
            <div className="p-6 border-b border-gray-800 bg-gray-900/50">
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
                    <Lock size={18} className="text-amber-400" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-white">Bloquear Acesso</h2>
                    <p className="text-xs text-gray-500">{blockModalUser.name} · {blockModalUser.email}</p>
                  </div>
                </div>
                <button
                  onClick={handleCloseBlockModal}
                  className="text-gray-400 hover:text-white transition-colors p-1 hover:bg-gray-800 rounded-lg"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-5">
              {/* Modo: agora vs agendado */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setBlockMode('now')}
                  className={`px-3 py-3 rounded-xl border text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                    blockMode === 'now'
                      ? 'bg-red-500/15 border-red-500/40 text-red-300'
                      : 'bg-gray-950 border-gray-800 text-gray-400 hover:text-white hover:border-gray-700'
                  }`}
                >
                  <Lock size={14} /> Bloquear Agora
                </button>
                <button
                  type="button"
                  onClick={() => setBlockMode('schedule')}
                  className={`px-3 py-3 rounded-xl border text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                    blockMode === 'schedule'
                      ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                      : 'bg-gray-950 border-gray-800 text-gray-400 hover:text-white hover:border-gray-700'
                  }`}
                >
                  <Calendar size={14} /> Programar
                </button>
              </div>

              {/* Campos de data — só aparecem em modo schedule */}
              {blockMode === 'schedule' && (
                <div className="grid grid-cols-1 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-gray-400 flex items-center gap-1.5">
                      <Calendar size={12} /> Início do bloqueio (opcional)
                    </label>
                    <input
                      type="datetime-local"
                      value={blockStartsAt}
                      onChange={(e) => setBlockStartsAt(e.target.value)}
                      className="w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2.5 text-white text-sm outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all"
                    />
                    <p className="text-[10px] text-gray-500">Vazio = começa imediatamente.</p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-gray-400 flex items-center gap-1.5">
                      <Clock size={12} /> Fim do bloqueio (opcional)
                    </label>
                    <input
                      type="datetime-local"
                      value={blockEndsAt}
                      onChange={(e) => setBlockEndsAt(e.target.value)}
                      className="w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2.5 text-white text-sm outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all"
                    />
                    <p className="text-[10px] text-gray-500">Vazio = bloqueio indefinido até liberação manual.</p>
                  </div>
                </div>
              )}

              {/* Motivo */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-400">Motivo (opcional, para auditoria)</label>
                <input
                  type="text"
                  value={blockReason}
                  onChange={(e) => setBlockReason(e.target.value)}
                  placeholder="Ex: inadimplência - aguardando pagamento"
                  className="w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2.5 text-white text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all placeholder-gray-600"
                />
              </div>

              {/* Aviso */}
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 flex items-start gap-2">
                <AlertTriangle size={14} className="text-amber-400 mt-0.5 flex-shrink-0" />
                <p className="text-[11px] text-amber-200/90 leading-relaxed">
                  O usuário verá: <span className="italic">"Seu perfil encontra-se bloqueado para uso, favor entrar em contato com o administrador."</span>
                </p>
              </div>
            </div>

            <div className="p-4 border-t border-gray-800 bg-gray-900/40 flex items-center justify-end gap-2">
              <button
                onClick={handleCloseBlockModal}
                disabled={savingBlock}
                className="px-4 py-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors text-sm font-medium disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveBlock}
                disabled={savingBlock}
                className="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-gray-950 font-bold rounded-lg transition-all text-sm disabled:opacity-50 inline-flex items-center gap-2"
              >
                {savingBlock ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-gray-950/30 border-t-gray-950 rounded-full animate-spin" />
                    Salvando...
                  </>
                ) : (
                  <>
                    <Lock size={14} /> Confirmar Bloqueio
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}