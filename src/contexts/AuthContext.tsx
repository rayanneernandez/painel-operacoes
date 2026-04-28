import React, { createContext, useContext, useState, useEffect } from 'react';
import supabase from '../lib/supabase';
import { AuthUser, UserRole } from '../types';
import { logService } from '../services/logService';

interface AuthContextType {
  user: AuthUser | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
// Mensagem mostrada na tela de login quando o acesso é bloqueado (manual ou agendado).
// Exata como pedido no UX — não alterar sem combinar.
export const ACCESS_BLOCKED_MESSAGE =
  'Seu perfil encontra-se bloqueado para uso, favor entrar em contato com o administrador.';

function withTimeout<T>(promiseLike: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    Promise.resolve(promiseLike),
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`Timeout em ${label}`)), ms);
    }),
  ]);
}

function isBlockedStatus(status: unknown) {
  const normalized = String(status || '').trim().toLowerCase();
  return ['inactive', 'inativo', 'blocked', 'bloqueado', 'suspended', 'suspenso'].includes(normalized);
}

// Avalia se a janela agendada (block_starts_at / block_ends_at) está vigente AGORA.
// - Se starts_at é nulo, a janela só vale quando há ends_at e ainda não passou.
// - Se starts_at existe e já passou, bloqueia até o ends_at (ou indefinido).
function isWithinScheduledBlockWindow(
  startsAt: unknown,
  endsAt: unknown,
  now: Date = new Date(),
): boolean {
  const startMs = startsAt ? Date.parse(String(startsAt)) : NaN;
  const endMs = endsAt ? Date.parse(String(endsAt)) : NaN;
  const nowMs = now.getTime();

  // Sem nenhuma das duas datas = nada agendado.
  if (!Number.isFinite(startMs) && !Number.isFinite(endMs)) return false;

  // Se já tem ends_at e ele passou, o bloqueio expirou.
  if (Number.isFinite(endMs) && nowMs >= endMs) return false;

  // Se tem starts_at e ainda não chegou, ainda não vigora.
  if (Number.isFinite(startMs) && nowMs < startMs) return false;

  // Caiu na janela.
  return true;
}

// Decide se o registro (user OU client) está bloqueado considerando status + janela.
function isRecordBlocked(record: any, now: Date = new Date()): boolean {
  if (!record) return false;
  if (isBlockedStatus(record.status)) return true;
  return isWithinScheduledBlockWindow(record.block_starts_at, record.block_ends_at, now);
}

