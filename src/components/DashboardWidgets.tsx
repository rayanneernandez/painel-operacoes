import React from 'react';
import { Activity, Clock, Users } from 'lucide-react';

// --- CHART COMPONENTS ---

export const LineChart = ({ data, color, height = 60 }: { data: number[], color: string, height?: number }) => {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const points = data.map((val, i) => {
    const x = (i / (data.length - 1)) * 100;
    const y = 100 - ((val - min) / range) * 100;
    return `${x},${y}`;
  }).join(' ');

  return (
    <div style={{ height }} className="w-full relative">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full overflow-visible">
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" className={color} />
      </svg>
    </div>
  );
};

export const DonutChart = ({ data, colors }: { data: { label: string, value: number }[], colors: string[] }) => {
  const total = data.reduce((acc, curr) => acc + curr.value, 0);
  let accumulatedAngle = 0;

  return (
    <div className="h-[200px] w-full relative flex items-center justify-center">
       <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90 overflow-visible">
         {data.map((d, i) => {
           const angle = (d.value / total) * 360;
           const radius = 40;
           const circumference = 2 * Math.PI * radius;
           const strokeDasharray = `${(angle / 360) * circumference} ${circumference}`;
           const strokeDashoffset = -((accumulatedAngle / 360) * circumference);
           accumulatedAngle += angle;
           return (
             <circle 
               key={i}
               cx="50" 
               cy="50" 
               r={radius} 
               fill="none" 
               stroke={colors[i]} 
               strokeWidth="15" 
               strokeDasharray={strokeDasharray} 
               strokeDashoffset={strokeDashoffset} 
               className="transition-all duration-1000 ease-out"
             />
           );
         })}
       </svg>
       <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-2xl font-bold text-gray-900 dark:text-white">{total.toLocaleString()}</span>
          <span className="text-[10px] text-gray-500 uppercase">Total</span>
       </div>
    </div>
  );
};

export const HorizontalBarChart = ({ data, color }: { data: { label: string, value: number }[], color: string }) => {
  const max = Math.max(...data.map(d => d.value));
  return (
    <div className="space-y-3 w-full">
      {data.map((d, i) => (
        <div key={i} className="flex items-center gap-3 text-xs">
           <span className="w-24 text-right text-gray-400 truncate">{d.label}</span>
           <div className="flex-1 bg-gray-100 dark:bg-gray-900 rounded-full h-2 relative">
             <div 
               style={{ width: `${(d.value / max) * 100}%` }} 
               className={`h-full rounded-full ${color} transition-all duration-1000`}
             />
           </div>
           <span className="w-12 text-gray-900 dark:text-white font-medium">{d.value}%</span>
        </div>
      ))}
    </div>
  );
};

export const AgePyramid = ({ data: externalData }: { data?: any[] }) => {
  const defaultData = [
    { age: '65+', m: 0, f: 0 },
    { age: '55-64', m: 0, f: 0 },
    { age: '45-54', m: 0, f: 0 },
    { age: '35-44', m: 0, f: 0 },
    { age: '25-34', m: 0, f: 0 },
    { age: '18-24', m: 0, f: 0 },
    { age: '18-', m: 0, f: 0 },
  ];
  
  const data = externalData || defaultData;
  
  // Calculate max value for relative width
  const maxVal = Math.max(
     ...data.map(d => Math.max(d.m, d.f)),
     1 // Avoid division by zero
  );

  return (
    <div className="w-full flex flex-col gap-1">
      <div className="flex justify-between text-[10px] text-gray-500 px-10 mb-2">
         <span>Masculino</span>
         <span>Feminino</span>
      </div>
      {data.map((d, i) => (
        <div key={i} className="flex items-center h-6 w-full">
          <div className="flex-1 flex justify-end pr-2">
             <div style={{ width: `${(d.m / maxVal) * 100}%` }} className="h-4 bg-blue-600 rounded-l-sm transition-all hover:bg-blue-500" />
          </div>
          <span className="w-12 text-center text-[10px] text-gray-400">{d.age}</span>
          <div className="flex-1 pl-2">
             <div style={{ width: `${(d.f / maxVal) * 100}%` }} className="h-4 bg-pink-600 rounded-r-sm transition-all hover:bg-pink-500" />
          </div>
        </div>
      ))}
    </div>
  );
};

