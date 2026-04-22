import React from 'react';
import { Activity, Clock, SlidersHorizontal, Users } from 'lucide-react';
import supabase from '../lib/supabase';

// ── Chart.js helpers ─────────────────────────────────────────────────────────
const CJ = {
  grid:           'rgba(255,255,255,0.06)',
  label:          '#9ca3af',
  male:           '#2563eb',
  female:         '#ef4444',
  neutral:        '#1D9E75',
  bg:             'rgba(10,10,20,0.95)',
  tooltipPadding: { top: 10, bottom: 10, left: 14, right: 14 },
  titleFont:      { size: 13, weight: 'bold' as const },
  bodyFont:       { size: 13 },
};

// Altura padrão de todos os canvas Chart.js — NUNCA use flex-1 com Chart.js
const CHART_H = 220;

function useChartJs(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  config: () => object | null,
  deps: any[],
) {
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
      let tries = 0;
      const poll = setInterval(() => {
        if ((window as any).Chart || tries++ > 30) { clearInterval(poll); init(); }
      }, 100);
      return () => { cancelled = true; clearInterval(poll); chartRef.current?.destroy(); chartRef.current = null; };
    }
    return () => { cancelled = true; chartRef.current?.destroy(); chartRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

const CanvasBox = ({
  height = CHART_H,
  minHeight,
  className = '',
  children,
}: {
  height?: number | string;
  minHeight?: number;
  className?: string;
  children: React.ReactNode;
}) => (
  <div
    style={{
      position: 'relative',
      width: '100%',
      height,
      ...(minHeight == null ? {} : { minHeight }),
    }}
    className={`min-w-0 ${typeof height === 'number' ? 'flex-shrink-0' : ''} ${className}`}
  >
    {children}
  </div>
);

// ── HorizontalBarChart ───────────────────────────────────────────────────────
export const HorizontalBarChart = ({ data, color }: { data: { label: string; value: number }[]; color: string }) => {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="space-y-3 w-full">
      {data.map((d, i) => (
        <div key={i} className="flex items-center gap-3 text-xs">
          <span className="w-24 text-right text-gray-400 truncate">{d.label}</span>
          <div className="flex-1 bg-gray-800 rounded-full h-2.5">
            <div style={{ width: `${(d.value / max) * 100}%` }} className={`h-full rounded-full ${color} transition-all duration-700`} />
          </div>
          <span className="w-12 text-white font-medium">{d.value}%</span>
        </div>
      ))}
    </div>
  );
};

// ── KPIStat ──────────────────────────────────────────────────────────────────
export const KPIStat = ({ label, value, color = 'text-white' }: { label: string; value: string; color?: string }) => (
  <div className="bg-gray-950/50 rounded-lg p-3 border border-gray-800 flex flex-col items-center justify-center text-center flex-1 min-w-[100px]">
    <span className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">{label}</span>
    <span className={`text-xl font-bold ${color}`}>{value}</span>
  </div>
);




// ── Maps ─────────────────────────────────────────────────────────────────────
const FACIAL_HAIR_MAP: Record<string, { label: string; color: string }> = {
  raspados: { label: 'Raspados', color: '#f9a8d4' }, shaved: { label: 'Raspados', color: '#f9a8d4' }, none: { label: 'Raspados', color: '#f9a8d4' }, gm: { label: 'Raspados', color: '#f9a8d4' }, 'no beard': { label: 'Raspados', color: '#f9a8d4' }, clean: { label: 'Raspados', color: '#f9a8d4' }, 'false': { label: 'Raspados', color: '#f9a8d4' }, '0': { label: 'Raspados', color: '#f9a8d4' },
  barba: { label: 'Barba', color: '#1f2937' }, beard: { label: 'Barba', color: '#1f2937' }, full: { label: 'Barba', color: '#1f2937' },
  cavanhaque: { label: 'Cavanhaque', color: '#2563eb' }, goatee: { label: 'Cavanhaque', color: '#2563eb' },
  bigode: { label: 'Bigode', color: '#dc2626' }, mustache: { label: 'Bigode', color: '#dc2626' },
  cerdas: { label: 'Cerdas', color: '#d97706' }, stubble: { label: 'Cerdas', color: '#d97706' }, bristle: { label: 'Cerdas', color: '#d97706' }, bristles: { label: 'Cerdas', color: '#d97706' },
};
const GLASSES_MAP: Record<string, { label: string; color: string }> = {
  // Sem óculos
  'sem óculos': { label: 'Sem Óculos', color: '#4b5563' }, none: { label: 'Sem Óculos', color: '#4b5563' }, 'false': { label: 'Sem Óculos', color: '#4b5563' }, '0': { label: 'Sem Óculos', color: '#4b5563' },
  // Óculos normais (valor "usual" vem do normalizador em sync-analytics)
  'óculos normais': { label: 'Óculos Normais', color: '#93c5fd' }, usual: { label: 'Óculos Normais', color: '#93c5fd' }, normal: { label: 'Óculos Normais', color: '#93c5fd' }, regular: { label: 'Óculos Normais', color: '#93c5fd' }, 'true': { label: 'Óculos Normais', color: '#93c5fd' }, '1': { label: 'Óculos Normais', color: '#93c5fd' },
  // Óculos escuros (3º tipo)
  'óculos escuros': { label: 'Óculos Escuros', color: '#1e3a5f' }, dark: { label: 'Óculos Escuros', color: '#1e3a5f' }, sunglasses: { label: 'Óculos Escuros', color: '#1e3a5f' }, 'dark glasses': { label: 'Óculos Escuros', color: '#1e3a5f' }, 'sun glasses': { label: 'Óculos Escuros', color: '#1e3a5f' },
};
const HAIR_TYPE_MAP: Record<string, { label: string; color: string }> = {
  normal: { label: 'Normal', color: '#2563eb' }, longo: { label: 'Longo', color: '#7c3aed' }, long: { label: 'Longo', color: '#7c3aed' },
  careca: { label: 'Careca', color: '#f97316' }, bald: { label: 'Careca', color: '#f97316' }, high_temple: { label: 'Entradas', color: '#06b6d4' },
  short: { label: 'Curto', color: '#10b981' }, curly: { label: 'Cacheado', color: '#eab308' }, wavy: { label: 'Ondulado', color: '#a78bfa' }, straight: { label: 'Liso', color: '#34d399' },
};
const HAIR_COLOR_MAP: Record<string, { label: string; color: string }> = {
  preto: { label: 'Preto', color: '#374151' }, black: { label: 'Preto', color: '#374151' },
  castanho: { label: 'Castanho', color: '#92400e' }, brown: { label: 'Castanho', color: '#92400e' },
  loiro: { label: 'Loiro', color: '#f59e0b' }, blond: { label: 'Loiro', color: '#f59e0b' }, blonde: { label: 'Loiro', color: '#f59e0b' },
  ruivo: { label: 'Ruivo', color: '#ef4444' }, red: { label: 'Ruivo', color: '#ef4444' },
  grisalho: { label: 'Grisalho', color: '#9ca3af' }, gray: { label: 'Grisalho', color: '#9ca3af' }, grey: { label: 'Grisalho', color: '#9ca3af' },
  branco: { label: 'Branco', color: '#e5e7eb' }, white: { label: 'Branco', color: '#e5e7eb' },
};

