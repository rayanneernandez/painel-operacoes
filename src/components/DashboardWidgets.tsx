import React from 'react';
import { Activity, Clock, Users } from 'lucide-react';

// --- CHART COMPONENTS ---

export const LineChart = ({
  data,
  color,
  height = 60,
  labels,
  valueFormatter,
}: {
  data: number[];
  color: string;
  height?: number;
  labels?: string[];
  valueFormatter?: (value: number, index: number) => string;
}) => {
  const safe = data && data.length ? data : [0];
  const max = Math.max(...safe);
  const min = Math.min(...safe);
  const range = max - min || 1;

  const pts = safe.map((val, i) => {
    const x = safe.length === 1 ? 50 : (i / (safe.length - 1)) * 100;
    const y = 100 - ((val - min) / range) * 100;
    return { x, y, val };
  });

  const polyPoints = pts.map((p) => `${p.x},${p.y}`).join(' ');

  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const [hoverIdx, setHoverIdx] = React.useState<number | null>(null);
  const [mouse, setMouse] = React.useState<{ x: number; y: number } | null>(null);

  const formatValue = (v: number, i: number) => {
    if (valueFormatter) return valueFormatter(v, i);
    return Number(v).toLocaleString();
  };

  const onMove = (e: React.MouseEvent) => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width <= 0) return;
    const relX = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const idx = pts.length === 1 ? 0 : Math.round(relX * (pts.length - 1));
    setHoverIdx(idx);
    setMouse({ x: e.clientX - r.left, y: e.clientY - r.top });
  };

  const onLeave = () => { setHoverIdx(null); setMouse(null); };
  const hoverPt = hoverIdx != null ? pts[hoverIdx] : null;
  const hoverLabel = hoverIdx != null ? labels?.[hoverIdx] : undefined;

  return (
    <div ref={wrapRef} style={{ height }} className="w-full relative" onMouseMove={onMove} onMouseLeave={onLeave}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full overflow-visible">
        <polyline points={polyPoints} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" className={color} />
        {hoverPt && (
          <>
            <line x1={hoverPt.x} y1={0} x2={hoverPt.x} y2={100} stroke="rgba(148,163,184,0.35)" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
            <circle cx={hoverPt.x} cy={hoverPt.y} r={2.5} fill="currentColor" className={color} />
          </>
        )}
      </svg>
      {hoverPt && mouse && (
        <div
          className="absolute z-10 px-2 py-1 rounded-md bg-gray-950/90 text-white text-[10px] border border-gray-800 pointer-events-none"
          style={{ left: Math.min(mouse.x + 10, 260), top: Math.max(0, mouse.y - 30) }}
        >
          <div className="font-semibold">{hoverLabel ?? `#${(hoverIdx ?? 0) + 1}`}</div>
          <div>{formatValue(hoverPt.val, hoverIdx ?? 0)}</div>
        </div>
      )}
    </div>
  );
};

export const DonutChart = ({
  data,
  colors,
  showCenter = true,
  tooltipFormatter,
}: {
  data: { label: string; value: number }[];
  colors: string[];
  showCenter?: boolean;
  tooltipFormatter?: (d: { label: string; value: number }, pct: number, total: number) => string;
}) => {
  const total = data.reduce((acc, curr) => acc + curr.value, 0);
  const safeTotal = total > 0 ? total : 1;
  let accumulatedAngle = 0;

  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const [hoverTip, setHoverTip] = React.useState<string | null>(null);
  const [mouse, setMouse] = React.useState<{ x: number; y: number } | null>(null);

  const onMove = (e: React.MouseEvent) => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setMouse({ x: e.clientX - r.left, y: e.clientY - r.top });
  };

  const onLeave = () => { setHoverTip(null); setMouse(null); };

  return (
    <div ref={wrapRef} className="h-[200px] w-full relative flex items-center justify-center" onMouseMove={onMove} onMouseLeave={onLeave}>
      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90 overflow-visible">
        {data.map((d, i) => {
          const angle = (d.value / safeTotal) * 360;
          const radius = 40;
          const circumference = 2 * Math.PI * radius;
          const strokeDasharray = `${(angle / 360) * circumference} ${circumference}`;
          const strokeDashoffset = -((accumulatedAngle / 360) * circumference);
          accumulatedAngle += angle;
          const pct = (d.value / safeTotal) * 100;
          const tip = tooltipFormatter
            ? tooltipFormatter(d, pct, total)
            : `${d.label}: ${Number(d.value).toLocaleString()} (${pct.toFixed(1)}%)`;
          return (
            <circle
              key={i}
              cx="50" cy="50" r={radius}
              fill="none"
              stroke={colors[i]}
              strokeWidth="15"
              strokeDasharray={strokeDasharray}
              strokeDashoffset={strokeDashoffset}
              className="transition-all duration-1000 ease-out cursor-default"
              onMouseEnter={() => setHoverTip(tip)}
              onMouseLeave={() => setHoverTip(null)}
            />
          );
        })}
      </svg>
      {showCenter && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-2xl font-bold text-gray-900 dark:text-white">{total.toLocaleString()}</span>
          <span className="text-[10px] text-gray-500 uppercase">Total</span>
        </div>
      )}
      {hoverTip && mouse && (
        <div
          className="absolute z-10 px-2 py-1 rounded-md bg-gray-950/90 text-white text-[10px] border border-gray-800 pointer-events-none"
          style={{ left: Math.min(mouse.x + 10, 260), top: Math.max(0, mouse.y - 30) }}
        >
          {hoverTip}
        </div>
      )}
    </div>
  );
};

