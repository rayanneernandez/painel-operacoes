import supabase from '../lib/supabase';

export type LogAction = 'LOGIN' | 'CREATE' | 'UPDATE' | 'DELETE' | 'VIEW';
export type LogScope = 'network' | 'store' | 'user' | 'system';

export const logService = {
  logAction: async (
    userEmail: string, 
    action: LogAction, 
    description: string, 
    scope: LogScope = 'network', 
    target?: string,
    metadata?: any
  ) => {
    try {
      // Obter IP (serviço público simples) - opcional
      let ip = 'unknown';
      try {
        const res = await fetch('https://api.ipify.org?format=json');
        const data = await res.json();
        ip = data.ip;
      } catch (e) {
        // Ignorar erro de IP
      }

      const { error } = await supabase.from('logs').insert({
        user_email: userEmail,
        action,
        description,
        scope,
        target,
        ip_address: ip,
        metadata,
        created_at: new Date().toISOString()
      });

      if (error) {
        console.error('Erro ao salvar log:', error);
      }
    } catch (err) {
      console.error('Erro inesperado no logService:', err);
    }
  },

  fetchLogs: async () => {
    const { data, error } = await supabase
      .from('logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw error;
    return data || [];
  }
};