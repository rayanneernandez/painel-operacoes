import React from 'react';
import { Activity, Clock, Users } from 'lucide-react';

// --- CHART COMPONENTS ---

export const LineChart = ({
  data, color, height = 60, labels, valueFormatter,
}: {
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
  const formatValue = (v: number, i: number) => valueFormatter ? valueFormatter(v, i) : Number(v).toLocaleString();
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
        <div className="absolute z-10 px-2 py-1 rounded-md bg-gray-950/90 text-white text-[10px] border border-gray-800 pointer-events-none" style={{ left: Math.min(mouse.x + 10, 260), top: Math.max(0, mouse.y - 30) }}>
          <div className="font-semibold">{labels?.[hoverIdx ?? 0] ?? `#${(hoverIdx ?? 0) + 1}`}</div>
          <div>{formatValue(hoverPt.val, hoverIdx ?? 0)}</div>
        </div>
      )}
    </div>
  );
};

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
      {showCenter && (<div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none"><span className="text-2xl font-bold text-gray-900 dark:text-white">{total.toLocaleString()}</span><span className="text-[10px] text-gray-500 uppercase">Total</span></div>)}
      {hoverTip && mouse && (<div className="absolute z-10 px-2 py-1 rounded-md bg-gray-950/90 text-white text-[10px] border border-gray-800 pointer-events-none" style={{ left: Math.min(mouse.x + 10, 260), top: Math.max(0, mouse.y - 30) }}>{hoverTip}</div>)}
    </div>
  );
};

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
          <div className="flex-1 bg-gray-100 dark:bg-gray-900 rounded-full h-2 relative">
            <div style={{ width: `${(d.value / max) * 100}%` }} className={`h-full rounded-full ${color} transition-all duration-1000`} />
          </div>
          <span className="w-12 text-gray-900 dark:text-white font-medium">{d.value}%</span>
        </div>
      ))}
      {hover && mouse && (<div className="absolute z-10 px-2 py-1 rounded-md bg-gray-950/90 text-white text-[10px] border border-gray-800 pointer-events-none" style={{ left: Math.min(mouse.x + 10, 260), top: Math.max(0, mouse.y - 30) }}><div className="font-semibold">{hover.label}</div><div>{hover.value}%</div></div>)}
    </div>
  );
};

export const KPIStat = ({ label, value, subvalue, color = 'text-gray-900 dark:text-white' }: { label: string; value: string; subvalue?: string; color?: string }) => (
  <div className="bg-gray-50 dark:bg-gray-950/50 rounded-lg p-3 border border-gray-200 dark:border-gray-800 flex flex-col items-center justify-center text-center flex-1 min-w-[100px]">
    <span className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">{label}</span>
    <span className={`text-xl font-bold ${color}`}>{value}</span>
    {subvalue && <span className="text-[10px] text-gray-400 mt-1">{subvalue}</span>}
  </div>
);

