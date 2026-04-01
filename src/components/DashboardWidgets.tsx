import React from 'react';
import { Activity, Clock, Users } from 'lucide-react';

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
  raspados: { label: 'Raspados', color: '#f9a8d4' }, shaved: { label: 'Raspados', color: '#f9a8d4' }, none: { label: 'Raspados', color: '#f9a8d4' },
  barba: { label: 'Barba', color: '#1f2937' }, beard: { label: 'Barba', color: '#1f2937' }, full: { label: 'Barba', color: '#1f2937' },
  cavanhaque: { label: 'Cavanhaque', color: '#2563eb' }, goatee: { label: 'Cavanhaque', color: '#2563eb' },
  bigode: { label: 'Bigode', color: '#dc2626' }, mustache: { label: 'Bigode', color: '#dc2626' },
  cerdas: { label: 'Cerdas', color: '#d97706' }, stubble: { label: 'Cerdas', color: '#d97706' },
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
  const order  = ['18-','18-24','25-34','35-44','45-54','55-64','65+'];
  const lblMap: Record<string,string> = { '18-':'<18','18-24':'18-25','25-34':'26-35','35-44':'36-45','45-54':'46-60','55-64':'55-64','65+':'60+' };
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
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <h3 className="font-bold text-white mb-3 flex items-center gap-2 uppercase text-xs tracking-wider">
        <Users size={14} className="text-pink-500" />Gênero
      </h3>
      {items.length === 0
        ? <div style={{ height: 200 }} className="flex items-center justify-center text-gray-500 text-sm">Sem dados</div>
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
  const segments = safe
    .map((x) => {
      const pct = isPct ? Math.round(Number(x.value) || 0) : Math.round(((Number(x.value) || 0) / sum) * 100);
      const count = x.count ?? (totalCount ? Math.round((pct / 100) * totalCount) : null);
      return { label: x.label, color: x.color, pct, count };
    })
    .filter((x) => x.pct > 0)
    .sort((a, b) => b.pct - a.pct);

  const radius = 40;
  const stroke = 15;
  const circ = 2 * Math.PI * radius;
  let arcOffset = 0;
  const arcs = segments.map((s) => {
    const dash = (s.pct / 100) * circ;
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
      const span = (s.pct / 100) * 360;
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
    <div className="flex flex-col items-center gap-3">
      <div
        ref={wrapRef}
        className="relative w-full mx-auto"
        style={{ width: `min(100%, ${maxSize}px)`, height: `min(100%, ${maxSize}px)` }}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
      >
        <svg viewBox="0 0 100 100" width="100%" height="100%" style={{ transform: 'rotate(-90deg)' }}>
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
          <span className="text-2xl font-bold text-white leading-none">{segments[0]?.pct ?? 0}%</span>
          <span className="text-[11px] text-gray-400 mt-1">{segments[0]?.label ?? ''}</span>
        </div>

        {hover && (
          <div
            className="fixed z-50 bg-gray-950 border border-gray-700 text-white text-[11px] px-2 py-1 rounded-md whitespace-nowrap pointer-events-none"
            style={{ left: hover.cx, top: hover.cy, transform: 'translate(12px, 12px)' }}
          >
            <div className="font-semibold" style={{ color: hover.color }}>{hover.label}</div>
            <div className="text-gray-300">
              {hover.pct}%{hover.count != null ? ` • ${hover.count.toLocaleString()} visitantes` : ''}
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-center gap-5 flex-wrap">
        {segments.map((s, i) => (
          <div key={i} className="group relative flex items-center gap-1.5 cursor-default">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.color }} />
            <span className="text-[11px] text-gray-400">{s.label}</span>
            <span className="text-[11px] font-semibold" style={{ color: s.color }}>{s.pct}%</span>
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
    items = glassesCatItems
      .filter((a) => Number(a.value) > 0)
      .map((a) => {
        const rawKey = String(a.label).replace('_glasses_', '').toLowerCase().trim();
        const m = GLASSES_MAP[rawKey] ?? { label: rawKey, color: '#6b7280' };
        return { label: m.label, value: Number(a.value), color: m.color };
      });
  } else {
    // Fallback: usa o total % de "Óculos" do atributo geral
    const raw = (attrData || []).find((a) => String(a.label).toLowerCase() === 'óculos');
    const w = Math.max(0, Math.min(100, Number(raw?.value) || 0)); const wo = Math.max(0, 100 - w);
    if (w > 0)  items.push({ label: 'Com Óculos', value: w,  color: '#93c5fd' });
    if (wo > 0) items.push({ label: 'Sem Óculos', value: wo, color: '#4b5563' });
  }
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <h3 className="font-bold text-white mb-3 uppercase text-xs tracking-wider">Visão</h3>
      {items.length === 0
        ? <div style={{ height: 200 }} className="flex items-center justify-center text-gray-500 text-sm">Sem dados</div>
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
    items = facialCatItems
      .filter((a) => Number(a.value) > 0)
      .map((a) => {
        const rawKey = String(a.label).replace('_facial_', '').toLowerCase().trim();
        const m = FACIAL_HAIR_MAP[rawKey] ?? { label: rawKey, color: '#6b7280' };
        return { label: m.label, value: Number(a.value), color: m.color };
      });
  } else {
    // Fallback: usa o total % de "Barba" do atributo geral
    const beardPct = Number((attrData || []).find((a) => String(a.label).toLowerCase() === 'barba')?.value) || 0;
    const w = Math.max(0, Math.min(100, beardPct)); const wo = Math.max(0, 100 - w);
    if (w > 0)  items.push({ label: 'Com Barba', value: w,  color: '#f97316' });
    if (wo > 0) items.push({ label: 'Sem Barba', value: wo, color: '#1d4ed8' });
  }
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <h3 className="font-bold text-white mb-3 uppercase text-xs tracking-wider">Pelos Faciais</h3>
      {items.length === 0
        ? <div style={{ height: 200 }} className="flex items-center justify-center text-gray-500 text-sm">Sem dados</div>
        : <DonutLikeGender items={items} />}
    </div>
  );
};

// ── WidgetHairType ───────────────────────────────────────────────────────────
export const WidgetHairType = ({ hairTypeData }: { hairTypeData?: { label: string; value: number }[] }) => {
  const { labels, values, colors } = mapHairData(hairTypeData, HAIR_TYPE_MAP);
  const items = labels.map((l, i) => ({ label: l, value: values[i], color: colors[i] }));
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <h3 className="font-bold text-white mb-3 uppercase text-xs tracking-wider">Tipo de Cabelo</h3>
      {items.length === 0
        ? <div style={{ height: 200 }} className="flex items-center justify-center text-gray-500 text-sm">Sem dados</div>
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
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <h3 className="font-bold text-white mb-3 uppercase text-xs tracking-wider">Cor de Cabelo</h3>
      {finalItems.length === 0
        ? <div style={{ height: 200 }} className="flex items-center justify-center text-gray-500 text-sm">Sem dados</div>
        : <DonutLikeGender items={finalItems} />}
    </div>
  );
};

// ── WidgetCampaigns ──────────────────────────────────────────────────────────
export const WidgetCampaigns = ({ clientId, lojaFilter }: { view?: string; clientId?: string; lojaFilter?: string | null }) => {
  const [rows, setRows]         = React.useState<any[]>([]);
  const [loading, setLoading]   = React.useState(false);
  const [lastSync, setLastSync] = React.useState<string | null>(null);

  const fetchData = React.useCallback(() => {
    if (!clientId) return;
    setLoading(true);
    import('../lib/supabase').then(({ default: supabase }) => {
      let q = supabase
        .from('campaigns')
        .select('name,tipo_midia,loja,start_date,end_date,duration_days,duration_hms,visitors,avg_attention_sec,uploaded_at')
        .eq('client_id', clientId)
        .order('start_date', { ascending: false })
        .limit(500);
      if (lojaFilter) q = (q as any).ilike('loja', `%${lojaFilter}%`);
      q.then(({ data }: { data: any[] | null }) => {
        setRows(data || []);
        if (data && data.length > 0 && data[0].uploaded_at) {
          setLastSync(new Date(data[0].uploaded_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }));
        }
        setLoading(false);
      });
    });
  }, [clientId, lojaFilter]);

  React.useEffect(() => { fetchData(); }, [fetchData]);

  const fmtDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

  const fmtAtencao = (s: number) => {
    if (!s || s === 0) return '—';
    const total = Math.floor(Number(s));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const sec = total % 60;
    if (h > 0) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  const totalVisitantes = rows.reduce((acc, r) => acc + (Number(r.visitors) || 0), 0);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 h-full flex flex-col" style={{ minHeight: '320px' }}>

      {/* Header */}
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <h3 className="font-bold text-white flex items-center gap-2 uppercase text-xs tracking-wider">
          <Activity size={14} className="text-emerald-500" />
          Engajamento em Campanhas
          {rows.length > 0 && (
            <span className="text-[10px] font-normal text-gray-500 normal-case tracking-normal">
              ({rows.length} {rows.length === 1 ? 'registro' : 'registros'})
            </span>
          )}
        </h3>
        <div className="flex items-center gap-2">
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

      {/* Body */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
          <svg className="animate-spin mr-2" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
          Carregando...
        </div>
      ) : rows.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-gray-500 text-sm">
          <p>{lojaFilter ? `Nenhuma campanha para a loja "${lojaFilter}".` : 'Nenhuma campanha disponível.'}</p>
          {!lojaFilter && <p className="text-xs text-gray-600">Aguardando sincronização automática pelo bot.</p>}
        </div>
      ) : (
        <div className="flex-1 overflow-auto" style={{ minHeight: 0 }}>
          <table className="min-w-full text-left text-xs border-separate border-spacing-0">
            <thead>
              <tr className="sticky top-0 z-10">
                <th className="bg-gray-900 pb-2 pt-1 pr-4 font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap border-b border-gray-700">Tipo Mídia</th>
                <th className="bg-gray-900 pb-2 pt-1 pr-4 font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap border-b border-gray-700">Loja</th>
                <th className="bg-gray-900 pb-2 pt-1 pr-4 font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap border-b border-gray-700">Início Exibição</th>
                <th className="bg-gray-900 pb-2 pt-1 pr-4 font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap border-b border-gray-700">Fim Exibição</th>
                <th className="bg-gray-900 pb-2 pt-1 pr-4 font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap text-right border-b border-gray-700">Tempo (Dias)</th>
                <th className="bg-gray-900 pb-2 pt-1 pr-4 font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap text-right border-b border-gray-700">Tempo (hh:mm:ss)</th>
                <th className="bg-gray-900 pb-2 pt-1 pr-4 font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap text-right border-b border-gray-700">Visitantes</th>
                <th className="bg-gray-900 pb-2 pt-1 font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap text-right border-b border-gray-700">Atenção Média</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={i}
                  className={`transition-colors hover:bg-gray-800/50 ${i % 2 === 0 ? 'bg-transparent' : 'bg-gray-800/20'}`}
                >
                  <td className="py-2 pr-4 text-purple-400 font-medium whitespace-nowrap">{r.tipo_midia || '—'}</td>
                  <td className="py-2 pr-4 text-gray-200 whitespace-nowrap">{r.loja || '—'}</td>
                  <td className="py-2 pr-4 text-gray-400 whitespace-nowrap">{fmtDate(r.start_date)}</td>
                  <td className="py-2 pr-4 text-gray-400 whitespace-nowrap">{fmtDate(r.end_date)}</td>
                  <td className="py-2 pr-4 text-yellow-400 text-right font-mono">{r.duration_days != null ? Number(r.duration_days).toFixed(2) : '—'}</td>
                  <td className="py-2 pr-4 text-gray-400 text-right font-mono">{r.duration_hms && r.duration_hms !== 'None' ? r.duration_hms : '—'}</td>
                  <td className="py-2 pr-4 text-emerald-400 text-right font-bold">{Number(r.visitors || 0).toLocaleString('pt-BR')}</td>
                  <td className="py-2 text-blue-400 text-right font-bold">{fmtAtencao(r.avg_attention_sec)}</td>
                </tr>
              ))}
            </tbody>
            {rows.length > 1 && (
              <tfoot>
                <tr className="border-t border-gray-700">
                  <td colSpan={6} className="pt-2 pr-4 text-gray-500 text-xs font-medium uppercase tracking-wider">Total</td>
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
      data: { labels: data.map(d=>d.label), datasets: [{ label:'Visitantes', data: visitorArr, backgroundColor: CJ.neutral, borderRadius:4, borderSkipped:false, hoverBackgroundColor:'#34d399' }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { backgroundColor: CJ.bg, borderColor: 'rgba(255,255,255,0.12)', borderWidth:1, padding: CJ.tooltipPadding, titleFont: CJ.titleFont, bodyFont: CJ.bodyFont, callbacks: { title:(i:any[])=>i[0]?.label??'', label:(ctx:any)=>{ const v=Number(ctx.raw); return `  Visitantes: ${v>=1000?`${(v/1000).toFixed(1)}k`:v.toLocaleString('pt-BR')}`; } } } },
        scales: {
          x: { grid:{ color:CJ.grid }, ticks:{ color:CJ.label, font:{ size:12 }, autoSkip:false, maxRotation:0 } },
          y: { beginAtZero:true, grid:{ color:CJ.grid }, ticks:{ color:CJ.neutral, font:{ size:11 }, callback:(v:number)=>v>=1000?`${(v/1000).toFixed(0)}k`:String(v) } },
        },
      },
    };
  }, [JSON.stringify(visitorArr)]);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 h-full flex flex-col min-h-0 overflow-hidden">
      <h3 className="font-bold text-white mb-2 uppercase text-xs tracking-wider">Total Visitantes — Último Trimestre</h3>
      <div className="flex gap-4 text-[10px] text-gray-500 mb-3 flex-none">
        <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: CJ.neutral }} />Visitantes <strong className="text-white ml-1">{loading ? '…' : totalV.toLocaleString('pt-BR')}</strong></span>
      </div>
      <CanvasBox height="100%" minHeight={0} className="flex-1 min-h-0">
        {loading ? <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">Carregando...</div>
          : data.length === 0 ? <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">Sem dados no trimestre</div>
          : <canvas ref={canvasRef} className="w-full h-full" />}
      </CanvasBox>
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
  'heatmap': () => <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 flex items-center justify-center text-gray-500" style={{ minHeight: 200 }}>Mapa de Calor (Em breve)</div>,
};
