import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, RefreshCw, CalendarDays, CalendarRange, FileDown, FileText, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { saveAs } from 'file-saver';
import supabase from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

// ── Exportação CSV / PDF ────────────────────────────────────────────────────
const downloadCsv = (filename: string, headers: string[], rows: (string | number)[][]) => {
  const sep = ';';
  const esc = (v: string | number) => {
    const s = String(v ?? '');
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.join(sep), ...rows.map((r) => r.map(esc).join(sep))].join('\r\n');
  saveAs(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }), `${filename}.csv`);
};

const downloadPdf = (
  title: string, headers: string[], rows: (string | number)[][], filename: string,
  orientation: 'portrait' | 'landscape' = 'landscape',
) => {
  const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' });
  doc.setFontSize(13);
  doc.text(title, 14, 14);
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(`Gerado em ${new Date().toLocaleString('pt-BR')}`, 14, 19);
  doc.setTextColor(0);
  autoTable(doc, {
    head: [headers],
    body: rows.map((r) => r.map((c) => String(c ?? ''))),
    startY: 23,
    styles: { fontSize: 7, cellPadding: 1.5 },
    headStyles: { fillColor: [37, 99, 235], fontSize: 7 },
    alternateRowStyles: { fillColor: [245, 247, 250] },
  });
  doc.save(`${filename}.pdf`);
};

// ── Tipos ─────────────────────────────────────────────────────────────────
type Scope = 'all' | string; // 'all' ou client_id
interface ClientRow { id: string; name: string; }
interface StoreRow { id: string; name: string; city: string | null; client_id: string; }
interface DeviceRow { id: string; store_id: string; mac_address: string | null; status: string | null; name: string | null; }
interface AlertRow { first_detected_at: string; resolved_at: string | null; device_id: string; store_id: string; client_id: string; device_name: string | null; store_name: string | null; }
interface SnapRow { store_id: string; client_id: string; date: string; total: number; online: number; offline: number; not_connected: number; }

interface DailyRow {
  date: string; weekday: string;
  total: number; online: number; offline: number; notConnected: number;
  pctOnline: number | null; movingAvg7: number | null;
  quedas: number; recuperacoes: number; saldo: number; mudancas: number;
  hasSnapshot: boolean;
}
interface WeekDef { key: string; label: string; start: string; end: string; }
interface WeeklyRow {
  storeId: string; storeIds: string[]; name: string; code: string; deviceCount: number;
  weekPct: (number | null)[];
  lastPct: number | null; prevPct: number | null; delta: number | null;
  trend: 'Piorou' | 'Melhorou' | 'Estável' | '—';
  weeksWithData: number;
}
interface DeviceWeekRow {
  key: string; name: string; status: 'online' | 'offline' | 'not_connected'; quedas: number;
  weekPct: (number | null)[];
  lastPct: number | null; prevPct: number | null; delta: number | null;
  trend: 'Piorou' | 'Melhorou' | 'Estável' | '—';
  weeksWithData: number;
}

// ── Helpers de data (fuso São Paulo) ────────────────────────────────────────
const SP_TZ = 'America/Sao_Paulo';
const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: SP_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const spDate = (iso: string | Date): string => {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (isNaN(d.getTime())) return '';
  return dateFmt.format(d); // YYYY-MM-DD
};
const todaySp = (): string => spDate(new Date());
const addDays = (ymd: string, n: number): string => {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
};
const weekdayPt = (ymd: string): string => {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][dt.getUTCDay()];
};
const ddmm = (ymd: string): string => { const [, m, d] = ymd.split('-'); return `${d}/${m}`; };
// Segunda-feira da semana que contém ymd
const mondayOf = (ymd: string): string => {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay(); // 0=dom
  const diff = dow === 0 ? -6 : 1 - dow;
  dt.setUTCDate(dt.getUTCDate() + diff);
  return dt.toISOString().slice(0, 10);
};

const normStatus = (s: string | null): 'online' | 'offline' | 'not_connected' => {
  const v = String(s ?? '').trim().toLowerCase();
  if (v === 'online') return 'online';
  if (v === 'not_connected' || v === 'not connected') return 'not_connected';
  return 'offline';
};
const statusRank = (s: 'online' | 'offline' | 'not_connected') => (s === 'offline' ? 3 : s === 'not_connected' ? 2 : 1);

// Nome do dispositivo removendo o prefixo da loja (com ou sem "-").
const DEVICE_KEYWORD = /(Painel|Corredor|G[oôó]ndola|Gondula|Caixa|Entrada|FLV|Totem|Recepç|Vitrine|A RETIRAR|Cam\b)/i;
const deviceLabel = (deviceName: string | null, storeName: string | null): string => {
  const original = (deviceName || '').trim();
  let s = original;
  // 1) formato "Loja - Dispositivo": pega depois do último " - "
  if (s.includes(' - ')) {
    const tail = s.slice(s.lastIndexOf(' - ') + 3).trim();
    if (tail) return tail;
  }
  // 2) remove o prefixo da loja (do alerta), se o nome começar com ele
  const store = (storeName || '').trim();
  if (store && s.toLowerCase().startsWith(store.toLowerCase())) {
    const rest = s.slice(store.length).replace(/^[\s\-–—:·|]+/, '').trim();
    if (rest) return rest;
  }
  // 3) corta a partir da palavra-chave do dispositivo (ex: "...JACU PÊSSEGO Painel Caixa 1" -> "Painel Caixa 1")
  const m = s.match(DEVICE_KEYWORD);
  if (m && m.index !== undefined && m.index > 0) {
    const rest = s.slice(m.index).trim();
    if (rest) return rest;
  }
  return original || 'Dispositivo';
};