export const HorizontalBarChart = ({ data, color }: { data: { label: string; value: number }[]; color: string }) => {
  const max = Math.max(...data.map((d) => d.value), 1);
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = React.useState<{ label: string; value: number } | null>(null);
  const [mouse, setMouse] = React.useState<{ x: number; y: number } | null>(null);

  const onMove = (e: React.MouseEvent) => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setMouse({ x: e.clientX - r.left, y: e.clientY - r.top });
  };

  return (
    <div ref={wrapRef} className="space-y-3 w-full relative" onMouseMove={onMove} onMouseLeave={() => { setHover(null); setMouse(null); }}>
      {data.map((d, i) => (
        <div key={i} className="flex items-center gap-3 text-xs" onMouseEnter={() => setHover(d)} onMouseLeave={() => setHover(null)}>
          <span className="w-24 text-right text-gray-400 truncate">{d.label}</span>
          <div className="flex-1 bg-gray-100 dark:bg-gray-900 rounded-full h-2 relative">
            <div style={{ width: `${(d.value / max) * 100}%` }} className={`h-full rounded-full ${color} transition-all duration-1000`} />
          </div>
          <span className="w-12 text-gray-900 dark:text-white font-medium">{d.value}%</span>
        </div>
      ))}
      {hover && mouse && (
        <div
          className="absolute z-10 px-2 py-1 rounded-md bg-gray-950/90 text-white text-[10px] border border-gray-800 pointer-events-none"
          style={{ left: Math.min(mouse.x + 10, 260), top: Math.max(0, mouse.y - 30) }}
        >
          <div className="font-semibold">{hover.label}</div>
          <div>{hover.value}%</div>
        </div>
      )}
    </div>
  );
};

export const AgePyramid = ({ data: externalData, totalVisitors }: { data?: any[]; totalVisitors?: number }) => {
  const defaultData = [
    { age: '65+', m: 0, f: 0 }, { age: '55-64', m: 0, f: 0 }, { age: '45-54', m: 0, f: 0 },
    { age: '35-44', m: 0, f: 0 }, { age: '25-34', m: 0, f: 0 }, { age: '18-24', m: 0, f: 0 }, { age: '18-', m: 0, f: 0 },
  ];
  const data = externalData || defaultData;
  const maxVal = Math.max(...data.map((d) => Math.max(Number(d.m) || 0, Number(d.f) || 0)), 1);
  const base = typeof totalVisitors === 'number' && totalVisitors > 0 ? totalVisitors : null;

  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const [hoverTip, setHoverTip] = React.useState<string | null>(null);
  const [mouse, setMouse] = React.useState<{ x: number; y: number } | null>(null);

  const onMove = (e: React.MouseEvent) => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setMouse({ x: e.clientX - r.left, y: e.clientY - r.top });
  };

  return (
    <div ref={wrapRef} className="w-full flex flex-col gap-1 relative" onMouseMove={onMove} onMouseLeave={() => { setHoverTip(null); setMouse(null); }}>
      <div className="flex justify-between text-[10px] text-gray-500 px-10 mb-2">
        <span>Masculino</span><span>Feminino</span>
      </div>
      {data.map((d, i) => {
        const mPct = Number(d.m) || 0;
        const fPct = Number(d.f) || 0;
        const tPct = mPct + fPct;
        const mCnt = base != null ? Math.round((mPct / 100) * base) : null;
        const fCnt = base != null ? Math.round((fPct / 100) * base) : null;
        const tCnt = base != null ? Math.round((tPct / 100) * base) : null;
        const tip = `${d.age} | M: ${mPct}%${mCnt != null ? ` (${mCnt.toLocaleString()})` : ''} | F: ${fPct}%${fCnt != null ? ` (${fCnt.toLocaleString()})` : ''} | Total: ${tPct}%${tCnt != null ? ` (${tCnt.toLocaleString()})` : ''}`;
        return (
          <div key={i} className="flex items-center h-6 w-full">
            <div className="flex-1 flex justify-end pr-2">
              <div style={{ width: `${(mPct / maxVal) * 100}%` }} className="h-4 bg-blue-600 rounded-l-sm transition-all hover:bg-blue-500" onMouseEnter={() => setHoverTip(tip)} onMouseLeave={() => setHoverTip(null)} />
            </div>
            <span className="w-12 text-center text-[10px] text-gray-400">{d.age}</span>
            <div className="flex-1 pl-2">
              <div style={{ width: `${(fPct / maxVal) * 100}%` }} className="h-4 bg-pink-600 rounded-r-sm transition-all hover:bg-pink-500" onMouseEnter={() => setHoverTip(tip)} onMouseLeave={() => setHoverTip(null)} />
            </div>
          </div>
        );
      })}
      {hoverTip && mouse && (
        <div className="absolute z-10 px-2 py-1 rounded-md bg-gray-950/90 text-white text-[10px] border border-gray-800 pointer-events-none" style={{ left: Math.min(mouse.x + 10, 300), top: Math.max(0, mouse.y - 30) }}>
          {hoverTip}
        </div>
      )}
    </div>
  );
};