function mapHairData(raw: { label: string; value: number }[] | undefined, mapDict: Record<string, { label: string; color: string }>) {
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
  { id: 'chart_facial_expressions', title: 'Expressoes Faciais', type: 'chart', size: 'half', description: 'Serie temporal de expressoes faciais quando disponivel' },
  { id: 'chart_device_flow', title: 'Fluxo e Audiencia Device', type: 'chart', size: 'half', description: 'Resumo visual de fluxo, devices e tracking quando disponivel' },
  { id: 'kpi_flow_stats',      title: 'Resumo de Fluxo',               type: 'kpi',   size: 'full',  description: 'Total Visitantes, Média Dia, Tempo Médio' },
  { id: 'flow_trend',          title: 'Média Visitantes por Dia',       type: 'chart', size: 'half',  description: 'Gráfico de linha com fluxo diário da semana' },
  { id: 'hourly_flow',         title: 'Fluxo por Hora',                 type: 'chart', size: 'half',  description: 'Gráfico de linha por gênero (Masculino/Feminino)' },
  { id: 'chart_sales_quarter', title: 'Visitantes — Último Trimestre',  type: 'chart', size: 'half',  description: 'Total de visitantes por mês (últimos 3 meses)' },
  { id: 'age_pyramid',         title: 'Gênero & Idade',                 type: 'chart', size: 'third', description: 'Barras agrupadas por faixa etária e gênero' },
  { id: 'chart_age_ranges',    title: 'Distribuição por Faixa Etária',  type: 'chart', size: 'third', description: 'Visitantes por faixa etária' },
  { id: 'gender_dist',         title: 'Distribuição de Gênero',         type: 'chart', size: 'third', description: 'Donut: Masculino vs Feminino' },
  { id: 'attributes',          title: 'Atributos Gerais',               type: 'chart', size: 'third', description: 'Resumo de atributos principais' },
  { id: 'chart_vision',        title: 'Atributo: Visão',                type: 'chart', size: 'third', description: 'Uso de óculos' },
  { id: 'chart_facial_hair',   title: 'Atributo: Pelos Faciais',        type: 'chart', size: 'third', description: 'Barba e pelos faciais' },
  { id: 'chart_hair_type',     title: 'Atributo: Tipo de Cabelo',       type: 'chart', size: 'third', description: 'Normal, Entradas, Careca' },
  { id: 'chart_hair_color',    title: 'Atributo: Cor de Cabelo',        type: 'chart', size: 'third', description: 'Preto, Castanho, Loiro, etc.' },
  { id: 'campaigns',           title: 'Engajamento em Campanhas',       type: 'table', size: 'full',  description: 'Tabela de performance de campanhas' },
  { id: 'heatmap',             title: 'Mapa de Calor (Loja)',           type: 'chart', size: 'full',  description: 'Visualização térmica da planta baixa' },
];

// ── WidgetFlowTrend ──────────────────────────────────────────────────────────
export const WidgetFlowTrend = ({ dailyData, genderData }: { view?: string; dailyData?: number[]; genderData?: { label: string; value: number }[] }) => {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const data = dailyData && dailyData.length ? dailyData : new Array(7).fill(0);
  const labels = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
  const mPct = Number(genderData?.find((g) => g.label.toLowerCase().includes('masc'))?.value ?? 50) / 100;
  const fPct = 1 - mPct;
  const maleData   = data.map((v) => Math.round(v * mPct));
  const femaleData = data.map((v) => Math.round(v * fPct));

  useChartJs(canvasRef, () => ({
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Masculino', data: maleData,   borderColor: CJ.male,   backgroundColor: 'transparent', borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, pointBackgroundColor: CJ.male,   tension: 0.4 },
        { label: 'Feminino',  data: femaleData, borderColor: CJ.female, backgroundColor: 'transparent', borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, pointBackgroundColor: CJ.female, tension: 0.4 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { backgroundColor: CJ.bg, borderColor: 'rgba(255,255,255,0.12)', borderWidth: 1, padding: CJ.tooltipPadding, titleFont: CJ.titleFont, bodyFont: CJ.bodyFont, callbacks: { label: (ctx: any) => `  ${ctx.dataset.label}: ${Number(ctx.raw).toLocaleString()}` } },
      },
      scales: {
        x: { grid: { color: CJ.grid }, ticks: { color: CJ.label, font: { size: 11 } }, title: { display: true, text: 'Dia da semana', color: CJ.label, font: { size: 11 } } },
        y: { beginAtZero: true, grid: { color: CJ.grid }, ticks: { color: CJ.label, font: { size: 11 }, callback: (v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v) }, title: { display: true, text: 'Visitantes', color: CJ.label, font: { size: 11 } } },
      },
    },
  }), [JSON.stringify(maleData), JSON.stringify(femaleData)]);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-white flex items-center gap-2 uppercase text-xs tracking-wider"><Activity size={14} className="text-blue-500" />Média Visitantes por Dia</h3>
        <div className="flex gap-3 text-[10px] text-gray-400">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: CJ.male }} />Masculino</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: CJ.female }} />Feminino</span>
        </div>
      </div>
      <CanvasBox><canvas ref={canvasRef} /></CanvasBox>
    </div>
  );
};

// ── WidgetHourlyFlow ─────────────────────────────────────────────────────────
export const WidgetHourlyFlow = ({ hourlyData, genderData }: { view?: string; hourlyData?: number[]; genderData?: { label: string; value: number }[] }) => {
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
        tooltip: { backgroundColor: CJ.bg, borderColor: 'rgba(255,255,255,0.12)', borderWidth: 1, padding: CJ.tooltipPadding, titleFont: CJ.titleFont, bodyFont: CJ.bodyFont, callbacks: { label: (ctx: any) => `  ${ctx.dataset.label}: ${Number(ctx.raw).toLocaleString()}` } },
      },
      scales: {
        x: { grid: { color: CJ.grid }, ticks: { color: CJ.label, font: { size: 10 }, autoSkip: true, maxTicksLimit: 12 }, title: { display: true, text: 'Horário (h)', color: CJ.label, font: { size: 11 } } },
        y: { beginAtZero: true, grid: { color: CJ.grid }, ticks: { color: CJ.label, font: { size: 11 }, callback: (v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v) }, title: { display: true, text: 'Número de Visitas', color: CJ.label, font: { size: 11 } } },
      },
    },
  }), [JSON.stringify(maleData), JSON.stringify(femaleData)]);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-white flex items-center gap-2 uppercase text-xs tracking-wider"><Clock size={14} className="text-emerald-500" />Fluxo por Hora</h3>
        <div className="flex gap-3 text-[10px] text-gray-400">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: CJ.male }} />Masculino</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: CJ.female }} />Feminino</span>
        </div>
      </div>
      <CanvasBox><canvas ref={canvasRef} /></CanvasBox>
    </div>
  );
};

// ── WidgetAgePyramid ─────────────────────────────────────────────────────────
export const WidgetAgePyramid = ({ ageData, totalVisitors }: { view?: string; ageData?: any[]; totalVisitors?: number }) => {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const defaultData = [{ age:'18-',m:0,f:0 },{ age:'18-24',m:0,f:0 },{ age:'25-34',m:0,f:0 },{ age:'35-44',m:0,f:0 },{ age:'45-54',m:0,f:0 },{ age:'55-64',m:0,f:0 },{ age:'65+',m:0,f:0 }];
  const displayforceOrder = ['1-19', '20-29', '30-45', '46-100'];
  const legacyOrder = ['18-', '18-24', '25-34', '35-44', '45-54', '55-64', '65+'];
  const lblMap: Record<string,string> = {
    '1-19':'<20','20-29':'20-29','30-45':'30-45','46-100':'>45',
    '18-':'<18','18-24':'18-24','25-34':'25-34','35-44':'35-44','45-54':'45-54','55-64':'55-64','65+':'65+'
  };
  const sourceData = ageData && ageData.length ? ageData : defaultData;
  const sourceKeys = sourceData.map((d) => String(d.age));
  const order = displayforceOrder.some((age) => sourceKeys.includes(age)) ? displayforceOrder : legacyOrder;
  const byAge = new Map(sourceData.map((d) => [String(d.age), d]));
  const data = order.map((age) => byAge.get(age) ?? { age, m: 0, f: 0 });

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
          backgroundColor: CJ.bg, borderColor: 'rgba(255,255,255,0.12)', borderWidth: 1, padding: CJ.tooltipPadding, titleFont: CJ.titleFont, bodyFont: CJ.bodyFont,
          callbacks: { label: (ctx: any) => { const v = Number(ctx.raw); const base = typeof totalVisitors === 'number' && totalVisitors > 0 ? totalVisitors : null; const cnt = base ? Math.round((v / 100) * base) : null; return `  ${ctx.dataset.label}: ${v}%${cnt ? ` (${cnt.toLocaleString()})` : ''}`; } },
        },
      },
      scales: {
        x: { grid: { color: CJ.grid }, ticks: { color: CJ.label, font: { size: 11 } } },
        y: { beginAtZero: true, grid: { color: CJ.grid }, ticks: { color: CJ.label, font: { size: 11 }, callback: (v: number) => `${v}%` }, title: { display: true, text: 'Número %', color: CJ.label, font: { size: 11 } } },
      },
    },
  }), [JSON.stringify(data)]);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-white flex items-center gap-2 uppercase text-xs tracking-wider"><Users size={14} className="text-purple-500" />Gênero &amp; Idade</h3>
        <div className="flex gap-3 text-[10px] text-gray-400">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: CJ.female }} />Feminino</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: CJ.male }} />Masculino</span>
        </div>
      </div>
      <CanvasBox><canvas ref={canvasRef} /></CanvasBox>
    </div>
  );
};

