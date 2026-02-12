import React, { createContext, useContext, useState, useEffect } from 'react';
import supabase from '../lib/supabase';
import { AuthUser, UserRole } from '../types';

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
    const savedUser = localStorage.getItem('auth_user');
    if (savedUser) {
      setUser(JSON.parse(savedUser));
    }
    setIsLoading(false);
  }, []);

  const login = async (email: string, password: string) => {
    setIsLoading(true);
    try {
      // Check users table in Supabase
      const { data, error } = await supabase
        .from('users')
        .select('*, clients(id)')
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
      const newUser: AuthUser = {
        id: data.id,
        name: data.name,
        email: data.email,
        role: data.role as UserRole, // Ensure database role matches 'admin' | 'client'
        clientId: data.clients && data.clients.length > 0 ? data.clients[0].id : undefined
      };

      setUser(newUser);
      localStorage.setItem('auth_user', JSON.stringify(newUser));
      
      // Update last login
      await supabase
        .from('users')
        .update({ last_login: new Date().toISOString() })
        .eq('id', data.id);

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