export const VerticalBarChart = ({ data, colors, height = 150 }: { data: { label: string, values: number[] }[], colors: string[], height?: number }) => {
  const allValues = data.flatMap(d => d.values);
  const max = Math.max(...allValues, 1);
  
  return (
    <div style={{ height }} className="w-full flex items-end justify-between gap-2">
      {data.map((d, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-1 group">
          <div className="flex items-end justify-center gap-1 w-full h-full relative">
             {d.values.map((v, idx) => (
               <div 
                 key={idx}
                 style={{ height: `${(v / max) * 100}%` }}
                 className={`flex-1 rounded-t-sm transition-all duration-500 relative group-hover:opacity-80 ${colors[idx % colors.length]}`}
               />
             ))}
          </div>
          <span className="text-[10px] text-gray-500 truncate w-full text-center">{d.label}</span>
        </div>
      ))}
    </div>
  );
};

export const KPIStat = ({ label, value, subvalue, color = "text-gray-900 dark:text-white" }: { label: string, value: string, subvalue?: string, color?: string }) => (
  <div className="bg-gray-50 dark:bg-gray-950/50 rounded-lg p-3 border border-gray-200 dark:border-gray-800 flex flex-col items-center justify-center text-center flex-1 min-w-[100px]">
    <span className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">{label}</span>
    <span className={`text-xl font-bold ${color}`}>{value}</span>
    {subvalue && <span className="text-[10px] text-gray-400 mt-1">{subvalue}</span>}
  </div>
);

// --- WIDGET DEFINITIONS ---

export type WidgetType = {
  id: string;
  title: string;
  type: 'chart' | 'table' | 'kpi';
  size: 'full' | 'half' | 'third' | 'quarter' | '2/3';
  description: string;
};