// ── WidgetAgeRanges ──────────────────────────────────────────────────────────
export const WidgetAgeRanges = ({ ageData }: { ageData?: { age: string; m: number; f: number }[] }) => {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const displayforceOrder = ['1-19', '20-29', '30-45', '46-100'];
  const legacyOrder = ['18-','18-24','25-34','35-44','45-54','55-64','65+'];
  const sourceKeys = (ageData || []).map((d) => String(d.age));
  const order = displayforceOrder.some((age) => sourceKeys.includes(age)) ? displayforceOrder : legacyOrder;
  const lblMap: Record<string,string> = {
    '1-19':'<20','20-29':'20-29','30-45':'30-45','46-100':'>45',
    '18-':'<18','18-24':'18-24','25-34':'25-34','35-44':'35-44','45-54':'45-54','55-64':'55-64','65+':'65+'
  };
  const byAge  = new Map((ageData||[]).map((d) => [String(d.age), d]));
  const vals   = order.map((age) => { const d = byAge.get(age); return (Number(d?.m)||0)+(Number(d?.f)||0); });

  useChartJs(canvasRef, () => ({
    type: 'bar',
    data: { labels: order.map((a) => lblMap[a]??a), datasets: [{ label: 'Visitantes', data: vals, backgroundColor: vals.map(()=>CJ.male), borderRadius: 4, borderSkipped: false, hoverBackgroundColor: '#93c5fd' }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { backgroundColor: CJ.bg, borderColor: 'rgba(255,255,255,0.12)', borderWidth: 1, padding: CJ.tooltipPadding, titleFont: CJ.titleFont, bodyFont: CJ.bodyFont, callbacks: { title: (i:any[])=>i[0]?.label??'', label: (ctx:any)=>`  visitantes: ${Number(ctx.raw).toLocaleString()}` } } },
      scales: {
        x: { grid:{ color:CJ.grid }, ticks:{ color:CJ.label, font:{ size:11 } }, title:{ display:true, text:'Faixa etária', color:CJ.label, font:{ size:11 } } },
        y: { beginAtZero:true, grid:{ color:CJ.grid }, ticks:{ color:CJ.label, font:{ size:11 }, callback:(v:number)=>v>=1000?`${(v/1000).toFixed(0)}k`:String(v) }, title:{ display:true, text:'Visitantes', color:CJ.label, font:{ size:11 } } },
      },
    },
  }), [JSON.stringify(vals)]);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <h3 className="font-bold text-white mb-3 uppercase text-xs tracking-wider">Distribuição por Faixa Etária</h3>
      <CanvasBox><canvas ref={canvasRef} /></CanvasBox>
    </div>
  );
};

// ── WidgetGenderDist ─────────────────────────────────────────────────────────
export const WidgetGenderDist = ({ genderData, totalVisitors }: { view?: string; genderData?: { label: string; value: number }[]; totalVisitors?: number }) => {
  const raw = genderData && genderData.length >= 2 ? genderData : [];
  const maleRaw = Number(raw.find(g => g.label.toLowerCase().includes('masc'))?.value) || 0;
  const femRaw  = Number(raw.find(g => g.label.toLowerCase().includes('fem'))?.value)  || 0;
  const indRaw  = Number(raw.find(g => g.label.toLowerCase().includes('indef') || g.label.toLowerCase().includes('unknown'))?.value) || 0;
  const sum = maleRaw + femRaw + indRaw || 1;
  const totalCount = typeof totalVisitors === 'number' && totalVisitors > 0 ? totalVisitors : null;
  const isPct = sum <= 101;
  const malePct = isPct ? Math.round(maleRaw) : Math.round((maleRaw / sum) * 100);
  const femPct  = isPct ? Math.round(femRaw)  : Math.round((femRaw  / sum) * 100);
  const indPct  = isPct ? Math.round(indRaw)  : Math.round((indRaw  / sum) * 100);
  const maleCount = totalCount ? Math.round((malePct / 100) * totalCount) : null;
  const femCount  = totalCount ? Math.round((femPct  / 100) * totalCount) : null;
  const indCount  = totalCount ? Math.round((indPct  / 100) * totalCount) : null;

  const items = [
    { label: 'Masculino', value: malePct, color: CJ.male,   count: maleCount },
    { label: 'Feminino',  value: femPct,  color: CJ.female, count: femCount  },
    ...(indPct > 0 ? [{ label: 'Indefinido', value: indPct, color: '#10b981', count: indCount }] : []),
  ].filter(s => Number(s.value) > 0);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col overflow-hidden">
      <h3 className="font-bold text-white mb-3 flex items-center gap-2 uppercase text-xs tracking-wider flex-shrink-0">
        <Users size={14} className="text-pink-500" />Gênero
      </h3>
      {items.length === 0
        ? <div className="flex items-center justify-center py-12 text-gray-500 text-sm">Sem dados</div>
        : <DonutLikeGender items={items} totalCount={totalCount} />
      }
    </div>
  );
};