// ── ChartJS helper: destroy + create ────────────────────────────────────────
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

    // Se Chart.js já está carregado, inicializa imediatamente
    if ((window as any).Chart) {
      init();
    } else {
      // Aguarda o script carregar via evento
      const script = document.querySelector(
        'script[src*="chart.umd"]'
      ) as HTMLScriptElement | null;
      if (script) {
        script.addEventListener('load', init, { once: true });
      } else {
        // Fallback: polling até 3s
        let tries = 0;
        const poll = setInterval(() => {
          if ((window as any).Chart || tries++ > 30) {
            clearInterval(poll);
            init();
          }
        }, 100);
        return () => { cancelled = true; clearInterval(poll); chartRef.current?.destroy(); chartRef.current = null; };
      }
    }

    return () => { cancelled = true; chartRef.current?.destroy(); chartRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

// ── Shared Chart.js theme ────────────────────────────────────────────────────
const CJ = {
  grid:    'rgba(255,255,255,0.06)',
  label:   '#9ca3af',
  male:    '#2563eb',
  female:  '#ef4444',
  neutral: '#1D9E75',
  bg:      'rgba(10,10,20,0.95)',
  tooltipPadding: { top: 10, bottom: 10, left: 14, right: 14 },
  titleFont: { size: 13, weight: 'bold' as const },
  bodyFont:  { size: 13 },
};

// ── Widget: Pirâmide / Gênero & Idade (barras agrupadas por faixa) ───────────
export const WidgetAgePyramid = ({ view, ageData, totalVisitors }: { view: string; ageData?: any[]; totalVisitors?: number }) => {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  const defaultData = [
    { age: '65+', m: 0, f: 0 }, { age: '55-64', m: 0, f: 0 }, { age: '45-54', m: 0, f: 0 },
    { age: '35-44', m: 0, f: 0 }, { age: '25-34', m: 0, f: 0 }, { age: '18-24', m: 0, f: 0 }, { age: '18-', m: 0, f: 0 },
  ];
  const data = (ageData && ageData.length ? ageData : defaultData).slice().reverse();

  // Mapeia labels para mais amigáveis
  const labelMap: Record<string, string> = { '18-': '<18', '18-24': '18-24', '25-34': '25-34', '35-44': '35-44', '45-54': '45-54', '55-64': '55-64', '65+': '65+' };

  useChartJs(canvasRef, () => ({
    type: 'bar',
    data: {
      labels: data.map((d) => labelMap[d.age] ?? d.age),
      datasets: [
        { label: 'Feminino',  data: data.map((d) => Number(d.f) || 0), backgroundColor: CJ.female, borderRadius: 3, borderSkipped: false },
        { label: 'Masculino', data: data.map((d) => Number(d.m) || 0), backgroundColor: CJ.male,   borderRadius: 3, borderSkipped: false },
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
              const cnt  = base ? Math.round((v / 100) * base) : null;
              return `  ${ctx.dataset.label}: ${v}%${cnt ? ` (${cnt.toLocaleString()})` : ''}`;
            },
          },
        },
      },
      scales: {
        x: { stacked: false, grid: { color: CJ.grid }, ticks: { color: CJ.label, font: { size: 11 } } },
        y: {
          beginAtZero: true, grid: { color: CJ.grid },
          ticks: { color: CJ.label, font: { size: 11 }, callback: (v: number) => `${v}%` },
          title: { display: true, text: 'Número %', color: CJ.label, font: { size: 11 } },
        },
      },
    },
  }), [JSON.stringify(data)]);

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 h-full shadow-sm dark:shadow-none flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2 uppercase text-xs tracking-wider">
          <Users size={14} className="text-purple-500" />
          Gênero &amp; Idade
        </h3>
        <div className="flex gap-3 text-[10px]">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: CJ.female }} />Feminino</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: CJ.male }} />Masculino</span>
        </div>
      </div>
      <div className="relative w-full" style={{ height: 220 }}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
};

// ── Widget: Distribuição por Faixa Etária (barras simples) ───────────────────
export const WidgetAgeRanges = ({ ageData }: { ageData?: { age: string; m: number; f: number }[] }) => {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  const order   = ['18-', '18-24', '25-34', '35-44', '45-54', '55-64', '65+'];
  const lblMap: Record<string, string> = { '18-': '<18', '18-24': '18-25', '25-34': '26-35', '35-44': '36-45', '45-54': '46-60', '55-64': '55-64', '65+': '60+' };
  const byAge   = new Map((ageData || []).map((d) => [String(d.age), d]));
  const vals    = order.map((age) => { const d = byAge.get(age); return (Number(d?.m) || 0) + (Number(d?.f) || 0); });

  useChartJs(canvasRef, () => ({
    type: 'bar',
    data: {
      labels: order.map((a) => lblMap[a] ?? a),
      datasets: [{
        label: 'Visitantes', data: vals,
        backgroundColor: vals.map(() => CJ.male),
        borderRadius: 4, borderSkipped: false, hoverBackgroundColor: '#93c5fd',
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: CJ.bg, borderColor: 'rgba(255,255,255,0.12)', borderWidth: 1,
          padding: CJ.tooltipPadding, titleFont: CJ.titleFont, bodyFont: CJ.bodyFont,
          callbacks: {
            title: (items: any[]) => items[0]?.label ?? '',
            label: (ctx: any) => `  visitantes : ${Number(ctx.raw).toLocaleString()}`,
          },
        },
      },
      scales: {
        x: { grid: { color: CJ.grid }, ticks: { color: CJ.label, font: { size: 11 } }, title: { display: true, text: 'Faixa etária', color: CJ.label, font: { size: 11 } } },
        y: { beginAtZero: true, grid: { color: CJ.grid }, ticks: { color: CJ.label, font: { size: 11 }, callback: (v: number) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v) }, title: { display: true, text: 'Visitantes', color: CJ.label, font: { size: 11 } } },
      },
    },
  }), [JSON.stringify(vals)]);

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 h-full shadow-sm dark:shadow-none flex flex-col gap-3">
      <h3 className="font-bold text-gray-900 dark:text-white uppercase text-xs tracking-wider">Distribuição por Faixa Etária</h3>
      <div className="relative w-full" style={{ height: 220 }}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
};

