import { useEffect } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import {
  LayoutDashboard,
  Users,
  Shield,
  Settings,
  LogOut,
  FileText,
  History,
  Wifi,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import globaliaLogo from '../assets/globalia.png';

export function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout, user } = useAuth();

  useEffect(() => {
    document.documentElement.classList.add('dark');
    localStorage.setItem('theme', 'dark');
  }, []);

  const menuItems = [
    { 
      icon: LayoutDashboard, 
      label: 'Visão Geral', 
      path: user?.role === 'client'
        ? (user?.clientId ? `/clientes/${user.clientId}/dashboard` : '/')
        : '/dashboard',
      show: user?.role === 'admin' || (user?.permissions?.view_dashboard ?? true)
    },
    { 
      icon: Wifi, 
      label: 'Dispositivos Online', 
      path: '/dispositivos-online',
      show: user?.role === 'admin' || (user?.permissions?.view_devices_online ?? false)
    },
    { 
      icon: Users, 
      label: 'Clientes', 
      path: '/clientes',
      show: user?.role === 'admin' 
    },
    { 
      icon: Shield, 
      label: 'Usuários', 
      path: '/usuarios',
      show: user?.role === 'admin' 
    },
    { 
      icon: History, 
      label: 'Logs de Acesso', 
      path: '/logs',
      show: user?.role === 'admin' 
    },
    { 
      icon: FileText, 
      label: 'Relatórios', 
      path: '/relatorios',
      // Garante que só aparece se a permissão for explicitamente true
      show: user?.role === 'admin' || (user?.permissions?.view_reports ?? false)
    },
    { 
      icon: Settings, 
      label: 'Configurações', 
      path: user?.role === 'client' && user?.clientId
        ? `/clientes/${user.clientId}/dashboard-config`
        : '/configuracoes',
      show: user?.role === 'admin' || (user?.role === 'client' && !!user?.clientId) || (user?.permissions?.manage_settings ?? false)
    },
  ];

  // Filtro rigoroso: remove itens undefined ou false
  const visibleMenuItems = menuItems.filter(item => !!item.show);

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 overflow-hidden font-sans transition-colors duration-300">
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 flex flex-col transition-colors duration-300">
        {/* Logo Area */}
        <div className="p-6 flex items-center gap-3">
          <div>
            <img src={globaliaLogo} alt="Global IA" className="h-8 w-auto mb-1" />
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-4 py-4 space-y-1">
          {visibleMenuItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname.startsWith(item.path);
            
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
                  isActive 
                    ? "bg-emerald-50 dark:bg-gray-800 text-emerald-600 dark:text-emerald-400 border-l-2 border-emerald-500 pl-[10px]" 
                    : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-900 hover:text-gray-900 dark:hover:text-gray-200"
                )}
              >
                <Icon size={18} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* User Profile / Logout */}
        <div className="p-4 border-t border-gray-200 dark:border-gray-800">
          <div className="flex items-center justify-between mb-4 px-2">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-white font-bold text-xs">
                {user?.name?.charAt(0).toUpperCase() || 'U'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{user?.name || 'Usuário'}</p>
                <p className="text-xs text-gray-500 truncate">{user?.email || ''}</p>
              </div>
            </div>

          </div>
          <button 
            onClick={() => {
              logout();
              navigate('/login');
            }}
            className="w-full flex items-center gap-2 px-2 py-2 text-sm text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
          >
            <LogOut size={16} />
            Sair
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto bg-gray-50 dark:bg-gray-950 relative transition-colors duration-300">
        <div className="p-8 max-w-7xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}