function DonutLikeGender({
  items,
  totalCount,
  maxSize = 200,
}: {
  items: { label: string; value: number; color: string; count?: number | null }[];
  totalCount?: number | null;
  maxSize?: number;
}) {
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const [hover, setHover] = React.useState<null | { label: string; pct: number; color: string; count: number | null; x: number; y: number; cx: number; cy: number }>(null);

  const safe = (items || []).filter((x) => Number(x.value) > 0);
  const sum = safe.reduce((a, x) => a + (Number(x.value) || 0), 0) || 1;
  const isPct = sum <= 101;
  const rawSegments = safe
    .map((x) => {
      const pct = isPct ? (Number(x.value) || 0) : (((Number(x.value) || 0) / sum) * 100);
      const count = x.count ?? (totalCount ? Math.round((pct / 100) * totalCount) : null);
      return { label: x.label, color: x.color, pct, count };
    })
    .filter((x) => x.pct > 0)
    .sort((a, b) => b.pct - a.pct);

  const minVisiblePct = rawSegments.length > 1 ? 1 : 0;
  const dominantIndex = rawSegments.findIndex((segment) => segment.pct === Math.max(...rawSegments.map((entry) => entry.pct), 0));
  const boostedIndices = rawSegments
    .map((segment, index) => ({ segment, index }))
    .filter(({ segment }) => segment.pct > 0 && segment.pct < minVisiblePct)
    .map(({ index }) => index);
  const totalBoost = boostedIndices.reduce((acc, index) => acc + (minVisiblePct - rawSegments[index].pct), 0);
  const segments = rawSegments.map((segment, index) => {
    let drawPct = segment.pct;
    if (boostedIndices.includes(index)) {
      drawPct = minVisiblePct;
    } else if (index === dominantIndex && totalBoost > 0) {
      drawPct = Math.max(segment.pct - totalBoost, 0.5);
    }
    return { ...segment, drawPct };
  });

  const formatPct = (value: number) => {
    if (!Number.isFinite(value)) return '0';
    if (value >= 99 || value < 1) return value.toFixed(2).replace(/\.?0+$/, '');
    if (value % 1 !== 0) return value.toFixed(1).replace(/\.0$/, '');
    return String(Math.round(value));
  };

  const radius = 40;
  const stroke = 15;
  const circ = 2 * Math.PI * radius;
  let arcOffset = 0;
  const arcs = segments.map((s) => {
    const dash = (s.drawPct / 100) * circ;
    const arc = { ...s, dash, offset: arcOffset };
    arcOffset += dash;
    return arc;
  });

  const pickSegmentAt = (clientX: number, clientY: number) => {
    const el = wrapRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;

    const x = clientX - rect.left;
    const y = clientY - rect.top;

    const nx = (x / rect.width) * 100;
    const ny = (y / rect.height) * 100;
    const dx = nx - 50;
    const dy = ny - 50;
    const dist = Math.sqrt(dx * dx + dy * dy);

    const inner = radius - stroke / 2;
    const outer = radius + stroke / 2;
    if (dist < inner || dist > outer) return null;

    const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
    const angle = (deg + 450) % 360;

    let acc = 0;
    for (const s of segments) {
      const span = (s.drawPct / 100) * 360;
      if (angle >= acc && angle < acc + span) return { ...s, x, y };
      acc += span;
    }
    return segments.length > 0 ? { ...segments[segments.length - 1], x, y } : null;
  };

  const onMove = (e: React.MouseEvent) => {
    if (segments.length === 0) return;
    const seg = pickSegmentAt(e.clientX, e.clientY);
    if (!seg) {
      setHover(null);
      return;
    }
    setHover({ ...seg, cx: e.clientX, cy: e.clientY });
  };

  const onLeave = () => setHover(null);

  return (
    <div className="flex flex-col items-center gap-2 w-full min-w-0">
      {/* Donut SVG — quadrado responsivo, limitado por maxSize */}
      <div
        ref={wrapRef}
        className="relative mx-auto flex-shrink-0"
        style={{ width: '100%', maxWidth: maxSize, aspectRatio: '1 / 1' }}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
      >
        <svg viewBox="0 0 100 100" width="100%" height="100%" style={{ transform: 'rotate(-90deg)', display: 'block' }}>
          {arcs.map((arc, i) => {
            const active = hover?.label === arc.label;
            return (
              <circle
                key={i}
                cx="50"
                cy="50"
                r={radius}
                fill="none"
                stroke={arc.color}
                strokeWidth={active ? 17 : 15}
                strokeOpacity={hover ? (active ? 1 : 0.65) : 1}
                strokeDasharray={`${arc.dash} ${circ}`}
                strokeDashoffset={-arc.offset}
              />
            );
          })}
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-2xl font-bold text-white leading-none">{formatPct(segments[0]?.pct ?? 0)}%</span>
          <span className="text-[11px] text-gray-400 mt-1 text-center px-1 truncate max-w-full">{segments[0]?.label ?? ''}</span>
        </div>

        {hover && (
          <div
            className="fixed z-50 bg-gray-950 border border-gray-700 text-white text-[11px] px-2 py-1 rounded-md whitespace-nowrap pointer-events-none"
            style={{ left: hover.cx, top: hover.cy, transform: 'translate(12px, 12px)' }}
          >
            <div className="font-semibold" style={{ color: hover.color }}>{hover.label}</div>
            <div className="text-gray-300">
              {formatPct(hover.pct)}%{hover.count != null ? ` • ${hover.count.toLocaleString()} visitantes` : ''}
            </div>
          </div>
        )}
      </div>

      {/* Legenda — sempre dentro do card, quebra em linhas se necessário */}
      <div className="flex justify-center gap-x-3 gap-y-1 flex-wrap w-full min-w-0 px-1">
        {segments.map((s, i) => (
          <div key={i} className="group relative flex items-center gap-1 cursor-default min-w-0">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.color }} />
            <span className="text-[10px] text-gray-400 truncate">{s.label}</span>
            <span className="text-[10px] font-semibold flex-shrink-0" style={{ color: s.color }}>{formatPct(s.pct)}%</span>
            {s.count != null && (
              <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-gray-950 border border-gray-700 text-white text-[10px] px-2 py-0.5 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                {s.count.toLocaleString()} visitantes
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── WidgetAttributes ─────────────────────────────────────────────────────────
export const WidgetAttributes = ({ attrData }: { view?: string; attrData?: { label: string; value: number }[] }) => {
  const data = (attrData || []).filter(a => !a.label.startsWith('_')).filter(a => ['Óculos','Barba','Máscara','Chapéu/Boné'].includes(a.label));
  const display = data.length > 0 ? data : [{ label:'Óculos', value:0 },{ label:'Barba', value:0 },{ label:'Máscara', value:0 },{ label:'Chapéu/Boné', value:0 }];
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 h-full flex flex-col min-h-0 overflow-hidden">
      <h3 className="font-bold text-white mb-3 flex items-center gap-2 uppercase text-xs tracking-wider flex-none"><Users size={14} className="text-orange-500" />Atributos</h3>
      <div className="flex-1 min-h-0 overflow-auto">
        <HorizontalBarChart data={display} color="bg-orange-500" />
      </div>
    </div>
  );
};

// ── WidgetVision ─────────────────────────────────────────────────────────────
export const WidgetVision = ({ attrData }: { attrData?: { label: string; value: number }[] }) => {
  // Os dados de óculos chegam com prefixo _glasses_ (ex: _glasses_none, _glasses_usual, _glasses_dark)
  const glassesCatItems = (attrData || []).filter((a) => String(a.label).startsWith('_glasses_'));
  let items: { label: string; value: number; color: string }[] = [];
  if (glassesCatItems.length > 0) {
    // Modo categórico: extrai a chave real (sem prefixo) e mapeia pelo GLASSES_MAP
    const mapped = glassesCatItems
      .filter((a) => Number(a.value) > 0)
      .map((a) => {
        const rawKey = String(a.label).replace('_glasses_', '').toLowerCase().trim();
        const m = GLASSES_MAP[rawKey] ?? { label: rawKey, color: '#6b7280' };
        return { label: m.label, value: Number(a.value), color: m.color };
      });
    // Mescla itens com o mesmo label (evita duplicatas como none + false → "Sem Óculos" x2)
    const merged = new Map<string, { label: string; value: number; color: string }>();
    for (const item of mapped) {
      const existing = merged.get(item.label);
      if (existing) existing.value = Math.round((existing.value + item.value) * 10) / 10;
      else merged.set(item.label, { ...item });
    }
    items = Array.from(merged.values());
  } else {
    // Fallback: usa o total % de "Óculos" do atributo geral
    // Só exibe se o valor for > 0 para evitar mostrar "Sem Óculos 100%" sem dados reais
    const raw = (attrData || []).find((a) => String(a.label).toLowerCase() === 'óculos');
    const w = Math.max(0, Math.min(100, Number(raw?.value) || 0));
    if (w > 0) {
      const wo = Math.max(0, 100 - w);
      items.push({ label: 'Com Óculos', value: w, color: '#93c5fd' });
      if (wo > 0) items.push({ label: 'Sem Óculos', value: wo, color: '#4b5563' });
    }
  }
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col overflow-hidden">
      <h3 className="font-bold text-white mb-3 uppercase text-xs tracking-wider flex-shrink-0">Visão</h3>
      {items.length === 0
        ? <div className="flex items-center justify-center py-12 text-gray-500 text-sm">Sem dados</div>
        : <DonutLikeGender items={items} />}
    </div>
  );
};

// ── WidgetFacialHair ─────────────────────────────────────────────────────────
export const WidgetFacialHair = ({ attrData }: { attrData?: { label: string; value: number }[] }) => {
  // Dados de pelos faciais chegam com prefixo _facial_ (ex: _facial_beard, _facial_shaved, _facial_goatee)
  const facialCatItems = (attrData || []).filter((a) => String(a.label).startsWith('_facial_'));
  let items: { label: string; value: number; color: string }[] = [];
  if (facialCatItems.length > 0) {
    // Modo categórico: extrai a chave real e mapeia pelo FACIAL_HAIR_MAP
    const mapped = facialCatItems
      .filter((a) => Number(a.value) > 0)
      .map((a) => {
        const rawKey = String(a.label).replace('_facial_', '').toLowerCase().trim();
        const m = FACIAL_HAIR_MAP[rawKey] ?? { label: rawKey, color: '#6b7280' };
        return { label: m.label, value: Number(a.value), color: m.color };
      });
    // Mescla itens com o mesmo label (ex: shaved + none + gm → Raspados único)
    const merged = new Map<string, { label: string; value: number; color: string }>();
    for (const item of mapped) {
      const existing = merged.get(item.label);
      if (existing) existing.value = Math.round((existing.value + item.value) * 10) / 10;
      else merged.set(item.label, { ...item });
    }
    items = Array.from(merged.values());
  } else {
    // Fallback: usa o total % de "Barba" do atributo geral
    // Só exibe se o valor for > 0 para evitar mostrar "Sem Barba 100%" sem dados reais
    const beardPct = Number((attrData || []).find((a) => String(a.label).toLowerCase() === 'barba')?.value) || 0;
    if (beardPct > 0) {
      const w = Math.max(0, Math.min(100, beardPct));
      const wo = Math.max(0, 100 - w);
      items.push({ label: 'Com Barba', value: w, color: '#f97316' });
      if (wo > 0) items.push({ label: 'Sem Barba', value: wo, color: '#1d4ed8' });
    }
  }
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col overflow-hidden">
      <h3 className="font-bold text-white mb-3 uppercase text-xs tracking-wider flex-shrink-0">Pelos Faciais</h3>
      {items.length === 0
        ? <div className="flex items-center justify-center py-12 text-gray-500 text-sm">Sem dados</div>
        : <DonutLikeGender items={items} />}
    </div>
  );
};

// ── WidgetHairType ───────────────────────────────────────────────────────────
export const WidgetHairType = ({ hairTypeData }: { hairTypeData?: { label: string; value: number }[] }) => {
  const { labels, values, colors } = mapHairData(hairTypeData, HAIR_TYPE_MAP);
  const items = labels.map((l, i) => ({ label: l, value: values[i], color: colors[i] }));
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col overflow-hidden">
      <h3 className="font-bold text-white mb-3 uppercase text-xs tracking-wider flex-shrink-0">Tipo de Cabelo</h3>
      {items.length === 0
        ? <div className="flex items-center justify-center py-12 text-gray-500 text-sm">Sem dados</div>
        : <DonutLikeGender items={items} />}
    </div>
  );
};

// ── WidgetHairColor ──────────────────────────────────────────────────────────
export const WidgetHairColor = ({ hairColorData }: { hairColorData?: { label: string; value: number }[] }) => {
  const { labels, values, colors } = mapHairData(hairColorData, HAIR_COLOR_MAP);
  const items = labels.map((l, i) => ({ label: l, value: values[i], color: colors[i] }))
    .filter((x) => Number(x.value) > 0)
    .sort((a, b) => b.value - a.value);

  const top = items.slice(0, 6);
  const restSum = items.slice(6).reduce((a, x) => a + Number(x.value || 0), 0);
  const finalItems = restSum > 0 ? [...top, { label: 'Outros', value: restSum, color: '#6b7280' }] : top;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col overflow-hidden">
      <h3 className="font-bold text-white mb-3 uppercase text-xs tracking-wider flex-shrink-0">Cor de Cabelo</h3>
      {finalItems.length === 0
        ? <div className="flex items-center justify-center py-12 text-gray-500 text-sm">Sem dados</div>
        : <DonutLikeGender items={finalItems} />}
    </div>
  );
};

