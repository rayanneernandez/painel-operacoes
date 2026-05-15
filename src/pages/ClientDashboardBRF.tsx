import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowDown, ArrowUp, Building2, Calendar, Camera, ChevronDown, Clock, Ghost, Image, LayoutGrid, Move, Package, RefreshCw, RotateCcw, Save, TrendingUp, User, Users, X, Zap } from 'lucide-react';
import supabase from '../lib/supabase';
import { Gondola3D, type ProductSlot } from '../components/Gondola3D';
import { DashboardChat } from '../components/DashboardChat';

type Span = 3 | 4 | 6 | 8 | 12;

type BrfWidgetType = {
  id: string;
  title: string;
  type: 'kpi' | 'chart' | 'section';
  size: 'quarter' | 'half' | 'full';
  description: string;
};

const BRF_CLIENT_ID = 'b93d290b-b069-4715-84cc-ddc393c9bfc1';

const GRID_AUTO_ROW_PX = 96;
const GRID_ROW_GAP_PX = 12;

const MOCK_RUPTURE_HOURLY = [0, 0, 0, 0, 0, 1, 2, 3, 4, 6, 5, 7, 8, 6, 5, 4, 6, 7, 5, 3, 2, 1, 0, 0];
const MOCK_QUEUE_LINE_MINUTES = [0, 0, 0, 0, 0, 2, 4, 6, 9, 12, 10, 14, 16, 13, 11, 9, 12, 15, 10, 7, 5, 3, 1, 0];
const MOCK_GONDOLA_PRODUCTS: ProductSlot[] = [
  { position: 4, code: '699856', name: 'Peito de Peru Fatiado Soltissimo', image: '/gondola/pos4.png', status: 'ok' },
  { position: 5, code: '63959', name: 'File Mignon Suino Mignoneto Sadia 180g', image: '/gondola/pos5.png', status: 'warning' },
  { position: 6, code: '763329', name: 'Presunto Cozido Fatiado 180g', image: '/gondola/pos6.png', status: 'rupture' },
];

const BRF_WIDGETS: BrfWidgetType[] = [
  { id: 'section_rupture', title: 'Ruptura', type: 'section', size: 'full', description: 'Alertas e rupturas por hora' },
  // Ruptura
  { id: 'rupture_orange', title: 'Alertas Laranja', type: 'kpi', size: 'quarter', description: 'Ruptura iminente' },
  { id: 'rupture_red', title: 'Alertas Vermelho', type: 'kpi', size: 'quarter', description: 'Ruptura confirmada' },
  { id: 'rupture_hourly', title: 'Rupturas por Hora', type: 'chart', size: 'half', description: 'Quantidade de rupturas por hora' },

  { id: 'section_operation', title: 'Operação', type: 'section', size: 'full', description: 'Distribuição de operadores no período' },
  // Operação
  { id: 'op_hours_two', title: '2+ Operadores', type: 'kpi', size: 'quarter', description: 'Horas com 2 ou mais operadores' },
  { id: 'op_hours_one', title: '1 Operador', type: 'kpi', size: 'quarter', description: 'Horas com apenas 1 operador' },
  { id: 'op_hours_zero', title: '0 Operadores', type: 'kpi', size: 'quarter', description: 'Horas sem operadores' },
  { id: 'op_dist_chart', title: 'Distribuição de Operadores', type: 'chart', size: 'half', description: 'Percentual de tempo por nível de operação' },

  { id: 'section_queue', title: 'Fila', type: 'section', size: 'full', description: 'Pessoas na fila e tempo médio' },
  // Fila
  { id: 'queue_total', title: 'Total de Pessoas', type: 'kpi', size: 'quarter', description: 'Total de pessoas na fila no período' },
  { id: 'queue_avg', title: 'Tempo Médio', type: 'kpi', size: 'quarter', description: 'Tempo médio de espera na fila' },
  { id: 'queue_now', title: 'Pessoas Agora', type: 'kpi', size: 'quarter', description: 'Fila atual (atualiza a cada 5 min)' },
  { id: 'queue_rate', title: 'Taxa de Ocupação', type: 'kpi', size: 'quarter', description: 'Tempo médio × fila atual' },
  { id: 'queue_line', title: 'Tempo em Fila (Linha)', type: 'chart', size: 'full', description: 'Minutos (Y) ao longo das horas (X)' },
];

const BRF_DEFAULT_WIDGET_IDS = [
  'section_rupture',
  'rupture_orange',
  'rupture_red',
  'rupture_hourly',
  'section_operation',
  'op_hours_two',
  'op_hours_one',
  'op_hours_zero',
  'op_dist_chart',
  'section_queue',
  'queue_total',
  'queue_avg',
  'queue_now',
  'queue_rate',
  'queue_line',
];

function uniqStrings(values: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values || []) {
    const s = String(v || '').trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function ensureBefore(ids: string[], beforeId: string, toEnsure: string[]) {
  const existing = new Set(ids);
  const insertAt = ids.indexOf(beforeId);
  const missing = (toEnsure || []).filter((x) => !existing.has(x));
  if (missing.length === 0) return ids;
  if (insertAt === -1) return [...ids, ...missing];
  const next = [...ids];
  next.splice(insertAt, 0, ...missing);
  return next;
}

function normalizeBrfWidgetIds(rawIds: string[]) {
  let ids = uniqStrings(rawIds);

  // Migração: layouts antigos usavam queue_p95/queue_max, agora usam queue_now/queue_rate.
  const legacyQueue = ids.includes('queue_p95') || ids.includes('queue_max') || (!ids.includes('queue_now') && !ids.includes('queue_rate'));
  const legacyOps = ids.includes('op_total_preps') || ids.includes('op_avg_prep') || ids.includes('op_prep_line');
  if (legacyQueue || legacyOps) return [...BRF_DEFAULT_WIDGET_IDS];

  // Sempre garante os headers das seções.
  if (!ids.includes('section_rupture')) ids.unshift('section_rupture');
  if (!ids.includes('section_operation')) ids.push('section_operation');
  if (!ids.includes('section_queue')) ids.push('section_queue');

  // Seção Fila: garante 4 KPIs + gráfico.
  const queueRequired = ['queue_total', 'queue_avg', 'queue_now', 'queue_rate', 'queue_line'];
  for (const k of queueRequired) {
    if (!ids.includes(k)) ids.push(k);
  }

  // Insere os KPIs antes do gráfico.
  ids = ensureBefore(ids, 'queue_line', ['queue_total', 'queue_avg', 'queue_now', 'queue_rate']);

  // Se algum header estiver vindo DEPOIS dos cards da própria seção, reorganiza.
  const defaultOrder = new Map(BRF_DEFAULT_WIDGET_IDS.map((wid, idx) => [wid, idx]));
  const headerAfterChildren = (headerId: string, childIds: string[]) => {
    const h = ids.indexOf(headerId);
    if (h === -1) return false;
    const childIdxs = childIds.map((c) => ids.indexOf(c)).filter((i) => i !== -1);
    if (childIdxs.length === 0) return false;
    return h > Math.min(...childIdxs);
  };
  const needsCanonicalOrder =
    headerAfterChildren('section_rupture', ['rupture_orange', 'rupture_red', 'rupture_hourly']) ||
    headerAfterChildren('section_operation', ['op_hours_two', 'op_hours_one', 'op_hours_zero', 'op_dist_chart']) ||
    headerAfterChildren('section_queue', ['queue_total', 'queue_avg', 'queue_now', 'queue_rate', 'queue_line']);

  if (needsCanonicalOrder) {
    const known = ids.filter((wid) => defaultOrder.has(wid)).sort((a, b) => (defaultOrder.get(a) as number) - (defaultOrder.get(b) as number));
    const unknown = ids.filter((wid) => !defaultOrder.has(wid));
    ids = [...known, ...unknown];
  }

  return ids;
}

function widgetsFromIds(ids: string[]) {
  return ids
    .map((wid) => BRF_WIDGETS.find((w) => w.id === wid))
    .filter(Boolean) as BrfWidgetType[];
}

function defaultSpanForSize(size: BrfWidgetType['size']): Span {
  if (size === 'full') return 12;
  if (size === 'half') return 6;
  return 3;
}

function computeRowSpan(widget: BrfWidgetType, heightPx?: number): number {
  if (widget.type === 'section') return 1;
  if (widget.type === 'kpi') return 1;
  const fallback = widget.size === 'full' ? 3 : 2;
  if (!Number.isFinite(Number(heightPx))) return fallback;
  const resolvedHeightPx = Math.max(1, Math.round(Number(heightPx)));
  return Math.max(1, Math.ceil((resolvedHeightPx + GRID_ROW_GAP_PX) / (GRID_AUTO_ROW_PX + GRID_ROW_GAP_PX)));
}

function fmtMinutes(seconds: number) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function alignUtcStartOfDay(value: Date | string) {
  const d = value instanceof Date ? new Date(value) : new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

function alignUtcEndOfDay(value: Date | string) {
  const d = value instanceof Date ? new Date(value) : new Date(value);
  d.setHours(23, 59, 59, 999);
  return d;
}

function formatDateInputValue(value: Date) {
  const yyyy = value.getFullYear();
  const mm = String(value.getMonth() + 1).padStart(2, '0');
  const dd = String(value.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parseDateInputValue(value: string, endOfDay = false) {
  const [y, m, d] = value.split('-').map((v) => Number(v));
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime())) return null;
  if (endOfDay) dt.setHours(23, 59, 59, 999);
  else dt.setHours(0, 0, 0, 0);
  return dt;
}

function isLightAppTheme() {
  if (typeof document === 'undefined') return false;
  return document.documentElement.dataset.appTheme === 'light';
}

function useThemeSignal() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const update = () => setTick((value) => value + 1);
    window.addEventListener('app-theme-change', update);
    window.addEventListener('dashboard-theme-change', update);
    window.addEventListener('storage', update);
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-app-theme'] });
    return () => {
      window.removeEventListener('app-theme-change', update);
      window.removeEventListener('dashboard-theme-change', update);
      window.removeEventListener('storage', update);
      observer.disconnect();
    };
  }, []);
  return tick;
}

