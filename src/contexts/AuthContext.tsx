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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const defaultPermissions = {
      view_dashboard: true,
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
        const { data, error } = await supabase
          .from('users')
          .select('*')
          .eq('id', parsed.id)
          .single();

        if (!error && data) {
          const userPermissions = data.role === 'admin'
            ? {
                view_dashboard: true,
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
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void run();
    return () => { cancelled = true; };
  }, []);

  const login = async (email: string, password: string) => {
    setIsLoading(true);
    try {
      // Check users table in Supabase
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('email', email)
        .single();

      if (error || !data) {
        throw new Error('Usuário não encontrado');
      }

      // Simple password check (Note: In production, use hashed passwords!)
      if (data.password_hash !== password) {
        throw new Error('Senha incorreta');
      }

      // Map Supabase user to AuthUser type
      const defaultPermissions = {
        view_dashboard: true,
        view_reports: false,
        view_analytics: false,
        export_data: false,
        manage_settings: false
      };

      // Se for admin, tem tudo. Se for cliente, usa o que tá no banco ou default.
      const userPermissions = data.role === 'admin' 
        ? {
            view_dashboard: true,
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
      await supabase
        .from('users')
        .update({ last_login: new Date().toISOString() })
        .eq('id', data.id);

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