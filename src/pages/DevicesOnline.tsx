import { useEffect, useMemo, useState } from 'react';
import { Building2, Camera, ChevronDown, ChevronUp, MapPin, RefreshCw } from 'lucide-react';
import supabase from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

type DbClient = { id: string; name: string };
type DeviceRow = { id: string; name: string; type: string; mac_address: string | null; status: 'online' | 'offline'; store_id: string };
type StoreRow = { id: string; name: string; city: unknown; client_id: string };

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
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

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

  useEffect(() => {
    if (!isAdmin) {
      setSelectedClientName('');
    }
  }, [isAdmin]);

  const refresh = async () => {
    if (!activeClientId) {
      setStores([]);
      setExpandedStore(null);
      return;
    }

    setLoading(true);
    try {
      const { data: storesData, error: storesError } = await supabase
        .from('stores')
        .select('id, name, city, client_id')
        .eq('client_id', activeClientId)
        .range(0, 9999);

      if (storesError) throw storesError;

      const storeRows = (storesData || []) as unknown as StoreRow[];

      const norm = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
      const toCity = (v: unknown) => {
        const s = typeof v === 'string' ? v.trim() : '';
        return s ? s : 'Não informada';
      };

      const storeGroups = new Map<string, { ids: string[]; name: string; city: string }>();
      for (const s of storeRows) {
        const city = toCity(s.city);
        const key = `${norm(s.name)}|${norm(city)}`;
        const existing = storeGroups.get(key);
        if (!existing) storeGroups.set(key, { ids: [s.id], name: s.name, city });
        else existing.ids.push(s.id);
      }

      const storeIds = [...new Set(storeRows.map(s => s.id))];

      let devicesByStore: Record<string, DeviceRow[]> = {};
      if (storeIds.length > 0) {
        const { data: devicesData, error: devicesError } = await supabase
          .from('devices')
          .select('id, name, type, mac_address, status, store_id')
          .in('store_id', storeIds)
          .range(0, 9999);

        if (devicesError) throw devicesError;

        (devicesData || []).forEach((d: any) => {
          const row = d as DeviceRow;
          if (!devicesByStore[row.store_id]) devicesByStore[row.store_id] = [];
          devicesByStore[row.store_id].push(row);
        });
      }

      const dedupeDevices = (rows: DeviceRow[]): UiDevice[] => {
        const map = new Map<string, DeviceRow>();
        for (const r of rows) {
          const mac = String(r.mac_address ?? '').trim();
          const key = mac ? `mac:${mac}` : `id:${r.id}`;
          const prev = map.get(key);
          if (!prev) map.set(key, r);
          else if (prev.status !== 'online' && r.status === 'online') map.set(key, r);
        }
        return [...map.values()]
          .map((d) => ({
            id: d.id,
            name: d.name,
            type: d.type,
            macAddress: String(d.mac_address ?? ''),
            status: d.status,
          }))
          .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
      };

      const formatted: UiStore[] = [...storeGroups.values()].map((g) => {
        const mergedRows = g.ids.flatMap((sid) => devicesByStore[sid] || []);
        return {
          id: g.ids.join('|'),
          name: g.name,
          city: g.city,
          devices: dedupeDevices(mergedRows),
        };
      });

      setStores(formatted);
      setLastUpdatedAt(new Date());

      if (expandedStore && !formatted.some(s => s.id === expandedStore)) {
        setExpandedStore(null);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!activeClientId) return;
      await refresh();
      if (cancelled) return;
    };

    void run();
    return () => { cancelled = true; };
  }, [activeClientId]);

  useEffect(() => {
    if (!activeClientId) return;

    const id = window.setInterval(() => { void refresh(); }, 10000);
    const onFocus = () => { void refresh(); };

    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [activeClientId]);

  const headerSubtitle = useMemo(() => {
    if (isAdmin) {
      if (!selectedClientId) return 'Selecione uma rede para ver lojas e dispositivos';
      return selectedClientName ? `Rede: ${selectedClientName}` : 'Rede selecionada';
    }
    return 'Sua rede: lojas e dispositivos online';
  }, [isAdmin, selectedClientId, selectedClientName]);

  const deviceStats = useMemo(() => {
    const total = stores.reduce((acc, s) => acc + s.devices.length, 0);
    const online = stores.reduce((acc, s) => acc + s.devices.filter(d => d.status === 'online').length, 0);
    const offline = Math.max(0, total - online);

    const onlinePct = total > 0 ? (online / total) * 100 : 0;
    const offlinePct = total > 0 ? (offline / total) * 100 : 0;

    return { total, online, offline, onlinePct, offlinePct };
  }, [stores]);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Building2 className="text-emerald-500" size={22} />
            Dispositivos Online
          </h1>
          <p className="text-gray-400 text-sm">{headerSubtitle}</p>
          {lastUpdatedAt && (
            <p className="text-gray-600 text-xs mt-1">
              Atualizado em {lastUpdatedAt.toLocaleTimeString('pt-BR')}
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
              <option value="" style={{ backgroundColor: '#111827', color: '#9CA3AF' }}>
                Selecione uma rede...
              </option>
              {clients.map(c => (
                <option key={c.id} value={c.id} style={{ backgroundColor: '#111827', color: 'white' }}>
                  {c.name}
                </option>
              ))}
            </select>
          )}

          <button
            onClick={() => void refresh()}
            disabled={loading || !activeClientId}
            className="h-[40px] w-[40px] flex items-center justify-center bg-gray-900 border border-gray-800 text-white rounded-lg hover:border-emerald-600 hover:text-emerald-400 transition-colors disabled:opacity-50"
            title="Atualizar agora"
          >
            {loading ? (
              <span className="inline-block w-3.5 h-3.5 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              <RefreshCw size={16} className="text-gray-400" />
            )}
          </button>
        </div>
      </div>

      {!activeClientId ? (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-10 text-center text-gray-500">
          {isAdmin ? 'Selecione uma rede acima para carregar os dispositivos.' : 'Seu usuário não está vinculado a uma rede.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
          <div className="space-y-3">
            {stores.length === 0 ? (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-10 text-center text-gray-500">
                Nenhuma loja encontrada para esta rede.
              </div>
            ) : (
              stores.map(store => {
                const onlineCount = store.devices.filter(d => d.status === 'online').length;
                const offlineCount = store.devices.filter(d => d.status !== 'online').length;

                return (
                  <div key={store.id} className="bg-gray-950 rounded-xl border border-gray-800 overflow-hidden">
                    <div
                      className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-900 transition-colors"
                      onClick={() => setExpandedStore(expandedStore === store.id ? null : store.id)}
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-lg bg-gray-900 flex items-center justify-center text-gray-500">
                          <Building2 size={18} />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-white">{store.name}</p>
                          <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                            <MapPin size={10} /> {store.city}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="inline-flex items-center gap-1 text-emerald-400">
                            <span className="w-2 h-2 rounded-full bg-emerald-500" />
                            {onlineCount}
                          </span>
                          <span className="inline-flex items-center gap-1 text-red-400">
                            <span className="w-2 h-2 rounded-full bg-red-500" />
                            {offlineCount}
                          </span>
                        </div>
                        {expandedStore === store.id ? (
                          <ChevronUp size={18} className="text-gray-500" />
                        ) : (
                          <ChevronDown size={18} className="text-gray-500" />
                        )}
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
                              <div
                                key={device.id}
                                className="flex items-center justify-between bg-gray-950 p-3 rounded border border-gray-800"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <div className={`w-2 h-2 rounded-full ${device.status === 'online' ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                                  <div className="min-w-0">
                                    <p className="text-xs font-medium text-gray-200 truncate">{device.name}</p>
                                    <p className="text-[10px] text-gray-600 font-mono truncate">
                                      {device.macAddress || '-'}
                                    </p>
                                  </div>
                                </div>

                                <span className="text-[10px] bg-gray-900 text-gray-400 px-2 py-0.5 rounded border border-gray-800 uppercase">
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

          <aside className="bg-gray-900 border border-gray-800 rounded-xl p-4 h-fit lg:sticky lg:top-6">
            <h3 className="text-sm font-bold text-white mb-4">Estatísticas dos dispositivos</h3>

            <div className="grid grid-cols-1 gap-3">
              <div className="bg-gray-950 border border-gray-800 rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] uppercase tracking-wider text-gray-500">Dispositivos online</p>
                  <p className="text-xs text-gray-300 font-medium">
                    {deviceStats.online.toLocaleString()} / {deviceStats.total.toLocaleString()}
                  </p>
                </div>
                <div className="mt-2 h-2 rounded bg-gray-800 overflow-hidden">
                  <div className="h-full bg-emerald-500" style={{ width: `${deviceStats.onlinePct}%` }} />
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
                  <div className="h-full bg-red-500" style={{ width: `${deviceStats.offlinePct}%` }} />
                </div>
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}