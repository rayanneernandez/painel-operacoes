import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Building2, Camera, ChevronDown, ChevronUp, MapPin, RefreshCw } from 'lucide-react';
import supabase from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

type DbClient = { id: string; name: string };
type DeviceRow = { id: string; name: string; type: string; mac_address: string | null; status: 'online' | 'offline'; store_id: string };
type StoreRow = { id: string; name: string; city: string | null; client_id: string };

type UiDevice = { id: string; name: string; type: string; macAddress: string; status: 'online' | 'offline' };
type UiStore = { id: string; name: string; city: string; devices: UiDevice[] };

export function DevicesOnline() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [clients, setClients] = useState<DbClient[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [selectedClientName, setSelectedClientName] = useState<string>('');

  const activeClientId = useMemo(() => {
    if (isAdmin) return selectedClientId || '';
    return user?.clientId || '';
  }, [isAdmin, selectedClientId, user?.clientId]);

  const [stores, setStores] = useState<UiStore[]>([]);
  const [expandedStore, setExpandedStore] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const syncTTLRef = useRef<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!isAdmin) return;
      const { data, error } = await supabase.from('clients').select('id, name').order('name', { ascending: true });
      if (cancelled) return;
      if (!error && data) setClients(data as any);
    };
    void run();
    return () => { cancelled = true; };
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    const c = clients.find(x => x.id === selectedClientId);
    setSelectedClientName(c?.name || '');
  }, [clients, isAdmin, selectedClientId]);

  // ── Sincroniza lojas/dispositivos com a DisplayForce ───────────────────────
  const syncWithDisplayForce = useCallback(async (clientId: string, force = false) => {
    if (!clientId) return;
    const TTL_MS = 2 * 60 * 1000; // 2 minutos entre syncs automáticos
    const last = syncTTLRef.current[clientId] || 0;
    if (!force && Date.now() - last < TTL_MS) return;

    setSyncing(true);
    try {
      const resp = await fetch('/api/sync-analytics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, sync_stores: true }),
      });
      if (resp.ok) {
        const json = await resp.json();
        console.log(`[DevicesOnline] Sync: ${json.stores_upserted ?? 0} lojas, ${json.devices_upserted ?? 0} dispositivos`);
        syncTTLRef.current[clientId] = Date.now();
      }
    } catch (e) {
      console.warn('[DevicesOnline] Erro no sync:', e);
    } finally {
      setSyncing(false);
    }
  }, []);

  // ── Carrega lojas e dispositivos do banco ──────────────────────────────────
  const refresh = useCallback(async (clientId?: string, forceSync = false) => {
    const cid = clientId ?? activeClientId;
    if (!cid) { setStores([]); setExpandedStore(null); return; }

    setLoading(true);
    try {
      // 1. Sincroniza status com DisplayForce primeiro
      await syncWithDisplayForce(cid, forceSync);

      // 2. Lê do banco (já atualizado)
      const { data: storesData, error: storesError } = await supabase
        .from('stores').select('id, name, city, client_id')
        .eq('client_id', cid).range(0, 9999);
      if (storesError) throw storesError;

      const storeRows = (storesData || []) as unknown as StoreRow[];
      const storeIds = storeRows.map(s => s.id);

      let devicesByStore: Record<string, DeviceRow[]> = {};
      if (storeIds.length > 0) {
        const { data: devicesData, error: devicesError } = await supabase
          .from('devices').select('id, name, type, mac_address, status, store_id')
          .in('store_id', storeIds).range(0, 9999);
        if (devicesError) throw devicesError;
        (devicesData || []).forEach((d: any) => {
          const row = d as DeviceRow;
          if (!devicesByStore[row.store_id]) devicesByStore[row.store_id] = [];
          devicesByStore[row.store_id].push(row);
        });
      }

      const formatted: UiStore[] = storeRows.map(s => ({
        id: s.id, name: s.name, city: s.city || 'Não informada',
        devices: (devicesByStore[s.id] || []).map(d => ({
          id: d.id, name: d.name, type: d.type,
          macAddress: d.mac_address || '', status: d.status,
        })),
      }));

      setStores(formatted);
      setLastUpdatedAt(new Date());
      if (expandedStore && !formatted.some(s => s.id === expandedStore)) setExpandedStore(null);
    } finally {
      setLoading(false);
    }
  }, [activeClientId, syncWithDisplayForce, expandedStore]);

  // Carrega ao trocar de cliente
  useEffect(() => {
    if (!activeClientId) return;
    void refresh(activeClientId, false);
  }, [activeClientId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh a cada 30s (sem forçar sync — usa TTL)
  useEffect(() => {
    if (!activeClientId) return;
    const id = window.setInterval(() => { void refresh(activeClientId, false); }, 30000);
    const onFocus = () => { void refresh(activeClientId, false); };
    window.addEventListener('focus', onFocus);
    return () => { window.clearInterval(id); window.removeEventListener('focus', onFocus); };
  }, [activeClientId, refresh]);

  const headerSubtitle = useMemo(() => {
    if (isAdmin) {
      if (!selectedClientId) return 'Selecione uma rede para ver lojas e dispositivos';
      return selectedClientName ? `Rede: ${selectedClientName}` : 'Rede selecionada';
    }
    return 'Sua rede: lojas e dispositivos online';
  }, [isAdmin, selectedClientId, selectedClientName]);

  const deviceStats = useMemo(() => {
    const total   = stores.reduce((acc, s) => acc + s.devices.length, 0);
    const online  = stores.reduce((acc, s) => acc + s.devices.filter(d => d.status === 'online').length, 0);
    const offline = Math.max(0, total - online);
    return {
      total, online, offline,
      onlinePct:  total > 0 ? (online  / total) * 100 : 0,
      offlinePct: total > 0 ? (offline / total) * 100 : 0,
    };
  }, [stores]);

  const storeStats = useMemo(() => {
    const total   = stores.length;
    const online  = stores.filter(s => s.devices.some(d => d.status === 'online')).length;
    const offline = Math.max(0, total - online);
    return { total, online, offline };
  }, [stores]);

  const isBusy = loading || syncing;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Building2 className="text-emerald-500" size={22} />
            Dispositivos Online
          </h1>
          <p className="text-gray-400 text-sm">{headerSubtitle}</p>
          {lastUpdatedAt && (
            <p className="text-gray-600 text-xs mt-1 flex items-center gap-1">
              {syncing && <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />}
              {syncing ? 'Sincronizando com DisplayForce...' : `Atualizado em ${lastUpdatedAt.toLocaleTimeString('pt-BR')}`}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isAdmin && (
            <select
              value={selectedClientId}
              onChange={(e) => setSelectedClientId(e.target.value)}
              className="bg-gray-950 border border-gray-800 text-white rounded-lg px-3 py-2 outline-none focus:border-emerald-500 min-w-[260px]"
            >
              <option value="" style={{ backgroundColor: '#111827', color: '#9CA3AF' }}>Selecione uma rede...</option>
              {clients.map(c => (
                <option key={c.id} value={c.id} style={{ backgroundColor: '#111827', color: 'white' }}>{c.name}</option>
              ))}
            </select>
          )}

          <button
            onClick={() => void refresh(activeClientId, true)}
            disabled={isBusy || !activeClientId}
            className="h-[40px] w-[40px] flex items-center justify-center bg-gray-900 border border-gray-800 text-white rounded-lg hover:border-emerald-600 hover:text-emerald-400 transition-colors disabled:opacity-50"
            title="Sincronizar com DisplayForce agora"
          >
            {isBusy
              ? <span className="inline-block w-3.5 h-3.5 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
              : <RefreshCw size={16} className="text-gray-400" />}
          </button>
        </div>
      </div>

      {!activeClientId ? (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-10 text-center text-gray-500">
          {isAdmin ? 'Selecione uma rede acima para carregar os dispositivos.' : 'Seu usuário não está vinculado a uma rede.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
          {/* Lista de lojas */}
          <div className="space-y-3">
            {stores.length === 0 ? (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-10 text-center text-gray-500">
                {isBusy ? 'Carregando lojas...' : 'Nenhuma loja encontrada para esta rede.'}
              </div>
            ) : (
              stores.map(store => {
                const onlineCount  = store.devices.filter(d => d.status === 'online').length;
                const offlineCount = store.devices.filter(d => d.status !== 'online').length;
                const storeIsOnline = onlineCount > 0;

                return (
                  <div key={store.id} className="bg-gray-950 rounded-xl border border-gray-800 overflow-hidden">
                    <div
                      className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-900 transition-colors"
                      onClick={() => setExpandedStore(expandedStore === store.id ? null : store.id)}
                    >
                      <div className="flex items-center gap-4">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${storeIsOnline ? 'bg-emerald-500/10' : 'bg-gray-900'}`}>
                          <Building2 size={18} className={storeIsOnline ? 'text-emerald-400' : 'text-gray-600'} />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-white flex items-center gap-2">
                            {store.name}
                            <span className={`w-1.5 h-1.5 rounded-full inline-block ${storeIsOnline ? 'bg-emerald-400' : 'bg-gray-600'}`} />
                          </p>
                          <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                            <MapPin size={10} /> {store.city}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="inline-flex items-center gap-1 text-emerald-400">
                            <span className="w-2 h-2 rounded-full bg-emerald-500" />{onlineCount}
                          </span>
                          <span className="inline-flex items-center gap-1 text-red-400">
                            <span className="w-2 h-2 rounded-full bg-red-500" />{offlineCount}
                          </span>
                        </div>
                        {expandedStore === store.id
                          ? <ChevronUp size={18} className="text-gray-500" />
                          : <ChevronDown size={18} className="text-gray-500" />}
                      </div>
                    </div>

                    {expandedStore === store.id && (
                      <div className="bg-gray-900/50 border-t border-gray-800 p-4 animate-in slide-in-from-top-2 duration-200">
                        <h5 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                          <Camera size={12} /> Dispositivos
                        </h5>
                        {store.devices.length > 0 ? (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {store.devices.map(device => (
                              <div key={device.id} className="flex items-center justify-between bg-gray-950 p-3 rounded border border-gray-800">
                                <div className="flex items-center gap-2 min-w-0">
                                  <div className={`w-2 h-2 rounded-full ${device.status === 'online' ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                                  <div className="min-w-0">
                                    <p className="text-xs font-medium text-gray-200 truncate">{device.name}</p>
                                    <p className="text-[10px] text-gray-600 font-mono truncate">{device.macAddress || '-'}</p>
                                  </div>
                                </div>
                                <span className={`text-[10px] px-2 py-0.5 rounded border uppercase ${device.status === 'online' ? 'bg-emerald-500/10 border-emerald-700 text-emerald-400' : 'bg-gray-900 border-gray-800 text-gray-500'}`}>
                                  {device.status === 'online' ? 'Online' : 'Offline'}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-gray-500 italic">Nenhum dispositivo vinculado a esta loja.</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Painel lateral de estatísticas */}
          <aside className="bg-gray-900 border border-gray-800 rounded-xl p-4 h-fit lg:sticky lg:top-6 space-y-4">
            {/* Card: Lojas Cadastradas */}
            <div>
              <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                <Building2 size={14} className="text-emerald-400" /> Lojas Cadastradas
              </h3>
              <div className="grid grid-cols-3 gap-2 mb-3">
                <div className="bg-gray-950 border border-gray-800 rounded-lg p-3 text-center">
                  <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Total</p>
                  <p className="text-xl font-bold text-white">{storeStats.total}</p>
                </div>
                <div className="bg-gray-950 border border-emerald-900/40 rounded-lg p-3 text-center">
                  <p className="text-[10px] uppercase tracking-wider text-emerald-600 mb-1">Online</p>
                  <p className="text-xl font-bold text-emerald-400">{storeStats.online}</p>
                </div>
                <div className="bg-gray-950 border border-gray-800 rounded-lg p-3 text-center">
                  <p className="text-[10px] uppercase tracking-wider text-gray-600 mb-1">Offline</p>
                  <p className="text-xl font-bold text-gray-500">{storeStats.offline}</p>
                </div>
              </div>
              {storeStats.total > 0 && (
                <div className="h-2 rounded bg-gray-800 overflow-hidden">
                  <div className="h-full bg-emerald-500 transition-all duration-700" style={{ width: `${(storeStats.online / storeStats.total) * 100}%` }} />
                </div>
              )}
            </div>

            <div className="border-t border-gray-800" />

            {/* Card: Dispositivos */}
            <div>
              <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                <Camera size={14} className="text-blue-400" /> Dispositivos
              </h3>
              <div className="space-y-3">
                <div className="bg-gray-950 border border-gray-800 rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] uppercase tracking-wider text-gray-500">Online</p>
                    <p className="text-xs text-gray-300 font-medium">
                      {deviceStats.online.toLocaleString()} / {deviceStats.total.toLocaleString()}
                    </p>
                  </div>
                  <div className="mt-2 h-2 rounded bg-gray-800 overflow-hidden">
                    <div className="h-full bg-emerald-500 transition-all duration-700" style={{ width: `${deviceStats.onlinePct}%` }} />
                  </div>
                </div>

                <div className="bg-gray-950 border border-gray-800 rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] uppercase tracking-wider text-gray-500">Não conectados</p>
                    <p className="text-xs text-gray-300 font-medium">
                      {deviceStats.offline.toLocaleString()} / {deviceStats.total.toLocaleString()}
                    </p>
                  </div>
                  <div className="mt-2 h-2 rounded bg-gray-800 overflow-hidden">
                    <div className="h-full bg-red-500 transition-all duration-700" style={{ width: `${deviceStats.offlinePct}%` }} />
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