// ── Widget: Fluxo por Hora — Masculino vs Feminino ───────────────────────────
export const WidgetHourlyFlow = ({ view, hourlyData, genderData, totalVisitors }: {
  view: string; hourlyData?: number[]; genderData?: { label: string; value: number }[]; totalVisitors?: number;
}) => {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const data = hourlyData && hourlyData.length ? hourlyData : new Array(24).fill(0);
  const labels = Array.from({ length: 24 }, (_, i) => `${i}h`);

  // Calcula split M/F por hora baseado nos percentuais globais de gênero
  const totalV = typeof totalVisitors === 'number' && totalVisitors > 0 ? totalVisitors : 1;
  const mPct = Number(genderData?.find((g) => g.label.toLowerCase().includes('masc'))?.value ?? 50) / 100;
  const fPct = 1 - mPct;
  const maleData   = data.map((v) => Math.round(v * mPct));
  const femaleData = data.map((v) => Math.round(v * fPct));

  useChartJs(canvasRef, () => ({
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Masculino',
          data: maleData,
          borderColor: CJ.male,
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 5,
          pointBackgroundColor: CJ.male,
          tension: 0.4,
        },
        {
          label: 'Feminino',
          data: femaleData,
          borderColor: CJ.female,
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 5,
          pointBackgroundColor: CJ.female,
          tension: 0.4,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
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
              title: (items: any[]) => items[0]?.label ?? '',
              label: (ctx: any) => `  ${ctx.dataset.label} : ${Number(ctx.raw).toLocaleString()}`,
            },
          },
        },
      scales: {
        x: {
          grid: { color: CJ.grid },
          ticks: { color: CJ.label, font: { size: 10 }, autoSkip: true, maxTicksLimit: 12 },
          title: { display: true, text: 'Horário (h)', color: CJ.label, font: { size: 11 } },
        },
        y: {
          beginAtZero: true, grid: { color: CJ.grid },
          ticks: { color: CJ.label, font: { size: 11 }, callback: (v: number) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v) },
          title: { display: true, text: 'Número de Visita', color: CJ.label, font: { size: 11 } },
        },
      },
    },
  }), [JSON.stringify(maleData), JSON.stringify(femaleData)]);

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 h-full shadow-sm dark:shadow-none flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2 uppercase text-xs tracking-wider">
          <Clock size={14} className="text-emerald-500" />
          Média Visitantes por Hora {view === 'network' ? '(Rede)' : ''}
        </h3>
        <div className="flex gap-3 text-[10px]">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: CJ.male }} />Masculino</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: CJ.female }} />Feminino</span>
        </div>
      </div>
      <div className="relative w-full" style={{ height: 220 }}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
};