export const VerticalBarChart = ({ data, colors, height = 150 }: { data: { label: string; values: number[] }[]; colors: string[]; height?: number }) => {
  const allValues = data.flatMap((d) => d.values);
  const max = Math.max(...allValues, 1);

  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const [hoverTip, setHoverTip] = React.useState<string | null>(null);
  const [mouse, setMouse] = React.useState<{ x: number; y: number } | null>(null);

  const onMove = (e: React.MouseEvent) => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setMouse({ x: e.clientX - r.left, y: e.clientY - r.top });
  };

  return (
    <div ref={wrapRef} style={{ height }} className="w-full flex items-end justify-between gap-2 relative" onMouseMove={onMove} onMouseLeave={() => { setHoverTip(null); setMouse(null); }}>
      {data.map((d, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-1 group">
          <div className="flex items-end justify-center gap-1 w-full h-full relative">
            {d.values.map((v, idx) => (
              <div
                key={idx}
                style={{ height: `${(v / max) * 100}%` }}
                className={`flex-1 rounded-t-sm transition-all duration-500 relative group-hover:opacity-80 ${colors[idx % colors.length]}`}
                onMouseEnter={() => setHoverTip(`${d.label}: ${Number(v).toLocaleString()}`)}
                onMouseLeave={() => setHoverTip(null)}
              />
            ))}
          </div>
          <span className="text-[10px] text-gray-500 truncate w-full text-center">{d.label}</span>
        </div>
      ))}
      {hoverTip && mouse && (
        <div className="absolute z-10 px-2 py-1 rounded-md bg-gray-950/90 text-white text-[10px] border border-gray-800 pointer-events-none" style={{ left: Math.min(mouse.x + 10, 300), top: Math.max(0, mouse.y - 30) }}>
          {hoverTip}
        </div>
      )}
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

// ── WidgetSalesQuarter — gráfico de barras com Chart.js ─────────────────────
// Usa Chart.js via CDN (carregado no index.html). Exibe visitantes por mês
// dos últimos 3 meses e vendas (quando disponíveis) em eixo secundário.
export const WidgetSalesQuarter = ({
  quarterData,
  loading,
}: {
  quarterData?: { label: string; visitors: number; sales: number }[];
  loading?: boolean;
}) => {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const chartRef  = React.useRef<any>(null);

  const data = Array.isArray(quarterData) && quarterData.length
    ? quarterData
    : [];

  React.useEffect(() => {
    if (!canvasRef.current) return;
    if (data.length === 0) return;

    // Chart.js deve estar disponível globalmente (carregado via <script> no index.html)
    const ChartJs = (window as any).Chart;
    if (!ChartJs) {
      console.warn('[WidgetSalesQuarter] Chart.js não encontrado no window. Adicione o script no index.html.');
      return;
    }

    // Destroi instância anterior
    if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }

    const labels   = data.map((d) => d.label);
    const visitors = data.map((d) => Number(d.visitors) || 0);
    const sales    = data.map((d) => Number(d.sales) || 0);
    const hasSales = sales.some((v) => v > 0);

    const C_VISITORS = '#1D9E75';
    const C_SALES    = '#378ADD';
    const C_GRID     = 'rgba(255,255,255,0.07)';
    const C_LABEL    = '#888780';

    chartRef.current = new ChartJs(canvasRef.current, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Visitantes',
            data: visitors,
            backgroundColor: C_VISITORS,
            borderRadius: 4,
            borderSkipped: false,
            yAxisID: 'yVisitors',
            order: 2,
          },
          ...(hasSales
            ? [{
                label: 'Vendas',
                data: sales,
                backgroundColor: C_SALES,
                borderRadius: 4,
                borderSkipped: false,
                yAxisID: 'ySales',
                order: 1,
              }]
            : []),
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx: any) => ` ${ctx.dataset.label}: ${Number(ctx.raw).toLocaleString('pt-BR')}`,
            },
          },
        },
        scales: {
          x: {
            grid: { color: C_GRID },
            ticks: { color: C_LABEL, font: { size: 12 }, autoSkip: false, maxRotation: 0 },
          },
          yVisitors: {
            position: 'left',
            beginAtZero: true,
            grid: { color: C_GRID },
            ticks: {
              color: C_VISITORS,
              font: { size: 11 },
              callback: (v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v),
            },
          },
          ...(hasSales
            ? {
                ySales: {
                  position: 'right',
                  beginAtZero: true,
                  grid: { drawOnChartArea: false },
                  ticks: {
                    color: C_SALES,
                    font: { size: 11 },
                    callback: (v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v),
                  },
                },
              }
            : {}),
        },
      },
    });

    return () => { chartRef.current?.destroy(); chartRef.current = null; };
  }, [data]);

  const totalVisitors = data.reduce((a, b) => a + (Number(b.visitors) || 0), 0);
  const totalSales    = data.reduce((a, b) => a + (Number(b.sales)    || 0), 0);
  const hasSales      = totalSales > 0;

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 h-full shadow-sm dark:shadow-none flex flex-col gap-3">
      <h3 className="font-bold text-gray-900 dark:text-white uppercase text-xs tracking-wider">
        Total Visitantes vs Vendas — Último Trimestre
      </h3>

      {/* Legenda */}
      <div className="flex gap-4 text-[10px] text-gray-500">
        <span className="flex items-center gap-1">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: '#1D9E75' }} />
          Visitantes{' '}
          <strong className="text-white">{loading ? '…' : totalVisitors.toLocaleString('pt-BR')}</strong>
        </span>
        {hasSales && (
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: '#378ADD' }} />
            Vendas <strong className="text-white">{totalSales.toLocaleString('pt-BR')}</strong>
          </span>
        )}
      </div>

      {/* Canvas */}
      <div className="relative w-full" style={{ height: 200 }}>
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">Carregando...</div>
        ) : data.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">Sem dados no trimestre</div>
        ) : (
          <canvas ref={canvasRef} />
        )}
      </div>
    </div>
  );
};