async function assertAccessAllowed(userRow: any) {
  if (isRecordBlocked(userRow)) {
    throw new Error(ACCESS_BLOCKED_MESSAGE);
  }

  if (userRow?.role === 'client' && userRow?.client_id) {
    const { data: clientData, error: clientError } = await withTimeout<{ data: any; error: any }>(
      supabase
        .from('clients')
        .select('id, name, status, block_starts_at, block_ends_at')
        .eq('id', userRow.client_id)
        .single() as any,
      8000,
      'auth client status'
    );

    if (clientError || !clientData || isRecordBlocked(clientData)) {
      throw new Error(ACCESS_BLOCKED_MESSAGE);
    }
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const defaultPermissions = {
      view_dashboard: true,
      view_devices_online: false,
      view_reports: false,
      view_analytics: false,
      export_data: false,
      manage_settings: false
    };

    const run = async () => {
      const savedUser = localStorage.getItem('auth_user');
      if (!savedUser) {
        if (!cancelled) setIsLoading(false);
        return;
      }

      let parsed: any = null;
      try {
        parsed = JSON.parse(savedUser);
      } catch {
        localStorage.removeItem('auth_user');
        if (!cancelled) {
          setUser(null);
          setIsLoading(false);
        }
        return;
      }

      if (!parsed?.id) {
        localStorage.removeItem('auth_user');
        if (!cancelled) {
          setUser(null);
          setIsLoading(false);
        }
        return;
      }

      if (!cancelled) {
        if (parsed.role === 'client' && !parsed.permissions) parsed.permissions = { ...defaultPermissions };
        setUser(parsed);
      }

      try {
        const { data, error } = await withTimeout<{ data: any; error: any }>(
          supabase
            .from('users')
            .select('*')
            .eq('id', parsed.id)
            .single() as any,
          8000,
          'auth user bootstrap'
        );

        if (!error && data) {
          // Bootstrap também precisa rejeitar quem ficou bloqueado depois do login inicial.
          // Se o admin agendou um bloqueio que já vigorou, derrubamos a sessão do localStorage.
          try {
            await assertAccessAllowed(data);
          } catch {
            localStorage.removeItem('auth_user');
            if (!cancelled) {
              setUser(null);
              setIsLoading(false);
            }
            return;
          }

          const userPermissions = data.role === 'admin'
            ? {
                view_dashboard: true,
                view_devices_online: true,
                view_reports: true,
                view_analytics: true,
                export_data: true,
                manage_settings: true
              }
            : { ...defaultPermissions, ...(data.permissions || {}) };

          const refreshed: AuthUser = {
            id: data.id,
            name: data.name,
            email: data.email,
            role: data.role as UserRole,
            clientId: data.client_id || undefined,
            permissions: userPermissions
          };

          if (!cancelled) setUser(refreshed);
          localStorage.setItem('auth_user', JSON.stringify(refreshed));
        }
      } catch {
        localStorage.removeItem('auth_user');
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void run();
    return () => { cancelled = true; };
  }, []);

  // Poll periódico (60s) — re-checa se o usuário/cliente foi bloqueado enquanto
  // a sessão já está aberta. Sem isso, alguém logado só seria deslogado no
  // próximo refresh ou login. Com isso, o bloqueio entra em vigor em até 1 min.
  useEffect(() => {
    if (!user?.id) return;

    let cancelled = false;

    const checkBlocked = async () => {
      try {
        const { data, error } = await withTimeout<{ data: any; error: any }>(
          supabase
            .from('users')
            .select('*')
            .eq('id', user.id)
            .single() as any,
          8000,
          'auth poll user'
        );
        if (cancelled || error || !data) return;
        try {
          await assertAccessAllowed(data);
        } catch {
          // Bloqueado — derruba a sessão silenciosamente.
          if (!cancelled) {
            localStorage.removeItem('auth_user');
            setUser(null);
          }
        }
      } catch {
        // Erro de rede ou timeout — ignora, tenta de novo no próximo tick.
      }
    };

    // Roda imediatamente na 1ª vez (pega bloqueio que entrou em vigor agora)
    void checkBlocked();
    const interval = setInterval(() => { void checkBlocked(); }, 60_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [user?.id]);

  const login = async (email: string, password: string) => {
    setIsLoading(true);
    try {
      // Check users table in Supabase
      const { data, error } = await withTimeout<{ data: any; error: any }>(
        supabase
          .from('users')
          .select('*')
          .eq('email', email)
          .single() as any,
        8000,
        'auth login'
      );

      if (error || !data) {
        throw new Error('Usuário não encontrado');
      }

      // Simple password check (Note: In production, use hashed passwords!)
      if (data.password_hash !== password) {
        throw new Error('Senha incorreta');
      }

      await assertAccessAllowed(data);

      // Map Supabase user to AuthUser type
      const defaultPermissions = {
        view_dashboard: true,
        view_devices_online: false,
        view_reports: false,
        view_analytics: false,
        export_data: false,
        manage_settings: false
      };

      // Se for admin, tem tudo. Se for cliente, usa o que tá no banco ou default.
      const userPermissions = data.role === 'admin' 
        ? {
            view_dashboard: true,
            view_devices_online: true,
            view_reports: true,
            view_analytics: true,
            export_data: true,
            manage_settings: true
          }
        : { ...defaultPermissions, ...(data.permissions || {}) };

      const newUser: AuthUser = {
        id: data.id,
        name: data.name,
        email: data.email,
        role: data.role as UserRole, // Ensure database role matches 'admin' | 'client'
        clientId: data.client_id || undefined,
        permissions: userPermissions
      };

      setUser(newUser);
      localStorage.setItem('auth_user', JSON.stringify(newUser));
      
      // Update last login
      await withTimeout(
        supabase
          .from('users')
          .update({ last_login: new Date().toISOString() })
          .eq('id', data.id) as any,
        8000,
        'auth last_login'
      );

      // Log Login Action
      await logService.logAction(
        data.email,
        'LOGIN',
        `Usuário ${data.email} realizou login com sucesso.`,
        'network',
        'Sistema',
        { userId: data.id, role: data.role }
      );

    } catch (err) {
      console.error('Login error:', err);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('auth_user');
  };

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