// ── Widget: Gênero Donut ────────────────────────────────────────────────────
export const WidgetGenderDist = ({ view, genderData, totalVisitors }: { view: string; genderData?: { label: string; value: number }[]; totalVisitors?: number }) => {
  const fallback = [{ label: 'Masculino', value: 0 }, { label: 'Feminino', value: 0 }];
  const data = genderData && genderData.length === 2 ? genderData : fallback;
  const maleRaw = Number(data[0]?.value) || 0; const femaleRaw = Number(data[1]?.value) || 0;
  const sum = maleRaw + femaleRaw;
  const totalCount = typeof totalVisitors === 'number' && totalVisitors > 0 ? totalVisitors : null;
  const isPct = totalCount != null && sum > 0 && sum <= 101;
  const malePct   = isPct ? Math.round(maleRaw)   : Math.round((maleRaw   / (sum || 1)) * 100);
  const femalePct = isPct ? Math.round(femaleRaw) : Math.round((femaleRaw / (sum || 1)) * 100);
  const maleCount   = totalCount != null ? Math.round((malePct   / 100) * totalCount) : null;
  const femaleCount = totalCount != null ? Math.round((femalePct / 100) * totalCount) : null;
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6 h-full shadow-sm dark:shadow-none">
      <h3 className="font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2 uppercase text-sm tracking-wider"><Users size={16} className="text-pink-500" />Gênero</h3>
      <DonutChart data={data} colors={[CJ.male, CJ.female]} showCenter={false}
        tooltipFormatter={(d, pct) => { const p = isPct ? d.value : pct; const pFmt = `${Number(p).toFixed(1)}%`; if (d.label.toLowerCase().includes('masc')) return `${d.label}: ${pFmt}${maleCount != null ? ` (${maleCount.toLocaleString()})` : ''}`; return `${d.label}: ${pFmt}${femaleCount != null ? ` (${femaleCount.toLocaleString()})` : ''}`; }} />
      <div className="flex justify-center gap-4 mt-4 text-xs">
        <span className="flex items-center gap-1 text-gray-400"><div className="w-2 h-2 rounded-full" style={{ background: CJ.male }} /> Masculino ({malePct}%{maleCount != null ? ` • ${maleCount.toLocaleString()}` : ''})</span>
        <span className="flex items-center gap-1 text-gray-400"><div className="w-2 h-2 rounded-full" style={{ background: CJ.female }} /> Feminino ({femalePct}%{femaleCount != null ? ` • ${femaleCount.toLocaleString()}` : ''})</span>
      </div>
    </div>
  );
};

// ── WidgetSalesQuarter ───────────────────────────────────────────────────────
export const WidgetSalesQuarter = ({ quarterData, loading }: { quarterData?: { label: string; visitors: number; sales: number }[]; loading?: boolean }) => {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const data = Array.isArray(quarterData) && quarterData.length ? quarterData : [];
  const labels   = data.map((d) => d.label);
  const visitors = data.map((d) => Number(d.visitors) || 0);
  const totalVisitors = visitors.reduce((a, b) => a + b, 0);

  useChartJs(canvasRef, () => {
    if (data.length === 0) return null;
    return {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Visitantes', data: visitors,
          backgroundColor: CJ.neutral, borderRadius: 4, borderSkipped: false,
          hoverBackgroundColor: '#34d399',
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: CJ.bg, borderColor: 'rgba(255,255,255,0.12)', borderWidth: 1,
            padding: CJ.tooltipPadding, titleFont: CJ.titleFont, bodyFont: CJ.bodyFont,
            callbacks: {
              title: (items: any[]) => items[0]?.label ?? '',
              label: (ctx: any) => { const v = Number(ctx.raw); return `  Visitantes: ${v >= 1000 ? `${(v/1000).toFixed(1)}k` : v.toLocaleString('pt-BR')}`; },
            },
          },
        },
        scales: {
          x: { grid: { color: CJ.grid }, ticks: { color: CJ.label, font: { size: 12 }, autoSkip: false, maxRotation: 0 } },
          y: { beginAtZero: true, grid: { color: CJ.grid }, ticks: { color: CJ.neutral, font: { size: 11 }, callback: (v: number) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v) } },
        },
      },
    };
  }, [JSON.stringify(visitors)]);

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 h-full shadow-sm dark:shadow-none flex flex-col gap-3">
      <h3 className="font-bold text-gray-900 dark:text-white uppercase text-xs tracking-wider">Total Visitantes — Último Trimestre</h3>
      <div className="flex gap-4 text-[10px] text-gray-500">
        <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: CJ.neutral }} />Visitantes <strong className="text-white ml-1">{loading ? '…' : totalVisitors.toLocaleString('pt-BR')}</strong></span>
      </div>
      <div className="relative w-full" style={{ height: 200 }}>
        {loading ? <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">Carregando...</div>
          : data.length === 0 ? <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">Sem dados no trimestre</div>
          : <canvas ref={canvasRef} />}
      </div>
    </div>
  );
};

// --- WIDGET DEFINITIONS ---
export type WidgetType = { id: string; title: string; type: 'chart' | 'table' | 'kpi'; size: 'full' | 'half' | 'third' | 'quarter' | '2/3'; description: string; };