const parseStoreCode = (name: string): string => {
  const m1 = name.match(/(?:lj|loja)\s*(\d{1,6})/i);
  if (m1) return m1[1];
  const m2 = name.match(/\b(\d{2,6})\b/);
  return m2 ? m2[1] : '';
};

// Cor da célula semanal por % (regras da Rayanne)
const weekCellClass = (pct: number | null): string => {
  if (pct === null || Number.isNaN(pct)) return 'bg-gray-800/60 text-gray-500';
  if (pct < 50) return 'bg-red-400 text-red-950';
  if (pct < 70) return 'bg-amber-300 text-amber-950';
  if (pct < 90) return 'bg-green-400 text-green-950';
  return 'bg-green-600 text-white';
};

const WINDOW_DAYS = 70; // cobre 8 semanas + média móvel
const DAILY_DAYS = 45;

export function EvolucaoMonitoramento() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [clients, setClients] = useState<ClientRow[]>([]);
  const [scope, setScope] = useState<Scope>(() => (user?.role === 'client' ? (user?.clientId || '') : 'all'));
  const [tab, setTab] = useState<'diario' | 'semanal' | 'criticidade'>('diario');
  const [critFilter, setCritFilter] = useState<'gt24' | 'lt24'>('gt24');
  const [weekPage, setWeekPage] = useState(0);
  const [expandedStore, setExpandedStore] = useState<string | null>(null);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'' | 'online' | 'offline' | 'not_connected'>('');
  const [filterWeekday, setFilterWeekday] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const PAGE_SIZE = 50;
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const [stores, setStores] = useState<StoreRow[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [snaps, setSnaps] = useState<SnapRow[]>([]);

  // Cliente fica travado na própria rede
  const effectiveScope: Scope = isAdmin ? scope : (user?.clientId || '');

  // Carrega lista de redes (admin)
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('clients').select('id, name').order('name', { ascending: true });
      if (!cancelled && data) setClients(data as ClientRow[]);
    })();
    return () => { cancelled = true; };
  }, [isAdmin]);

  const load = useCallback(async () => {
    if (isAdmin === false && !user?.clientId) return;
    setLoading(true);
    try {
      // Grava o retrato de hoje (para os dados ficarem exatos daqui pra frente)
      supabase.rpc('snapshot_device_status_today').then(() => {}, () => {});

      const windowStart = addDays(todaySp(), -WINDOW_DAYS);
      const today = todaySp();

      // Lojas (filtra por rede quando não for "todas")
      let storeQuery = supabase.from('stores').select('id, name, city, client_id');
      if (effectiveScope !== 'all') storeQuery = storeQuery.eq('client_id', effectiveScope);
      const { data: storeData } = await storeQuery;
      const storeRows = (storeData || []) as StoreRow[];
      const storeIds = new Set(storeRows.map((s) => s.id));

      // Dispositivos (tabela pequena — busca tudo e filtra pelas lojas do escopo)
      const { data: devData } = await supabase.from('devices').select('id, store_id, mac_address, status, name');
      const devRows = ((devData || []) as DeviceRow[]).filter((d) => storeIds.has(d.store_id));

      // Snapshots do período
      let snapQuery = supabase.from('device_status_daily').select('store_id, client_id, date, total, online, offline, not_connected').gte('date', windowStart);
      if (effectiveScope !== 'all') snapQuery = snapQuery.eq('client_id', effectiveScope);
      const { data: snapData } = await snapQuery;
      const snapRows = ((snapData || []) as SnapRow[]).filter((r) => storeIds.has(r.store_id));

      // Alertas (quedas/recuperações) que sobrepõem o período
      let alertQuery = supabase
        .from('device_offline_alerts')
        .select('first_detected_at, resolved_at, device_id, store_id, client_id, device_name, store_name')
        .lte('first_detected_at', `${today}T23:59:59`)
        .or(`resolved_at.is.null,resolved_at.gte.${windowStart}T00:00:00`)
        .limit(20000);
      if (effectiveScope !== 'all') alertQuery = alertQuery.eq('client_id', effectiveScope);
      const { data: alertData } = await alertQuery;
      const alertRows = ((alertData || []) as AlertRow[]).filter((r) => storeIds.has(r.store_id));

      setStores(storeRows);
      setDevices(devRows);
      setSnaps(snapRows);
      setAlerts(alertRows);
      setLastUpdate(new Date());
    } finally {
      setLoading(false);
    }
  }, [effectiveScope, isAdmin, user?.clientId]);

  useEffect(() => { void load(); }, [load]);

  // ── Contagem atual (dedup por MAC, pior status) por loja ──────────────────
  const deviceCountByStore = useMemo(() => {
    const map = new Map<string, number>();
    const seen = new Map<string, 'online' | 'offline' | 'not_connected'>(); // key store|mac
    for (const d of devices) {
      const key = `${d.store_id}|${d.mac_address?.trim() || d.id}`;
      const st = normStatus(d.status);
      const prev = seen.get(key);
      if (!prev || statusRank(st) > statusRank(prev)) seen.set(key, st);
    }
    for (const key of seen.keys()) {
      const storeId = key.split('|')[0];
      map.set(storeId, (map.get(storeId) ?? 0) + 1);
    }
    return map;
  }, [devices]);

  // Status atual de cada dispositivo (por id)
  const deviceStatusById = useMemo(() => {
    const m = new Map<string, 'online' | 'offline' | 'not_connected'>();
    for (const d of devices) m.set(d.id, normStatus(d.status));
    return m;
  }, [devices]);

  // Quantidade de quedas por dispositivo no período carregado (últimos WINDOW_DAYS)
  const quedasByDevice = useMemo(() => {
    const m = new Map<string, number>();
    const startMs = Date.now() - WINDOW_DAYS * 86400000;
    for (const a of alerts) {
      const t = Date.parse(a.first_detected_at);
      if (Number.isFinite(t) && t >= startMs) m.set(a.device_id, (m.get(a.device_id) ?? 0) + 1);
    }
    return m;
  }, [alerts]);

  // ── Criticidade: dispositivos atualmente offline, agrupados por loja ──────
  const criticalityRows = useMemo(() => {
    const now = Date.now();
    const groups = new Map<string, { loja: string; devices: { key: string; name: string; since: string; hours: number; quedas: number }[] }>();
    for (const a of alerts) {
      if (a.resolved_at) continue; // só os que ainda estão offline
      const detected = Date.parse(a.first_detected_at);
      if (!Number.isFinite(detected)) continue;
      const hours = (now - detected) / 3600000;
      const matches = critFilter === 'gt24' ? hours >= 24 : hours < 24;
      if (!matches) continue;
      const loja = a.store_name || '—';
      const g = groups.get(loja) ?? { loja, devices: [] };
      g.devices.push({
        key: `${a.device_id}-${a.first_detected_at}`,
        name: deviceLabel(a.device_name, a.store_name),
        since: a.first_detected_at,
        hours,
        quedas: quedasByDevice.get(a.device_id) ?? 0,
      });
      groups.set(loja, g);
    }
    const list = [...groups.values()];
    list.forEach((g) => g.devices.sort((x, y) => y.hours - x.hours));
    // lojas com mais dispositivos offline primeiro
    return list.sort((x, y) => y.devices.length - x.devices.length || x.loja.localeCompare(y.loja));
  }, [alerts, critFilter, quedasByDevice]);

  const critTotalDevices = useMemo(() => criticalityRows.reduce((acc, g) => acc + g.devices.length, 0), [criticalityRows]);

  const fmtDuration = (hours: number) => {
    if (hours >= 24) { const d = Math.floor(hours / 24); const h = Math.round(hours % 24); return `${d}d ${h}h`; }
    if (hours >= 1) return `${Math.round(hours)}h`;
    return `${Math.round(hours * 60)}min`;
  };

  const currentTotals = useMemo(() => {
    const seen = new Map<string, 'online' | 'offline' | 'not_connected'>();
    for (const d of devices) {
      const key = `${d.store_id}|${d.mac_address?.trim() || d.id}`;
      const st = normStatus(d.status);
      const prev = seen.get(key);
      if (!prev || statusRank(st) > statusRank(prev)) seen.set(key, st);
    }
    let online = 0, offline = 0, nc = 0;
    for (const st of seen.values()) { if (st === 'online') online++; else if (st === 'offline') offline++; else nc++; }
    return { total: online + offline + nc, online, offline, notConnected: nc };
  }, [devices]);

  const totalDevicesNow = currentTotals.total;

  // ── Tabela DIÁRIA ─────────────────────────────────────────────────────────
  const dailyRows = useMemo<DailyRow[]>(() => {
    const today = todaySp();
    // pré-processa alertas em datas SP
    const alertDates = alerts.map((a) => ({
      dev: a.device_id,
      start: spDate(a.first_detected_at),
      end: a.resolved_at ? spDate(a.resolved_at) : null,
    }));
    // snapshots somados por dia
    const snapByDate = new Map<string, { total: number; online: number; offline: number; nc: number }>();
    for (const s of snaps) {
      const cur = snapByDate.get(s.date) ?? { total: 0, online: 0, offline: 0, nc: 0 };
      cur.total += s.total; cur.online += s.online; cur.offline += s.offline; cur.nc += s.not_connected;
      snapByDate.set(s.date, cur);
    }

    const rows: DailyRow[] = [];
    for (let i = DAILY_DAYS - 1; i >= 0; i--) {
      const day = addDays(today, -i);

      const quedas = alertDates.filter((a) => a.start === day).length;
      const recuperacoes = alertDates.filter((a) => a.end === day).length;

      const snap = snapByDate.get(day);
      let total: number, online: number, offline: number, notConnected: number, hasSnapshot: boolean;
      if (day === today) {
        // Hoje: contagem ao vivo (exata, igual à página de dispositivos)
        total = currentTotals.total; online = currentTotals.online;
        offline = currentTotals.offline; notConnected = currentTotals.notConnected;
        hasSnapshot = true;
      } else if (snap && snap.total > 0) {
        total = snap.total; online = snap.online; offline = snap.offline; notConnected = snap.nc; hasSnapshot = true;
      } else {
        // offline = dispositivos únicos com queda cobrindo o dia (dado real das quedas)
        const offlineDevs = new Set<string>();
        for (const a of alertDates) {
          const endDay = a.end ?? today;
          if (a.start <= day && endDay >= day) offlineDevs.add(a.dev);
        }
        offline = offlineDevs.size;
        total = totalDevicesNow;
        // Não-conectado = aparelhos permanentemente não conectados (os de hoje).
        // online = o que sobra: total − offline − não-conectado.
        notConnected = Math.min(currentTotals.notConnected, Math.max(0, total - offline));
        online = Math.max(0, total - offline - notConnected);
        hasSnapshot = false;
      }

      const pctOnline = total > 0 ? Number(((online / total) * 100).toFixed(1)) : null;
      rows.push({
        date: day, weekday: weekdayPt(day),
        total, online, offline, notConnected, pctOnline, movingAvg7: null,
        quedas, recuperacoes, saldo: recuperacoes - quedas, mudancas: quedas + recuperacoes,
        hasSnapshot,
      });
    }
    // média móvel 7 dias sobre pctOnline
    for (let i = 0; i < rows.length; i++) {
      const slice = rows.slice(Math.max(0, i - 6), i + 1).map((r) => r.pctOnline).filter((v): v is number => v !== null);
      rows[i].movingAvg7 = slice.length > 0 ? Number((slice.reduce((a, b) => a + b, 0) / slice.length).toFixed(1)) : null;
    }
    return [...rows].reverse(); // mais recente no topo
  }, [alerts, snaps, totalDevicesNow, currentTotals]);

  // Filtros (estilo Excel) da tabela diária
  const filteredDailyRows = useMemo(() => dailyRows.filter((r) => {
    if (filterWeekday && r.weekday !== filterWeekday) return false;
    if (filterFrom && r.date < filterFrom) return false;
    if (filterTo && r.date > filterTo) return false;
    return true;
  }), [dailyRows, filterWeekday, filterFrom, filterTo]);

  // ── Tabela SEMANAL ──────────────────────────────────────────────────────────
  const weeks = useMemo<WeekDef[]>(() => {
    const curMon = mondayOf(todaySp());
    const out: WeekDef[] = [];
    for (let i = 7; i >= 0; i--) {
      const start = addDays(curMon, -7 * i);
      const end = addDays(start, 6);
      out.push({ key: start, label: `${ddmm(start)}`, start, end });
    }
    return out; // 8 semanas, mais antiga -> atual
  }, []);

  const weeklyRows = useMemo<WeeklyRow[]>(() => {
    const today = todaySp();
    const alertDates = alerts.map((a) => ({
      dev: a.device_id, store: a.store_id,
      start: spDate(a.first_detected_at),
      end: a.resolved_at ? spDate(a.resolved_at) : null,
    }));
    // snapshot por loja+dia
    const snapMap = new Map<string, SnapRow>(); // store|date
    for (const s of snaps) snapMap.set(`${s.store_id}|${s.date}`, s);

    // Agrupa lojas duplicadas por (rede + nome) — junta os store_id repetidos numa linha só
    const groups = new Map<string, { name: string; storeIds: string[] }>();
    for (const store of stores) {
      const key = `${store.client_id}|${store.name.trim().toLowerCase()}`;
      const g = groups.get(key) ?? { name: store.name, storeIds: [] };
      g.storeIds.push(store.id);
      groups.set(key, g);
    }

    const rows: WeeklyRow[] = [...groups.values()].map((group) => {
      const storeIds = group.storeIds;
      const deviceCount = storeIds.reduce((acc, sid) => acc + (deviceCountByStore.get(sid) ?? 0), 0);
      const weekPct: (number | null)[] = weeks.map((w) => {
        // média diária de %online na semana (só dias <= hoje), somando todos os store_id do grupo
        const daily: number[] = [];
        for (let d = w.start; d <= w.end; d = addDays(d, 1)) {
          if (d > today) break;
          let snapTotal = 0, snapOnline = 0, hasSnap = false;
          for (const sid of storeIds) {
            const snap = snapMap.get(`${sid}|${d}`);
            if (snap && snap.total > 0) { snapTotal += snap.total; snapOnline += snap.online; hasSnap = true; }
          }
          if (hasSnap && snapTotal > 0) {
            daily.push((snapOnline / snapTotal) * 100);
          } else if (deviceCount > 0) {
            const offlineDevs = new Set<string>();
            for (const a of alertDates) {
              if (!storeIds.includes(a.store)) continue;
              const endDay = a.end ?? today;
              if (a.start <= d && endDay >= d) offlineDevs.add(a.dev);
            }
            const online = Math.max(0, deviceCount - offlineDevs.size);
            daily.push((online / deviceCount) * 100);
          }
        }
        if (daily.length === 0) return null;
        return Number((daily.reduce((a, b) => a + b, 0) / daily.length).toFixed(0));
      });

      const withData = weekPct.filter((v): v is number => v !== null);
      const weeksWithData = withData.length;
      let lastPct: number | null = null, prevPct: number | null = null;
      for (let i = weekPct.length - 1; i >= 0; i--) {
        if (weekPct[i] !== null) {
          if (lastPct === null) lastPct = weekPct[i];
          else { prevPct = weekPct[i]; break; }
        }
      }
      const delta = lastPct !== null && prevPct !== null ? Number((lastPct - prevPct).toFixed(1)) : null;
      let trend: WeeklyRow['trend'] = '—';
      if (delta !== null) trend = delta > 1 ? 'Melhorou' : delta < -1 ? 'Piorou' : 'Estável';

      return {
        storeId: storeIds[0], storeIds, name: group.name, code: parseStoreCode(group.name),
        deviceCount, weekPct, lastPct, prevPct, delta, trend, weeksWithData,
      };
    });

    // Mostra TODAS as lojas (não esconde nenhuma). Ordem: Piorou -> Melhorou -> Estável -> sem dados
    const order: Record<WeeklyRow['trend'], number> = { Piorou: 0, Melhorou: 1, 'Estável': 2, '—': 3 };
    return rows.sort((a, b) => order[a.trend] - order[b.trend] || (a.delta ?? 0) - (b.delta ?? 0) || a.name.localeCompare(b.name));
  }, [stores, weeks, alerts, snaps, deviceCountByStore]);

  const trendClass = (t: WeeklyRow['trend']) =>
    t === 'Piorou' ? 'text-red-400' : t === 'Melhorou' ? 'text-green-400' : t === 'Estável' ? 'text-gray-400' : 'text-gray-600';

  // ── Exportação da aba visível ─────────────────────────────────────────────
  const scopeLabel = effectiveScope === 'all'
    ? 'Todas as redes'
    : (clients.find((c) => c.id === effectiveScope)?.name ?? 'Rede');
  const scopeSlug = scopeLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const buildDaily = () => {
    const headers = ['Data', 'Dia', 'Dispositivos', 'Online', 'Offline', 'Não Conectado', '% Online', 'Média 7d', 'Novas Quedas', 'Recuperações', 'Saldo', 'Mudanças de Status'];
    const rows: (string | number)[][] = filteredDailyRows.map((r) => [
      `${ddmm(r.date)}/${r.date.slice(0, 4)}`, r.weekday, r.total, r.online, r.offline,
      r.notConnected,
      r.pctOnline !== null ? `${r.pctOnline}%` : '—',
      r.movingAvg7 !== null ? `${r.movingAvg7}%` : '—',
      r.quedas, r.recuperacoes, r.saldo, r.mudancas,
    ]);
    return { headers, rows };
  };
  const buildWeekly = () => {
    const headers = ['Loja', 'Código', 'Dispositivos', ...weeks.map((w) => w.label), 'Última semana', 'Semana anterior', 'Δ p.p.', 'Tendência', 'Semanas com dados'];
    const rows: (string | number)[][] = weeklyRows.map((r) => [
      r.name, r.code || '—', r.deviceCount,
      ...r.weekPct.map((p) => (p !== null ? `${p}%` : '')),
      r.lastPct !== null ? `${r.lastPct}%` : '—',
      r.prevPct !== null ? `${r.prevPct}%` : '—',
      r.delta !== null ? `${r.delta > 0 ? '+' : ''}${r.delta}` : '—',
      r.trend, r.weeksWithData,
    ]);
    return { headers, rows };
  };
  const handleExport = (format: 'csv' | 'pdf') => {
    const today = todaySp();
    if (tab === 'diario') {
      const { headers, rows } = buildDaily();
      const fname = `evolucao-diario-${scopeSlug}-${today}`;
      if (format === 'csv') downloadCsv(fname, headers, rows);
      else downloadPdf(`Evolução Diária — ${scopeLabel}`, headers, rows, fname, 'landscape');
    } else {
      const { headers, rows } = buildWeekly();
      const fname = `evolucao-semanal-${scopeSlug}-${today}`;
      if (format === 'csv') downloadCsv(fname, headers, rows);
      else downloadPdf(`Evolução Semanal por Loja — ${scopeLabel}`, headers, rows, fname, 'landscape');
    }
  };

  // ── Dispositivos offline num dia (expansão da tabela diária) ──────────────
  const fmtDateTime = (iso: string) => {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  };
  const buildDayDevices = (day: string) => {
    const today = todaySp();
    return alerts
      .filter((a) => {
        const start = spDate(a.first_detected_at);
        const end = a.resolved_at ? spDate(a.resolved_at) : today;
        return start <= day && end >= day;
      })
      .map((a) => ({
        key: `${a.device_id}-${a.first_detected_at}`,
        name: deviceLabel(a.device_name, a.store_name),
        store: a.store_name || '—',
        since: a.first_detected_at,
        until: a.resolved_at,
        status: deviceStatusById.get(a.device_id) ?? 'offline',
        quedas: quedasByDevice.get(a.device_id) ?? 0,
      }))
      .sort((x, y) => x.store.localeCompare(y.store) || x.name.localeCompare(y.name));
  };

  // ── Dispositivos de uma loja (expansão) — % por semana, sem cor ───────────
  const buildDeviceRows = (storeIds: string[]): DeviceWeekRow[] => {
    const today = todaySp();
    const alertDates = alerts.map((a) => ({
      dev: a.device_id,
      start: spDate(a.first_detected_at),
      end: a.resolved_at ? spDate(a.resolved_at) : null,
    }));
    // dedup por MAC (junta os device_id do mesmo aparelho)
    const macMap = new Map<string, { name: string; ids: string[]; status: 'online' | 'offline' | 'not_connected' }>();
    for (const d of devices) {
      if (!storeIds.includes(d.store_id)) continue;
      const key = (d.mac_address && d.mac_address.trim()) || d.id;
      const cur = macMap.get(key) ?? { name: d.name ? deviceLabel(d.name, null) : `Dispositivo ${key}`, ids: [], status: 'online' as const };
      cur.ids.push(d.id);
      if (d.name) cur.name = deviceLabel(d.name, null);
      const st = normStatus(d.status);
      if (statusRank(st) > statusRank(cur.status)) cur.status = st; // mantém o pior status
      macMap.set(key, cur);
    }
    return [...macMap.values()].map((dev, idx) => {
      const idSet = new Set(dev.ids);
      const weekPct: (number | null)[] = weeks.map((w) => {
        const vals: number[] = [];
        for (let d = w.start; d <= w.end; d = addDays(d, 1)) {
          if (d > today) break;
          const offline = alertDates.some((a) => idSet.has(a.dev) && a.start <= d && (a.end ?? today) >= d);
          vals.push(offline ? 0 : 100);
        }
        return vals.length === 0 ? null : Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
      });
      let lastPct: number | null = null, prevPct: number | null = null;
      for (let i = weekPct.length - 1; i >= 0; i--) {
        if (weekPct[i] !== null) {
          if (lastPct === null) lastPct = weekPct[i];
          else { prevPct = weekPct[i]; break; }
        }
      }
      const delta = lastPct !== null && prevPct !== null ? Number((lastPct - prevPct).toFixed(1)) : null;
      let trend: DeviceWeekRow['trend'] = '—';
      if (delta !== null) trend = delta > 1 ? 'Melhorou' : delta < -1 ? 'Piorou' : 'Estável';
      const quedas = dev.ids.reduce((acc, id) => acc + (quedasByDevice.get(id) ?? 0), 0);
      return {
        key: `${dev.ids[0]}-${idx}`, name: dev.name, status: dev.status, quedas, weekPct, lastPct, prevPct, delta, trend,
        weeksWithData: weekPct.filter((v) => v !== null).length,
      };
    });
  };

  // ── Paginação da tabela semanal ──────────────────────────────────────────
  const totalWeekPages = Math.max(1, Math.ceil(weeklyRows.length / PAGE_SIZE));
  const safeWeekPage = Math.min(Math.max(0, weekPage), totalWeekPages - 1);
  const pagedWeekly = weeklyRows.slice(safeWeekPage * PAGE_SIZE, safeWeekPage * PAGE_SIZE + PAGE_SIZE);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 md:p-6 text-gray-100">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Activity className="w-6 h-6 text-blue-400" />
          <h1 className="text-xl font-bold">Monitoramento de Evolução</h1>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm"
            >
              <option value="all">Todas as redes</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as '' | 'online' | 'offline' | 'not_connected')}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm"
            title="Filtra os dispositivos ao expandir (por status atual)"
          >
            <option value="">Status: todos</option>
            <option value="online">Online</option>
            <option value="offline">Offline</option>
            <option value="not_connected">Não conectado</option>
          </select>
          <button
            onClick={() => handleExport('csv')}
            className="flex items-center gap-1.5 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm hover:bg-gray-700"
            title="Exportar a aba atual em CSV"
          >
            <FileDown className="w-4 h-4" /> CSV
          </button>
          <button
            onClick={() => handleExport('pdf')}
            className="flex items-center gap-1.5 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm hover:bg-gray-700"
            title="Exportar a aba atual em PDF"
          >
            <FileText className="w-4 h-4" /> PDF
          </button>
          <button
            onClick={() => void load()}
            className="flex items-center gap-1.5 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm hover:bg-gray-700"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Atualizar
          </button>
        </div>
      </div>

      {/* Abas */}
      <div className="flex gap-1 mb-4 bg-gray-900 p-1 rounded-lg w-fit border border-gray-800">
        <button
          onClick={() => setTab('diario')}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium ${tab === 'diario' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
        >
          <CalendarDays className="w-4 h-4" /> Diário
        </button>
        <button
          onClick={() => setTab('semanal')}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium ${tab === 'semanal' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
        >
          <CalendarRange className="w-4 h-4" /> Semanal por Loja
        </button>
        <button
          onClick={() => setTab('criticidade')}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium ${tab === 'criticidade' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
        >
          <AlertTriangle className="w-4 h-4" /> Criticidade
        </button>
      </div>

      {lastUpdate && (
        <p className="text-xs text-gray-500 mb-2">
          Atualizado: {lastUpdate.toLocaleString('pt-BR')}
        </p>
      )}

      {tab === 'diario' ? (
        <>
        <div className="flex flex-wrap items-end gap-3 mb-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-400">Dia da semana</span>
            <select
              value={filterWeekday}
              onChange={(e) => setFilterWeekday(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5"
            >
              <option value="">Todos</option>
              {['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'].map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-400">De</span>
            <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-400">Até</span>
            <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5" />
          </label>
          {(filterWeekday || filterFrom || filterTo) && (
            <button
              onClick={() => { setFilterWeekday(''); setFilterFrom(''); setFilterTo(''); }}
              className="px-3 py-1.5 rounded-lg border border-gray-700 bg-gray-800 hover:bg-gray-700"
            >Limpar filtros</button>
          )}
          <span className="text-xs text-gray-500 ml-auto self-center">{filteredDailyRows.length} dias</span>
        </div>
        <div className="overflow-x-auto border border-gray-800 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-gray-900 text-gray-300">
              <tr>
                {['Data', 'Dia', 'Dispositivos', 'Online', 'Offline', 'Não Conect.', '% Online', 'Média 7d', 'Quedas', 'Recuperações', 'Saldo', 'Mud. status'].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredDailyRows.map((r) => {
                const isOpen = expandedDay === r.date;
                const offlineDevs = isOpen
                  ? buildDayDevices(r.date).filter((d) => !statusFilter || d.status === statusFilter)
                  : [];
                return (
                <Fragment key={r.date}>
                <tr
                  className="border-t border-gray-800 hover:bg-gray-900/50 cursor-pointer"
                  onClick={() => setExpandedDay(isOpen ? null : r.date)}
                >
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1">
                      {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                      {ddmm(r.date)}/{r.date.slice(0, 4)}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-gray-400">{r.weekday}</td>
                  <td className="px-3 py-1.5">{r.total}</td>
                  <td className="px-3 py-1.5 text-green-400">{r.online}</td>
                  <td className="px-3 py-1.5 text-red-400">{r.offline}</td>
                  <td className="px-3 py-1.5 text-gray-400">{r.notConnected}</td>
                  <td className="px-3 py-1.5 font-semibold">{r.pctOnline !== null ? `${r.pctOnline}%` : '—'}</td>
                  <td className="px-3 py-1.5 text-gray-300">{r.movingAvg7 !== null ? `${r.movingAvg7}%` : '—'}</td>
                  <td className="px-3 py-1.5 text-red-300">{r.quedas}</td>
                  <td className="px-3 py-1.5 text-green-300">{r.recuperacoes}</td>
                  <td className={`px-3 py-1.5 font-medium ${r.saldo > 0 ? 'text-green-400' : r.saldo < 0 ? 'text-red-400' : 'text-gray-400'}`}>{r.saldo > 0 ? `+${r.saldo}` : r.saldo}</td>
                  <td className="px-3 py-1.5 text-gray-300">{r.mudancas}</td>
                </tr>
                {isOpen && (
                  <tr className="bg-gray-900/40">
                    <td colSpan={12} className="px-6 py-2">
                      {offlineDevs.length === 0 ? (
                        <span className="text-gray-500 text-xs">Nenhum dispositivo offline neste dia.</span>
                      ) : (
                        <div className="text-xs">
                          <div className="text-gray-400 mb-1">{offlineDevs.length} dispositivo(s) offline em {ddmm(r.date)}:</div>
                          <table className="w-full">
                            <thead className="text-gray-500">
                              <tr>
                                <th className="text-left font-medium py-0.5 pr-4">Dispositivo</th>
                                <th className="text-left font-medium py-0.5 pr-4">Loja</th>
                                <th className="text-left font-medium py-0.5 pr-4">Queda em</th>
                                <th className="text-left font-medium py-0.5 pr-4">Retorno</th>
                                <th className="text-center font-medium py-0.5">Quedas no período</th>
                              </tr>
                            </thead>
                            <tbody>
                              {offlineDevs.map((d) => (
                                <tr key={d.key} className="text-gray-300">
                                  <td className="py-0.5 pr-4">{d.name}</td>
                                  <td className="py-0.5 pr-4 text-gray-400">{d.store}</td>
                                  <td className="py-0.5 pr-4">{fmtDateTime(d.since)}</td>
                                  <td className="py-0.5 pr-4">{d.until ? fmtDateTime(d.until) : <span className="text-red-400">continua offline</span>}</td>
                                  <td className="py-0.5 text-center text-amber-400/80">{d.quedas}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </td>
                  </tr>
                )}
                </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      ) : tab === 'semanal' ? (
        <>
        <div className="border border-gray-800 rounded-lg overflow-hidden">
          <table className="w-full table-fixed text-xs">
            <thead className="bg-gray-900 text-gray-300">
              <tr>
                <th className="px-2 py-2 text-left font-semibold w-[16%]">Loja</th>
                <th className="px-1 py-2 text-left font-semibold w-[4%]">Cód.</th>
                <th className="px-1 py-2 text-center font-semibold w-[4%]">Disp.</th>
                {weeks.map((w) => (
                  <th key={w.key} className="px-1 py-2 text-center font-semibold w-[5.5%] leading-tight text-[10px]">
                    {ddmm(w.start)}<br />a {ddmm(w.end)}
                  </th>
                ))}
                <th className="px-1 py-2 text-center font-semibold w-[6%]">Últ.</th>
                <th className="px-1 py-2 text-center font-semibold w-[6%]">Ant.</th>
                <th className="px-1 py-2 text-center font-semibold w-[5%]">Δ</th>
                <th className="px-2 py-2 text-left font-semibold w-[9%]">Tendência</th>
                <th className="px-1 py-2 text-center font-semibold w-[4.5%]">Sem.</th>
              </tr>
            </thead>
            <tbody>
              {pagedWeekly.map((r) => {
                const isOpen = expandedStore === r.storeId;
                const deviceRows = isOpen
                  ? buildDeviceRows(r.storeIds).filter((dr) => !statusFilter || dr.status === statusFilter)
                  : [];
                return (
                <Fragment key={r.storeId}>
                <tr
                  className="border-t border-gray-800 cursor-pointer hover:bg-gray-900/40"
                  onClick={() => setExpandedStore(isOpen ? null : r.storeId)}
                >
                  <td className="px-2 py-1.5 truncate" title={r.name}>
                    <span className="inline-flex items-center gap-1 w-full">
                      {isOpen ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
                      <span className="truncate">{r.name}</span>
                    </span>
                  </td>
                  <td className="px-1 py-1.5 text-gray-400">{r.code || '—'}</td>
                  <td className="px-1 py-1.5 text-center text-gray-400">{r.deviceCount}</td>
                  {r.weekPct.map((p, i) => (
                    <td key={i} className="px-0.5 py-1 text-center">
                      <span className={`inline-block w-full rounded px-1 py-0.5 text-[10px] font-bold ${weekCellClass(p)}`}>
                        {p !== null ? `${p}%` : ''}
                      </span>
                    </td>
                  ))}
                  <td className="px-1 py-1.5 text-center font-semibold">{r.lastPct !== null ? `${r.lastPct}%` : '—'}</td>
                  <td className="px-1 py-1.5 text-center text-gray-400">{r.prevPct !== null ? `${r.prevPct}%` : '—'}</td>
                  <td className={`px-1 py-1.5 text-center font-medium ${r.delta !== null && r.delta > 0 ? 'text-green-400' : r.delta !== null && r.delta < 0 ? 'text-red-400' : 'text-gray-400'}`}>
                    {r.delta !== null ? `${r.delta > 0 ? '+' : ''}${r.delta}` : '—'}
                  </td>
                  <td className={`px-2 py-1.5 font-medium whitespace-nowrap ${trendClass(r.trend)}`}>
                    {r.trend === 'Piorou' ? '▼ Piorou' : r.trend === 'Melhorou' ? '▲ Melhorou' : r.trend === 'Estável' ? '= Estável' : '—'}
                  </td>
                  <td className="px-1 py-1.5 text-center text-gray-400">{r.weeksWithData}</td>
                </tr>
                {isOpen && deviceRows.length === 0 && (
                  <tr className="bg-gray-900/30"><td colSpan={weeks.length + 8} className="px-8 py-2 text-gray-500 text-[11px]">Sem dispositivos cadastrados nesta loja.</td></tr>
                )}
                {isOpen && deviceRows.map((dr) => (
                  <tr key={dr.key} className="border-t border-gray-900 bg-gray-900/30 text-gray-300">
                    <td className="px-2 py-1 pl-6 truncate text-[11px]" title={dr.name}>
                      {dr.name}
                      {dr.quedas > 0 && <span className="ml-1 text-amber-400/80">· {dr.quedas} queda{dr.quedas > 1 ? 's' : ''}</span>}
                    </td>
                    <td className="px-1 py-1"></td>
                    <td className="px-1 py-1 text-center text-gray-600">1</td>
                    {dr.weekPct.map((p, i) => (
                      <td key={i} className="px-0.5 py-1 text-center text-[10px] text-gray-300">{p !== null ? `${p}%` : ''}</td>
                    ))}
                    <td className="px-1 py-1 text-center text-[11px]">{dr.lastPct !== null ? `${dr.lastPct}%` : '—'}</td>
                    <td className="px-1 py-1 text-center text-[11px] text-gray-400">{dr.prevPct !== null ? `${dr.prevPct}%` : '—'}</td>
                    <td className={`px-1 py-1 text-center text-[11px] ${dr.delta !== null && dr.delta > 0 ? 'text-green-400' : dr.delta !== null && dr.delta < 0 ? 'text-red-400' : 'text-gray-500'}`}>
                      {dr.delta !== null ? `${dr.delta > 0 ? '+' : ''}${dr.delta}` : '—'}
                    </td>
                    <td className={`px-2 py-1 whitespace-nowrap text-[11px] ${trendClass(dr.trend)}`}>
                      {dr.trend === 'Piorou' ? '▼ Piorou' : dr.trend === 'Melhorou' ? '▲ Melhorou' : dr.trend === 'Estável' ? '= Estável' : '—'}
                    </td>
                    <td className="px-1 py-1 text-center text-[11px] text-gray-400">{dr.weeksWithData}</td>
                  </tr>
                ))}
                </Fragment>
                );
              })}
              {weeklyRows.length === 0 && (
                <tr><td colSpan={weeks.length + 8} className="px-3 py-6 text-center text-gray-500">Sem lojas para exibir.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {totalWeekPages > 1 && (
          <div className="flex items-center justify-between mt-3 text-sm text-gray-400">
            <span>
              {weeklyRows.length} lojas · página {safeWeekPage + 1} de {totalWeekPages}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setWeekPage((p) => Math.max(0, p - 1))}
                disabled={safeWeekPage === 0}
                className="px-3 py-1 rounded border border-gray-700 bg-gray-800 disabled:opacity-40 hover:bg-gray-700"
              >Anterior</button>
              {Array.from({ length: totalWeekPages }, (_, i) => i)
                .filter((i) => Math.abs(i - safeWeekPage) <= 2 || i === 0 || i === totalWeekPages - 1)
                .map((i, idx, arr) => (
                  <span key={i} className="flex items-center">
                    {idx > 0 && i - arr[idx - 1] > 1 && <span className="px-1 text-gray-600">…</span>}
                    <button
                      onClick={() => setWeekPage(i)}
                      className={`px-3 py-1 rounded border ${i === safeWeekPage ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-700 bg-gray-800 hover:bg-gray-700'}`}
                    >{i + 1}</button>
                  </span>
                ))}
              <button
                onClick={() => setWeekPage((p) => Math.min(totalWeekPages - 1, p + 1))}
                disabled={safeWeekPage >= totalWeekPages - 1}
                className="px-3 py-1 rounded border border-gray-700 bg-gray-800 disabled:opacity-40 hover:bg-gray-700"
              >Próxima</button>
            </div>
          </div>
        )}
        </>
      ) : (
        <>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <button
            onClick={() => setCritFilter('gt24')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${critFilter === 'gt24' ? 'bg-red-600 border-red-600 text-white' : 'border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
          >Offline há mais de 24h</button>
          <button
            onClick={() => setCritFilter('lt24')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${critFilter === 'lt24' ? 'bg-amber-500 border-amber-500 text-gray-900' : 'border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
          >Offline há menos de 24h</button>
          <span className="text-xs text-gray-500 ml-auto">{critTotalDevices} dispositivo(s) · {criticalityRows.length} loja(s)</span>
        </div>
        <div className="overflow-x-auto border border-gray-800 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-gray-900 text-gray-300">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Loja / Dispositivo</th>
                <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">Offline desde</th>
                <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">Tempo offline</th>
                <th className="px-3 py-2 text-center font-semibold whitespace-nowrap">Quedas no período</th>
              </tr>
            </thead>
            <tbody>
              {criticalityRows.map((g) => (
                <Fragment key={g.loja}>
                  <tr className="border-t border-gray-800 bg-gray-900/40">
                    <td className="px-3 py-1.5 font-semibold text-white">{g.loja}</td>
                    <td className="px-3 py-1.5 text-gray-500 text-xs" colSpan={3}>{g.devices.length} dispositivo(s) offline</td>
                  </tr>
                  {g.devices.map((d) => (
                    <tr key={d.key} className="border-t border-gray-900 text-gray-300">
                      <td className="px-3 py-1.5 pl-8">{d.name}</td>
                      <td className="px-3 py-1.5 text-gray-400 whitespace-nowrap">{fmtDateTime(d.since)}</td>
                      <td className={`px-3 py-1.5 whitespace-nowrap font-medium ${d.hours >= 24 ? 'text-red-400' : 'text-amber-400'}`}>{fmtDuration(d.hours)}</td>
                      <td className="px-3 py-1.5 text-center">{d.quedas}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
              {criticalityRows.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-6 text-center text-gray-500">Nenhum dispositivo offline {critFilter === 'gt24' ? 'há mais de 24h' : 'há menos de 24h'}.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  );
}

export default EvolucaoMonitoramento;