// --- WIDGET DEFINITIONS ---

export type WidgetType = {
  id: string;
  title: string;
  type: 'chart' | 'table' | 'kpi';
  size: 'full' | 'half' | 'third' | 'quarter' | '2/3';
  description: string;
};

export const AVAILABLE_WIDGETS: WidgetType[] = [
  { id: 'kpi_flow_stats',             title: 'Resumo de Fluxo',                      type: 'kpi',   size: 'full',    description: 'Total Visitantes, Média Dia, Tempo Médio' },
  { id: 'kpi_store_quarter',          title: 'Loja Último Trimestre',                type: 'kpi',   size: 'half',    description: 'KPIs de Visitantes, Vendas e Conversão' },
  { id: 'kpi_store_period',           title: 'Loja Período',                         type: 'kpi',   size: 'half',    description: 'KPIs de Visitantes, Vendas e Conversão (Período)' },
  { id: 'flow_trend',                 title: 'Tendências de Fluxo (Semanal)',        type: 'chart', size: 'half',    description: 'Gráfico de linha com fluxo diário' },
  { id: 'hourly_flow',                title: 'Fluxo por Hora',                       type: 'chart', size: 'half',    description: 'Gráfico de linha com média horária' },
  { id: 'chart_sales_quarter',        title: 'Visitantes vs Vendas (Trimestre)',     type: 'chart', size: 'half',    description: 'Comparativo mensal de conversão' },
  { id: 'chart_sales_daily',          title: 'Visitantes vs Vendas (Diário)',        type: 'chart', size: 'half',    description: 'Linha do tempo diária de conversão' },
  { id: 'chart_sales_period_bar',     title: 'Visitantes vs Vendas (Período Barras)',type: 'chart', size: 'half',    description: 'Comparativo por período agrupado' },
  { id: 'chart_sales_period_line',    title: 'Visitantes vs Vendas (Período Linha)', type: 'chart', size: 'half',    description: 'Tendência comparativa entre períodos' },
  { id: 'conversion',                 title: 'Taxa de Conversão',                   type: 'kpi',   size: 'quarter', description: 'KPI simples de conversão de vendas' },
  { id: 'chart_attention_conversion', title: 'Atenção Possível Conversão',           type: 'chart', size: 'quarter', description: 'Donut chart de níveis de atenção' },
  { id: 'chart_kibon_vert_quarter',   title: 'Kibon Vertical (Trimestre)',           type: 'chart', size: 'half',    description: 'Contatos Freezer Vertical Último Trimestre' },
  { id: 'chart_kibon_vert_period',    title: 'Kibon Vertical (Período)',             type: 'chart', size: 'half',    description: 'Contatos Freezer Vertical Período' },
  { id: 'chart_kibon_horiz_quarter',  title: 'Kibon Horizontal (Trimestre)',         type: 'chart', size: 'half',    description: 'Contatos Freezer Horizontal Último Trimestre' },
  { id: 'chart_kibon_horiz_period',   title: 'Kibon Horizontal (Período)',           type: 'chart', size: 'half',    description: 'Contatos Freezer Horizontal Período' },
  { id: 'age_pyramid',                title: 'Pirâmide Etária',                     type: 'chart', size: 'third',   description: 'Distribuição demográfica por idade/gênero' },
  { id: 'chart_age_ranges',           title: 'Faixa Etária (Barras)',               type: 'chart', size: 'third',   description: 'Distribuição por faixas etárias detalhadas' },
  { id: 'gender_dist',                title: 'Distribuição de Gênero',              type: 'chart', size: 'third',   description: 'Gráfico de rosca: Masculino vs Feminino' },
  { id: 'chart_vision',               title: 'Atributo: Visão',                     type: 'chart', size: 'third',   description: 'Uso de óculos (Normais/Escuros)' },
  { id: 'chart_facial_hair',          title: 'Atributo: Pelos Faciais',             type: 'chart', size: 'third',   description: 'Barba, Bigode, etc.' },
  { id: 'chart_hair_type',            title: 'Atributo: Tipo de Cabelo',            type: 'chart', size: 'third',   description: 'Longo, Curto, Careca' },
  { id: 'chart_hair_color',           title: 'Atributo: Cor de Cabelo',             type: 'chart', size: 'third',   description: 'Preto, Loiro, Castanho' },
  { id: 'attributes',                 title: 'Atributos Gerais',                    type: 'chart', size: 'third',   description: 'Resumo de atributos principais' },
  { id: 'journey',                    title: 'Jornada do Cliente',                  type: 'chart', size: 'third',   description: 'Funil de pontos de passagem' },
  { id: 'campaigns',                  title: 'Engajamento em Campanhas',            type: 'table', size: '2/3',     description: 'Tabela de performance de campanhas' },
  { id: 'heatmap',                    title: 'Mapa de Calor (Loja)',               type: 'chart', size: 'full',    description: 'Visualização térmica da planta baixa' },
];