export const AVAILABLE_WIDGETS: WidgetType[] = [
  { id: 'kpi_flow_stats',      title: 'Resumo de Fluxo',                  type: 'kpi',   size: 'full',  description: 'Total Visitantes, Média Dia, Tempo Médio' },

  { id: 'flow_trend',          title: 'Tendências de Fluxo (Semanal)',    type: 'chart', size: 'half',  description: 'Gráfico de linha com fluxo diário' },
  { id: 'hourly_flow',         title: 'Fluxo por Hora',                   type: 'chart', size: 'half',  description: 'Gráfico de linha com média horária por gênero' },
  { id: 'chart_sales_quarter', title: 'Visitantes Último Trimestre',      type: 'chart', size: 'half',  description: 'Total de visitantes por mês' },
  { id: 'age_pyramid',         title: 'Gênero & Idade',                   type: 'chart', size: 'third', description: 'Barras agrupadas por faixa etária e gênero' },
  { id: 'chart_age_ranges',    title: 'Distribuição por Faixa Etária',    type: 'chart', size: 'third', description: 'Barras de visitantes por faixa etária' },
  { id: 'gender_dist',         title: 'Distribuição de Gênero',           type: 'chart', size: 'third', description: 'Gráfico de rosca: Masculino vs Feminino' },
  { id: 'chart_vision',        title: 'Atributo: Visão',                  type: 'chart', size: 'third', description: 'Uso de óculos' },
  { id: 'chart_facial_hair',   title: 'Atributo: Pelos Faciais',          type: 'chart', size: 'third', description: 'Barba, Bigode, etc.' },
  { id: 'chart_hair_type',     title: 'Atributo: Tipo de Cabelo',         type: 'chart', size: 'third', description: 'Longo, Curto, Careca' },
  { id: 'chart_hair_color',    title: 'Atributo: Cor de Cabelo',          type: 'chart', size: 'third', description: 'Preto, Loiro, Castanho' },
  { id: 'attributes',          title: 'Atributos Gerais',                 type: 'chart', size: 'third', description: 'Resumo de atributos principais' },
  { id: 'campaigns',           title: 'Engajamento em Campanhas',         type: 'table', size: '2/3',   description: 'Tabela de performance de campanhas' },
  { id: 'heatmap',             title: 'Mapa de Calor (Loja)',            type: 'chart', size: 'full',  description: 'Visualização térmica da planta baixa' },
];

// --- REMAINING WIDGET COMPONENTS (sem alteração) ---

export const WidgetFlowTrend = ({ view, dailyData }: { view: string; dailyData?: number[] }) => {
  const data = dailyData && dailyData.length ? dailyData : [0, 0, 0, 0, 0, 0, 0];
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 h-full shadow-sm dark:shadow-none">
      <h3 className="font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2 uppercase text-xs tracking-wider"><Activity size={14} className="text-blue-500" />Média Visitantes Dia - {view === 'network' ? 'Rede' : 'Dia da Semana'}</h3>
      <LineChart data={data} color="text-blue-500" height={100} labels={['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab', 'Dom']} valueFormatter={(v) => `${Number(v).toLocaleString()} visitantes`} />
      <div className="flex justify-between text-[10px] text-gray-500 mt-2 uppercase"><span>Seg</span><span>Ter</span><span>Qua</span><span>Qui</span><span>Sex</span><span>Sab</span><span>Dom</span></div>
    </div>
  );
};

export const WidgetAttributes = ({ view, attrData }: { view: string; attrData?: { label: string; value: number }[] }) => {
  const data = attrData && attrData.length ? attrData : [{ label: 'Óculos', value: 0 }, { label: 'Barba', value: 0 }, { label: 'Máscara', value: 0 }, { label: 'Chapéu/Boné', value: 0 }];
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6 h-full shadow-sm dark:shadow-none">
      <h3 className="font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2 uppercase text-sm tracking-wider"><Users size={16} className="text-orange-500" />Atributos</h3>
      <HorizontalBarChart data={data} color="bg-orange-500" />
    </div>
  );
};

