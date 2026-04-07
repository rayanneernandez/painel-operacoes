import supabase from '@/lib/supabase';

export type LogAction = 'LOGIN' | 'CREATE' | 'UPDATE' | 'DELETE' | 'VIEW';
export type LogScope = 'network' | 'store' | 'user' | 'system';

let cachedIp: string | null = null;
let cachedIpPromise: Promise<string> | null = null;

async function resolveIp(): Promise<string> {
  if (cachedIp) return cachedIp;
  if (!cachedIpPromise) {
    cachedIpPromise = (async () => {
      const res = await fetch('https://api.ipify.org?format=json');
      const data = await res.json();
      const ip = typeof data?.ip === 'string' && data.ip.trim() ? data.ip.trim() : 'unknown';
      cachedIp = ip;
      return ip;
    })().catch(() => {
      cachedIp = 'unknown';
      return 'unknown';
    });
  }
  return cachedIpPromise;
}

async function resolveIpWithTimeout(timeoutMs = 800): Promise<string> {
  return await Promise.race([
    resolveIp(),
    new Promise<string>((resolve) => setTimeout(() => resolve('unknown'), timeoutMs)),
  ]);
}

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
      const ip = await resolveIpWithTimeout();

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
      .limit(500);

    if (error) throw error;
    return data || [];
  }
};