export const AVAILABLE_WIDGETS: WidgetType[] = [
  // KPIs
  { id: 'kpi_flow_stats', title: 'Resumo de Fluxo', type: 'kpi', size: 'full', description: 'Total Visitantes, Média Dia, Tempo Médio' },
  { id: 'kpi_store_quarter', title: 'Loja Último Trimestre', type: 'kpi', size: 'half', description: 'KPIs de Visitantes, Vendas e Conversão' },
  { id: 'kpi_store_period', title: 'Loja Período', type: 'kpi', size: 'half', description: 'KPIs de Visitantes, Vendas e Conversão (Período)' },
  
  // Sales & Traffic
  { id: 'flow_trend', title: 'Tendências de Fluxo (Semanal)', type: 'chart', size: 'half', description: 'Gráfico de linha com fluxo diário' },
  { id: 'hourly_flow', title: 'Fluxo por Hora', type: 'chart', size: 'half', description: 'Gráfico de linha com média horária' },
  { id: 'chart_sales_quarter', title: 'Visitantes vs Vendas (Trimestre)', type: 'chart', size: 'half', description: 'Comparativo mensal de conversão' },
  { id: 'chart_sales_daily', title: 'Visitantes vs Vendas (Diário)', type: 'chart', size: 'half', description: 'Linha do tempo diária de conversão' },
  { id: 'chart_sales_period_bar', title: 'Visitantes vs Vendas (Período Barras)', type: 'chart', size: 'half', description: 'Comparativo por período agrupado' },
  { id: 'chart_sales_period_line', title: 'Visitantes vs Vendas (Período Linha)', type: 'chart', size: 'half', description: 'Tendência comparativa entre períodos' },
  { id: 'conversion', title: 'Taxa de Conversão', type: 'kpi', size: 'quarter', description: 'KPI simples de conversão de vendas' },
  { id: 'chart_attention_conversion', title: 'Atenção Possível Conversão', type: 'chart', size: 'quarter', description: 'Donut chart de níveis de atenção' },

  // Kibon Specific
  { id: 'chart_kibon_vert_quarter', title: 'Kibon Vertical (Trimestre)', type: 'chart', size: 'half', description: 'Contatos Freezer Vertical Último Trimestre' },
  { id: 'chart_kibon_vert_period', title: 'Kibon Vertical (Período)', type: 'chart', size: 'half', description: 'Contatos Freezer Vertical Período' },
  { id: 'chart_kibon_horiz_quarter', title: 'Kibon Horizontal (Trimestre)', type: 'chart', size: 'half', description: 'Contatos Freezer Horizontal Último Trimestre' },
  { id: 'chart_kibon_horiz_period', title: 'Kibon Horizontal (Período)', type: 'chart', size: 'half', description: 'Contatos Freezer Horizontal Período' },

  // Demographics & Attributes
  { id: 'age_pyramid', title: 'Pirâmide Etária', type: 'chart', size: 'third', description: 'Distribuição demográfica por idade/gênero' },
  { id: 'chart_age_ranges', title: 'Faixa Etária (Barras)', type: 'chart', size: 'third', description: 'Distribuição por faixas etárias detalhadas' },
  { id: 'gender_dist', title: 'Distribuição de Gênero', type: 'chart', size: 'third', description: 'Gráfico de rosca: Masculino vs Feminino' },
  { id: 'chart_vision', title: 'Atributo: Visão', type: 'chart', size: 'third', description: 'Uso de óculos (Normais/Escuros)' },
  { id: 'chart_facial_hair', title: 'Atributo: Pelos Faciais', type: 'chart', size: 'third', description: 'Barba, Bigode, etc.' },
  { id: 'chart_hair_type', title: 'Atributo: Tipo de Cabelo', type: 'chart', size: 'third', description: 'Longo, Curto, Careca' },
  { id: 'chart_hair_color', title: 'Atributo: Cor de Cabelo', type: 'chart', size: 'third', description: 'Preto, Loiro, Castanho' },
  { id: 'attributes', title: 'Atributos Gerais', type: 'chart', size: 'third', description: 'Resumo de atributos principais' },

  // Journey & Campaigns
  { id: 'journey', title: 'Jornada do Cliente', type: 'chart', size: 'third', description: 'Funil de pontos de passagem' },
  { id: 'campaigns', title: 'Engajamento em Campanhas', type: 'table', size: '2/3', description: 'Tabela de performance de campanhas' },
  { id: 'heatmap', title: 'Mapa de Calor (Loja)', type: 'chart', size: 'full', description: 'Visualização térmica da planta baixa' },
];

// --- WIDGET COMPONENTS ---

export const WidgetFlowTrend = ({ view }: { view: string }) => (
  <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 h-full shadow-sm dark:shadow-none">
     <h3 className="font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2 uppercase text-xs tracking-wider">
       <Activity size={14} className="text-blue-500" />
       Média Visitantes Dia - {view === 'network' ? 'Rede' : 'Dia da Semana'}
     </h3>
     <LineChart data={[0, 0, 0, 0, 0, 0, 0]} color="text-blue-500" height={100} />
     <div className="flex justify-between text-[10px] text-gray-500 mt-2 uppercase">
        <span>Seg</span><span>Ter</span><span>Qua</span><span>Qui</span><span>Sex</span><span>Sab</span><span>Dom</span>
     </div>
   </div>
);

export const WidgetHourlyFlow = ({ view }: { view: string }) => (
  <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 h-full shadow-sm dark:shadow-none">
     <h3 className="font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2 uppercase text-xs tracking-wider">
       <Clock size={14} className="text-emerald-500" />
       Média Visitantes por Hora {view === 'network' ? '(Rede)' : ''}
     </h3>
     <LineChart data={[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]} 
        color="text-emerald-500" height={100} 
     />
     <div className="flex justify-between text-[10px] text-gray-500 mt-2">
        <span>06h</span><span>09h</span><span>12h</span><span>15h</span><span>18h</span><span>21h</span>
     </div>
   </div>
);

export const WidgetAgePyramid = ({ view }: { view: string }) => (
  <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6 h-full shadow-sm dark:shadow-none">
     <h3 className="font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2 uppercase text-sm tracking-wider">
       <Users size={16} className="text-purple-500" />
       Pirâmide Etária {view === 'network' ? '(Consolidado)' : ''}
     </h3>
     <AgePyramid />
   </div>
);