export const WidgetCampaigns = ({ view }: { view: string }) => (
  <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6 h-full shadow-sm dark:shadow-none">
    <h3 className="font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2 uppercase text-sm tracking-wider"><Activity size={16} className="text-emerald-500" />Engajamento em Campanhas {view === 'network' ? '(Rede)' : ''}</h3>
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs text-gray-500 dark:text-gray-400">
        <thead className="text-gray-500 uppercase border-b border-gray-200 dark:border-gray-800">
          <tr><th className="pb-2 font-medium">Campanha</th><th className="pb-2 font-medium">Início</th><th className="pb-2 font-medium">Visitantes</th><th className="pb-2 font-medium">Tempo Médio</th><th className="pb-2 font-medium">Atenção</th></tr>
        </thead>
        <tbody className="divide-y divide-gray-200 dark:divide-gray-800" />
      </table>
    </div>
  </div>
);

export const WidgetKPIFlowStats = ({ totalVisitors, avgVisitorsPerDay, avgVisitSeconds }: { totalVisitors?: number; avgVisitorsPerDay?: number; avgVisitSeconds?: number }) => {
  const fmtDur = (s: number) => { const sec = Math.max(0, Math.floor(Number(s) || 0)); const m = Math.floor(sec / 60); const r = sec % 60; return `${String(m).padStart(2,'0')}:${String(r).padStart(2,'0')}`; };
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 h-full flex items-center justify-between gap-4 overflow-x-auto shadow-sm dark:shadow-none">
      <KPIStat label="Total Visitantes"     value={Number(totalVisitors     || 0).toLocaleString()} color="text-gray-900 dark:text-white" />
      <KPIStat label="Média Visitantes Dia" value={Number(avgVisitorsPerDay || 0).toLocaleString()} color="text-blue-500" />
      <KPIStat label="Tempo Médio Visita"   value={fmtDur(Number(avgVisitSeconds || 0))}            color="text-emerald-500" />
    </div>
  );
};

export const WidgetKPIStoreQuarter = ({ visitors, sales, loading }: { visitors?: number; sales?: number; loading?: boolean }) => {
  const v = Number(visitors || 0); const s = Number(sales || 0); const conv = v > 0 ? (s / v) * 100 : 0;
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 h-full flex flex-col justify-between shadow-sm dark:shadow-none">
      <h3 className="font-bold text-red-500 mb-2 uppercase text-xs tracking-wider">Loja Último Trimestre</h3>
      <div className="flex gap-2">
        <KPIStat label="Visitantes" value={loading ? '—' : v.toLocaleString()} />
        <KPIStat label="Vendas"     value={loading ? '—' : s.toLocaleString()} />
        <KPIStat label="Conversão"  value={loading ? '—' : `${conv.toFixed(1)}%`} color="text-emerald-500" />
      </div>
    </div>
  );
};

