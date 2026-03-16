import React from 'react';
import { Activity, Clock, Users } from 'lucide-react';

// ── LineChart (SVG) ──────────────────────────────────────────────────────────
export const LineChart = ({ data, color, height = 60, labels, valueFormatter }: {
  data: number[]; color: string; height?: number; labels?: string[];
  valueFormatter?: (value: number, index: number) => string;
}) => {
  const safe = data && data.length ? data : [0];
  const max = Math.max(...safe); const min = Math.min(...safe); const range = max - min || 1;
  const pts = safe.map((val, i) => ({
    x: safe.length === 1 ? 50 : (i / (safe.length - 1)) * 100,
    y: 100 - ((val - min) / range) * 100, val,
  }));
  const polyPoints = pts.map((p) => `${p.x},${p.y}`).join(' ');
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const [hoverIdx, setHoverIdx] = React.useState<number | null>(null);
  const [mouse, setMouse] = React.useState<{ x: number; y: number } | null>(null);
  const fmt = (v: number, i: number) => valueFormatter ? valueFormatter(v, i) : Number(v).toLocaleString();
  const onMove = (e: React.MouseEvent) => {
    const el = wrapRef.current; if (!el) return;
    const r = el.getBoundingClientRect(); if (r.width <= 0) return;
    const relX = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const idx = pts.length === 1 ? 0 : Math.round(relX * (pts.length - 1));
    setHoverIdx(idx); setMouse({ x: e.clientX - r.left, y: e.clientY - r.top });
  };
  const hoverPt = hoverIdx != null ? pts[hoverIdx] : null;
  return (
    <div ref={wrapRef} style={{ height }} className="w-full relative" onMouseMove={onMove} onMouseLeave={() => { setHoverIdx(null); setMouse(null); }}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full overflow-visible">
        <polyline points={polyPoints} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" className={color} />
        {hoverPt && (<><line x1={hoverPt.x} y1={0} x2={hoverPt.x} y2={100} stroke="rgba(148,163,184,0.35)" strokeWidth="0.5" vectorEffect="non-scaling-stroke" /><circle cx={hoverPt.x} cy={hoverPt.y} r={2.5} fill="currentColor" className={color} /></>)}
      </svg>
      {hoverPt && mouse && (
        <div className="absolute z-10 px-3 py-2 rounded-md bg-gray-950/90 text-white text-xs border border-gray-800 pointer-events-none" style={{ left: Math.min(mouse.x + 10, 260), top: Math.max(0, mouse.y - 30) }}>
          <div className="font-semibold">{labels?.[hoverIdx ?? 0] ?? `#${(hoverIdx ?? 0) + 1}`}</div>
          <div>{fmt(hoverPt.val, hoverIdx ?? 0)}</div>
        </div>
      )}
    </div>
  );
};