// ── WidgetCampaigns ──────────────────────────────────────────────────────────
const cleanCampaignContentName = (raw?: string | null) => {
  const value = String(raw || '').trim();
  if (!value) return '';
  const months = '(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)';

  let name = value
    .replace(/\.mp4$/i, '')
    .replace(/\s*\(\d+\)\s*$/i, '')
    .replace(/\s*\([^)]*(?:vertical|horizontal|vert|horiz|ventical)[^)]*\)\s*$/i, '')
    .replace(/[_\s-]+v\d+\s*$/i, '')
    .replace(/[_\-\s]*\d{3,4}\s*[xX]\s*\d{3,4}.*$/i, '');

  name = name.replace(new RegExp(`[_\\-\\s]+\\d{1,2}${months}.*$`, 'i'), '');

  return name
    .replace(/[_\-]{2,}/g, '-')
    .replace(/[\s_-]+$/g, '')
    .trim();
};

const CAMPAIGN_REFRESH_MS = 10 * 60 * 1000;

function getCampaignStatusMeta(start?: string | null, end?: string | null, uploadedAt?: string | null, explicitStatus?: string | null) {
  const normalizedStatus = String(explicitStatus || '').trim().toLowerCase();
  if (normalizedStatus === 'ativa') {
    return { label: 'Ativa', color: 'text-emerald-400', order: 0 };
  }
  if (normalizedStatus === 'agendada') {
    return { label: 'Agendada', color: 'text-yellow-400', order: 1 };
  }
  if (normalizedStatus === 'encerrada') {
    return { label: 'Encerrada', color: 'text-red-400', order: 2 };
  }

  const now = Date.now();
  const freshWindowMs = 36 * 60 * 60 * 1000;
  const startMs = start ? Date.parse(start) : Number.NaN;
  const endMs = end ? Date.parse(end) : Number.NaN;
  const uploadedMs = uploadedAt ? Date.parse(uploadedAt) : Number.NaN;

  if (Number.isFinite(startMs) && startMs > now + 60 * 60 * 1000) {
    return { label: 'Agendada', color: 'text-yellow-400', order: 1 };
  }

  // Relatorios "Views of visitors" nao trazem a data real de encerramento da campanha,
  // apenas o ultimo evento visto ate o momento. Se o upload e recente, a campanha segue ativa.
  if (Number.isFinite(uploadedMs) && now - uploadedMs <= freshWindowMs) {
    return { label: 'Ativa', color: 'text-emerald-400', order: 0 };
  }

  if (Number.isFinite(endMs) && endMs < now - freshWindowMs) {
    return { label: 'Encerrada', color: 'text-red-400', order: 2 };
  }

  if (Number.isFinite(startMs) && startMs <= now) {
    return { label: 'Ativa', color: 'text-emerald-400', order: 0 };
  }

  return { label: '—', color: 'text-gray-500', order: 3 };
}

