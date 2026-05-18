import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { logService } from '@/services/logService';
import supabase from '@/lib/supabase';
import {
  LayoutDashboard,
  Users,
  Shield,
  Settings,
  LogOut,
  FileText,
  History,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Wifi,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import globaliaLogo from '../assets/globalia.png';
import globaliaLogoLight from '../assets/globalia-light.png';

export function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout, user } = useAuth();

  const navStateRef = useRef<{ path: string; atMs: number } | null>(null);
  const pathRef = useRef<string>('');
  const lastClickAtRef = useRef<number>(0);
  const [isMobileMenu, setIsMobileMenu] = useState(() => {
    try { return typeof window !== 'undefined' && window.innerWidth < 1024; } catch { return false; }
  });
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try {
      if (typeof window !== 'undefined' && window.innerWidth < 1024) return false;
      const saved = localStorage.getItem('sidebar-open');
      if (saved === 'false') return false;
      return true;
    } catch {
      return true;
    }
  });
  const [appTheme, setAppTheme] = useState<'dark' | 'light'>(() => {
    try { return localStorage.getItem('app-theme') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
  });
  const applyTheme = (value: string | null) => {
    const theme = value === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.appTheme = theme;
    document.documentElement.classList.toggle('dark', theme === 'dark');
    setAppTheme(theme);
  };

  useEffect(() => {
    applyTheme(localStorage.getItem('app-theme') || localStorage.getItem('theme'));
    const onThemeChange = (event: Event) => {
      const theme = (event as CustomEvent<{ theme?: string }>).detail?.theme;
      applyTheme(theme || localStorage.getItem('app-theme') || localStorage.getItem('theme'));
    };
    window.addEventListener('app-theme-change', onThemeChange);
    return () => window.removeEventListener('app-theme-change', onThemeChange);
  }, []);

  useEffect(() => {
    if (isMobileMenu) return;
    try { localStorage.setItem('sidebar-open', sidebarOpen ? 'true' : 'false'); } catch { /* noop */ }
  }, [isMobileMenu, sidebarOpen]);

  useEffect(() => {
    const onResize = () => {
      const mobile = window.innerWidth < 1024;
      setIsMobileMenu(mobile);
      if (mobile) {
        setSidebarOpen(false);
      } else {
        setSidebarOpen(localStorage.getItem('sidebar-open') !== 'false');
      }
    };
    window.addEventListener('resize', onResize);
    onResize();
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const localTheme = localStorage.getItem('app-theme') || localStorage.getItem('theme');
    if (localTheme === 'light' || localTheme === 'dark') {
      applyTheme(localTheme);
      return () => { cancelled = true; };
    }
    const readTheme = (cfg: any) => {
      const raw = String(cfg?.theme || cfg?.dashboard_theme || '').toLowerCase();
      return raw === 'light' || raw === 'dark' ? raw : null;
    };
    const fetchConfigTheme = async () => {
      if (!user) return;
      try {
        let cfg: any = null;
        if (user.role === 'client' && user.clientId) {
          const { data } = await supabase
            .from('dashboard_configs')
            .select('widgets_config, updated_at')
            .eq('layout_name', 'client')
            .eq('client_id', user.clientId)
            .order('updated_at', { ascending: false })
            .limit(1);
          cfg = data?.[0]?.widgets_config ?? null;
        }
        if (!cfg) {
          const { data } = await supabase
            .from('dashboard_configs')
            .select('widgets_config, updated_at')
            .eq('layout_name', 'global')
            .is('client_id', null)
            .order('updated_at', { ascending: false })
            .limit(1);
          cfg = data?.[0]?.widgets_config ?? null;
        }
        const theme = readTheme(cfg);
        if (!cancelled && theme) {
          localStorage.setItem('app-theme', theme);
          localStorage.setItem('theme', theme);
          applyTheme(theme);
          window.dispatchEvent(new CustomEvent('dashboard-theme-change', { detail: { theme } }));
        }
      } catch {
        // Mantem o tema local se a configuracao remota falhar.
      }
    };
    void fetchConfigTheme();
    return () => { cancelled = true; };
  }, [user?.role, user?.clientId]);

  useEffect(() => {
    pathRef.current = `${location.pathname}${location.search || ''}`;
  }, [location.pathname, location.search]);

  useEffect(() => {
    const email = user?.email;
    if (!email) return;

    const nowMs = Date.now();
    const currentPath = `${location.pathname}${location.search || ''}`;

    const prev = navStateRef.current;
    navStateRef.current = { path: currentPath, atMs: nowMs };

    if (!prev) {
      void logService.logAction(email, 'VIEW', `Entrou: ${currentPath}`, 'network', currentPath, {
        type: 'page_enter',
        to: currentPath,
        at: new Date(nowMs).toISOString(),
      });
      return;
    }

    if (prev.path === currentPath) return;

    const durationMs = Math.max(0, nowMs - prev.atMs);
    void logService.logAction(email, 'VIEW', `Navegou: ${prev.path}  ${currentPath}`, 'network', currentPath, {
      type: 'navigate',
      from: prev.path,
      to: currentPath,
      duration_ms: durationMs,
      duration_seconds: Math.round(durationMs / 1000),
      at: new Date(nowMs).toISOString(),
    });
  }, [location.pathname, location.search, user?.email]);

  useEffect(() => {
    const email = user?.email;
    if (!email) return;

    const handler = (ev: MouseEvent) => {
      const nowMs = Date.now();
      if (nowMs - lastClickAtRef.current < 800) return;

      const target = ev.target;
      if (!(target instanceof Element)) return;

      const tag = target.tagName?.toLowerCase?.() || '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      const el = (target.closest('a,button,[role="button"],[data-track-click]') as Element | null) || target;
      if (!el) return;

      const elTag = el.tagName?.toLowerCase?.() || '';
      const elId = (el as HTMLElement).id ? `#${(el as HTMLElement).id}` : '';
      const elClassRaw = (el as HTMLElement).className;
      const elClasses = typeof elClassRaw === 'string'
        ? elClassRaw.split(' ').filter(Boolean).slice(0, 3).map((c) => `.${c}`).join('')
        : '';
      const selector = `${elTag}${elId}${elClasses}`.trim() || elTag || 'element';

      const aria = (el as HTMLElement).getAttribute?.('aria-label') || '';
      const title = (el as HTMLElement).getAttribute?.('title') || '';
      const track = (el as HTMLElement).getAttribute?.('data-track-click') || '';

      let text = '';
      if (!aria && !title && !track) {
        const rawText = (el as HTMLElement).innerText || '';
        text = rawText.replace(/\s+/g, ' ').trim().slice(0, 80);
      }

      const label = (track || aria || title || text || selector).trim().slice(0, 120);
      const href = el instanceof HTMLAnchorElement ? (el.getAttribute('href') || '') : '';

      lastClickAtRef.current = nowMs;

      void logService.logAction(email, 'VIEW', `Clique: ${label}`, 'network', pathRef.current, {
        type: 'click',
        path: pathRef.current,
        element: { selector, tag: elTag },
        href: href || null,
        at: new Date(nowMs).toISOString(),
      });
    };

    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }, [user?.email]);

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
      icon: MessageSquare,
      label: 'Alertas WhatsApp',
      path: '/alertas-whatsapp',
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
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Fechar menu"
          className="fixed inset-0 z-30 bg-gray-950/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed lg:static inset-y-0 left-0 z-40 w-64 flex-shrink-0 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 flex flex-col transition-transform duration-300",
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:hidden"
        )}
      >
        {/* Logo Area */}
        <div className="p-6 flex items-center justify-between gap-3">
          <div>
            <img src={appTheme === 'light' ? globaliaLogoLight : globaliaLogo} alt="Global IA" className="h-8 w-auto mb-1" />
          </div>
          <button
            type="button"
            onClick={() => {
              if (!isMobileMenu) localStorage.setItem('sidebar-open', 'false');
              setSidebarOpen(false);
            }}
            aria-label="Ocultar menu"
            title="Ocultar menu"
            className="h-9 w-9 rounded-lg border border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-900 hover:text-gray-950 dark:hover:text-white transition-colors flex items-center justify-center"
          >
            <PanelLeftClose size={18} />
          </button>
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
                onClick={() => { if (window.innerWidth < 1024) setSidebarOpen(false); }}
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
        {!sidebarOpen && (
          <button
            type="button"
            onClick={() => {
              if (!isMobileMenu) localStorage.setItem('sidebar-open', 'true');
              setSidebarOpen(true);
            }}
            aria-label="Abrir menu"
            title="Abrir menu"
            className="fixed left-4 top-4 z-30 h-10 w-10 rounded-xl border border-gray-200 dark:border-gray-800 bg-white/95 dark:bg-gray-950/95 text-gray-700 dark:text-gray-300 shadow-lg shadow-gray-900/5 hover:bg-gray-100 dark:hover:bg-gray-900 hover:text-gray-950 dark:hover:text-white transition-colors flex items-center justify-center"
          >
            <PanelLeftOpen size={19} />
          </button>
        )}
        <div className="p-4 pt-16 sm:p-6 sm:pt-16 lg:p-8 lg:pt-8 max-w-7xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
