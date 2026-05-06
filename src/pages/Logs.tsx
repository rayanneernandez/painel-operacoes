import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Building2,
  Clock,
  Download,
  Filter,
  Globe,
  History,
  MessageSquare,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  WifiOff,
} from 'lucide-react';
import { logService } from '../services/logService';
import supabase from '../lib/supabase';

type LogsTab = 'access' | 'monitoring';
type Scope = 'network' | 'store';

type ClientOption = {
  id: string;
  name: string;
};

type StoreOption = {
  id: string;
  name: string;
  client_id: string;
};

type AccessLogRow = {
  id: string;
  user: string;
  action: string;
  status: 'success' | 'error';
  store: string;
  time: string;
  ip: string;
  scope: string;
};

type MonitoringLogRow = {
  id: string;
  client_id: string;
  client_name: string | null;
  store_id: string | null;
  store_name: string | null;
  device_name: string;
  mac_address: string | null;
  first_detected_at: string;
  last_seen_offline_at: string | null;
  last_seen_online_at: string | null;
  notified_at: string | null;
  last_notification_sent_at?: string | null;
  resolved_at: string | null;
  status: 'pending' | 'notified' | 'resolved' | 'cancelled';
  notification_attempts: number | null;
  last_notification_error: string | null;
  offline_reason: string | null;
};

const SELECTED_CLIENT_STORAGE_KEY = 'globalia-monitoring-selected-client-id';