// --- WIDGET COMPONENTS ---

export const WidgetFlowTrend = ({ view, dailyData }: { view: string; dailyData?: number[] }) => {
  const data = dailyData && dailyData.length ? dailyData : [0, 0, 0, 0, 0, 0, 0];
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 h-full shadow-sm dark:shadow-none">
      <h3 className="font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2 uppercase text-xs tracking-wider">
        <Activity size={14} className="text-blue-500" />
        Média Visitantes Dia - {view === 'network' ? 'Rede' : 'Dia da Semana'}
      </h3>
      <LineChart data={data} color="text-blue-500" height={100} labels={['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab', 'Dom']} valueFormatter={(v) => `${Number(v).toLocaleString()} visitantes`} />
      <div className="flex justify-between text-[10px] text-gray-500 mt-2 uppercase">
        <span>Seg</span><span>Ter</span><span>Qua</span><span>Qui</span><span>Sex</span><span>Sab</span><span>Dom</span>
      </div>
    </div>
  );
};

export const WidgetHourlyFlow = ({ view, hourlyData }: { view: string; hourlyData?: number[] }) => {
  const data = hourlyData && hourlyData.length ? hourlyData : new Array(24).fill(0);
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 h-full shadow-sm dark:shadow-none">
      <h3 className="font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2 uppercase text-xs tracking-wider">
        <Clock size={14} className="text-emerald-500" />
        Média Visitantes por Hora {view === 'network' ? '(Rede)' : ''}
      </h3>
      <LineChart data={data} color="text-emerald-500" height={100} labels={Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}h`)} valueFormatter={(v, i) => `${String(i).padStart(2, '0')}h: ${Number(v).toLocaleString()} visitantes`} />
      <div className="flex justify-between text-[10px] text-gray-500 mt-2">
        <span>06h</span><span>09h</span><span>12h</span><span>15h</span><span>18h</span><span>21h</span>
      </div>
    </div>
  );
};

export const WidgetAgePyramid = ({ view, ageData, totalVisitors }: { view: string; ageData?: any[]; totalVisitors?: number }) => (
  <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6 h-full shadow-sm dark:shadow-none">
    <h3 className="font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2 uppercase text-sm tracking-wider">
      <Users size={16} className="text-purple-500" />
      Pirâmide Etária {view === 'network' ? '(Consolidado)' : ''}
    </h3>
    <AgePyramid data={ageData} totalVisitors={totalVisitors} />
  </div>
);

export const WidgetGenderDist = ({ view, genderData, totalVisitors }: { view: string; genderData?: { label: string; value: number }[]; totalVisitors?: number }) => {
  const fallback = [{ label: 'Masculino', value: 0 }, { label: 'Feminino', value: 0 }];
  const data = genderData && genderData.length === 2 ? genderData : fallback;
  const maleRaw   = Number(data[0]?.value) || 0;
  const femaleRaw = Number(data[1]?.value) || 0;
  const sum = maleRaw + femaleRaw;
  const totalCount = typeof totalVisitors === 'number' && totalVisitors > 0 ? totalVisitors : null;
  const isPct = totalCount != null && sum > 0 && sum <= 101;
  const malePct   = isPct ? Math.round(maleRaw)   : Math.round((maleRaw   / (sum || 1)) * 100);
  const femalePct = isPct ? Math.round(femaleRaw) : Math.round((femaleRaw / (sum || 1)) * 100);
  const maleCount   = totalCount != null ? Math.round((malePct   / 100) * totalCount) : (isPct ? null : Math.round(maleRaw));
  const femaleCount = totalCount != null ? Math.round((femalePct / 100) * totalCount) : (isPct ? null : Math.round(femaleRaw));

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6 h-full shadow-sm dark:shadow-none">
      <h3 className="font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2 uppercase text-sm tracking-wider">
        <Users size={16} className="text-pink-500" />
        Gênero {view === 'network' ? '(Consolidado)' : ''}
      </h3>
      <DonutChart
        data={data}
        colors={['#1e40af', '#db2777']}
        showCenter={false}
        tooltipFormatter={(d, pct) => {
          const p = isPct ? d.value : pct;
          const pFmt = `${Number(p).toFixed(1)}%`;
          if (d.label.toLowerCase().includes('masc')) return `${d.label}: ${pFmt}${maleCount != null ? ` (${maleCount.toLocaleString()})` : ''}`;
          return `${d.label}: ${pFmt}${femaleCount != null ? ` (${femaleCount.toLocaleString()})` : ''}`;
        }}
      />
      <div className="flex justify-center gap-4 mt-4 text-xs">
        <span className="flex items-center gap-1 text-gray-400"><div className="w-2 h-2 bg-blue-800 rounded-full" /> Masculino ({malePct}%{maleCount != null ? ` • ${maleCount.toLocaleString()}` : ''})</span>
        <span className="flex items-center gap-1 text-gray-400"><div className="w-2 h-2 bg-pink-600 rounded-full" /> Feminino ({femalePct}%{femaleCount != null ? ` • ${femaleCount.toLocaleString()}` : ''})</span>
      </div>
    </div>
  );
};

export const WidgetAttributes = ({ view, attrData }: { view: string; attrData?: { label: string; value: number }[] }) => {
  const data = attrData && attrData.length
    ? attrData
    : [{ label: 'Óculos', value: 0 }, { label: 'Barba', value: 0 }, { label: 'Máscara', value: 0 }, { label: 'Chapéu/Boné', value: 0 }];
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6 h-full shadow-sm dark:shadow-none">
      <h3 className="font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2 uppercase text-sm tracking-wider">
        <Users size={16} className="text-orange-500" />
        Atributos {view === 'network' ? '(Consolidado)' : ''}
      </h3>
      <HorizontalBarChart data={data} color="bg-orange-500" />
    </div>
  );
};

export const WidgetCampaigns = ({ view }: { view: string }) => (
  <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6 h-full shadow-sm dark:shadow-none">
    <h3 className="font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2 uppercase text-sm tracking-wider">
      <Activity size={16} className="text-emerald-500" />
      Engajamento em Campanhas {view === 'network' ? '(Rede)' : ''}
    </h3>
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs text-gray-500 dark:text-gray-400">
        <thead className="text-gray-500 uppercase border-b border-gray-200 dark:border-gray-800">
          <tr>
            <th className="pb-2 font-medium">Campanha</th>
            <th className="pb-2 font-medium">Início</th>
            <th className="pb-2 font-medium">Visitantes</th>
            <th className="pb-2 font-medium">Tempo Médio</th>
            <th className="pb-2 font-medium">Atenção</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 dark:divide-gray-800" />
      </table>
    </div>
  </div>
);

export const WidgetKPIFlowStats = ({ totalVisitors, avgVisitorsPerDay, avgVisitSeconds }: { totalVisitors?: number; avgVisitorsPerDay?: number; avgVisitSeconds?: number }) => {
  const fmtDur = (s: number) => {
    const sec = Math.max(0, Math.floor(Number(s) || 0));
    const m = Math.floor(sec / 60);
    const r = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  };
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 h-full flex items-center justify-between gap-4 overflow-x-auto shadow-sm dark:shadow-none">
      <KPIStat label="Total Visitantes"    value={Number(totalVisitors     || 0).toLocaleString()} color="text-gray-900 dark:text-white" />
      <KPIStat label="Média Visitantes Dia" value={Number(avgVisitorsPerDay || 0).toLocaleString()} color="text-blue-500" />
      <KPIStat label="Tempo Médio Visita"  value={fmtDur(Number(avgVisitSeconds || 0))}             color="text-emerald-500" />
    </div>
  );
};

export const WidgetKPIStoreQuarter = ({ visitors, sales, loading }: { visitors?: number; sales?: number; loading?: boolean }) => {
  const v = Number(visitors || 0);
  const s = Number(sales || 0);
  const conv = v > 0 ? (s / v) * 100 : 0;
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

export const WidgetKPIStorePeriod = ({ visitors, sales, loading }: { visitors?: number; sales?: number; loading?: boolean }) => {
  const v = Number(visitors || 0);
  const s = Number(sales || 0);
  const conv = v > 0 ? (s / v) * 100 : 0;
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 h-full flex flex-col justify-between shadow-sm dark:shadow-none">
      <h3 className="font-bold text-red-500 mb-2 uppercase text-xs tracking-wider">Loja Período</h3>
      <div className="flex gap-2">
        <KPIStat label="Visitantes" value={loading ? '—' : v.toLocaleString()} />
        <KPIStat label="Vendas"     value={loading ? '—' : s.toLocaleString()} />
        <KPIStat label="Conversão"  value={loading ? '—' : `${conv.toFixed(1)}%`} color="text-emerald-500" />
      </div>
    </div>
  );
};

export const WidgetSalesDaily = ({ labels, visitors, loading }: { labels?: string[]; visitors?: number[]; loading?: boolean }) => (
  <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 h-full shadow-sm dark:shadow-none">
    <h3 className="font-bold text-gray-900 dark:text-white mb-4 uppercase text-xs tracking-wider">Total Visitantes vs Vendas por Dia</h3>
    <LineChart data={(visitors || []).length ? (visitors as number[]) : [0]} labels={labels} color="text-blue-500" height={100} />
    <div className="flex justify-center gap-4 mt-2 text-[10px] text-gray-500">
      <span className="flex items-center gap-1"><div className="w-2 h-2 bg-blue-500 rounded-full" /> {loading ? 'Visitantes (carregando...)' : 'Visitantes'}</span>
    </div>
  </div>
);

export const WidgetSalesPeriodBar = ({ periodData, loading }: { periodData?: { label: string; visitors: number; sales: number }[]; loading?: boolean }) => (
  <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 h-full shadow-sm dark:shadow-none">
    <h3 className="font-bold text-gray-900 dark:text-white mb-4 uppercase text-xs tracking-wider">Total Visitantes vs Vendas por Período</h3>
    <VerticalBarChart
      data={(periodData || []).length
        ? (periodData as any[]).map((d) => ({ label: d.label, values: [Number(d.visitors) || 0, Number(d.sales) || 0] }))
        : [{ label: '—', values: [0, 0] }, { label: '—', values: [0, 0] }, { label: '—', values: [0, 0] }, { label: '—', values: [0, 0] }]}
      colors={['bg-blue-500', 'bg-blue-900']}
      height={120}
    />
    <div className="flex justify-center gap-4 mt-2 text-[10px] text-gray-500">
      <span className="flex items-center gap-1"><div className="w-2 h-2 bg-blue-500 rounded-full" /> {loading ? 'Visitantes (carregando...)' : 'Visitantes'}</span>
      <span className="flex items-center gap-1"><div className="w-2 h-2 bg-blue-900 rounded-full" /> {loading ? 'Vendas (carregando...)' : 'Vendas'}</span>
    </div>
  </div>
);

export const WidgetSalesPeriodLine = ({ labels, current, previous, loading }: { labels?: string[]; current?: number[]; previous?: number[]; loading?: boolean }) => (
  <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 h-full shadow-sm dark:shadow-none">
    <h3 className="font-bold text-gray-900 dark:text-white mb-4 uppercase text-xs tracking-wider">Total Visitantes vs Vendas (Comparativo)</h3>
    <div className="relative h-[100px]">
      <div className="absolute inset-0 opacity-50"><LineChart data={(previous || []).length ? (previous as number[]) : [0]} labels={labels} color="text-blue-300" height={100} /></div>
      <div className="absolute inset-0"><LineChart data={(current || []).length ? (current as number[]) : [0]} labels={labels} color="text-blue-600" height={100} /></div>
    </div>
    <div className="flex justify-center gap-4 mt-2 text-[10px] text-gray-500">
      <span className="flex items-center gap-1"><div className="w-2 h-2 bg-blue-300 rounded-full" /> {loading ? 'Período anterior (carregando...)' : 'Período anterior'}</span>
      <span className="flex items-center gap-1"><div className="w-2 h-2 bg-blue-600 rounded-full" /> {loading ? 'Período atual (carregando...)' : 'Período atual'}</span>
    </div>
  </div>
);

export const WidgetFreezerVerticalQuarter = () => (
  <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 h-full shadow-sm dark:shadow-none">
    <h3 className="font-bold text-red-500 mb-4 uppercase text-xs tracking-wider">Kibon Último Trimestre (Freezer Vertical)</h3>
    <div className="h-[120px] flex items-center justify-center text-gray-500 text-sm">Sem dados</div>
  </div>
);

export const WidgetFreezerHorizontalQuarter = () => (
  <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 h-full shadow-sm dark:shadow-none">
    <h3 className="font-bold text-red-500 mb-4 uppercase text-xs tracking-wider">Kibon Último Trimestre (Freezer Horizontal)</h3>
    <div className="h-[120px] flex items-center justify-center text-gray-500 text-sm">Sem dados</div>
  </div>
);

export const WidgetAgeRanges = ({ ageData }: { ageData?: { age: string; m: number; f: number }[] }) => {
  const order = ['18-', '18-24', '25-34', '35-44', '45-54', '55-64', '65+'];
  const byAge = new Map((ageData || []).map((d) => [String(d.age), d]));
  const chartData = order.map((age) => {
    const d = byAge.get(age);
    return { label: age, values: [(Number(d?.m) || 0) + (Number(d?.f) || 0)] };
  });
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6 h-full shadow-sm dark:shadow-none">
      <h3 className="font-bold text-gray-900 dark:text-white mb-4 uppercase text-sm tracking-wider">Faixa Etária</h3>
      <VerticalBarChart data={chartData} colors={['bg-blue-500']} height={150} />
    </div>
  );
};

export const WidgetVision = ({ attrData }: { attrData?: { label: string; value: number }[] }) => {
  const glassesPct = Number(attrData?.find((a) => String(a.label).toLowerCase().includes('óculos'))?.value) || 0;
  const withGlasses    = Math.max(0, Math.min(100, glassesPct));
  const withoutGlasses = Math.max(0, 100 - withGlasses);
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6 h-full shadow-sm dark:shadow-none">
      <h3 className="font-bold text-gray-900 dark:text-white mb-4 uppercase text-sm tracking-wider">Visão</h3>
      <DonutChart data={[{ label: 'Sem Óculos', value: withoutGlasses }, { label: 'Com Óculos', value: withGlasses }]} colors={['#e5e7eb', '#3b82f6']} showCenter={false} />
    </div>
  );
};

export const WidgetFacialHair = ({ attrData }: { attrData?: { label: string; value: number }[] }) => {
  const beardPct = Number(attrData?.find((a) => String(a.label).toLowerCase().includes('barba'))?.value) || 0;
  const withBeard    = Math.max(0, Math.min(100, beardPct));
  const withoutBeard = Math.max(0, 100 - withBeard);
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6 h-full shadow-sm dark:shadow-none">
      <h3 className="font-bold text-gray-900 dark:text-white mb-4 uppercase text-sm tracking-wider">Pelos Faciais</h3>
      <DonutChart data={[{ label: 'Sem Barba', value: withoutBeard }, { label: 'Com Barba', value: withBeard }]} colors={['#fca5a5', '#3b82f6']} showCenter={false} />
    </div>
  );
};

export const WidgetHairType = ({ hairTypeData }: { hairTypeData?: { label: string; value: number }[] }) => {
  const has = Array.isArray(hairTypeData) && hairTypeData.some((d) => Number(d.value) > 0);
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6 h-full shadow-sm dark:shadow-none">
      <h3 className="font-bold text-gray-900 dark:text-white mb-4 uppercase text-sm tracking-wider">Tipo de Cabelo</h3>
      {has
        ? <DonutChart data={hairTypeData as any} colors={['#3b82f6', '#eab308', '#ef4444', '#94a3b8']} showCenter={false} />
        : <div className="h-[160px] flex items-center justify-center text-gray-500 text-sm">Sem dados</div>}
    </div>
  );
};

export const WidgetHairColor = ({ hairColorData }: { hairColorData?: { label: string; value: number }[] }) => {
  const has = Array.isArray(hairColorData) && hairColorData.some((d) => Number(d.value) > 0);
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6 h-full shadow-sm dark:shadow-none">
      <h3 className="font-bold text-gray-900 dark:text-white mb-4 uppercase text-sm tracking-wider">Cor de Cabelo</h3>
      {has
        ? <DonutChart data={hairColorData as any} colors={['#1f2937', '#eab308', '#78350f', '#94a3b8']} showCenter={false} />
        : <div className="h-[160px] flex items-center justify-center text-gray-500 text-sm">Sem dados</div>}
    </div>
  );
};

export const WidgetAttentionConversion = () => (
  <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6 h-full shadow-sm dark:shadow-none">
    <h3 className="font-bold text-gray-900 dark:text-white mb-4 uppercase text-sm tracking-wider">Atenção Possível Conversão</h3>
    <div className="h-[160px] flex items-center justify-center text-gray-500 text-sm">Sem dados</div>
  </div>
);

export const WidgetJourneyPoints = () => (
  <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6 h-full shadow-sm dark:shadow-none">
    <h3 className="font-bold text-gray-900 dark:text-white mb-4 uppercase text-sm tracking-wider">Pontos Jornada</h3>
    <div className="h-[160px] flex items-center justify-center text-gray-500 text-sm">Sem dados</div>
  </div>
);

export const WIDGET_MAP: Record<string, React.FC<any>> = {
  'flow_trend':                 WidgetFlowTrend,
  'hourly_flow':                WidgetHourlyFlow,
  'age_pyramid':                WidgetAgePyramid,
  'gender_dist':                WidgetGenderDist,
  'attributes':                 WidgetAttributes,
  'campaigns':                  WidgetCampaigns,
  'kpi_flow_stats':             WidgetKPIFlowStats,
  'kpi_store_quarter':          WidgetKPIStoreQuarter,
  'kpi_store_period':           WidgetKPIStorePeriod,
  'chart_sales_quarter':        WidgetSalesQuarter,      // ← usa Chart.js agora
  'chart_sales_daily':          WidgetSalesDaily,
  'chart_sales_period_bar':     WidgetSalesPeriodBar,
  'chart_sales_period_line':    WidgetSalesPeriodLine,
  'chart_kibon_vert_quarter':   WidgetFreezerVerticalQuarter,
  'chart_kibon_vert_period':    WidgetFreezerVerticalQuarter,
  'chart_kibon_horiz_quarter':  WidgetFreezerHorizontalQuarter,
  'chart_kibon_horiz_period':   WidgetFreezerHorizontalQuarter,
  'chart_age_ranges':           WidgetAgeRanges,
  'chart_vision':               WidgetVision,
  'chart_facial_hair':          WidgetFacialHair,
  'chart_hair_type':            WidgetHairType,
  'chart_hair_color':           WidgetHairColor,
  'chart_attention_conversion': WidgetAttentionConversion,
  'journey':                    WidgetJourneyPoints,
  'heatmap':    () => <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 h-full flex items-center justify-center text-gray-500">Mapa de Calor (Em breve)</div>,
  'conversion': () => <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 h-full flex items-center justify-center text-gray-500">Taxa de Conversão (Em breve)</div>,
};