// ── Donut com Chart.js (tooltip maior, dados reais) ─────────────────────────
function ChartDonut({ labels, values, colors, title }: {
  labels: string[]; values: number[]; colors: string[]; title: string;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const total = values.reduce((a, b) => a + b, 0);

  useChartJs(canvasRef, () => {
    if (total === 0) return null;
    return {
      type: 'doughnut',
      data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 0, hoverOffset: 6 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '68%',
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: CJ.bg,
            borderColor: 'rgba(255,255,255,0.12)',
            borderWidth: 1,
            padding: { top: 10, bottom: 10, left: 14, right: 14 },
            titleFont: { size: 13, weight: 'bold' },
            bodyFont: { size: 13 },
            callbacks: {
              label: (ctx: any) => {
                const v = Number(ctx.raw);
                const pct = total > 0 ? ((v / total) * 100).toFixed(1) : '0.0';
                return `  ${ctx.label}: ${pct}%`;
              },
            },
          },
        },
      },
    };
  }, [JSON.stringify(values)]);

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative w-full" style={{ height: 160 }}>
        {total === 0
          ? <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">Sem dados</div>
          : <canvas ref={canvasRef} />}
      </div>
      {total > 0 && (
        <div className="flex flex-wrap justify-center gap-x-3 gap-y-1">
          {labels.map((l, i) => (
            <span key={i} className="flex items-center gap-1 text-[11px] text-gray-400">
              <span className="w-2.5 h-2.5 rounded-sm inline-block flex-shrink-0" style={{ background: colors[i] }} />
              {l} ({total > 0 ? ((values[i] / total) * 100).toFixed(1) : 0}%)
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export const WidgetVision = ({ attrData }: { attrData?: { label: string; value: number }[] }) => {
  const glassesPct    = Number(attrData?.find((a) => String(a.label).toLowerCase().includes('óculos'))?.value) || 0;
  const withGlasses   = Math.max(0, Math.min(100, glassesPct));
  const withoutGlasses = Math.max(0, 100 - withGlasses);
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 h-full shadow-sm dark:shadow-none">
      <h3 className="font-bold text-gray-900 dark:text-white mb-3 uppercase text-xs tracking-wider">Visão</h3>
      <ChartDonut labels={['Sem Óculos', 'Com Óculos']} values={[withoutGlasses, withGlasses]} colors={['#4b5563', '#3b82f6']} title="Visão" />
    </div>
  );
};

export const WidgetFacialHair = ({ attrData }: { attrData?: { label: string; value: number }[] }) => {
  const beardPct    = Number(attrData?.find((a) => String(a.label).toLowerCase().includes('barba'))?.value) || 0;
  const withBeard   = Math.max(0, Math.min(100, beardPct));
  const withoutBeard = Math.max(0, 100 - withBeard);
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 h-full shadow-sm dark:shadow-none">
      <h3 className="font-bold text-gray-900 dark:text-white mb-3 uppercase text-xs tracking-wider">Pelos Faciais</h3>
      <ChartDonut labels={['Sem Barba', 'Com Barba']} values={[withoutBeard, withBeard]} colors={['#6b7280', '#2563eb']} title="Pelos Faciais" />
    </div>
  );
};

// Normaliza dados que podem vir como true/false, yes/no ou categorias
function normalizeBoolOrCategory(
  data: { label: string; value: number }[] | undefined,
  trueLabel: string,
  falseLabel: string,
): { labels: string[]; values: number[] } {
  if (!data || data.length === 0) return { labels: [], values: [] };

  // Verifica se tem labels booleanas (true/false/yes/no/1/0)
  const boolKeys = new Set(['true', 'false', 'yes', 'no', '1', '0']);
  const isBool = data.every((d) => boolKeys.has(String(d.label).toLowerCase().trim()));

  if (isBool) {
    const trueVal  = data.find((d) => ['true','yes','1'].includes(String(d.label).toLowerCase()))?.value ?? 0;
    const falseVal = data.find((d) => ['false','no','0'].includes(String(d.label).toLowerCase()))?.value ?? 0;
    if (trueVal === 0 && falseVal === 0) return { labels: [], values: [] };
    // Normaliza para percentual se não estiver
    const total = trueVal + falseVal;
    const tPct = total > 0 ? Number(((trueVal / total) * 100).toFixed(1)) : 0;
    const fPct = total > 0 ? Number(((falseVal / total) * 100).toFixed(1)) : 0;
    return { labels: [trueLabel, falseLabel], values: [tPct, fPct] };
  }

  // Dados categóricos normais
  const items = data.filter((d) => Number(d.value) > 0);
  return { labels: items.map((d) => d.label), values: items.map((d) => Number(d.value)) };
}

export const WidgetHairType = ({ hairTypeData }: { hairTypeData?: { label: string; value: number }[] }) => {
  const { labels, values } = normalizeBoolOrCategory(hairTypeData, 'Com Cabelo', 'Careca/Curto');
  const colors = ['#3b82f6', '#94a3b8', '#eab308', '#ef4444', '#8b5cf6', '#10b981'];
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 h-full shadow-sm dark:shadow-none">
      <h3 className="font-bold text-gray-900 dark:text-white mb-3 uppercase text-xs tracking-wider">Tipo de Cabelo</h3>
      <ChartDonut labels={labels} values={values} colors={colors.slice(0, labels.length)} title="Tipo de Cabelo" />
    </div>
  );
};

export const WidgetHairColor = ({ hairColorData }: { hairColorData?: { label: string; value: number }[] }) => {
  const { labels, values } = normalizeBoolOrCategory(hairColorData, 'Com Cor', 'Sem Cor');
  const colorPalette = ['#1f2937', '#eab308', '#78350f', '#94a3b8', '#ef4444', '#3b82f6', '#10b981'];
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 h-full shadow-sm dark:shadow-none">
      <h3 className="font-bold text-gray-900 dark:text-white mb-3 uppercase text-xs tracking-wider">Cor de Cabelo</h3>
      <ChartDonut labels={labels} values={values} colors={colorPalette.slice(0, labels.length)} title="Cor de Cabelo" />
    </div>
  );
};

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