function formatDateTime(value: string | null | undefined) {
  if (!value) return '-';

  try {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export function Logs() {
  const [activeTab, setActiveTab] = useState<LogsTab>('access');
  const [scope, setScope] = useState<Scope>('network');
  const [selectedStore, setSelectedStore] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [logs, setLogs] = useState<AccessLogRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [stores, setStores] = useState<StoreOption[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(SELECTED_CLIENT_STORAGE_KEY) || '';
  });
  const [monitoringStoreId, setMonitoringStoreId] = useState('');
  const [monitoringSearchTerm, setMonitoringSearchTerm] = useState('');
  const [monitoringLogs, setMonitoringLogs] = useState<MonitoringLogRow[]>([]);
  const [monitoringLoading, setMonitoringLoading] = useState(false);
  const [monitoringMessage, setMonitoringMessage] = useState<string | null>(null);

  useEffect(() => {
    void fetchAccessData();
    void loadClientsAndStores();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(SELECTED_CLIENT_STORAGE_KEY, selectedClientId || '');
  }, [selectedClientId]);

  useEffect(() => {
    if (!selectedClientId && clients.length > 0) {
      setSelectedClientId(clients[0].id);
    }
  }, [clients, selectedClientId]);

  useEffect(() => {
    setMonitoringStoreId('');
  }, [selectedClientId]);

  useEffect(() => {
    if (!selectedClientId) {
      setMonitoringLogs([]);
      return;
    }

    void fetchMonitoringLogs(selectedClientId);
  }, [selectedClientId]);

  const fetchAccessData = async () => {
    setLoading(true);
    try {
      const data = await logService.fetchLogs();
      const mappedLogs = data.map((l: any) => ({
        id: String(l.id),
        user: l.user_email || 'Sistema',
        action: l.description || l.action,
        status: 'success' as const,
        store: l.target || (l.scope === 'network' ? 'Rede Global' : 'Loja'),
        time: new Date(l.created_at).toLocaleString('pt-BR'),
        ip: l.ip_address || '::1',
        scope: l.scope,
      }));
      setLogs(mappedLogs);
    } catch (error) {
      console.error('Erro ao buscar logs:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadClientsAndStores = async () => {
    try {
      const [{ data: storesData }, { data: clientsData }] = await Promise.all([
        supabase.from('stores').select('id, name, client_id').order('name', { ascending: true }),
        supabase.from('clients').select('id, name').order('name', { ascending: true }),
      ]);

      setStores((storesData || []) as StoreOption[]);
      setClients((clientsData || []) as ClientOption[]);
    } catch (error) {
      console.error('Erro ao carregar redes e lojas:', error);
    }
  };

  const fetchMonitoringLogs = async (clientId: string) => {
    setMonitoringLoading(true);
    setMonitoringMessage(null);

    try {
      const { data, error } = await supabase
        .from('device_offline_alerts')
        .select(
          'id, client_id, client_name, store_id, store_name, device_name, mac_address, first_detected_at, last_seen_offline_at, last_seen_online_at, notified_at, last_notification_sent_at, resolved_at, status, notification_attempts, last_notification_error, offline_reason'
        )
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .limit(300);

      if (error) throw error;

      setMonitoringLogs((data || []) as MonitoringLogRow[]);
    } catch (error: any) {
      setMonitoringLogs([]);
      setMonitoringMessage(error?.message || 'Falha ao carregar os logs do monitoramento offline.');
    } finally {
      setMonitoringLoading(false);
    }
  };

  const handleRefresh = async () => {
    await Promise.all([
      fetchAccessData(),
      loadClientsAndStores(),
      selectedClientId ? fetchMonitoringLogs(selectedClientId) : Promise.resolve(),
    ]);
  };

  const selectedClientName = useMemo(
    () => clients.find((client) => client.id === selectedClientId)?.name || '',
    [clients, selectedClientId]
  );

  const storeOptions = useMemo(
    () => stores.filter((store) => store.client_id === selectedClientId),
    [selectedClientId, stores]
  );

  const filteredLogs = useMemo(
    () =>
      logs.filter((log) => {
        const matchesSearch =
          log.user.toLowerCase().includes(searchTerm.toLowerCase()) ||
          log.action.toLowerCase().includes(searchTerm.toLowerCase());

        if (!matchesSearch) return false;

        if (scope === 'network') return true;
        if (selectedStore) return log.store === selectedStore;
        return log.scope === 'store';
      }),
    [logs, scope, searchTerm, selectedStore]
  );

  const monitoringHistory = useMemo(
    () =>
      monitoringLogs.filter(
        (alert) => Boolean(alert.notified_at) || Boolean(alert.resolved_at) || alert.status === 'cancelled'
      ),
    [monitoringLogs]
  );

  const filteredMonitoringLogs = useMemo(
    () =>
      monitoringHistory.filter((alert) => {
        if (monitoringStoreId && alert.store_id !== monitoringStoreId) return false;

        const haystack = [
          alert.device_name,
          alert.store_name,
          alert.client_name,
          alert.mac_address,
          alert.offline_reason,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        return haystack.includes(monitoringSearchTerm.toLowerCase());
      }),
    [monitoringHistory, monitoringSearchTerm, monitoringStoreId]
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <History className="text-orange-500" /> Logs de Acesso
          </h1>
          <p className="text-gray-400">Consulte os registros de acesso e os incidentes do monitoramento offline</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => void handleRefresh()}
            className="bg-gray-800 hover:bg-gray-700 text-white font-medium px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
          >
            <RefreshCw size={18} className={loading || monitoringLoading ? 'animate-spin' : ''} />
          </button>
          <button className="bg-gray-800 hover:bg-gray-700 text-white font-medium px-4 py-2 rounded-lg flex items-center gap-2 transition-colors">
            <Download size={18} />
          </button>
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-2 flex flex-col md:flex-row gap-2">
        <button
          type="button"
          onClick={() => setActiveTab('access')}
          className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-medium transition-colors ${
            activeTab === 'access'
              ? 'bg-gray-800 text-white'
              : 'text-gray-400 hover:bg-gray-800/50 hover:text-white'
          }`}
        >
          <History size={16} />
          Logs de acesso
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('monitoring')}
          className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-medium transition-colors ${
            activeTab === 'monitoring'
              ? 'bg-gray-800 text-white'
              : 'text-gray-400 hover:bg-gray-800/50 hover:text-white'
          }`}
        >
          <WifiOff size={16} />
          Monitoramento offline
        </button>
      </div>

      {activeTab === 'access' ? (
        <>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">Filtrar origem dos logs</h2>
            <div className="flex flex-col md:flex-row gap-6 items-start md:items-center">
              <div className="flex bg-gray-950 p-1 rounded-lg border border-gray-800">
                <button
                  onClick={() => setScope('network')}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${
                    scope === 'network' ? 'bg-gray-800 text-white shadow-sm' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  <Globe size={16} />
                  Rede (Global)
                </button>
                <button
                  onClick={() => setScope('store')}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${
                    scope === 'store' ? 'bg-gray-800 text-white shadow-sm' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  <Building2 size={16} />
                  Loja especifica
                </button>
              </div>

              {scope === 'store' && (
                <div className="flex items-center gap-2 animate-in fade-in slide-in-from-left-4 duration-300">
                  <ArrowRight size={16} className="text-gray-600" />
                  <select
                    value={selectedStore}
                    onChange={(event) => setSelectedStore(event.target.value)}
                    className="bg-gray-950 border border-gray-800 text-white rounded-lg px-4 py-2 outline-none focus:border-orange-500 min-w-[220px]"
                  >
                    <option value="" disabled>
                      Selecione uma loja...
                    </option>
                    {stores.map((store) => (
                      <option key={store.id} value={store.name}>
                        {store.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-gray-800 flex flex-col md:flex-row gap-4 justify-between items-center">
              <div className="relative w-full md:w-96">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
                <input
                  type="text"
                  placeholder="Buscar por usuario, acao..."
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  className="w-full bg-gray-950 border border-gray-800 text-white pl-10 pr-4 py-2 rounded-lg outline-none focus:border-orange-500 placeholder-gray-600"
                />
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <Filter size={16} />
                <span>Mostrando {filteredLogs.length} registros</span>
              </div>
            </div>

            <div className="w-full text-left">
              <div className="bg-gray-950/50 text-gray-400 text-xs uppercase tracking-wider font-medium flex border-b border-gray-800">
                <div className="p-4 w-1/4">Usuario / IP</div>
                <div className="p-4 w-1/4">Acao</div>
                <div className="p-4 w-1/4">Origem (Loja)</div>
                <div className="p-4 w-1/4 text-right">Data / Hora</div>
              </div>

              <div className="divide-y divide-gray-800">
                {filteredLogs.length > 0 ? (
                  filteredLogs.map((log) => (
                    <div key={log.id} className="flex hover:bg-gray-800/30 transition-colors group">
                      <div className="p-4 w-1/4">
                        <div className="font-medium text-white">{log.user}</div>
                        <div className="text-xs text-gray-500 font-mono mt-1">{log.ip}</div>
                      </div>
                      <div className="p-4 w-1/4">
                        <div className="flex items-center gap-2">
                          {log.status === 'success' ? (
                            <ShieldCheck size={16} className="text-emerald-500" />
                          ) : (
                            <ShieldAlert size={16} className="text-red-500" />
                          )}
                          <span className={log.status === 'success' ? 'text-gray-300' : 'text-red-400'}>{log.action}</span>
                        </div>
                      </div>
                      <div className="p-4 w-1/4 flex items-center gap-2 text-gray-400">
                        <Building2 size={14} className="text-gray-600" />
                        <span className="text-sm">{log.store}</span>
                      </div>
                      <div className="p-4 w-1/4 text-right flex items-center justify-end gap-2 text-gray-400">
                        <Clock size={14} />
                        <span className="text-sm">{log.time}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-8 text-center text-gray-500">Nenhum registro encontrado para os filtros selecionados.</div>
                )}
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="grid grid-cols-1 xl:grid-cols-[260px_260px_1fr] gap-4">
              <div>
                <label className="text-xs uppercase tracking-wider text-gray-500 block mb-1">Rede</label>
                <select
                  value={selectedClientId}
                  onChange={(event) => setSelectedClientId(event.target.value)}
                  className="w-full bg-gray-950 border border-gray-800 text-white rounded-lg px-4 py-2 outline-none focus:border-orange-500"
                >
                  <option value="">Selecione a rede...</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs uppercase tracking-wider text-gray-500 block mb-1">Loja da rede</label>
                <select
                  value={monitoringStoreId}
                  onChange={(event) => setMonitoringStoreId(event.target.value)}
                  className="w-full bg-gray-950 border border-gray-800 text-white rounded-lg px-4 py-2 outline-none focus:border-orange-500"
                >
                  <option value="">Todas as lojas</option>
                  {storeOptions.map((store) => (
                    <option key={store.id} value={store.id}>
                      {store.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs uppercase tracking-wider text-gray-500 block mb-1">Buscar no log</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
                  <input
                    type="text"
                    placeholder="Buscar por dispositivo, loja, MAC..."
                    value={monitoringSearchTerm}
                    onChange={(event) => setMonitoringSearchTerm(event.target.value)}
                    className="w-full bg-gray-950 border border-gray-800 text-white pl-10 pr-4 py-2 rounded-lg outline-none focus:border-orange-500 placeholder-gray-600"
                  />
                </div>
              </div>
            </div>

            <p className="text-xs text-gray-500 mt-4">
              Rede atual: {selectedClientName || 'Nao selecionada'}. Aqui ficam os registros de quando o dispositivo caiu,
              quando o WhatsApp saiu e quando voltou ao normal.
            </p>
          </div>

          {monitoringMessage && (
            <div className="rounded-xl border border-amber-700 bg-amber-950/20 px-4 py-3 text-sm text-amber-200">
              {monitoringMessage}
            </div>
          )}

          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <MessageSquare size={16} className="text-orange-400" />
                  Log do monitoramento offline
                </h3>
                <p className="text-xs text-gray-500 mt-1">
                  Historico de incidentes offline, incluindo envio de WhatsApp e retorno online.
                </p>
              </div>

              <div className="flex items-center gap-2 text-sm text-gray-400">
                <Filter size={16} />
                <span>{filteredMonitoringLogs.length} incidentes</span>
              </div>
            </div>

            {monitoringLoading ? (
              <div className="rounded-lg border border-dashed border-gray-800 bg-gray-950/50 p-8 text-center text-sm text-gray-500 mt-4">
                Carregando logs do monitoramento...
              </div>
            ) : filteredMonitoringLogs.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-800 bg-gray-950/50 p-8 text-center text-sm text-gray-500 mt-4">
                Nenhum incidente encontrado para os filtros selecionados.
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {filteredMonitoringLogs.map((alert) => {
                  const stillOfflineAfterSend = Boolean(alert.notified_at) && !alert.resolved_at;
                  const endedWithoutResolution = alert.status === 'cancelled';
                  const historyBadgeClass = stillOfflineAfterSend
                    ? 'border-red-700 bg-red-950/30 text-red-200'
                    : endedWithoutResolution
                      ? 'border-gray-700 bg-gray-900 text-gray-300'
                      : 'border-emerald-700 bg-emerald-950/30 text-emerald-300';
                  const historyBadgeLabel = stillOfflineAfterSend
                    ? 'WhatsApp enviado'
                    : endedWithoutResolution
                      ? 'Encerrado sem envio'
                      : 'Voltou online';

                  return (
                    <div key={`history-${alert.id}`} className="rounded-xl border border-gray-800 bg-gray-950 p-4">
                      <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-white">{alert.device_name}</p>
                            <span className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded-full border ${historyBadgeClass}`}>
                              {historyBadgeLabel}
                            </span>
                          </div>
                          <p className="text-xs text-gray-400 mt-1">
                            {(alert.store_name || 'Loja nao informada')} - {(alert.client_name || selectedClientName || 'Rede selecionada')}
                          </p>
                          <p className="text-[11px] text-gray-600 mt-1">
                            {alert.mac_address ? `${alert.mac_address} - ` : ''}
                            Detectado em {formatDateTime(alert.first_detected_at)}
                          </p>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-gray-300 min-w-[300px]">
                          <div className="rounded-lg border border-gray-800 bg-gray-900 px-3 py-2">
                            <p className="text-[10px] uppercase tracking-wider text-gray-500">Queda detectada</p>
                            <p className="mt-1">{formatDateTime(alert.first_detected_at)}</p>
                          </div>
                          <div className="rounded-lg border border-gray-800 bg-gray-900 px-3 py-2">
                            <p className="text-[10px] uppercase tracking-wider text-gray-500">Primeiro envio</p>
                            <p className="mt-1">{formatDateTime(alert.notified_at)}</p>
                          </div>
                          <div className="rounded-lg border border-gray-800 bg-gray-900 px-3 py-2">
                            <p className="text-[10px] uppercase tracking-wider text-gray-500">
                              {stillOfflineAfterSend ? 'Ultimo disparo' : endedWithoutResolution ? 'Encerrado em' : 'Voltou online'}
                            </p>
                            <p className="mt-1">
                              {stillOfflineAfterSend
                                ? formatDateTime(alert.last_notification_sent_at || alert.notified_at)
                                : formatDateTime(alert.resolved_at)}
                            </p>
                          </div>
                        </div>
                      </div>

                      {(alert.offline_reason || alert.last_notification_error) && (
                        <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
                          <div className="rounded-lg border border-gray-800 bg-gray-900/70 px-3 py-3">
                            <p className="text-[10px] uppercase tracking-wider text-gray-500">Motivo registrado</p>
                            <p className="mt-2 text-xs text-gray-300">
                              {alert.offline_reason || 'Motivo nao informado para este incidente.'}
                            </p>
                          </div>

                          {alert.last_notification_error && (
                            <div className="rounded-lg border border-amber-800/70 bg-amber-950/20 px-3 py-3">
                              <p className="text-[10px] uppercase tracking-wider text-amber-300">Ultimo retorno do monitor</p>
                              <p className="mt-2 text-xs text-amber-100">{alert.last_notification_error}</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