export const WidgetGenderDist = ({ view }: { view: string }) => (
  <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6 h-full shadow-sm dark:shadow-none">
     <h3 className="font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2 uppercase text-sm tracking-wider">
       <Users size={16} className="text-pink-500" />
       Gênero {view === 'network' ? '(Consolidado)' : ''}
     </h3>
     <DonutChart 
        data={[{ label: 'Masculino', value: 0 }, { label: 'Feminino', value: 0 }]} 
        colors={['#1e40af', '#db2777']}
     />
     <div className="flex justify-center gap-4 mt-4 text-xs">
        <span className="flex items-center gap-1 text-gray-400"><div className="w-2 h-2 bg-blue-800 rounded-full" /> Masculino (0%)</span>
        <span className="flex items-center gap-1 text-gray-400"><div className="w-2 h-2 bg-pink-600 rounded-full" /> Feminino (0%)</span>
     </div>
   </div>
);

export const WidgetAttributes = ({ view }: { view: string }) => (
  <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6 h-full shadow-sm dark:shadow-none">
     <h3 className="font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2 uppercase text-sm tracking-wider">
       <Users size={16} className="text-orange-500" />
       Atributos {view === 'network' ? '(Consolidado)' : ''}
     </h3>
     <HorizontalBarChart 
        data={[
          { label: 'Óculos', value: 0 },
          { label: 'Barba', value: 0 },
          { label: 'Máscara', value: 0 },
          { label: 'Chapéu/Boné', value: 0 }
        ]}
        color="bg-orange-500"
     />
   </div>
);

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
         <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
           {/* Tabela vazia */}
         </tbody>
       </table>
     </div>
   </div>
);

export const WidgetKPIFlowStats = () => (
  <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 h-full flex items-center justify-between gap-4 overflow-x-auto shadow-sm dark:shadow-none">
     <KPIStat label="Total Visitantes" value="0" color="text-gray-900 dark:text-white" />
     <KPIStat label="Média Visitantes Dia" value="0" color="text-blue-500" />
     <KPIStat label="Tempo Médio Visita" value="00:00" color="text-emerald-500" />
     <KPIStat label="Tempo Médio Contato" value="00:00" color="text-amber-500" />
  </div>
);

export const WidgetKPIStoreQuarter = () => (
  <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 h-full flex flex-col justify-between shadow-sm dark:shadow-none">
    <h3 className="font-bold text-red-500 mb-2 uppercase text-xs tracking-wider">Loja Último Trimestre</h3>
    <div className="flex gap-2">
       <KPIStat label="Visitantes" value="0" />
       <KPIStat label="Vendas" value="0" />
       <KPIStat label="Conversão" value="0%" color="text-emerald-500" />
    </div>
  </div>
);

export const WidgetKPIStorePeriod = () => (
  <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 h-full flex flex-col justify-between shadow-sm dark:shadow-none">
    <h3 className="font-bold text-red-500 mb-2 uppercase text-xs tracking-wider">Loja Período</h3>
    <div className="flex gap-2">
       <KPIStat label="Visitantes" value="0" />
       <KPIStat label="Vendas" value="0" />
       <KPIStat label="Conversão" value="0%" color="text-emerald-500" />
    </div>
  </div>
);

export const WidgetSalesQuarter = () => (
  <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 h-full shadow-sm dark:shadow-none">
     <h3 className="font-bold text-gray-900 dark:text-white mb-4 uppercase text-xs tracking-wider">Total Visitantes vs Vendas Último Trimestre</h3>
     <VerticalBarChart 
       data={[
         { label: 'OUT', values: [0, 0] },
         { label: 'NOV', values: [0, 0] },
         { label: 'DEZ', values: [0, 0] }
       ]} 
       colors={['bg-blue-500', 'bg-blue-900']} 
       height={120}
     />
     <div className="flex justify-center gap-4 mt-2 text-[10px] text-gray-500">
        <span className="flex items-center gap-1"><div className="w-2 h-2 bg-blue-500 rounded-full"/> Visitantes</span>
        <span className="flex items-center gap-1"><div className="w-2 h-2 bg-blue-900 rounded-full"/> Vendas</span>
     </div>
  </div>
);