export const WidgetCampaigns = ({ clientId, lojaFilter }: { view?: string; clientId?: string; lojaFilter?: string | null }) => {
  const [rows, setRows]                 = React.useState<any[]>([]);
  const [loading, setLoading]           = React.useState(false);
  const [lastSync, setLastSync]         = React.useState<string | null>(null);
  const [campaignFilter, setCampaignFilter] = React.useState('all');
  const [branchFilter, setBranchFilter]     = React.useState('all');
  const [statusFilter, setStatusFilter]     = React.useState('all');
  const [showFilters, setShowFilters]       = React.useState(false);

  const fetchData = React.useCallback(async () => {
    if (!clientId) {
      setRows([]);
      setLastSync(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Timeout ao carregar campanhas')), 10000);
      });

      const buildViewQuery = () => {
        let query = supabase
          .from('campaigns_dashboard_vw')
          .select('name,content_name,tipo_midia,loja,start_date,end_date,duration_days,display_count,visitors,avg_attention_sec,uploaded_at,status,last_seen_at,first_seen_at')
          .eq('client_id', clientId)
          .order('last_seen_at', { ascending: false })
          .order('uploaded_at', { ascending: false })
          .limit(2000);
        if (lojaFilter) query = (query as any).ilike('loja', `%${lojaFilter}%`);
        return query;
      };

      const buildTableQuery = () => {
        let query = supabase
          .from('campaigns')
          .select('name,content_name,tipo_midia,loja,start_date,end_date,duration_days,display_count,visitors,avg_attention_sec,uploaded_at,status,last_seen_at,first_seen_at')
          .eq('client_id', clientId)
          .order('uploaded_at', { ascending: false })
          .order('start_date', { ascending: false })
          .limit(2000);
        if (lojaFilter) query = (query as any).ilike('loja', `%${lojaFilter}%`);
        return query;
      };

      let result = await Promise.race([buildViewQuery(), timeoutPromise]) as { data: any[] | null; error?: any };
      if (result?.error) {
        console.warn('[Campaigns] campaigns_dashboard_vw indisponível, usando tabela campaigns:', result.error);
        result = await Promise.race([buildTableQuery(), timeoutPromise]) as { data: any[] | null; error?: any };
      }
      if (result?.error) throw result.error;

      const data = result?.data || [];
      setRows(data);
      if (data.length > 0 && data[0].uploaded_at) {
        setLastSync(new Date(data[0].uploaded_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }));
      } else {
        setLastSync(null);
      }
    } catch (error) {
      console.warn('[Campaigns] Erro ao carregar campanhas:', error);
      setRows([]);
      setLastSync(null);
    } finally {
      setLoading(false);
    }
  }, [clientId, lojaFilter]);

  React.useEffect(() => {
    fetchData();
    const intervalId = window.setInterval(fetchData, CAMPAIGN_REFRESH_MS);
    return () => window.clearInterval(intervalId);
  }, [fetchData]);

  const fmtAtencao = (s: number) => {
    if (!s || s === 0) return '—';
    const total = Math.floor(Number(s));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const sec = total % 60;
    if (h > 0) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  const normalizedRows = React.useMemo(() => {
    const deduped = new Map<string, any>();

    for (const rawRow of rows) {
      const campaignLabel = cleanCampaignContentName(rawRow.content_name) || cleanCampaignContentName(rawRow.name) || rawRow.content_name || rawRow.name || '—';
      const status = getCampaignStatusMeta(rawRow.start_date, rawRow.end_date, rawRow.uploaded_at, rawRow.status);
      const normalizedRow = {
        ...rawRow,
        _campaignLabel: campaignLabel,
        _campaignTitle: rawRow.content_name || rawRow.name || campaignLabel,
        _status: status,
      };
      const key = [
        String(campaignLabel || '').trim().toLowerCase(),
        String(rawRow.loja || '').trim().toLowerCase(),
        String(rawRow.tipo_midia || '').trim().toLowerCase(),
      ].join('||');
      const existing = deduped.get(key);
      const rowScore = Math.max(
        Date.parse(rawRow.uploaded_at || '') || 0,
        Date.parse(rawRow.start_date || '') || 0,
        Date.parse(rawRow.end_date || '') || 0,
      );
      const existingScore = existing
        ? Math.max(
            Date.parse(existing.uploaded_at || '') || 0,
            Date.parse(existing.start_date || '') || 0,
            Date.parse(existing.end_date || '') || 0,
          )
        : -1;
      if (!existing || rowScore >= existingScore) {
        deduped.set(key, normalizedRow);
      }
    }

    return Array.from(deduped.values()).sort((a, b) => {
      const statusDiff = (a._status?.order ?? 99) - (b._status?.order ?? 99);
      if (statusDiff !== 0) return statusDiff;
      const uploadedDiff = (Date.parse(b.uploaded_at || '') || 0) - (Date.parse(a.uploaded_at || '') || 0);
      if (uploadedDiff !== 0) return uploadedDiff;
      const startDiff = (Date.parse(b.start_date || '') || 0) - (Date.parse(a.start_date || '') || 0);
      if (startDiff !== 0) return startDiff;
      return (Number(b.visitors) || 0) - (Number(a.visitors) || 0);
    });
  }, [rows]);

  const campaignOptions = React.useMemo(
    () => Array.from(new Set(normalizedRows.map((row) => row._campaignLabel).filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b), 'pt-BR')),
    [normalizedRows]
  );
  const branchOptions = React.useMemo(
    () => Array.from(new Set(normalizedRows.map((row) => row.loja).filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b), 'pt-BR')),
    [normalizedRows]
  );

  React.useEffect(() => {
    if (campaignFilter !== 'all' && !campaignOptions.includes(campaignFilter)) {
      setCampaignFilter('all');
    }
  }, [campaignFilter, campaignOptions]);

  React.useEffect(() => {
    if (branchFilter !== 'all' && !branchOptions.includes(branchFilter)) {
      setBranchFilter('all');
    }
  }, [branchFilter, branchOptions]);

  const filteredRows = React.useMemo(() => {
    return normalizedRows.filter((row) => {
      if (campaignFilter !== 'all' && row._campaignLabel !== campaignFilter) return false;
      if (branchFilter !== 'all' && row.loja !== branchFilter) return false;
      if (statusFilter !== 'all' && row._status?.label !== statusFilter) return false;
      return true;
    });
  }, [normalizedRows, campaignFilter, branchFilter, statusFilter]);

  const totalVisitantes = filteredRows.reduce((acc, row) => acc + (Number(row.visitors) || 0), 0);
  const totalExibicoes = filteredRows.reduce((acc, row) => acc + (Number(row.display_count) || 0), 0);
  const activeFilterCount = [campaignFilter, branchFilter, statusFilter].filter((value) => value !== 'all').length;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 h-full flex flex-col" style={{ minHeight: '320px' }}>

      {/* Header */}
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <h3 className="font-bold text-white flex items-center gap-2 uppercase text-xs tracking-wider">
          <Activity size={14} className="text-emerald-500" />
          Engajamento em Campanhas
          {normalizedRows.length > 0 && (
            <span className="text-[10px] font-normal text-gray-500 normal-case tracking-normal">
              ({filteredRows.length}/{normalizedRows.length} {normalizedRows.length === 1 ? 'registro' : 'registros'})
            </span>
          )}
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters((prev) => !prev)}
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] transition-colors ${
              showFilters || activeFilterCount > 0
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                : 'border-gray-800 bg-gray-950 text-gray-500 hover:text-gray-300'
            }`}
            title="Filtrar campanhas"
          >
            <SlidersHorizontal size={11} />
            Filtros
            {activeFilterCount > 0 && <span className="font-semibold">{activeFilterCount}</span>}
          </button>
          {lastSync && <span className="text-[10px] text-gray-600 hidden sm:block">Sync: {lastSync}</span>}
          <button
            onClick={fetchData}
            className="text-gray-500 hover:text-emerald-400 transition-colors p-1 rounded"
            title="Atualizar dados"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
          </button>
        </div>
      </div>

      <div className={`mb-3 grid grid-cols-1 gap-2 md:grid-cols-3 flex-shrink-0 ${showFilters ? '' : 'hidden'}`}>
        <select
          value={campaignFilter}
          onChange={(e) => setCampaignFilter(e.target.value)}
          className="bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-[11px] text-gray-200 focus:outline-none focus:border-emerald-500"
        >
          <option value="all">Todas as campanhas</option>
          {campaignOptions.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
        <select
          value={branchFilter}
          onChange={(e) => setBranchFilter(e.target.value)}
          className="bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-[11px] text-gray-200 focus:outline-none focus:border-emerald-500"
        >
          <option value="all">Todas as filiais</option>
          {branchOptions.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-[11px] text-gray-200 focus:outline-none focus:border-emerald-500"
        >
          <option value="all">Todos os status</option>
          <option value="Ativa">Ativas</option>
          <option value="Agendada">Agendadas</option>
          <option value="Encerrada">Encerradas</option>
        </select>
      </div>

      {/* Body */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
          <svg className="animate-spin mr-2" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
          Carregando...
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-gray-500 text-sm">
          <p>{lojaFilter ? `Nenhuma campanha para a loja "${lojaFilter}".` : 'Nenhuma campanha disponível.'}</p>
          {!lojaFilter && <p className="text-xs text-gray-600">Aguardando sincronização automática pelo bot.</p>}
        </div>
      ) : (
        <div className="flex-1 overflow-auto" style={{ minHeight: 0 }}>
          <table className="min-w-full text-left text-xs border-separate border-spacing-0">
            <thead>
              <tr className="sticky top-0 z-10">
                <th className="bg-gray-900 pb-2 pt-1 pr-4 font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap border-b border-gray-700">Campanha</th>
                <th className="bg-gray-900 pb-2 pt-1 pr-4 font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap border-b border-gray-700">Por Loja</th>
                <th className="bg-gray-900 pb-2 pt-1 pr-4 font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap border-b border-gray-700">Device</th>
                <th className="bg-gray-900 pb-2 pt-1 pr-4 font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap border-b border-gray-700">Status</th>
                <th className="bg-gray-900 pb-2 pt-1 pr-4 font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap text-right border-b border-gray-700">Qtd. Exibições</th>
                <th className="bg-gray-900 pb-2 pt-1 pr-4 font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap text-right border-b border-gray-700">Dias de Exibição Ativa</th>
                <th className="bg-gray-900 pb-2 pt-1 pr-4 font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap text-right border-b border-gray-700">Visitantes</th>
                <th className="bg-gray-900 pb-2 pt-1 font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap text-right border-b border-gray-700">Atenção Média</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r, i) => {
                const status = r._status || getCampaignStatusMeta(r.start_date, r.end_date, r.uploaded_at, r.status);
                const campaignTitle = r._campaignTitle || r.content_name || r.name || '';
                const campaignLabel = r._campaignLabel || r.content_name || r.name || '—';
                return (
                <tr
                  key={`${campaignLabel}-${r.loja || 'loja'}-${r.tipo_midia || 'device'}-${i}`}
                  className={`transition-colors hover:bg-gray-800/50 ${i % 2 === 0 ? 'bg-transparent' : 'bg-gray-800/20'}`}
                >
                  <td className="py-2 pr-4 text-purple-400 font-medium whitespace-nowrap max-w-[200px] truncate" title={campaignTitle}>{campaignLabel}</td>
                  <td className="py-2 pr-4 text-gray-200 whitespace-nowrap">{r.loja || '—'}</td>
                  <td className="py-2 pr-4 text-cyan-400 whitespace-nowrap">{r.tipo_midia || '—'}</td>
                  <td className="py-2 pr-4 whitespace-nowrap">
                    <span className={`font-semibold ${status.color}`}>{status.label}</span>
                  </td>
                  <td className="py-2 pr-4 text-orange-400 text-right font-mono">{Number(r.display_count || 0).toLocaleString('pt-BR')}</td>
                  <td className="py-2 pr-4 text-yellow-400 text-right font-mono">{r.duration_days != null ? Number(r.duration_days).toFixed(2) : '—'}</td>
                  <td className="py-2 pr-4 text-emerald-400 text-right font-bold">{Number(r.visitors || 0).toLocaleString('pt-BR')}</td>
                  <td className="py-2 text-blue-400 text-right font-bold">{fmtAtencao(r.avg_attention_sec)}</td>
                </tr>
                );
              })}
            </tbody>
            {filteredRows.length > 0 && (
              <tfoot>
                <tr className="border-t border-gray-700">
                  <td colSpan={4} className="pt-2 pr-4 text-gray-500 text-xs font-medium uppercase tracking-wider">Total</td>
                  <td className="pt-2 pr-4 text-orange-300 text-right font-bold text-xs">{totalExibicoes.toLocaleString('pt-BR')}</td>
                  <td className="pt-2 pr-4 text-gray-600 text-right text-xs">—</td>
                  <td className="pt-2 pr-4 text-emerald-300 text-right font-bold text-xs">{totalVisitantes.toLocaleString('pt-BR')}</td>
                  <td className="pt-2 text-gray-600 text-right text-xs">—</td>
                </tr>
              </tfoot>
            )}
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
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between gap-4 overflow-x-auto">
      <KPIStat label="Total Visitantes"     value={Number(totalVisitors||0).toLocaleString()} />
      <KPIStat label="Média Visitantes Dia" value={Number(avgVisitorsPerDay||0).toLocaleString()} color="text-blue-400" />
      <KPIStat label="Tempo Médio Visita"   value={fmtDur(Number(avgVisitSeconds||0))} color="text-emerald-400" />
    </div>
  );
};

// ── WidgetSalesQuarter ───────────────────────────────────────────────────────
export const WidgetSalesQuarter = ({
  quarterData, loading,
}: {
  quarterData?: { label: string; visitors: number; sales: number }[];
  loading?: boolean;
}) => {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  // Aceita tanto quarterData (array de meses) quanto quarterBars via props diretas
  const data = Array.isArray(quarterData) && quarterData.length ? quarterData : [];
  const visitorArr = data.map((d) => Number(d.visitors) || 0);
  const totalV = visitorArr.reduce((a, b) => a + b, 0);

  useChartJs(canvasRef, () => {
    if (data.length === 0) return null;
    return {
      type: 'bar',
      data: { labels: data.map((d) => d.label), datasets: [{ label:'Visitantes', data: visitorArr, backgroundColor: CJ.neutral, borderRadius:4, borderSkipped:false, hoverBackgroundColor:'#34d399' }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { backgroundColor: CJ.bg, borderColor: 'rgba(255,255,255,0.12)', borderWidth:1, padding: CJ.tooltipPadding, titleFont: CJ.titleFont, bodyFont: CJ.bodyFont, callbacks: { title:(i:any[])=>i[0]?.label??'', label:(ctx:any)=>{ const v=Number(ctx.raw); return `  Visitantes: ${v>=1000?`${(v/1000).toFixed(1)}k`:v.toLocaleString('pt-BR')}`; } } } },
        scales: {
          x: { grid:{ color:CJ.grid }, ticks:{ color:CJ.label, font:{ size:12 }, autoSkip:false, maxRotation:0 } },
          y: { beginAtZero:true, grid:{ color:CJ.grid }, ticks:{ color:CJ.neutral, font:{ size:11 }, callback:(v:number)=>v>=1000?`${(v/1000).toFixed(0)}k`:String(v) } },
        },
      },
    };
  }, [JSON.stringify(data)]);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 h-full flex flex-col min-h-0 overflow-hidden">
      <h3 className="font-bold text-white mb-2 uppercase text-xs tracking-wider">Total Visitantes — Último Trimestre</h3>
      <div className="flex gap-4 text-[10px] text-gray-500 mb-3 flex-none">
        <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: CJ.neutral }} />Visitantes <strong className="text-white ml-1">{loading ? '…' : totalV.toLocaleString('pt-BR')}</strong></span>
      </div>
      <CanvasBox height={CHART_H} minHeight={CHART_H} className="flex-none">
        <canvas ref={canvasRef} className="w-full h-full" />
        {loading ? <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">Carregando...</div>
          : data.length === 0 ? <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">Sem dados no trimestre</div>
          : null}
      </CanvasBox>
    </div>
  );
};

// ── WIDGET_MAP ───────────────────────────────────────────────────────────────
type FacialExpressionSeries = {
  label: string;
  values: number[];
  color: string;
};

function buildPreviewDateLabels(startDate?: Date | string, endDate?: Date | string) {
  const fallback = Array.from({ length: 7 }, (_, index) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - index));
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  });

  if (!startDate || !endDate) return fallback;

  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return fallback;

  const labels: string[] = [];
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  const last = new Date(end);
  last.setHours(0, 0, 0, 0);

  while (cursor <= last && labels.length < 31) {
    labels.push(cursor.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }));
    cursor.setDate(cursor.getDate() + 1);
  }

  return labels.length > 0 ? labels : fallback;
}

export const WidgetFacialExpressions = ({
  startDate,
  endDate,
  labels,
  series,
}: {
  startDate?: Date | string;
  endDate?: Date | string;
  labels?: string[];
  series?: FacialExpressionSeries[];
}) => {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const chartLabels = labels && labels.length > 0 ? labels : buildPreviewDateLabels(startDate, endDate);
  const palette: FacialExpressionSeries[] = [
    { label: 'Neutro', values: [], color: '#9ca3af' },
    { label: 'Felicidade', values: [], color: '#fbbf24' },
    { label: 'Surpresa', values: [], color: '#22c55e' },
    { label: 'Raiva', values: [], color: '#fb7185' },
  ];
  const resolvedSeries = palette.map((defaultSeries) => {
    const match = (series || []).find((entry) => String(entry.label).toLowerCase() === defaultSeries.label.toLowerCase());
    const values = Array.from({ length: chartLabels.length }, (_, index) => Number(match?.values?.[index]) || 0);
    return { ...defaultSeries, ...match, values };
  });
  const hasAnyData = resolvedSeries.some((entry) => entry.values.some((value) => value > 0));

  useChartJs(canvasRef, () => ({
    type: 'line',
    data: {
      labels: chartLabels,
      datasets: resolvedSeries.map((entry) => ({
        label: entry.label,
        data: entry.values,
        borderColor: entry.color,
        backgroundColor: 'transparent',
        borderWidth: 2,
        pointRadius: 2.5,
        pointHoverRadius: 5,
        pointBackgroundColor: entry.color,
        tension: 0.35,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: CJ.bg,
          borderColor: 'rgba(255,255,255,0.12)',
          borderWidth: 1,
          padding: CJ.tooltipPadding,
          titleFont: CJ.titleFont,
          bodyFont: CJ.bodyFont,
          callbacks: {
            label: (ctx: any) => `  ${ctx.dataset.label}: ${Number(ctx.raw).toLocaleString('pt-BR')}`,
          },
        },
      },
      scales: {
        x: {
          grid: { color: CJ.grid },
          ticks: { color: CJ.label, font: { size: 10 }, maxTicksLimit: 8 },
        },
        y: {
          beginAtZero: true,
          grid: { color: CJ.grid },
          ticks: {
            color: CJ.label,
            font: { size: 11 },
            callback: (value: number) => value >= 1000 ? `${(value / 1000).toFixed(0)}k` : String(value),
          },
          title: { display: true, text: 'Numero', color: CJ.label, font: { size: 11 } },
        },
      },
    },
  }), [JSON.stringify(chartLabels), JSON.stringify(resolvedSeries)]);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 h-full flex flex-col min-h-0 overflow-hidden">
      <div className="flex items-center justify-between mb-3 flex-none gap-3">
        <h3 className="font-bold text-white flex items-center gap-2 uppercase text-xs tracking-wider">
          <Activity size={14} className="text-pink-400" />
          Expressoes Faciais
        </h3>
        <div className="flex gap-3 text-[10px] text-gray-400 flex-wrap justify-end">
          {resolvedSeries.map((entry) => (
            <span key={entry.label} className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: entry.color }} />
              {entry.label}
            </span>
          ))}
        </div>
      </div>
      <CanvasBox className="flex-1 min-h-[220px]">
        <canvas ref={canvasRef} />
        {!hasAnyData && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm bg-gray-900/55">
            Sem dados de expressoes faciais neste periodo.
          </div>
        )}
      </CanvasBox>
    </div>
  );
};

type DeviceAudienceItem = {
  label: string;
  value: number;
  color?: string;
};

export const WidgetDeviceFlow = ({
  visitors,
  passersby,
  deviceAudience,
  trackingData,
}: {
  visitors?: number;
  passersby?: number | null;
  deviceAudience?: DeviceAudienceItem[];
  trackingData?: DeviceAudienceItem[];
}) => {
  const safeVisitors = Math.max(0, Number(visitors) || 0);
  const safePassersby = Math.max(0, Number(passersby) || 0);
  const hasFlowRatio = safePassersby > 0;
  const flowPct = hasFlowRatio ? Math.max(0, Math.min(100, (safeVisitors / safePassersby) * 100)) : null;
  const audiencePalette = ['#ff4d4f', '#d667ff', '#2f7df6', '#ffb703'];
  const trackingPalette = ['#f8dfcf', '#f2c3a8', '#e89e72', '#cc5d12'];
  const audienceRows = (deviceAudience || []).map((entry, index) => ({
    ...entry,
    color: entry.color || audiencePalette[index % audiencePalette.length],
  }));
  const incomingTracking = Array.isArray(trackingData) ? trackingData : [];
  const trackingRows = incomingTracking
    .filter((entry) => Number(entry?.value ?? 0) > 0)
    .slice(0, 4)
    .map((entry, index) => ({
      label: String(entry?.label ?? '').trim(),
      value: Number(entry?.value ?? 0),
      color: entry?.color || trackingPalette[index % trackingPalette.length],
    }));

  const formatPct = (value: number) => `${value.toFixed(1).replace('.', ',')}%`;
  const fluxoBarWidth = flowPct ?? 0;
  const passersbyPct = hasFlowRatio ? Math.max(0, 100 - flowPct!) : null;
  const flowDisplay = hasFlowRatio ? formatPct(flowPct!) : (safeVisitors > 0 ? '0,0%' : '--');
  const flowHelperText = hasFlowRatio
    ? 'Visitantes sobre passantes no periodo.'
    : 'Sem passantes no periodo filtrado.';

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-2.5 h-full flex flex-col gap-2.5 overflow-hidden">
      <h3 className="font-bold text-white flex items-center gap-2 uppercase text-xs tracking-wider">
        <Users size={14} className="text-fuchsia-400" />
        Fluxo e Audiencia Device
      </h3>

      {/* ── FLUXO ───────────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-fuchsia-200 font-semibold uppercase tracking-wider">Fluxo</span>
          <div className="h-px flex-1 bg-gradient-to-r from-fuchsia-400/60 via-fuchsia-300/20 to-transparent" />
        </div>
        <div className="rounded-xl border border-gray-800/80 bg-gradient-to-br from-gray-900 via-gray-900 to-gray-800/60 p-2">
          <div className="flex flex-wrap items-end justify-between gap-1.5 mb-1.5">
            <div className="min-w-[96px]">
              <div className="text-[10px] uppercase tracking-[0.24em] text-gray-500">Conversao do fluxo</div>
              <div className="text-[19px] font-black text-white leading-none mt-1">
                {flowDisplay}
              </div>
              <div className="text-[9px] text-gray-500 mt-0.5">{flowHelperText}</div>
            </div>
            <div className="flex flex-wrap justify-end gap-1.5">
              <div className="min-w-[76px] rounded-lg border border-gray-800 bg-gray-950/60 px-2 py-1 text-right">
                <div className="text-[10px] uppercase tracking-[0.18em] text-gray-500">Visitantes</div>
                <div className="text-[13px] font-bold text-white">{safeVisitors.toLocaleString('pt-BR')}</div>
              </div>
              <div className="min-w-[76px] rounded-lg border border-gray-800 bg-gray-950/60 px-2 py-1 text-right">
                <div className="text-[10px] uppercase tracking-[0.18em] text-gray-500">Passantes</div>
                <div className="text-[13px] font-bold text-white">{safePassersby.toLocaleString('pt-BR')}</div>
              </div>
            </div>
          </div>

          <div className="relative h-5 rounded-lg overflow-hidden border border-gray-800 bg-white/[0.06]">
            <div className="absolute inset-0 bg-gradient-to-r from-white/5 to-transparent" />
            <div
              className="absolute inset-y-0 left-0 rounded-r-lg bg-gradient-to-r from-emerald-500 via-emerald-400 to-teal-300 shadow-[0_0_18px_rgba(16,185,129,0.14)] transition-all duration-500"
              style={{ width: `${fluxoBarWidth}%` }}
            />
            <div className="absolute inset-y-0 right-0 flex items-center pr-1.5">
              <span className="rounded-full bg-gray-950/80 px-1.5 py-0.5 text-[10px] font-black text-white shadow-lg">
                {flowDisplay}
              </span>
            </div>
          </div>
          <div className="mt-1 flex items-center justify-between text-[10px] text-gray-400">
            <span>Visitantes {flowDisplay}</span>
            <span>Passantes {passersbyPct !== null ? formatPct(passersbyPct) : '--'}</span>
          </div>
        </div>
      </div>

      {/* ── AUDIENCIA DEVICE ────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-fuchsia-200 font-semibold uppercase tracking-wider">Audiencia Device</span>
          <div className="h-px flex-1 bg-gradient-to-r from-fuchsia-400/60 via-fuchsia-300/20 to-transparent" />
        </div>
        {audienceRows.length > 0 ? (
          <div className="space-y-1.5">
            {audienceRows.map((entry, index) => {
              const barWidth = Math.max(10, Math.min(100, entry.value));
              return (
                <div key={entry.label} className="rounded-xl border border-gray-800/70 bg-gray-950/35 px-2 py-1.5 overflow-hidden">
                  <div className="mb-1 flex items-start gap-2">
                    <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full border border-white/10 bg-gray-950/80 px-1.5 text-[9px] font-bold text-white">
                      #{index + 1}
                    </span>
                    <div className="min-w-0 flex-1 text-[10px] text-gray-200 leading-tight break-words whitespace-normal">
                      {entry.label}
                    </div>
                    <span className="rounded-full bg-gray-950/70 px-1.5 py-0.5 text-[10px] font-black text-white shadow-lg">
                      {formatPct(entry.value)}
                    </span>
                  </div>
                  <div className="h-4 rounded-lg bg-white/[0.04] relative overflow-hidden">
                    <div
                      className="absolute inset-y-0 left-0 rounded-lg transition-all duration-500 shadow-[0_4px_12px_rgba(0,0,0,0.14)]"
                      style={{ background: `linear-gradient(90deg, ${entry.color}, ${entry.color}dd)`, width: `${barWidth}%` }}
                    />
                    <div className="absolute inset-0 bg-gradient-to-r from-white/[0.06] to-transparent" />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-gray-800 bg-gray-950/40 px-4 py-6 text-sm text-gray-500 text-center">
            Sem dados de audiencia por device.
          </div>
        )}
      </div>

      {/* ── TRACKING ILHA ───────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-fuchsia-200 font-semibold uppercase tracking-wider">Tracking Ilha</span>
          <div className="h-px flex-1 bg-gradient-to-r from-fuchsia-400/60 via-fuchsia-300/20 to-transparent" />
        </div>
        {trackingRows.length > 0 ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-1.5">
            {trackingRows.map((entry) => (
              <div
                key={entry.label}
                className="rounded-xl border border-black/10 px-1.5 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]"
                style={{ background: `linear-gradient(180deg, ${entry.color}, ${entry.color}ee)` }}
              >
                <div className="text-[9px] text-gray-900/80 font-semibold leading-tight break-words whitespace-normal min-h-[2rem] mb-1">
                  {entry.label}
                </div>
                <div className="text-[16px] font-black text-gray-950 leading-none">
                  {formatPct(entry.value)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-gray-800 bg-gray-950/40 px-4 py-6 text-sm text-gray-500 text-center">
            Sem dados de tracking por ilha.
          </div>
        )}
      </div>
    </div>
  );
};

export const WIDGET_MAP: Record<string, React.FC<any>> = {
  'flow_trend':          WidgetFlowTrend,
  'hourly_flow':         WidgetHourlyFlow,
  'chart_facial_expressions': WidgetFacialExpressions,
  'chart_device_flow':   WidgetDeviceFlow,
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
  'heatmap': () => <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 flex items-center justify-center text-gray-500" style={{ minHeight: 200 }}>Mapa de Calor (Em breve)</div>,
};