function useChartJs(canvasRef: React.RefObject<HTMLCanvasElement>, config: () => object | null, deps: any[]) {
  const chartRef = React.useRef<any>(null);
  const themeTick = useThemeSignal();
  React.useEffect(() => {
    let cancelled = false;
    const init = () => {
      if (cancelled || !canvasRef.current) return;
      const ChartJs = (window as any).Chart;
      if (!ChartJs) return;
      const cfg = config();
      if (!cfg) return;
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
      chartRef.current = new ChartJs(canvasRef.current, cfg);
    };
    if ((window as any).Chart) {
      init();
    } else {
      let tries = 0;
      const poll = setInterval(() => {
        if ((window as any).Chart || tries++ > 30) {
          clearInterval(poll);
          init();
        }
      }, 100);
      return () => {
        cancelled = true;
        clearInterval(poll);
        chartRef.current?.destroy();
        chartRef.current = null;
      };
    }
    return () => {
      cancelled = true;
      chartRef.current?.destroy();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, themeTick]);
}

function LineChart({
  title,
  subtitle,
  labels,
  seriesLabel,
  values,
  yUnit,
  accentColor = '#10b981',
}: {
  title: string;
  subtitle: string;
  labels: string[];
  seriesLabel: string;
  values: number[];
  yUnit: 'count' | 'minutes';
  accentColor?: string;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const safeLabels = labels.length === values.length ? labels : new Array(values.length).fill('');
  const yTick = (v: number) => (yUnit === 'minutes' ? `${v}m` : String(v));

  useChartJs(
    canvasRef,
    () => {
      const light = isLightAppTheme();
      return {
        type: 'line',
        data: {
          labels: safeLabels,
          datasets: [
            {
              label: seriesLabel,
              data: values,
              borderColor: accentColor,
              backgroundColor: `${accentColor}18`,
              fill: true,
              borderWidth: 2.5,
              pointRadius: 0,
              pointHitRadius: 16,
              pointHoverRadius: 4,
              pointHoverBackgroundColor: accentColor,
              pointHoverBorderColor: light ? '#ffffff' : '#fff',
              pointHoverBorderWidth: 2,
              tension: 0.4,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          layout: { padding: { top: 12, right: 16, bottom: 8, left: 8 } },
          interaction: { mode: 'index', intersect: false, axis: 'x' },
          hover: { mode: 'index', intersect: false, axis: 'x' },
          plugins: {
            legend: { display: false },
            tooltip: {
              mode: 'index',
              intersect: false,
              backgroundColor: light ? 'rgba(255, 255, 255, 0.98)' : 'rgba(17, 24, 39, 0.95)',
              borderColor: light ? 'rgba(148,163,184,0.45)' : 'rgba(255,255,255,0.1)',
              borderWidth: 1,
              titleColor: light ? '#0f172a' : '#ffffff',
              bodyColor: light ? '#334155' : '#ffffff',
              titleFont: { size: 12, weight: '600' },
              bodyFont: { size: 12 },
              padding: { x: 12, y: 8 },
              cornerRadius: 8,
              displayColors: false,
            },
          },
          scales: {
            x: {
              grid: { color: light ? 'rgba(15,23,42,0.08)' : 'rgba(255,255,255,0.04)', drawBorder: false },
              ticks: { color: light ? '#475569' : '#6b7280', font: { size: 10, weight: '500' }, maxTicksLimit: 12, padding: 8 },
              border: { display: false },
            },
            y: {
              beginAtZero: true,
              grid: { color: light ? 'rgba(15,23,42,0.08)' : 'rgba(255,255,255,0.04)', drawBorder: false },
              ticks: { color: light ? '#475569' : '#6b7280', font: { size: 10, weight: '500' }, callback: (v: any) => yTick(Number(v)), padding: 8 },
              border: { display: false },
            },
          },
        },
      };
    },
    [JSON.stringify(safeLabels), JSON.stringify(values), yUnit, accentColor],
  );

  return (
    <div className="bg-[#0d1117] border border-gray-800/60 rounded-2xl p-5 h-full flex flex-col min-h-0 overflow-hidden transition-all hover:border-gray-700/60">
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div>
          <div className="font-semibold text-white text-sm">{title}</div>
          <div className="text-xs text-gray-300/70 mt-0.5">{subtitle}</div>
        </div>
        <div className="flex items-center gap-1.5 text-gray-600">
          <TrendingUp size={14} />
        </div>
      </div>
      <div className="w-full min-w-0 flex-1 min-h-0" style={{ minHeight: 180 }}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}

function HorizontalBarChart({
  title,
  subtitle,
  bars,
}: {
  title: string;
  subtitle: string;
  bars: { label: string; value: number; color: string }[];
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const total = bars.reduce((s, b) => s + b.value, 0);
  const pcts = bars.map((b) => (total > 0 ? Math.round((b.value / total) * 1000) / 10 : 0));
  const light = isLightAppTheme();

  useChartJs(
    canvasRef,
    () => ({
      type: 'bar',
      data: {
        labels: bars.map((b) => b.label),
        datasets: [{
          data: pcts,
          backgroundColor: bars.map((b) => b.color),
          borderRadius: 6,
          barThickness: 28,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 8, right: 32, bottom: 8, left: 8 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: light ? 'rgba(255,255,255,0.98)' : 'rgba(17,24,39,0.95)',
            borderColor: light ? 'rgba(148,163,184,0.45)' : 'rgba(255,255,255,0.1)',
            borderWidth: 1,
            titleColor: light ? '#0f172a' : '#ffffff',
            bodyColor: light ? '#334155' : '#ffffff',
            titleFont: { size: 12, weight: '600' },
            bodyFont: { size: 12 },
            padding: { x: 12, y: 8 },
            cornerRadius: 8,
            displayColors: false,
            callbacks: {
              label: (ctx: any) => ` ${ctx.parsed.x}% do período`,
            },
          },
        },
        scales: {
          x: {
            min: 0,
            max: 100,
            grid: { color: light ? 'rgba(15,23,42,0.08)' : 'rgba(255,255,255,0.04)', drawBorder: false },
            ticks: { color: light ? '#475569' : '#6b7280', font: { size: 10 }, callback: (v: any) => `${v}%`, maxTicksLimit: 6, padding: 6 },
            border: { display: false },
          },
          y: {
            grid: { display: false },
            ticks: { color: light ? '#334155' : '#d1d5db', font: { size: 11, weight: '500' }, padding: 8 },
            border: { display: false },
          },
        },
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(pcts), light],
  );

  return (
    <div className="bg-[#0d1117] border border-gray-800/60 rounded-2xl p-5 h-full flex flex-col min-h-0 overflow-hidden transition-all hover:border-gray-700/60">
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <div>
          <div className="font-semibold text-white text-sm">{title}</div>
          <div className="text-xs text-gray-300/70 mt-0.5">{subtitle}</div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {bars.map((b) => (
            <div key={b.label} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: b.color }} />
              <span className="text-[10px] text-gray-400">{b.label}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="w-full min-w-0 flex-1 min-h-0" style={{ minHeight: 120 }}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}

function KpiCard({
  title,
  value,
  tone,
  helper,
  icon,
}: {
  title: string;
  value: string;
  tone: 'neutral' | 'orange' | 'red';
  helper?: string;
  icon?: React.ReactNode;
}) {
  const toneStyles = {
    orange: {
      card: 'border-orange-500/30 bg-gradient-to-br from-orange-500/10 via-[#0d1117] to-[#0d1117]',
      iconBg: 'bg-orange-500/15',
      iconColor: 'text-orange-400',
      valueColor: 'text-orange-700 dark:text-orange-100',
      dot: 'bg-orange-400',
    },
    red: {
      card: 'border-red-500/30 bg-gradient-to-br from-red-500/10 via-[#0d1117] to-[#0d1117]',
      iconBg: 'bg-red-500/15',
      iconColor: 'text-red-400',
      valueColor: 'text-red-700 dark:text-red-100',
      dot: 'bg-red-400',
    },
    neutral: {
      card: 'border-gray-800/60 bg-[#0d1117]',
      iconBg: 'bg-emerald-500/10',
      iconColor: 'text-emerald-400',
      valueColor: 'text-white',
      dot: 'bg-emerald-400',
    },
  };
  const s = toneStyles[tone];
  return (
    <div className={`border rounded-2xl px-4 py-3 flex items-center gap-3 transition-all hover:border-gray-700/60 ${s.card}`}>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] uppercase tracking-wide font-semibold text-gray-300 leading-tight">{title}</div>
        {helper && <div className="text-[11px] text-gray-300/80 mt-0.5 leading-tight">{helper}</div>}
        <div className="mt-1.5 flex items-end gap-1.5">
          <div className={`text-2xl font-bold leading-none tabular-nums ${s.valueColor}`}>{value}</div>
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${s.dot} mb-0.5 animate-pulse`} />
        </div>
      </div>
      {icon && (
        <div className={`flex-shrink-0 w-9 h-9 rounded-xl ${s.iconBg} flex items-center justify-center ${s.iconColor}`}>
          {icon}
        </div>
      )}
    </div>
  );
}

function SectionHeader({ title, description, tone }: { title: string; description?: string; tone: 'rupture' | 'operation' | 'queue' }) {
  const toneConfig = {
    rupture: {
      border: 'border-orange-500/20',
      bg: 'bg-gradient-to-r from-orange-500/8 via-transparent to-transparent',
      bar: 'bg-orange-500',
      icon: <AlertTriangle size={15} className="text-orange-400" />,
      badge: 'bg-orange-500/15 text-orange-400 border-orange-500/20',
    },
    operation: {
      border: 'border-emerald-500/20',
      bg: 'bg-gradient-to-r from-emerald-500/8 via-transparent to-transparent',
      bar: 'bg-emerald-500',
      icon: <Package size={15} className="text-emerald-400" />,
      badge: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
    },
    queue: {
      border: 'border-sky-500/20',
      bg: 'bg-gradient-to-r from-sky-500/8 via-transparent to-transparent',
      bar: 'bg-sky-500',
      icon: <Users size={15} className="text-sky-400" />,
      badge: 'bg-sky-500/15 text-sky-400 border-sky-500/20',
    },
  };
  const c = toneConfig[tone];
  return (
    <div className={`h-full border ${c.border} rounded-2xl overflow-hidden ${c.bg} flex items-center`}>
      <div className={`w-1 self-stretch ${c.bar} rounded-l-2xl`} />
      <div className="flex items-center justify-between w-full px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-white/5">
            {c.icon}
          </div>
          <div>
            <div className="text-white font-bold tracking-wide uppercase text-xs">{title}</div>
            {description && <div className="text-xs text-gray-300/70 mt-0.5">{description}</div>}
          </div>
        </div>
        <div className={`text-[10px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-md border ${c.badge}`}>BRF</div>
      </div>
    </div>
  );
}

export function ClientDashboardBRF() {
  const { id } = useParams();
  const navigate = useNavigate();
  const themeSignal = useThemeSignal();
  const optionStyle = useMemo(
    () => isLightAppTheme()
      ? { backgroundColor: '#ffffff', color: '#0f172a' }
      : { backgroundColor: '#161b22', color: 'white' },
    [themeSignal],
  );

  const [clientName, setClientName] = useState<string>('');
  const [clientLogoUrl, setClientLogoUrl] = useState<string>('');
  const [stores, setStores] = useState<Array<{ id: string; name: string; cameras: Array<{ id: string; name: string; macAddress: string }> }>>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<string>('all');
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('all');
  const [startDate, setStartDate] = useState<Date>(() => alignUtcStartOfDay(new Date()));
  const [endDate, setEndDate] = useState<Date>(() => alignUtcEndOfDay(new Date()));
  const [startHour, setStartHour] = useState<number>(0);
  const [endHour, setEndHour] = useState<number>(23);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [demoMode, setDemoMode] = useState<boolean>(true);
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  const [activeWidgets, setActiveWidgets] = useState<BrfWidgetType[]>([]);
  const [widgetLayout, setWidgetLayout] = useState<Record<string, { colSpanLg?: Span; heightPx?: number }>>({});
  const [editLayoutMode, setEditLayoutMode] = useState(false);
  const [layoutSnapshot, setLayoutSnapshot] = useState<BrfWidgetType[] | null>(null);
  const [savingLayout, setSavingLayout] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const widgetsGridRef = useRef<HTMLDivElement | null>(null);

  const isBrf = id === BRF_CLIENT_ID;

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: client } = await supabase.from('clients').select('name, logo_url').eq('id', id).maybeSingle();
        if (!cancelled) setClientName(String(client?.name || ''));
        if (!cancelled) setClientLogoUrl(String((client as any)?.logo_url || ''));
      } catch {
        if (!cancelled) {
          setClientName('');
          setClientLogoUrl('');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Lojas e devices (folders + devices do banco)
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: storesData } = await supabase.from('stores').select('id, name').eq('client_id', id);
        const storeIds = (storesData || []).map((s: any) => s.id).filter(Boolean);
        const { data: devicesData } = storeIds.length
          ? await supabase.from('devices').select('id, name, mac_address, store_id').in('store_id', storeIds)
          : { data: [] as any[] };
        const devicesByStore: Record<string, any[]> = {};
        (devicesData || []).forEach((d: any) => {
          if (!devicesByStore[d.store_id]) devicesByStore[d.store_id] = [];
          devicesByStore[d.store_id].push({ id: d.id, name: d.name, macAddress: d.mac_address });
        });
        const mapped = (storesData || []).map((s: any) => ({
          id: String(s.id),
          name: String(s.name || ''),
          cameras: (devicesByStore[s.id] || []) as Array<{ id: string; name: string; macAddress: string }>,
        }));
        if (!cancelled) setStores(mapped);
      } catch {
        if (!cancelled) setStores([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const storageKey = useMemo(() => (id ? `dashboard-config-brf-${id}` : 'dashboard-config-brf'), [id]);

  const resetLayout = useCallback(() => {
    const normalized = normalizeBrfWidgetIds(BRF_DEFAULT_WIDGET_IDS);
    setActiveWidgets(widgetsFromIds(normalized));
    setWidgetLayout({});
    try {
      localStorage.setItem(storageKey, JSON.stringify({ widget_ids: normalized, widget_layout: {} }));
    } catch {}
  }, [storageKey]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setIsLoadingConfig(true);

    const defaultIds = [...BRF_DEFAULT_WIDGET_IDS];

    (async () => {
      try {
        const { data } = await supabase
          .from('dashboard_configs')
          .select('widgets_config, updated_at')
          .eq('layout_name', 'client_brf_user')
          .eq('client_id', id)
          .order('updated_at', { ascending: false })
          .limit(1);

        const raw = data?.[0]?.widgets_config ?? null;
        const fromLocal = (() => {
          try {
            return JSON.parse(localStorage.getItem(storageKey) || 'null');
          } catch {
            return null;
          }
        })();
        const cfgRaw = raw || fromLocal;
        const cfg = (() => {
          if (!cfgRaw) return null;
          if (typeof cfgRaw !== 'string') return cfgRaw;
          try {
            return JSON.parse(cfgRaw);
          } catch {
            return null;
          }
        })();

        const rawIds: string[] = Array.isArray(cfg?.widget_ids) ? cfg.widget_ids : defaultIds;
        const ids: string[] = normalizeBrfWidgetIds(rawIds);
        const layout: Record<string, any> = cfg?.widget_layout && typeof cfg.widget_layout === 'object' ? cfg.widget_layout : {};

        const active = widgetsFromIds(ids);

        if (!cancelled) {
          setActiveWidgets(active.length ? active : widgetsFromIds(normalizeBrfWidgetIds(defaultIds)));
          setWidgetLayout(layout);
        }
      } catch {
        if (!cancelled) {
          setActiveWidgets(widgetsFromIds(normalizeBrfWidgetIds(defaultIds)));
          setWidgetLayout({});
        }
      } finally {
        if (!cancelled) setIsLoadingConfig(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, storageKey]);

  const enterEditMode = () => {
    setLayoutSnapshot([...activeWidgets]);
    setEditLayoutMode(true);
  };

  const cancelEditMode = () => {
    if (layoutSnapshot) setActiveWidgets(layoutSnapshot);
    setLayoutSnapshot(null);
    setDraggedIndex(null);
    setEditLayoutMode(false);
  };

  const saveLayoutOrder = useCallback(async () => {
    if (!id) return;
    setSavingLayout(true);
    try {
      const widget_ids = activeWidgets.map((w) => w.id);
      const payload = { widget_ids, widget_layout: widgetLayout };
      try {
        localStorage.setItem(storageKey, JSON.stringify(payload));
      } catch {}

      await supabase.from('dashboard_configs').insert({
        id: crypto.randomUUID(),
        client_id: id,
        layout_name: 'client_brf_user',
        widgets_config: payload,
        updated_at: new Date().toISOString(),
      });
      setEditLayoutMode(false);
      setLayoutSnapshot(null);
      setDraggedIndex(null);
    } catch (e) {
      console.warn('[BRF] erro ao salvar layout:', e);
      alert('Erro ao salvar layout. Tente novamente.');
    } finally {
      setSavingLayout(false);
    }
  }, [activeWidgets, id, storageKey, widgetLayout]);

  const handleWidgetDragStart = (e: React.DragEvent, index: number) => {
    if (!editLayoutMode) return;
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', String(index));
    } catch {}
  };

  const handleWidgetDragOver = (e: React.DragEvent, index: number) => {
    if (!editLayoutMode) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setActiveWidgets((prev) => {
      if (draggedIndex === null || draggedIndex === index) return prev;
      const next = [...prev];
      const draggedItem = next[draggedIndex];
      next.splice(draggedIndex, 1);
      next.splice(index, 0, draggedItem);
      setDraggedIndex(index);
      return next;
    });
  };

  const handleWidgetDragEnd = () => setDraggedIndex(null);

  const handleGridDragOver = (e: React.DragEvent) => {
    if (!editLayoutMode || draggedIndex === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const grid = widgetsGridRef.current;
    if (!grid) return;
    const cards = Array.from(grid.querySelectorAll<HTMLElement>('[data-widget-card]'));
    if (cards.length === 0) return;
    const x = e.clientX;
    const y = e.clientY;
    let bestIdx = -1;
    let bestDist = Number.POSITIVE_INFINITY;
    cards.forEach((el, idx) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const d = Math.hypot(x - cx, y - cy);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = idx;
      }
    });
    if (bestIdx === -1 || bestIdx === draggedIndex) return;
    setActiveWidgets((prev) => {
      if (draggedIndex === null || draggedIndex === bestIdx) return prev;
      const next = [...prev];
      const item = next[draggedIndex];
      next.splice(draggedIndex, 1);
      next.splice(bestIdx, 0, item);
      setDraggedIndex(bestIdx);
      return next;
    });
  };

  const moveWidgetByIndex = (index: number, direction: 'up' | 'down') => {
    setActiveWidgets((prev) => {
      const arr = [...prev];
      if (direction === 'up' && index > 0) {
        [arr[index], arr[index - 1]] = [arr[index - 1], arr[index]];
      } else if (direction === 'down' && index < arr.length - 1) {
        [arr[index], arr[index + 1]] = [arr[index + 1], arr[index]];
      }
      return arr;
    });
  };

  const deviceNums = useMemo(() => {
    const store = selectedStoreId !== 'all' ? stores.find((s) => s.id === selectedStoreId) : null;
    const all = store ? store.cameras : stores.flatMap((s) => s.cameras);
    const selected = selectedDeviceId !== 'all' ? all.find((c) => c.id === selectedDeviceId) : null;
    const list = selected ? [selected] : all;
    return list.map((d) => Number(d.macAddress)).filter((n) => Number.isFinite(n));
  }, [stores, selectedStoreId, selectedDeviceId]);

  const ruptureLabels = useMemo(() => Array.from({ length: 24 }, (_, i) => `${i}h`), []);
  const [ruptureHourly, setRuptureHourly] = useState<number[]>(new Array(24).fill(0));
  const [ruptureOrange, setRuptureOrange] = useState(0);
  const [ruptureRed, setRuptureRed] = useState(0);

  const [opHoursTwo, setOpHoursTwo]   = useState(0);
  const [opHoursOne, setOpHoursOne]   = useState(0);
  const [opHoursZero, setOpHoursZero] = useState(0);

  const [queueTotal, setQueueTotal] = useState(0);
  const [queueAvgSeconds, setQueueAvgSeconds] = useState(0);
  const [queueNow, setQueueNow] = useState(0);
  const [queueNowUpdatedAt, setQueueNowUpdatedAt] = useState<Date | null>(null);
  const [queueLineMinutes, setQueueLineMinutes] = useState<number[]>(new Array(24).fill(0));

  const [gondolaProducts, setGondolaProducts] = useState<ProductSlot[]>(MOCK_GONDOLA_PRODUCTS);
  const [selectedGondolaProduct, setSelectedGondolaProduct] = useState<ProductSlot | null>(null);

  const missingTablesRef = useRef<{ rupture: boolean; ops: boolean; queue: boolean }>({ rupture: false, ops: false, queue: false });

  const applyMockData = useCallback(() => {
    setRuptureOrange(18);
    setRuptureRed(9);
    setRuptureHourly(MOCK_RUPTURE_HOURLY);
    setOpHoursTwo(5.8);
    setOpHoursOne(2.4);
    setOpHoursZero(0.7);
    setQueueTotal(126);
    setQueueAvgSeconds(274);
    setQueueNow(8);
    setQueueNowUpdatedAt(new Date());
    setQueueLineMinutes(MOCK_QUEUE_LINE_MINUTES);
    setGondolaProducts(MOCK_GONDOLA_PRODUCTS);
  }, []);


  const deviceSelectOptions = useMemo(() => {
    const sourceStores = selectedStoreId !== 'all' ? stores.filter((s) => s.id === selectedStoreId) : stores;
    return sourceStores.flatMap((store) =>
      (store.cameras || []).map((device) => ({
        id: device.id,
        label: selectedStoreId !== 'all' ? device.name : `${store.name} - ${device.name}`,
      })),
    );
  }, [stores, selectedStoreId]);

  const loadBrfData = useCallback(async () => {
    if (!id) return;
    setIsLoadingData(true);
    if (demoMode) {
      applyMockData();
      setIsLoadingData(false);
      return;
    }
    const sd = new Date(startDate);
    sd.setHours(startHour, 0, 0, 0);
    const ed = new Date(endDate);
    ed.setHours(endHour, 59, 59, 999);
    const startIso = sd.toISOString();
    const endIso = ed.toISOString();
    try {
      // ── Ruptura ──────────────────────────────────────────────
      if (!missingTablesRef.current.rupture) {
        const { data, error } = await supabase
          .from('brf_rupture_alerts')
          .select('severity, created_at')
          .eq('client_id', id)
          .gte('created_at', startIso)
          .lte('created_at', endIso);
        if (error) {
          if (String(error.code || '').includes('PGRST') || String(error.message || '').includes('schema cache')) {
            missingTablesRef.current.rupture = true;
          }
        } else {
          const hourly = new Array(24).fill(0);
          let o = 0; let r = 0;
          (data || []).forEach((row: any) => {
            const sev = String(row?.severity || '').toLowerCase();
            if (sev === 'orange') o++;
            if (sev === 'red') r++;
            const dt = new Date(row?.created_at);
            if (!Number.isNaN(dt.getTime())) hourly[dt.getHours()]++;
          });
          setRuptureOrange(o);
          setRuptureRed(r);
          setRuptureHourly(hourly);
        }
      }

      // ── Gôndola (status atual por posição) ───────────────────
      {
        const { data } = await supabase
          .from('brf_gondola_current')
          .select('column_number, shelf_number, product_code, product_name, product_image_url, status')
          .eq('client_id', id);
        if (data && data.length > 0) {
          const colsInUse = [4, 5, 6];
          const updated = (data as any[])
            .filter((r) => colsInUse.includes(r.column_number))
            .map((r) => ({
              position: r.column_number,
              code: r.product_code,
              name: r.product_name,
              image: r.product_image_url || `/gondola/pos${r.column_number}.png`,
              status: r.status as 'ok' | 'warning' | 'rupture',
            }));
          if (updated.length > 0) setGondolaProducts(updated);
        }
      }

      // ── Operação (brf_operation_detections) ──────────────────────
      if (!missingTablesRef.current.ops) {
        const detRes = await supabase
          .from('brf_operation_detections')
          .select('attendant_count, detected_at')
          .eq('client_id', id)
          .gte('detected_at', startIso)
          .lte('detected_at', endIso)
          .order('detected_at', { ascending: true });

        if (detRes.error) {
          if (String(detRes.error.code || '').includes('PGRST')) missingTablesRef.current.ops = true;
        } else {
          const rows = (detRes.data || []) as { attendant_count: number; detected_at: string }[];
          // Compute seconds per bucket by measuring gap between consecutive detections.
          // Cap each gap at 10 min to avoid counting offline periods.
          const MAX_GAP_SEC = 600;
          let secTwo = 0; let secOne = 0; let secZero = 0;
          for (let i = 0; i < rows.length; i++) {
            const t0 = new Date(rows[i].detected_at).getTime();
            const t1 = i + 1 < rows.length ? new Date(rows[i + 1].detected_at).getTime() : t0;
            const gap = Math.min(Math.max((t1 - t0) / 1000, 0), MAX_GAP_SEC) || 60;
            const cnt = Number(rows[i].attendant_count) || 0;
            if (cnt >= 2)      secTwo  += gap;
            else if (cnt === 1) secOne  += gap;
            else               secZero += gap;
          }
          const toHours = (s: number) => Math.round((s / 3600) * 10) / 10;
          setOpHoursTwo(toHours(secTwo));
          setOpHoursOne(toHours(secOne));
          setOpHoursZero(toHours(secZero));
        }
      }

      // ── Fila (brf_queue_detections + brf_queue_sessions) ─────
      if (!missingTablesRef.current.queue) {
        const [detRes, sessRes] = await Promise.all([
          supabase
            .from('brf_queue_detections')
            .select('people_count, detected_at')
            .eq('client_id', id)
            .gte('detected_at', startIso)
            .lte('detected_at', endIso),
          supabase
            .from('brf_queue_sessions')
            .select('entered_at, exited_at, wait_seconds')
            .eq('client_id', id)
            .gte('entered_at', startIso)
            .lte('entered_at', endIso),
        ]);

        if (detRes.error) {
          if (String(detRes.error.code || '').includes('PGRST')) missingTablesRef.current.queue = true;
        } else {
          const sessions = Array.isArray(sessRes.data) ? sessRes.data : [];
          setQueueTotal(sessions.length);

          const waitVals = sessions
            .map((s: any) => Number(s.wait_seconds) || 0)
            .filter((v) => v > 0);
          setQueueAvgSeconds(
            waitVals.length ? Math.round(waitVals.reduce((a, b) => a + b, 0) / waitVals.length) : 0
          );

          // Pessoas agora: detecção mais recente dos últimos 5 min
          const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
          const { data: nowData } = await supabase
            .from('brf_queue_detections')
            .select('people_count')
            .eq('client_id', id)
            .gte('detected_at', fiveMinAgo)
            .order('detected_at', { ascending: false })
            .limit(1);
          const nowCount = nowData && nowData.length > 0 ? Number((nowData[0] as any).people_count) || 0 : 0;
          setQueueNow(nowCount);
          setQueueNowUpdatedAt(new Date());

          const qHoursSum = new Array(24).fill(0);
          const qHoursCnt = new Array(24).fill(0);
          (detRes.data || []).forEach((row: any) => {
            const dt = new Date(row?.detected_at);
            if (Number.isNaN(dt.getTime())) return;
            const h = dt.getHours();
            const cnt = Number(row?.people_count) || 0;
            if (cnt > 0) { qHoursSum[h] += cnt; qHoursCnt[h]++; }
          });
          setQueueLineMinutes(qHoursSum.map((sum, h) => (qHoursCnt[h] ? Math.round(sum / qHoursCnt[h]) : 0)));
        }
      }
    } catch (e) {
      console.warn('[BRF] erro ao carregar dados:', e);
    } finally {
      setIsLoadingData(false);
    }
  }, [applyMockData, demoMode, deviceNums, endDate, endHour, id, startDate, startHour]);

  useEffect(() => {
    void loadBrfData();
  }, [loadBrfData]);

  // Auto-refresh a cada 5 minutos para "Pessoas Agora"
  useEffect(() => {
    const interval = setInterval(() => { void loadBrfData(); }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [loadBrfData]);

  const queueRate = useMemo(() => {
    if (queueNow <= 0 || queueAvgSeconds <= 0) return 0;
    return Math.round((queueAvgSeconds / 60) * queueNow * 10) / 10;
  }, [queueNow, queueAvgSeconds]);

  if (!id) return null;

  if (!isBrf) {
    return (
      <div className="p-6">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-gray-200">
          <div className="text-lg font-semibold">Dashboard BRF</div>
          <div className="text-gray-400 mt-1">Esta aba é exclusiva para a BRF. Cliente atual: {clientName || id}</div>
          <button
            type="button"
            onClick={() => navigate(`/clientes/${id}/dashboard`)}
            className="mt-4 px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-white text-sm"
          >
            Voltar ao Dashboard Geral
          </button>
          <button
            type="button"
            onClick={() => setDemoMode((v) => !v)}
            className={`px-4 py-2 rounded-lg text-white text-sm border transition-colors ${
              demoMode ? 'bg-emerald-600/20 border-emerald-500/40 hover:bg-emerald-600/30' : 'bg-gray-900 border-gray-800 hover:bg-gray-800'
            }`}
            title="Ativa dados mockados para visualizar o layout"
          >
            {demoMode ? 'Demo: ON' : 'Demo: OFF'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex flex-col gap-5 mb-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="h-12 w-12 sm:h-14 sm:w-14 rounded-2xl bg-[#0d1117] border border-gray-800/60 flex items-center justify-center overflow-hidden flex-shrink-0 shadow-lg">
              {clientLogoUrl ? (
                <img src={clientLogoUrl} alt="Logo BRF" className="h-full w-auto object-contain p-1.5" />
              ) : (
                <Image size={20} className="text-gray-600" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <h1 className="text-white text-xl sm:text-2xl font-bold leading-tight">Painel BRF</h1>
                <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/20 text-emerald-400 text-[10px] font-semibold uppercase tracking-widest">Exclusivo</span>
              </div>
              <p className="text-gray-400 text-sm mt-0.5">Ruptura &middot; Operação &middot; Fila</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate(`/clientes/${id}/dashboard`)}
              className="h-9 px-3.5 rounded-xl bg-[#0d1117] border border-gray-800/60 hover:border-gray-700 text-gray-300 hover:text-white text-xs font-medium inline-flex items-center transition-all"
            >
              Dashboard Geral
            </button>
            {!editLayoutMode ? (
              <button
                type="button"
                onClick={enterEditMode}
                className="h-9 px-3.5 rounded-xl bg-[#0d1117] border border-gray-800/60 hover:border-emerald-500/40 text-gray-300 hover:text-emerald-300 text-xs font-medium inline-flex items-center gap-1.5 transition-all"
              >
                <Move size={14} /> Editar Layout
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={saveLayoutOrder}
                  disabled={savingLayout}
                  className="h-9 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-medium inline-flex items-center gap-1.5 transition-all shadow-lg shadow-emerald-500/20"
                >
                  <Save size={14} /> Salvar
                </button>
                <button
                  type="button"
                  onClick={cancelEditMode}
                  className="h-9 px-3.5 rounded-xl bg-[#0d1117] border border-gray-800/60 hover:border-red-500/40 text-gray-300 hover:text-red-300 text-xs font-medium inline-flex items-center gap-1.5 transition-all"
                >
                  <X size={14} /> Cancelar
                </button>
              </>
            )}
          </div>
        </div>

        {/* Filters bar */}
        <div className="flex flex-wrap items-center gap-2.5 p-3 bg-[#0d1117] border border-gray-800/40 rounded-2xl">
          {/* Date + Hour: start */}
          <div className="flex items-center gap-1.5">
            <div className="relative">
              <input
                type="date"
                className="h-9 bg-[#161b22] border border-gray-800/60 text-white pl-9 pr-2.5 rounded-xl focus:outline-none focus:ring-1 focus:ring-emerald-500/50 focus:border-emerald-500/50 text-xs font-medium w-[140px] transition-all"
                value={formatDateInputValue(startDate)}
                onChange={(e) => {
                  const next = parseDateInputValue(e.target.value, false);
                  if (next) setStartDate(next);
                }}
              />
              <div className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-gray-500">
                <Calendar size={14} />
              </div>
            </div>
            <div className="relative">
              <select
                className="h-9 bg-[#161b22] border border-gray-800/60 text-white pl-8 pr-7 rounded-xl focus:outline-none focus:ring-1 focus:ring-emerald-500/50 focus:border-emerald-500/50 appearance-none cursor-pointer text-xs font-medium w-[105px] transition-all"
                value={startHour}
                onChange={(e) => setStartHour(Number(e.target.value))}
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i} style={optionStyle}>{String(i).padStart(2, '0')}:00</option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-gray-500">
                <Clock size={13} />
              </div>
              <div className="pointer-events-none absolute inset-y-0 right-1.5 flex items-center text-gray-600">
                <ChevronDown size={11} />
              </div>
            </div>
          </div>

          <span className="text-gray-600 text-xs">até</span>

          {/* Date + Hour: end */}
          <div className="flex items-center gap-1.5">
            <div className="relative">
              <input
                type="date"
                className="h-9 bg-[#161b22] border border-gray-800/60 text-white pl-9 pr-2.5 rounded-xl focus:outline-none focus:ring-1 focus:ring-emerald-500/50 focus:border-emerald-500/50 text-xs font-medium w-[140px] transition-all"
                value={formatDateInputValue(endDate)}
                onChange={(e) => {
                  const next = parseDateInputValue(e.target.value, true);
                  if (next) setEndDate(next);
                }}
              />
              <div className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-gray-500">
                <Calendar size={14} />
              </div>
            </div>
            <div className="relative">
              <select
                className="h-9 bg-[#161b22] border border-gray-800/60 text-white pl-8 pr-7 rounded-xl focus:outline-none focus:ring-1 focus:ring-emerald-500/50 focus:border-emerald-500/50 appearance-none cursor-pointer text-xs font-medium w-[105px] transition-all"
                value={endHour}
                onChange={(e) => setEndHour(Number(e.target.value))}
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i} style={optionStyle}>{String(i).padStart(2, '0')}:59</option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-gray-500">
                <Clock size={13} />
              </div>
              <div className="pointer-events-none absolute inset-y-0 right-1.5 flex items-center text-gray-600">
                <ChevronDown size={11} />
              </div>
            </div>
          </div>

          <div className="h-5 w-px bg-gray-800 mx-0.5 hidden sm:block" />

          <button
            type="button"
            onClick={() => loadBrfData()}
            className="h-9 px-3.5 rounded-xl bg-emerald-600/90 hover:bg-emerald-500 text-white text-xs font-medium inline-flex items-center gap-1.5 transition-all shadow-lg shadow-emerald-500/10"
          >
            <RefreshCw size={13} className={isLoadingData ? 'animate-spin' : ''} />
            {isLoadingData ? 'Atualizando…' : 'Atualizar'}
          </button>

          <button
            type="button"
            onClick={resetLayout}
            className="h-9 px-3 rounded-xl bg-[#161b22] border border-gray-800/60 hover:border-gray-700 text-gray-400 hover:text-white text-xs font-medium inline-flex items-center gap-1.5 transition-all"
            title="Volta o layout padrão"
          >
            <RotateCcw size={13} />
            Reset
          </button>
        </div>
      </div>

      {/* Widgets */}
      <div
        ref={widgetsGridRef}
        onDragOver={handleGridDragOver}
        onDrop={(e) => { if (editLayoutMode) e.preventDefault(); }}
        className="flex flex-col gap-4 min-h-[400px]"
      >
        {isLoadingConfig ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <div className="animate-spin rounded-full h-7 w-7 border-2 border-gray-800 border-t-emerald-500" />
            <span className="text-xs text-gray-600">Carregando widgets...</span>
          </div>
        ) : activeWidgets.length > 0 ? (
          (() => {
            const sections: Array<{ header: BrfWidgetType; headerIndex: number; kpis: Array<{ w: BrfWidgetType; idx: number }>; charts: Array<{ w: BrfWidgetType; idx: number }> }> = [];
            let current: (typeof sections)[0] | null = null;

            activeWidgets.forEach((w, idx) => {
              if (w.type === 'section') {
                current = { header: w, headerIndex: idx, kpis: [], charts: [] };
                sections.push(current);
              } else if (current) {
                if (w.type === 'kpi') current.kpis.push({ w, idx });
                else current.charts.push({ w, idx });
              }
            });

            const renderWidgetContent = (widget: BrfWidgetType) => {
              if (widget.id === 'rupture_orange') return <KpiCard title="Alertas Laranja" helper="Prestes a acabar" value={String(ruptureOrange)} tone="orange" icon={<AlertTriangle size={15} />} />;
              if (widget.id === 'rupture_red') return <KpiCard title="Alertas Vermelho" helper="Acabou" value={String(ruptureRed)} tone="red" icon={<Zap size={15} />} />;
              if (widget.id === 'rupture_hourly') return <LineChart title="Rupturas por Hora" subtitle="Quantidade de rupturas por hora" labels={ruptureLabels} seriesLabel="Rupturas" values={ruptureHourly} yUnit="count" accentColor="#f97316" />;
              if (widget.id === 'op_hours_two')  return <KpiCard title="2+ Operadores" helper="Horas no período" value={`${opHoursTwo}h`} tone="neutral" icon={<Users size={15} />} />;
              if (widget.id === 'op_hours_one')  return <KpiCard title="1 Operador" helper="Horas no período" value={`${opHoursOne}h`} tone="orange" icon={<User size={15} />} />;
              if (widget.id === 'op_hours_zero') return <KpiCard title="0 Operadores" helper="Horas no período" value={`${opHoursZero}h`} tone="red" icon={<Ghost size={15} />} />;
              if (widget.id === 'op_dist_chart') return (
                <HorizontalBarChart
                  title="Distribuição de Operadores"
                  subtitle="% do tempo por nível de cobertura"
                  bars={[
                    { label: '2+ op.', value: opHoursTwo,  color: '#10b981' },
                    { label: '1 op.',  value: opHoursOne,  color: '#f97316' },
                    { label: '0 op.',  value: opHoursZero, color: '#ef4444' },
                  ]}
                />
              );
              if (widget.id === 'queue_total') return <KpiCard title="Total de Pessoas" helper="No período" value={Number(queueTotal || 0).toLocaleString('pt-BR')} tone="neutral" icon={<Users size={15} />} />;
              if (widget.id === 'queue_avg') return <KpiCard title="Tempo Médio" helper="Espera (mm:ss)" value={queueAvgSeconds > 0 ? fmtMinutes(queueAvgSeconds) : '—'} tone="neutral" icon={<Clock size={15} />} />;
              if (widget.id === 'queue_now') return <KpiCard title="Pessoas Agora" helper={queueNowUpdatedAt ? `Atualizado ${queueNowUpdatedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'A cada 5 min'} value={String(queueNow)} tone={queueNow > 10 ? 'red' : queueNow > 5 ? 'orange' : 'neutral'} icon={<Zap size={15} />} />;
              if (widget.id === 'queue_rate') return <KpiCard title="Taxa de Ocupação" helper="Tempo médio × fila atual" value={queueRate > 0 ? `${queueRate} min` : '—'} tone={queueRate > 15 ? 'red' : queueRate > 8 ? 'orange' : 'neutral'} icon={<TrendingUp size={15} />} />;
              if (widget.id === 'queue_line') return <LineChart title="Tempo em Fila" subtitle="Eixo Y em minutos; eixo X por hora" labels={ruptureLabels} seriesLabel="Minutos" values={queueLineMinutes} yUnit="minutes" accentColor="#38bdf8" />;
              return <div className="bg-[#0d1117] border border-gray-800/60 rounded-2xl p-4 h-full flex items-center justify-center text-gray-600 text-sm">Widget: {widget.id}</div>;
            };

            const renderEditOverlay = (widgetIndex: number) => {
              if (!editLayoutMode) return null;
              return (
                <div className="absolute top-2 right-2 z-20 flex items-center gap-1">
                  <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); moveWidgetByIndex(widgetIndex, 'up'); }} disabled={widgetIndex === 0} title="Subir" className="bg-gray-900/95 backdrop-blur-sm border border-gray-700/60 text-gray-300 hover:text-white hover:bg-emerald-600 hover:border-emerald-500 rounded-lg p-1 shadow-xl disabled:opacity-20 disabled:cursor-not-allowed transition-all"><ArrowUp size={12} /></button>
                  <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); moveWidgetByIndex(widgetIndex, 'down'); }} disabled={widgetIndex === activeWidgets.length - 1} title="Descer" className="bg-gray-900/95 backdrop-blur-sm border border-gray-700/60 text-gray-300 hover:text-white hover:bg-emerald-600 hover:border-emerald-500 rounded-lg p-1 shadow-xl disabled:opacity-20 disabled:cursor-not-allowed transition-all"><ArrowDown size={12} /></button>
                  <div className="bg-emerald-600 text-white rounded-lg px-2 py-1 shadow-xl pointer-events-none flex items-center gap-1"><Move size={11} /><span className="text-[9px] font-semibold uppercase tracking-widest">Mover</span></div>
                </div>
              );
            };

            const sectionTone = (id: string) => id === 'section_rupture' ? 'rupture' : id === 'section_operation' ? 'operation' : 'queue';

            return sections.map((section) => {
              const isRuptureSection = section.header.id === 'section_rupture';
              return (
              <div key={section.header.id} className="flex flex-col gap-3">
                {/* Section header */}
                <div
                  data-widget-card
                  draggable={false}
                  onDragOver={(e) => handleWidgetDragOver(e, section.headerIndex)}
                >
                  <SectionHeader
                    title={isRuptureSection ? `${section.header.title} · Gôndola` : section.header.title}
                    description={isRuptureSection ? 'Alertas, rupturas por hora e planograma 3D' : section.header.description}
                    tone={sectionTone(section.header.id)}
                  />
                </div>

                {/* KPIs (vertical left) + Chart (right) */}
                <div className="flex flex-col lg:flex-row lg:items-stretch gap-3">
                  {/* KPIs column */}
                  {section.kpis.length > 0 && (
                    <div className={`flex flex-col gap-3 w-full ${section.kpis.length <= 2 ? 'lg:w-[220px] lg:min-w-[220px]' : 'lg:w-[280px] lg:min-w-[280px]'}`}>
                      {section.kpis.map(({ w, idx }) => {
                        const isDragging = editLayoutMode && draggedIndex === idx;
                        return (
                          <div
                            key={w.id}
                            data-widget-card
                            draggable={editLayoutMode}
                            onDragStart={(e) => handleWidgetDragStart(e, idx)}
                            onDragOver={(e) => handleWidgetDragOver(e, idx)}
                            onDragEnd={handleWidgetDragEnd}
                            onDrop={(e) => { if (editLayoutMode) e.preventDefault(); }}
                            className={`relative flex-1 min-h-[80px] ${editLayoutMode ? 'cursor-move ring-1 ring-emerald-500/30 rounded-2xl' : ''} ${isDragging ? 'opacity-40 scale-[0.97] ring-2 ring-emerald-400' : ''} transition-all duration-200`}
                          >
                            {renderEditOverlay(idx)}
                            <div className={`h-full ${editLayoutMode ? 'pointer-events-none' : ''}`}>
                              {renderWidgetContent(w)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Charts column */}
                  {section.charts.length > 0 && (
                    <div className="flex flex-col gap-3 flex-1 min-w-0 min-h-full">
                      {section.charts.map(({ w, idx }) => {
                        const isDragging = editLayoutMode && draggedIndex === idx;
                        return (
                          <div
                            key={w.id}
                            data-widget-card
                            draggable={editLayoutMode}
                            onDragStart={(e) => handleWidgetDragStart(e, idx)}
                            onDragOver={(e) => handleWidgetDragOver(e, idx)}
                            onDragEnd={handleWidgetDragEnd}
                            onDrop={(e) => { if (editLayoutMode) e.preventDefault(); }}
                            className={`relative flex-1 min-h-[260px] ${editLayoutMode ? 'cursor-move ring-1 ring-emerald-500/30 rounded-2xl' : ''} ${isDragging ? 'opacity-40 scale-[0.97] ring-2 ring-emerald-400' : ''} transition-all duration-200`}
                          >
                            {renderEditOverlay(idx)}
                            <div className={`h-full ${editLayoutMode ? 'pointer-events-none' : ''}`}>
                              {renderWidgetContent(w)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Gondola 3D inside Ruptura section */}
                {isRuptureSection && (
                  <div className="flex flex-col lg:flex-row lg:items-stretch gap-3">
                    <div className="flex flex-col gap-3 w-full lg:w-[280px] lg:min-w-[280px]">
                      {gondolaProducts.map((p) => {
                        const isSelected = selectedGondolaProduct?.position === p.position;
                        const ss = {
                          ok: { border: 'border-emerald-500/30', bg: 'from-emerald-500/10', text: 'text-emerald-400', label: 'Abastecido' },
                          warning: { border: 'border-orange-500/30', bg: 'from-orange-500/10', text: 'text-orange-400', label: 'Estoque baixo' },
                          rupture: { border: 'border-red-500/30', bg: 'from-red-500/10', text: 'text-red-400', label: 'Ruptura' },
                        };
                        const st = ss[p.status];
                        return (
                          <button
                            key={p.position}
                            type="button"
                            onClick={() => setSelectedGondolaProduct(isSelected ? null : p)}
                            className={`border rounded-2xl px-4 py-3 text-left transition-all bg-gradient-to-br ${st.bg} via-[#0d1117] to-[#0d1117] ${st.border} ${isSelected ? 'ring-1 ring-orange-500/50' : 'hover:border-gray-700/60'}`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex-1 min-w-0">
                                <div className="text-[12px] uppercase tracking-wide font-semibold text-gray-300 leading-tight truncate">{p.name}</div>
                                <div className="text-[11px] text-gray-400 mt-0.5">Cód: {p.code} · Pos: {p.position}</div>
                              </div>
                              <span className={`flex-shrink-0 ml-2 text-[9px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-md border ${st.border} ${st.text} bg-black/20`}>{st.label}</span>
                            </div>
                          </button>
                        );
                      })}
                      <div className="border border-gray-800/40 rounded-2xl px-4 py-3 bg-[#0d1117] text-[11px] text-gray-400 leading-relaxed">
                        <span className="text-gray-400 font-medium">Visão computacional:</span> A câmera envia imagens para o Sonnet 4.6, que compara com o planograma e identifica rupturas em tempo real.
                      </div>
                    </div>
                    <div className="flex-1 min-w-0 min-h-[400px]">
                      <Gondola3D products={gondolaProducts} onSlotClick={(p) => setSelectedGondolaProduct(p)} />
                    </div>
                  </div>
                )}
              </div>
              );
            });
          })()
        ) : (
          <div className="text-center py-24 text-gray-600">
            <LayoutGrid size={40} className="mx-auto mb-3 opacity-15" />
            <p className="text-sm">Nenhum widget configurado para este dashboard.</p>
          </div>
        )}
      </div>

      {/* Gondola section removed - now inside Ruptura */}

      <DashboardChat
        context={{
          dashboardName: 'BRF — Painel Exclusivo',
          data: {
            periodo: { inicio: startDate.toLocaleDateString('pt-BR'), fim: endDate.toLocaleDateString('pt-BR'), horaInicio: startHour, horaFim: endHour },
            ruptura: {
              alertasLaranja: ruptureOrange,
              alertasVermelho: ruptureRed,
              totalAlertas: ruptureOrange + ruptureRed,
              rupturasPorHora: ruptureHourly,
              gondola: gondolaProducts.map((p) => ({ produto: p.name, codigo: p.code, status: p.status })),
            },
            operacao: {
              horasCom2ouMaisOperadores: opHoursTwo,
              horasCom1Operador: opHoursOne,
              horasSemOperadores: opHoursZero,
              totalHoras: Math.round((opHoursTwo + opHoursOne + opHoursZero) * 10) / 10,
            },
            fila: {
              totalPessoas: queueTotal,
              tempoMedio: queueAvgSeconds > 0 ? `${Math.floor(queueAvgSeconds / 60)}min ${queueAvgSeconds % 60}s` : '0',
              pessoasAgora: queueNow,
              taxaOcupacao: queueNow > 0 && queueAvgSeconds > 0 ? `${Math.round((queueAvgSeconds / 60) * queueNow * 10) / 10} min·pessoa` : '0',
              filaPorHora: queueLineMinutes,
            },
          },
        }}
        queryFn={async (startIso, endIso) => {
          const sd = new Date(startIso); sd.setHours(0, 0, 0, 0);
          const ed = new Date(endIso);   ed.setHours(23, 59, 59, 999);
          const [ruptRes, opRes, queueRes] = await Promise.all([
            supabase.from('brf_rupture_alerts').select('severity, created_at').eq('client_id', id ?? '').gte('created_at', sd.toISOString()).lte('created_at', ed.toISOString()),
            supabase.from('brf_operation_detections').select('attendant_count, is_preparing, detected_at').eq('client_id', id ?? '').gte('detected_at', sd.toISOString()).lte('detected_at', ed.toISOString()),
            supabase.from('brf_queue_detections').select('people_count, detected_at').eq('client_id', id ?? '').gte('detected_at', sd.toISOString()).lte('detected_at', ed.toISOString()),
          ]);
          const alerts = (ruptRes.data ?? []) as any[];
          const ops    = (opRes.data ?? []) as any[];
          const queue  = (queueRes.data ?? []) as any[];
          return {
            periodo: { inicio: startIso, fim: endIso },
            ruptura: {
              alertasLaranja: alerts.filter((r) => r.severity === 'orange').length,
              alertasVermelho: alerts.filter((r) => r.severity === 'red').length,
              totalAlertas: alerts.length,
            },
            operacao: {
              horasCom2ouMaisOperadores: (() => {
                let s = 0;
                const sorted = [...ops].sort((a: any, b: any) => new Date(a.detected_at).getTime() - new Date(b.detected_at).getTime());
                for (let i = 0; i < sorted.length; i++) {
                  const t0 = new Date(sorted[i].detected_at).getTime();
                  const t1 = i + 1 < sorted.length ? new Date(sorted[i + 1].detected_at).getTime() : t0;
                  const gap = Math.min(Math.max((t1 - t0) / 1000, 0), 600) || 60;
                  if ((sorted[i].attendant_count || 0) >= 2) s += gap;
                }
                return Math.round(s / 360) / 10;
              })(),
              horasCom1Operador: (() => {
                let s = 0;
                const sorted = [...ops].sort((a: any, b: any) => new Date(a.detected_at).getTime() - new Date(b.detected_at).getTime());
                for (let i = 0; i < sorted.length; i++) {
                  const t0 = new Date(sorted[i].detected_at).getTime();
                  const t1 = i + 1 < sorted.length ? new Date(sorted[i + 1].detected_at).getTime() : t0;
                  const gap = Math.min(Math.max((t1 - t0) / 1000, 0), 600) || 60;
                  if ((sorted[i].attendant_count || 0) === 1) s += gap;
                }
                return Math.round(s / 360) / 10;
              })(),
              horasSemOperadores: (() => {
                let s = 0;
                const sorted = [...ops].sort((a: any, b: any) => new Date(a.detected_at).getTime() - new Date(b.detected_at).getTime());
                for (let i = 0; i < sorted.length; i++) {
                  const t0 = new Date(sorted[i].detected_at).getTime();
                  const t1 = i + 1 < sorted.length ? new Date(sorted[i + 1].detected_at).getTime() : t0;
                  const gap = Math.min(Math.max((t1 - t0) / 1000, 0), 600) || 60;
                  if ((sorted[i].attendant_count || 0) === 0) s += gap;
                }
                return Math.round(s / 360) / 10;
              })(),
            },
            fila: {
              totalPessoas: queue.length,
              mediaPessoas: queue.length ? (queue.reduce((s: number, r: any) => s + (r.people_count || 0), 0) / queue.length).toFixed(1) : 0,
              picoMaximo: queue.length ? Math.max(...queue.map((r: any) => r.people_count || 0)) : 0,
            },
          };
        }}
      />
    </div>
  );
}