export const WidgetSalesDaily = () => (
  <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 h-full shadow-sm dark:shadow-none">
     <h3 className="font-bold text-gray-900 dark:text-white mb-4 uppercase text-xs tracking-wider">Total Visitantes vs Vendas por Dia</h3>
     <LineChart data={[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]} color="text-blue-500" height={100} />
     <div className="flex justify-center gap-4 mt-2 text-[10px] text-gray-500">
        <span className="flex items-center gap-1"><div className="w-2 h-2 bg-blue-500 rounded-full"/> Visitantes</span>
     </div>
  </div>
);

export const WidgetSalesPeriodBar = () => (
  <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 h-full shadow-sm dark:shadow-none">
     <h3 className="font-bold text-gray-900 dark:text-white mb-4 uppercase text-xs tracking-wider">Total Visitantes vs Vendas por Período</h3>
     <VerticalBarChart 
       data={[
         { label: 'Sem 1', values: [0, 0] },
         { label: 'Sem 2', values: [0, 0] },
         { label: 'Sem 3', values: [0, 0] },
         { label: 'Sem 4', values: [0, 0] }
       ]} 
       colors={['bg-blue-500', 'bg-blue-900']} 
       height={120}
     />
  </div>
);

export const WidgetSalesPeriodLine = () => (
  <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 h-full shadow-sm dark:shadow-none">
     <h3 className="font-bold text-gray-900 dark:text-white mb-4 uppercase text-xs tracking-wider">Total Visitantes vs Vendas (Comparativo)</h3>
     <div className="relative h-[100px]">
        <div className="absolute inset-0 opacity-50"><LineChart data={[20, 30, 40, 35]} color="text-blue-300" height={100} /></div>
        <div className="absolute inset-0"><LineChart data={[30, 45, 55, 40]} color="text-blue-600" height={100} /></div>
     </div>
  </div>
);

export const WidgetFreezerVerticalQuarter = () => (
  <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 h-full shadow-sm dark:shadow-none">
     <h3 className="font-bold text-red-500 mb-4 uppercase text-xs tracking-wider">Kibon Último Trimestre (Freezer Vertical)</h3>
     <VerticalBarChart 
       data={[
         { label: 'OUT', values: [90, 20] },
         { label: 'NOV', values: [50, 15] },
         { label: 'DEZ', values: [45, 12] }
       ]} 
       colors={['bg-blue-500', 'bg-purple-600']} 
       height={120}
     />
  </div>
);

export const WidgetFreezerHorizontalQuarter = () => (
  <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 h-full shadow-sm dark:shadow-none">
     <h3 className="font-bold text-red-500 mb-4 uppercase text-xs tracking-wider">Kibon Último Trimestre (Freezer Horizontal)</h3>
     <VerticalBarChart 
       data={[
         { label: 'OUT', values: [85, 10] },
         { label: 'NOV', values: [40, 8] },
         { label: 'DEZ', values: [42, 9] }
       ]} 
       colors={['bg-blue-500', 'bg-purple-600']} 
       height={120}
     />
  </div>
);

export const WidgetAgeRanges = () => (
  <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 h-full">
     <h3 className="font-bold text-white mb-4 uppercase text-sm tracking-wider">Faixa Etária</h3>
     <VerticalBarChart 
       data={[
         { label: '18-', values: [10] },
         { label: '18-24', values: [25] },
         { label: '25-34', values: [60] },
         { label: '35-44', values: [40] },
         { label: '45-54', values: [20] },
         { label: '55-64', values: [15] },
         { label: '65+', values: [5] }
       ]} 
       colors={['bg-blue-500']} 
       height={150}
     />
  </div>
);

export const WidgetVision = () => (
  <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 h-full">
     <h3 className="font-bold text-white mb-4 uppercase text-sm tracking-wider">Visão</h3>
     <DonutChart 
        data={[{ label: 'Sem Óculos', value: 65 }, { label: 'Óculos Normais', value: 25 }, { label: 'Óculos Escuros', value: 10 }]} 
        colors={['#e5e7eb', '#3b82f6', '#1f2937']}
     />
  </div>
);