// ── DonutChart (SVG) ─────────────────────────────────────────────────────────
export const DonutChart = ({ data, colors, showCenter = true, tooltipFormatter }: {
  data: { label: string; value: number }[]; colors: string[]; showCenter?: boolean;
  tooltipFormatter?: (d: { label: string; value: number }, pct: number, total: number) => string;
}) => {
  const total = data.reduce((acc, curr) => acc + curr.value, 0);
  const safeTotal = total > 0 ? total : 1;
  let accumulatedAngle = 0;
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const [hoverTip, setHoverTip] = React.useState<string | null>(null);
  const [mouse, setMouse] = React.useState<{ x: number; y: number } | null>(null);
  return (
    <div ref={wrapRef} className="h-[200px] w-full relative flex items-center justify-center"
      onMouseMove={(e) => { const el = wrapRef.current; if (!el) return; const r = el.getBoundingClientRect(); setMouse({ x: e.clientX - r.left, y: e.clientY - r.top }); }}
      onMouseLeave={() => { setHoverTip(null); setMouse(null); }}>
      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90 overflow-visible">
        {data.map((d, i) => {
          const angle = (d.value / safeTotal) * 360;
          const radius = 40; const circumference = 2 * Math.PI * radius;
          const strokeDasharray = `${(angle / 360) * circumference} ${circumference}`;
          const strokeDashoffset = -((accumulatedAngle / 360) * circumference);
          accumulatedAngle += angle;
          const pct = (d.value / safeTotal) * 100;
          const tip = tooltipFormatter ? tooltipFormatter(d, pct, total) : `${d.label}: ${Number(d.value).toLocaleString()} (${pct.toFixed(1)}%)`;
          return (<circle key={i} cx="50" cy="50" r={radius} fill="none" stroke={colors[i]} strokeWidth="15" strokeDasharray={strokeDasharray} strokeDashoffset={strokeDashoffset} className="transition-all duration-1000 ease-out cursor-default" onMouseEnter={() => setHoverTip(tip)} onMouseLeave={() => setHoverTip(null)} />);
        })}
      </svg>
      {showCenter && (<div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none"><span className="text-2xl font-bold text-white">{total.toLocaleString()}</span><span className="text-[10px] text-gray-500 uppercase">Total</span></div>)}
      {hoverTip && mouse && (<div className="absolute z-10 px-3 py-2 rounded-md bg-gray-950/90 text-white text-xs border border-gray-800 pointer-events-none" style={{ left: Math.min(mouse.x + 10, 260), top: Math.max(0, mouse.y - 30) }}>{hoverTip}</div>)}
    </div>
  );
};

// ── HorizontalBarChart ───────────────────────────────────────────────────────
export const HorizontalBarChart = ({ data, color }: { data: { label: string; value: number }[]; color: string }) => {
  const max = Math.max(...data.map((d) => d.value), 1);
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = React.useState<{ label: string; value: number } | null>(null);
  const [mouse, setMouse] = React.useState<{ x: number; y: number } | null>(null);
  return (
    <div ref={wrapRef} className="space-y-3 w-full relative"
      onMouseMove={(e) => { const el = wrapRef.current; if (!el) return; const r = el.getBoundingClientRect(); setMouse({ x: e.clientX - r.left, y: e.clientY - r.top }); }}
      onMouseLeave={() => { setHover(null); setMouse(null); }}>
      {data.map((d, i) => (
        <div key={i} className="flex items-center gap-3 text-xs" onMouseEnter={() => setHover(d)} onMouseLeave={() => setHover(null)}>
          <span className="w-24 text-right text-gray-400 truncate">{d.label}</span>
          <div className="flex-1 bg-gray-800 rounded-full h-2.5">
            <div style={{ width: `${(d.value / max) * 100}%` }} className={`h-full rounded-full ${color} transition-all duration-700`} />
          </div>
          <span className="w-12 text-white font-medium">{d.value}%</span>
        </div>
      ))}
      {hover && mouse && (<div className="absolute z-10 px-3 py-2 rounded-md bg-gray-950/90 text-white text-xs border border-gray-800 pointer-events-none" style={{ left: Math.min(mouse.x + 10, 260), top: Math.max(0, mouse.y - 30) }}><div className="font-semibold">{hover.label}</div><div>{hover.value}%</div></div>)}
    </div>
  );
};

// ── KPIStat ──────────────────────────────────────────────────────────────────
export const KPIStat = ({ label, value, subvalue, color = 'text-white' }: { label: string; value: string; subvalue?: string; color?: string }) => (
  <div className="bg-gray-950/50 rounded-lg p-3 border border-gray-800 flex flex-col items-center justify-center text-center flex-1 min-w-[100px]">
    <span className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">{label}</span>
    <span className={`text-xl font-bold ${color}`}>{value}</span>
    {subvalue && <span className="text-[10px] text-gray-400 mt-1">{subvalue}</span>}
  </div>
);

// ── Chart.js helpers ─────────────────────────────────────────────────────────
const CJ = {
  grid:        'rgba(255,255,255,0.06)',
  label:       '#9ca3af',
  male:        '#2563eb',
  female:      '#ef4444',
  neutral:     '#1D9E75',
  bg:          'rgba(10,10,20,0.95)',
  tooltipPadding: { top: 10, bottom: 10, left: 14, right: 14 },
  titleFont:   { size: 13, weight: 'bold' as const },
  bodyFont:    { size: 13 },
};

function useChartJs(canvasRef: React.RefObject<HTMLCanvasElement>, config: () => object | null, deps: any[]) {
  const chartRef = React.useRef<any>(null);
  React.useEffect(() => {
    let cancelled = false;
    const init = () => {
      if (cancelled || !canvasRef.current) return;
      const ChartJs = (window as any).Chart;
      if (!ChartJs) return;
      const cfg = config();
      if (!cfg) return;
      if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }
      chartRef.current = new ChartJs(canvasRef.current, cfg);
    };
    if ((window as any).Chart) {
      init();
    } else {
      const script = document.querySelector('script[src*="chart.umd"]') as HTMLScriptElement | null;
      if (script) {
        script.addEventListener('load', init, { once: true });
      } else {
        let tries = 0;
        const poll = setInterval(() => { if ((window as any).Chart || tries++ > 30) { clearInterval(poll); init(); } }, 100);
        return () => { cancelled = true; clearInterval(poll); chartRef.current?.destroy(); chartRef.current = null; };
      }
    }
    return () => { cancelled = true; chartRef.current?.destroy(); chartRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

// ── Barra horizontal colorida ────────────────────────────────────────────────
function AttrBarList({ items }: { items: { label: string; value: number; color: string }[] }) {
  return (
    <div className="space-y-3 mt-2">
      {items.map((item, i) => (
        <div key={i} className="space-y-1">
          <div className="flex justify-between text-xs text-gray-400">
            <span>{item.label}</span>
            <span style={{ color: item.color }} className="font-bold">{item.value.toFixed(1)}%</span>
          </div>
          <div className="w-full bg-gray-800 rounded-full h-3 overflow-hidden">
            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${item.value}%`, background: item.color }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── ChartDonut (Chart.js) ────────────────────────────────────────────────────
function ChartDonut({ labels, values, colors }: { labels: string[]; values: number[]; colors: string[] }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const total = values.reduce((a, b) => a + b, 0);
  const safeColors = values.map((v, i) => v > 0 ? (colors[i] ?? '#6b7280') : 'transparent');
  const safeBorder = values.map((v) => v > 0 ? '#111827' : 'transparent');

  useChartJs(canvasRef, () => {
    if (total === 0) return null;
    return {
      type: 'doughnut',
      data: { labels, datasets: [{ data: values, backgroundColor: safeColors, borderColor: safeBorder, borderWidth: 2, hoverOffset: 8 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '65%',
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: CJ.bg, borderColor: 'rgba(255,255,255,0.12)', borderWidth: 1,
            padding: CJ.tooltipPadding, titleFont: CJ.titleFont, bodyFont: CJ.bodyFont,
            filter: (item: any) => Number(item.raw) > 0,
            callbacks: {
              label: (ctx: any) => `  ${ctx.label}: ${total > 0 ? ((Number(ctx.raw) / total) * 100).toFixed(1) : 0}%`,
            },
          },
        },
      },
    };
  }, [JSON.stringify(values), JSON.stringify(safeColors)]);

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative w-full" style={{ height: 160 }}>
        {total === 0
          ? <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">Sem dados</div>
          : <canvas ref={canvasRef} />}
      </div>
      {total > 0 && (
        <div className="flex flex-wrap justify-center gap-x-3 gap-y-1">
          {labels.map((l, i) => values[i] > 0 && (
            <span key={i} className="flex items-center gap-1 text-[11px] text-gray-300">
              <span className="w-2.5 h-2.5 rounded-sm inline-block flex-shrink-0" style={{ background: colors[i] ?? '#6b7280' }} />
              {l} ({total > 0 ? ((values[i] / total) * 100).toFixed(1) : 0}%)
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const FACIAL_HAIR_MAP: Record<string, { label: string; color: string }> = {
  raspados:   { label: 'Raspados',   color: '#f9a8d4' },
  shaved:     { label: 'Raspados',   color: '#f9a8d4' },
  none:       { label: 'Raspados',   color: '#f9a8d4' },
  barba:      { label: 'Barba',      color: '#1f2937' },
  beard:      { label: 'Barba',      color: '#1f2937' },
  full:       { label: 'Barba',      color: '#1f2937' },
  cavanhaque: { label: 'Cavanhaque', color: '#2563eb' },
  goatee:     { label: 'Cavanhaque', color: '#2563eb' },
  bigode:     { label: 'Bigode',     color: '#dc2626' },
  mustache:   { label: 'Bigode',     color: '#dc2626' },
  cerdas:     { label: 'Cerdas',     color: '#d97706' },
  stubble:    { label: 'Cerdas',     color: '#d97706' },
};

const GLASSES_MAP: Record<string, { label: string; color: string }> = {
  'sem óculos':    { label: 'Sem óculos',    color: '#e5e7eb' },
  none:            { label: 'Sem óculos',    color: '#e5e7eb' },
  'false':         { label: 'Sem óculos',    color: '#e5e7eb' },
  'óculos normais':{ label: 'Óculos normais',color: '#93c5fd' },
  normal:          { label: 'Óculos normais',color: '#93c5fd' },
  regular:         { label: 'Óculos normais',color: '#93c5fd' },
  'true':          { label: 'Óculos normais',color: '#93c5fd' },
  'óculos escuros':{ label: 'Óculos escuros',color: '#374151' },
  dark:            { label: 'Óculos escuros',color: '#374151' },
  sunglasses:      { label: 'Óculos escuros',color: '#374151' },
};
const HAIR_TYPE_MAP: Record<string, { label: string; color: string }> = {
  normal:      { label: 'Normal',   color: '#2563eb' },
  longo:       { label: 'Longo',    color: '#7c3aed' },
  long:        { label: 'Longo',    color: '#7c3aed' },
  careca:      { label: 'Careca',   color: '#f97316' },
  bald:        { label: 'Careca',   color: '#f97316' },
  high_temple: { label: 'Entradas', color: '#06b6d4' },
  short:       { label: 'Curto',    color: '#10b981' },
  curly:       { label: 'Cacheado', color: '#eab308' },
  wavy:        { label: 'Ondulado', color: '#a78bfa' },
  straight:    { label: 'Liso',     color: '#34d399' },
};

const HAIR_COLOR_MAP: Record<string, { label: string; color: string }> = {
  preto:    { label: 'Preto',    color: '#374151' },
  black:    { label: 'Preto',    color: '#374151' },
  castanho: { label: 'Castanho', color: '#92400e' },
  brown:    { label: 'Castanho', color: '#92400e' },
  loiro:    { label: 'Loiro',    color: '#f59e0b' },
  blond:    { label: 'Loiro',    color: '#f59e0b' },
  blonde:   { label: 'Loiro',    color: '#f59e0b' },
  ruivo:    { label: 'Ruivo',    color: '#ef4444' },
  red:      { label: 'Ruivo',    color: '#ef4444' },
  grisalho: { label: 'Grisalho', color: '#9ca3af' },
  gray:     { label: 'Grisalho', color: '#9ca3af' },
  grey:     { label: 'Grisalho', color: '#9ca3af' },
  branco:   { label: 'Branco',   color: '#e5e7eb' },
  white:    { label: 'Branco',   color: '#e5e7eb' },
};

function mapHairData(raw: { label: string; value: number }[] | undefined, mapDict: Record<string, { label: string; color: string }>): { labels: string[]; values: number[]; colors: string[] } {
  if (!raw || raw.length === 0) return { labels: [], values: [], colors: [] };
  const items = raw.filter((d) => Number(d.value) > 0).map((d) => {
    const key = String(d.label).toLowerCase().trim();
    const mapped = mapDict[key] ?? { label: d.label, color: '#6b7280' };
    return { label: mapped.label, value: Number(d.value), color: mapped.color };
  });
  return { labels: items.map((x) => x.label), values: items.map((x) => x.value), colors: items.map((x) => x.color) };
}

// ── WIDGET DEFINITIONS ───────────────────────────────────────────────────────
export type WidgetType = { id: string; title: string; type: 'chart' | 'table' | 'kpi'; size: 'full' | 'half' | 'third' | 'quarter' | '2/3'; description: string; };

export const AVAILABLE_WIDGETS: WidgetType[] = [
  { id: 'kpi_flow_stats',      title: 'Resumo de Fluxo',               type: 'kpi',   size: 'full',  description: 'Total Visitantes, Média Dia, Tempo Médio' },
  { id: 'flow_trend',          title: 'Tendências de Fluxo (Semanal)', type: 'chart', size: 'half',  description: 'Gráfico de linha com fluxo diário' },
  { id: 'hourly_flow',         title: 'Fluxo por Hora',                type: 'chart', size: 'half',  description: 'Gráfico de linha por gênero (Masculino/Feminino)' },
  { id: 'chart_sales_quarter', title: 'Visitantes — Último Trimestre', type: 'chart', size: 'half',  description: 'Total de visitantes por mês (últimos 3 meses)' },
  { id: 'age_pyramid',         title: 'Gênero & Idade',                type: 'chart', size: 'third', description: 'Barras agrupadas por faixa etária e gênero' },
  { id: 'chart_age_ranges',    title: 'Distribuição por Faixa Etária', type: 'chart', size: 'third', description: 'Visitantes por faixa etária' },
  { id: 'gender_dist',         title: 'Distribuição de Gênero',        type: 'chart', size: 'third', description: 'Donut: Masculino vs Feminino' },
  { id: 'attributes',          title: 'Atributos Gerais',              type: 'chart', size: 'third', description: 'Resumo de atributos principais' },
  { id: 'chart_vision',        title: 'Atributo: Visão',               type: 'chart', size: 'third', description: 'Uso de óculos' },
  { id: 'chart_facial_hair',   title: 'Atributo: Pelos Faciais',       type: 'chart', size: 'third', description: 'Barba e pelos faciais' },
  { id: 'chart_hair_type',     title: 'Atributo: Tipo de Cabelo',      type: 'chart', size: 'third', description: 'Normal, Entradas, Careca' },
  { id: 'chart_hair_color',    title: 'Atributo: Cor de Cabelo',       type: 'chart', size: 'third', description: 'Preto, Castanho, Loiro, etc.' },
  { id: 'campaigns',           title: 'Engajamento em Campanhas',      type: 'table', size: '2/3',   description: 'Tabela de performance de campanhas' },
  { id: 'heatmap',             title: 'Mapa de Calor (Loja)',          type: 'chart', size: 'full',  description: 'Visualização térmica da planta baixa' },
];

// ── WidgetFlowTrend ──────────────────────────────────────────────────────────
export const WidgetFlowTrend = ({ view, dailyData }: { view: string; dailyData?: number[] }) => {
  const data = dailyData && dailyData.length ? dailyData : [0,0,0,0,0,0,0];
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 h-full">
      <h3 className="font-bold text-white mb-4 flex items-center gap-2 uppercase text-xs tracking-wider"><Activity size={14} className="text-blue-500" />Média Visitantes Dia - {view === 'network' ? 'Rede' : 'Dia da Semana'}</h3>
      <LineChart data={data} color="text-blue-500" height={100} labels={['Seg','Ter','Qua','Qui','Sex','Sab','Dom']} valueFormatter={(v) => `${Number(v).toLocaleString()} visitantes`} />
      <div className="flex justify-between text-[10px] text-gray-500 mt-2 uppercase"><span>Seg</span><span>Ter</span><span>Qua</span><span>Qui</span><span>Sex</span><span>Sab</span><span>Dom</span></div>
    </div>
  );
};

// ── WidgetHourlyFlow ─────────────────────────────────────────────────────────
export const WidgetHourlyFlow = ({ view, hourlyData, genderData }: { view: string; hourlyData?: number[]; genderData?: { label: string; value: number }[] }) => {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const data = hourlyData && hourlyData.length ? hourlyData : new Array(24).fill(0);
  const labels = Array.from({ length: 24 }, (_, i) => `${i}h`);
  const mPct = Number(genderData?.find((g) => g.label.toLowerCase().includes('masc'))?.value ?? 50) / 100;
  const fPct = 1 - mPct;
  const maleData   = data.map((v) => Math.round(v * mPct));
  const femaleData = data.map((v) => Math.round(v * fPct));

  useChartJs(canvasRef, () => ({
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Masculino', data: maleData,   borderColor: CJ.male,   backgroundColor: 'transparent', borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, pointBackgroundColor: CJ.male,   tension: 0.4 },
        { label: 'Feminino',  data: femaleData, borderColor: CJ.female, backgroundColor: 'transparent', borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, pointBackgroundColor: CJ.female, tension: 0.4 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: CJ.bg, borderColor: 'rgba(255,255,255,0.12)', borderWidth: 1,
          padding: CJ.tooltipPadding, titleFont: CJ.titleFont, bodyFont: CJ.bodyFont,
          callbacks: { label: (ctx: any) => `  ${ctx.dataset.label}: ${Number(ctx.raw).toLocaleString()}` },
        },
      },
      scales: {
        x: { grid: { color: CJ.grid }, ticks: { color: CJ.label, font: { size: 10 }, autoSkip: true, maxTicksLimit: 12 }, title: { display: true, text: 'Horário (h)', color: CJ.label, font: { size: 11 } } },
        y: { beginAtZero: true, grid: { color: CJ.grid }, ticks: { color: CJ.label, font: { size: 11 }, callback: (v: number) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v) }, title: { display: true, text: 'Número de Visita', color: CJ.label, font: { size: 11 } } },
      },
    },
  }), [JSON.stringify(maleData), JSON.stringify(femaleData)]);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 h-full flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-white flex items-center gap-2 uppercase text-xs tracking-wider"><Clock size={14} className="text-emerald-500" />Fluxo por Hora {view === 'network' ? '(Rede)' : ''}</h3>
        <div className="flex gap-3 text-[10px] text-gray-400">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: CJ.male }} />Masculino</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: CJ.female }} />Feminino</span>
        </div>
      </div>
      <div className="relative w-full" style={{ height: 220 }}><canvas ref={canvasRef} /></div>
    </div>
  );
};

// ── WidgetAgePyramid ─────────────────────────────────────────────────────────
export const WidgetAgePyramid = ({ view, ageData, totalVisitors }: { view: string; ageData?: any[]; totalVisitors?: number }) => {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const defaultData = [{ age:'65+',m:0,f:0 },{ age:'55-64',m:0,f:0 },{ age:'45-54',m:0,f:0 },{ age:'35-44',m:0,f:0 },{ age:'25-34',m:0,f:0 },{ age:'18-24',m:0,f:0 },{ age:'18-',m:0,f:0 }];
  const data = (ageData && ageData.length ? ageData : defaultData).slice().reverse();
  const lblMap: Record<string,string> = { '18-':'<18','18-24':'18-24','25-34':'25-34','35-44':'35-44','45-54':'45-54','55-64':'55-64','65+':'65+' };

  useChartJs(canvasRef, () => ({
    type: 'bar',
    data: {
      labels: data.map((d) => lblMap[d.age] ?? d.age),
      datasets: [
        { label: 'Feminino',  data: data.map((d) => Number(d.f)||0), backgroundColor: CJ.female, borderRadius: 3, borderSkipped: false },
        { label: 'Masculino', data: data.map((d) => Number(d.m)||0), backgroundColor: CJ.male,   borderRadius: 3, borderSkipped: false },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: CJ.bg, borderColor: 'rgba(255,255,255,0.12)', borderWidth: 1,
          padding: CJ.tooltipPadding, titleFont: CJ.titleFont, bodyFont: CJ.bodyFont,
          callbacks: {
            label: (ctx: any) => {
              const v = Number(ctx.raw);
              const base = typeof totalVisitors === 'number' && totalVisitors > 0 ? totalVisitors : null;
              const cnt = base ? Math.round((v / 100) * base) : null;
              return `  ${ctx.dataset.label}: ${v}%${cnt ? ` (${cnt.toLocaleString()})` : ''}`;
            },
          },
        },
      },
      scales: {
        x: { grid: { color: CJ.grid }, ticks: { color: CJ.label, font: { size: 11 } } },
        y: { beginAtZero: true, grid: { color: CJ.grid }, ticks: { color: CJ.label, font: { size: 11 }, callback: (v: number) => `${v}%` }, title: { display: true, text: 'Número %', color: CJ.label, font: { size: 11 } } },
      },
    },
  }), [JSON.stringify(data)]);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 h-full flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-white flex items-center gap-2 uppercase text-xs tracking-wider"><Users size={14} className="text-purple-500" />Gênero &amp; Idade</h3>
        <div className="flex gap-3 text-[10px] text-gray-400">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: CJ.female }} />Feminino</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: CJ.male }} />Masculino</span>
        </div>
      </div>
      <div className="relative w-full" style={{ height: 220 }}><canvas ref={canvasRef} /></div>
    </div>
  );
};

// ── WidgetAgeRanges ──────────────────────────────────────────────────────────
export const WidgetAgeRanges = ({ ageData }: { ageData?: { age: string; m: number; f: number }[] }) => {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const order  = ['18-','18-24','25-34','35-44','45-54','55-64','65+'];
  const lblMap: Record<string,string> = { '18-':'<18','18-24':'18-25','25-34':'26-35','35-44':'36-45','45-54':'46-60','55-64':'55-64','65+':'60+' };
  const byAge  = new Map((ageData||[]).map((d) => [String(d.age), d]));
  const vals   = order.map((age) => { const d = byAge.get(age); return (Number(d?.m)||0)+(Number(d?.f)||0); });

  useChartJs(canvasRef, () => ({
    type: 'bar',
    data: {
      labels: order.map((a) => lblMap[a]??a),
      datasets: [{ label: 'Visitantes', data: vals, backgroundColor: vals.map(()=>CJ.male), borderRadius: 4, borderSkipped: false, hoverBackgroundColor: '#93c5fd' }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: CJ.bg, borderColor: 'rgba(255,255,255,0.12)', borderWidth: 1,
          padding: CJ.tooltipPadding, titleFont: CJ.titleFont, bodyFont: CJ.bodyFont,
          callbacks: { title: (i:any[])=>i[0]?.label??'', label: (ctx:any)=>`  visitantes: ${Number(ctx.raw).toLocaleString()}` },
        },
      },
      scales: {
        x: { grid:{ color:CJ.grid }, ticks:{ color:CJ.label, font:{ size:11 } }, title:{ display:true, text:'Faixa etária', color:CJ.label, font:{ size:11 } } },
        y: { beginAtZero:true, grid:{ color:CJ.grid }, ticks:{ color:CJ.label, font:{ size:11 }, callback:(v:number)=>v>=1000?`${(v/1000).toFixed(0)}k`:String(v) }, title:{ display:true, text:'Visitantes', color:CJ.label, font:{ size:11 } } },
      },
    },
  }), [JSON.stringify(vals)]);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 h-full flex flex-col gap-3">
      <h3 className="font-bold text-white uppercase text-xs tracking-wider">Distribuição por Faixa Etária</h3>
      <div className="relative w-full" style={{ height: 220 }}><canvas ref={canvasRef} /></div>
    </div>
  );
};

// ── WidgetGenderDist ─────────────────────────────────────────────────────────
export const WidgetGenderDist = ({ genderData, totalVisitors }: { view?: string; genderData?: { label: string; value: number }[]; totalVisitors?: number }) => {
  const fallback = [{ label:'Masculino', value:0 },{ label:'Feminino', value:0 }];
  const raw = genderData && genderData.length >= 2 ? genderData : fallback;

  const maleRaw  = Number(raw.find(g => g.label.toLowerCase().includes('masc'))?.value) || 0;
  const femRaw   = Number(raw.find(g => g.label.toLowerCase().includes('fem'))?.value)  || 0;
  const indRaw   = Number(raw.find(g => g.label.toLowerCase().includes('indef') || g.label.toLowerCase().includes('unknown') || g.label === '0')?.value) || 0;

  const sum = maleRaw + femRaw + indRaw || 1;
  const totalCount = typeof totalVisitors === 'number' && totalVisitors > 0 ? totalVisitors : null;
  const isPct = totalCount != null && sum > 0 && sum <= 101;

  const malePct  = isPct ? Math.round(maleRaw) : Math.round((maleRaw/sum)*100);
  const femPct   = isPct ? Math.round(femRaw)  : Math.round((femRaw/sum)*100);
  const indPct   = isPct ? Math.round(indRaw)  : Math.round((indRaw/sum)*100);

  const maleCount = totalCount ? Math.round((malePct/100)*totalCount) : null;
  const femCount  = totalCount ? Math.round((femPct/100)*totalCount)  : null;
  const indCount  = totalCount ? Math.round((indPct/100)*totalCount)  : null;

  const segments = [
    { label: 'Masculino',  value: malePct, color: CJ.male,   count: maleCount },
    { label: 'Feminino',   value: femPct,  color: CJ.female, count: femCount  },
    ...(indPct > 0 ? [{ label: 'Indefinido', value: indPct, color: '#10b981', count: indCount }] : []),
  ].filter(s => s.value > 0);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 h-full">
      <h3 className="font-bold text-white mb-3 flex items-center gap-2 uppercase text-xs tracking-wider"><Users size={14} className="text-pink-500" />Gênero</h3>
      <ChartDonut
        labels={segments.map(s=>s.label)}
        values={segments.map(s=>s.value)}
        colors={segments.map(s=>s.color)}
      />
      <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-1">
        {segments.map((s,i) => (
          <span key={i} className="flex items-center gap-1 text-[11px] text-gray-300">
            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: s.color }} />
            {s.label} ({s.value}%{s.count!=null?` • ${s.count.toLocaleString()}`:''})
          </span>
        ))}
      </div>
    </div>
  );
};

// ── WidgetAttributes ─────────────────────────────────────────────────────────
export const WidgetAttributes = ({ attrData }: { view?: string; attrData?: { label: string; value: number }[] }) => {
  // Filtra apenas os 4 atributos principais, ignorando prefixos internos
  const data = (attrData || [])
    .filter(a => !a.label.startsWith('_'))
    .filter(a => ['Óculos','Barba','Máscara','Chapéu/Boné'].includes(a.label));
  const display = data.length > 0 ? data : [
    { label:'Óculos', value:0 }, { label:'Barba', value:0 },
    { label:'Máscara', value:0 }, { label:'Chapéu/Boné', value:0 },
  ];
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 h-full">
      <h3 className="font-bold text-white mb-4 flex items-center gap-2 uppercase text-xs tracking-wider"><Users size={14} className="text-orange-500" />Atributos</h3>
      <HorizontalBarChart data={display} color="bg-orange-500" />
    </div>
  );
};

// ── WidgetVision ─────────────────────────────────────────────────────────────
export const WidgetVision = ({ attrData }: { attrData?: { label: string; value: number }[] }) => {
  const raw = attrData?.find((a) => String(a.label).toLowerCase().includes('óculos'));
  const glassesPct = Number(raw?.value) || 0;

  // Tenta usar mapa detalhado se vier como categorias
  const glassesAttr = attrData || [];
  const hasCats = glassesAttr.some((a) => {
    const k = String(a.label).toLowerCase();
    return k.includes('normal') || k.includes('escuro') || k.includes('sunglasses');
  });

  let items: { label: string; value: number; color: string }[] = [];

  if (hasCats) {
    items = glassesAttr
      .filter((a) => Number(a.value) > 0)
      .map((a) => {
        const k = String(a.label).toLowerCase().trim();
        const m = GLASSES_MAP[k] ?? { label: a.label, color: '#6b7280' };
        return { label: m.label, value: Number(a.value), color: m.color };
      });
  } else {
    const withGlasses    = Math.max(0, Math.min(100, glassesPct));
    const withoutGlasses = Math.max(0, 100 - withGlasses);
    if (withGlasses > 0)    items.push({ label: 'Com Óculos', value: withGlasses,    color: '#93c5fd' });
    if (withoutGlasses > 0) items.push({ label: 'Sem Óculos', value: withoutGlasses, color: '#4b5563' });
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 h-full">
      <h3 className="font-bold text-white mb-3 uppercase text-xs tracking-wider">Visão</h3>
      {items.length === 0
        ? <div className="h-[120px] flex items-center justify-center text-gray-500 text-sm">Sem dados</div>
        : items.length === 1
          ? <AttrBarList items={items} />
          : <ChartDonut labels={items.map(x=>x.label)} values={items.map(x=>x.value)} colors={items.map(x=>x.color)} />}
    </div>
  );
};

// ── WidgetFacialHair ─────────────────────────────────────────────────────────
export const WidgetFacialHair = ({ attrData }: { attrData?: { label: string; value: number }[] }) => {
  const beardPct     = Number(attrData?.find((a) => String(a.label).toLowerCase().includes('barba'))?.value) || 0;
  const withBeard    = Math.max(0, Math.min(100, beardPct));
  const withoutBeard = Math.max(0, 100 - withBeard);

  // Detecta se tem categorias detalhadas (raspados, cavanhaque, etc)
  const hasCats = (attrData || []).some((a) => {
    const k = String(a.label).toLowerCase();
    return k.includes('raspad') || k.includes('cavanhaque') || k.includes('bigode') || k.includes('cerda');
  });

  let items: { label: string; value: number; color: string }[] = [];

  if (hasCats) {
    items = (attrData || [])
      .filter((a) => Number(a.value) > 0)
      .map((a) => {
        const k = String(a.label).toLowerCase().trim();
        const m = FACIAL_HAIR_MAP[k] ?? { label: a.label, color: '#6b7280' };
        return { label: m.label, value: Number(a.value), color: m.color };
      });
  } else {
    if (withBeard > 0)    items.push({ label: 'Com Barba', value: withBeard,    color: '#f97316' });
    if (withoutBeard > 0) items.push({ label: 'Sem Barba', value: withoutBeard, color: '#1d4ed8' });
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 h-full">
      <h3 className="font-bold text-white mb-3 uppercase text-xs tracking-wider">Pelos Faciais</h3>
      {items.length === 0
        ? <div className="h-[120px] flex items-center justify-center text-gray-500 text-sm">Sem dados</div>
        : items.length === 1
          ? <AttrBarList items={items} />
          : <ChartDonut labels={items.map(x=>x.label)} values={items.map(x=>x.value)} colors={items.map(x=>x.color)} />}
    </div>
  );
};

// ── WidgetHairType ───────────────────────────────────────────────────────────
export const WidgetHairType = ({ hairTypeData }: { hairTypeData?: { label: string; value: number }[] }) => {
  const { labels, values, colors } = mapHairData(hairTypeData, HAIR_TYPE_MAP);
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 h-full">
      <h3 className="font-bold text-white mb-3 uppercase text-xs tracking-wider">Tipo de Cabelo</h3>
      {labels.length === 0 ? <div className="h-[120px] flex items-center justify-center text-gray-500 text-sm">Sem dados</div>
        : labels.length === 1 ? <AttrBarList items={labels.map((l,i)=>({ label:l, value:values[i], color:colors[i] }))} />
        : <ChartDonut labels={labels} values={values} colors={colors} />}
    </div>
  );
};

// ── WidgetHairColor ──────────────────────────────────────────────────────────
export const WidgetHairColor = ({ hairColorData }: { hairColorData?: { label: string; value: number }[] }) => {
  const { labels, values, colors } = mapHairData(hairColorData, HAIR_COLOR_MAP);
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 h-full">
      <h3 className="font-bold text-white mb-3 uppercase text-xs tracking-wider">Cor de Cabelo</h3>
      {labels.length === 0 ? <div className="h-[120px] flex items-center justify-center text-gray-500 text-sm">Sem dados</div>
        : labels.length === 1 ? <AttrBarList items={labels.map((l,i)=>({ label:l, value:values[i], color:colors[i] }))} />
        : <ChartDonut labels={labels} values={values} colors={colors} />}
    </div>
  );
};

// ── WidgetCampaigns ──────────────────────────────────────────────────────────
export const WidgetCampaigns = ({ view, clientId }: { view: string; clientId?: string }) => {
  const [rows, setRows]       = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!clientId) return;
    setLoading(true);
    import('../lib/supabase').then(({ default: supabase }) => {
      supabase
        .from('campaigns')
        .select('name,start_date,end_date,duration_days,duration_hms,visitors,avg_attention_sec')
        .eq('client_id', clientId)
        .order('start_date', { ascending: false })
        .limit(50)
        .then(({ data }) => { setRows(data || []); setLoading(false); });
    });
  }, [clientId]);

  const fmtDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';

  const fmtSec = (s: number) => {
    const m = Math.floor(s / 60); const sec = s % 60;
    return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 h-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-white flex items-center gap-2 uppercase text-xs tracking-wider">
          <Activity size={14} className="text-emerald-500" />
          Engajamento em Campanhas {view === 'network' ? '(Rede)' : ''}
        </h3>
        {clientId && (
          <a
            href={`/clientes/${clientId}/campanhas`}
            className="text-[10px] text-emerald-400 hover:text-emerald-300 border border-emerald-800 hover:border-emerald-600 px-2 py-1 rounded-md transition-colors"
          >
            + Importar CSV
          </a>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-gray-500 text-sm">Carregando...</div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 gap-2 text-gray-500 text-sm">
          <p>Nenhuma campanha importada.</p>
          {clientId && (
            <a href={`/clientes/${clientId}/campanhas`} className="text-emerald-400 hover:underline text-xs">
              Clique aqui para importar o relatório da Displayforce
            </a>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-gray-500 uppercase border-b border-gray-800">
              <tr>
                <th className="pb-2 pr-4 font-medium">Campanha</th>
                <th className="pb-2 pr-4 font-medium">Início</th>
                <th className="pb-2 pr-4 font-medium">Fim</th>
                <th className="pb-2 pr-4 font-medium text-right">Visitantes</th>
                <th className="pb-2 font-medium text-right">Atenção</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {rows.map((r, i) => (
                <tr key={i} className="hover:bg-gray-800/50 transition-colors">
                  <td className="py-2 pr-4 text-white font-medium max-w-[180px] truncate">{r.name || '—'}</td>
                  <td className="py-2 pr-4 text-gray-400 whitespace-nowrap">{fmtDate(r.start_date)}</td>
                  <td className="py-2 pr-4 text-gray-400 whitespace-nowrap">{fmtDate(r.end_date)}</td>
                  <td className="py-2 pr-4 text-emerald-400 text-right font-medium">{Number(r.visitors||0).toLocaleString('pt-BR')}</td>
                  <td className="py-2 text-blue-400 text-right font-medium">{r.avg_attention_sec > 0 ? fmtSec(r.avg_attention_sec) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ── WidgetKPIFlowStats ───────────────────────────────────────────────────────
export const WidgetKPIFlowStats = ({ totalVisitors, avgVisitorsPerDay, avgVisitSeconds }: { totalVisitors?: number; avgVisitorsPerDay?: number; avgVisitSeconds?: number }) => {
  const fmtDur = (s: number) => { const sec=Math.max(0,Math.floor(Number(s)||0)); const m=Math.floor(sec/60); const r=sec%60; return `${String(m).padStart(2,'0')}:${String(r).padStart(2,'0')}`; };
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 h-full flex items-center justify-between gap-4 overflow-x-auto">
      <KPIStat label="Total Visitantes"     value={Number(totalVisitors||0).toLocaleString()} />
      <KPIStat label="Média Visitantes Dia" value={Number(avgVisitorsPerDay||0).toLocaleString()} color="text-blue-400" />
      <KPIStat label="Tempo Médio Visita"   value={fmtDur(Number(avgVisitSeconds||0))}         color="text-emerald-400" />
    </div>
  );
};

// ── WidgetSalesQuarter ───────────────────────────────────────────────────────
export const WidgetSalesQuarter = ({ quarterData, loading }: { quarterData?: { label: string; visitors: number; sales: number }[]; loading?: boolean }) => {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const data = Array.isArray(quarterData) && quarterData.length ? quarterData : [];
  const visitors = data.map((d) => Number(d.visitors)||0);
  const totalV   = visitors.reduce((a,b)=>a+b,0);

  useChartJs(canvasRef, () => {
    if (data.length === 0) return null;
    return {
      type: 'bar',
      data: { labels: data.map(d=>d.label), datasets: [{ label:'Visitantes', data: visitors, backgroundColor: CJ.neutral, borderRadius:4, borderSkipped:false, hoverBackgroundColor:'#34d399' }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: CJ.bg, borderColor: 'rgba(255,255,255,0.12)', borderWidth:1,
            padding: CJ.tooltipPadding, titleFont: CJ.titleFont, bodyFont: CJ.bodyFont,
            callbacks: { title:(i:any[])=>i[0]?.label??'', label:(ctx:any)=>{ const v=Number(ctx.raw); return `  Visitantes: ${v>=1000?`${(v/1000).toFixed(1)}k`:v.toLocaleString('pt-BR')}`; } },
          },
        },
        scales: {
          x: { grid:{ color:CJ.grid }, ticks:{ color:CJ.label, font:{ size:12 }, autoSkip:false, maxRotation:0 } },
          y: { beginAtZero:true, grid:{ color:CJ.grid }, ticks:{ color:CJ.neutral, font:{ size:11 }, callback:(v:number)=>v>=1000?`${(v/1000).toFixed(0)}k`:String(v) } },
        },
      },
    };
  }, [JSON.stringify(visitors)]);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 h-full flex flex-col gap-3">
      <h3 className="font-bold text-white uppercase text-xs tracking-wider">Total Visitantes — Último Trimestre</h3>
      <div className="flex gap-4 text-[10px] text-gray-500">
        <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: CJ.neutral }} />Visitantes <strong className="text-white ml-1">{loading ? '…' : totalV.toLocaleString('pt-BR')}</strong></span>
      </div>
      <div className="relative w-full" style={{ height: 200 }}>
        {loading ? <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">Carregando...</div>
          : data.length === 0 ? <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">Sem dados no trimestre</div>
          : <canvas ref={canvasRef} />}
      </div>
    </div>
  );
};

// ── WIDGET_MAP ───────────────────────────────────────────────────────────────
export const WIDGET_MAP: Record<string, React.FC<any>> = {
  'flow_trend':          WidgetFlowTrend,
  'hourly_flow':         WidgetHourlyFlow,
  'age_pyramid':         WidgetAgePyramid,
  'gender_dist':         WidgetGenderDist,
  'attributes':          WidgetAttributes,
  'campaigns':           WidgetCampaigns,
  'kpi_flow_stats':      WidgetKPIFlowStats,
  'chart_sales_quarter': WidgetSalesQuarter,
  'chart_age_ranges':    WidgetAgeRanges,
  'chart_vision':        WidgetVision,
  'chart_facial_hair':   WidgetFacialHair,
  'chart_hair_type':     WidgetHairType,
  'chart_hair_color':    WidgetHairColor,
  'heatmap': () => <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 h-full flex items-center justify-center text-gray-500">Mapa de Calor (Em breve)</div>,
};