export const WidgetFacialHair = () => (
  <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 h-full">
     <h3 className="font-bold text-white mb-4 uppercase text-sm tracking-wider">Pelos Faciais</h3>
     <DonutChart 
        data={[{ label: 'Raspado', value: 55 }, { label: 'Barba', value: 30 }, { label: 'Bigode', value: 15 }]} 
        colors={['#fca5a5', '#3b82f6', '#ef4444']}
     />
  </div>
);

export const WidgetHairType = () => (
  <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 h-full">
     <h3 className="font-bold text-white mb-4 uppercase text-sm tracking-wider">Tipo de Cabelo</h3>
     <DonutChart 
        data={[{ label: 'Normal', value: 45 }, { label: 'Longo', value: 40 }, { label: 'Careca', value: 15 }]} 
        colors={['#3b82f6', '#eab308', '#ef4444']}
     />
  </div>
);

export const WidgetHairColor = () => (
  <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 h-full">
     <h3 className="font-bold text-white mb-4 uppercase text-sm tracking-wider">Cor de Cabelo</h3>
     <DonutChart 
        data={[{ label: 'Preto', value: 50 }, { label: 'Loiro', value: 20 }, { label: 'Castanho', value: 30 }]} 
        colors={['#1f2937', '#eab308', '#78350f']}
     />
  </div>
);

export const WidgetAttentionConversion = () => (
  <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 h-full">
     <h3 className="font-bold text-white mb-4 uppercase text-sm tracking-wider">Atenção Possível Conversão</h3>
     <DonutChart 
        data={[{ label: 'Baixa', value: 60 }, { label: 'Média', value: 30 }, { label: 'Alta', value: 10 }]} 
        colors={['#e5e7eb', '#f59e0b', '#ef4444']}
     />
  </div>
);

export const WidgetJourneyPoints = () => (
  <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 h-full">
     <h3 className="font-bold text-white mb-4 uppercase text-sm tracking-wider">Pontos Jornada</h3>
     <HorizontalBarChart 
        data={[
          { label: 'Entrada', value: 100 },
          { label: 'Vitrine', value: 85 },
          { label: 'Gôndola', value: 60 },
          { label: 'Caixa', value: 45 },
          { label: 'Saída', value: 98 }
        ]}
        color="bg-blue-600"
     />
  </div>
);

export const WIDGET_MAP: Record<string, React.FC<{view: string}>> = {
  'flow_trend': WidgetFlowTrend,
  'hourly_flow': WidgetHourlyFlow,
  'age_pyramid': WidgetAgePyramid,
  'gender_dist': WidgetGenderDist,
  'attributes': WidgetAttributes,
  'campaigns': WidgetCampaigns,
  
  // New Mappings
  'kpi_flow_stats': WidgetKPIFlowStats,
  'kpi_store_quarter': WidgetKPIStoreQuarter,
  'kpi_store_period': WidgetKPIStorePeriod,
  'chart_sales_quarter': WidgetSalesQuarter,
  'chart_sales_daily': WidgetSalesDaily,
  'chart_sales_period_bar': WidgetSalesPeriodBar,
  'chart_sales_period_line': WidgetSalesPeriodLine,
  'chart_kibon_vert_quarter': WidgetFreezerVerticalQuarter,
  'chart_kibon_vert_period': WidgetFreezerVerticalQuarter, // Reuse for demo
  'chart_kibon_horiz_quarter': WidgetFreezerHorizontalQuarter,
  'chart_kibon_horiz_period': WidgetFreezerHorizontalQuarter, // Reuse for demo
  'chart_age_ranges': WidgetAgeRanges,
  'chart_vision': WidgetVision,
  'chart_facial_hair': WidgetFacialHair,
  'chart_hair_type': WidgetHairType,
  'chart_hair_color': WidgetHairColor,
  'chart_attention_conversion': WidgetAttentionConversion,
  'journey': WidgetJourneyPoints,
  
  'heatmap': () => <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 h-full flex items-center justify-center text-gray-500">Mapa de Calor (Em breve)</div>,
  'conversion': () => <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 h-full flex items-center justify-center text-gray-500">Taxa de Conversão (Em breve)</div>,
};