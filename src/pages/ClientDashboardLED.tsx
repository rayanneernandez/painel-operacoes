import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Calendar, Clock, Image, RefreshCw } from 'lucide-react';
import supabase from '../lib/supabase';
import { StorePlan3D, LED_CONTACT_POINTS, type ContactPoint } from '../components/StorePlan3D';
import { DashboardChat } from '../components/DashboardChat';

function alignStartOfDay(d: Date) { const n = new Date(d); n.setHours(0, 0, 0, 0); return n; }
function alignEndOfDay(d: Date) { const n = new Date(d); n.setHours(23, 59, 59, 999); return n; }
function fmtDateInput(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseDateInput(s: string, end = false) {
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime())) return null;
  if (end) dt.setHours(23, 59, 59, 999); else dt.setHours(0, 0, 0, 0);
  return dt;
}

function readAppTheme(): 'dark' | 'light' {
  try {
    if (document.documentElement.dataset.appTheme === 'light') return 'light';
    if (document.documentElement.dataset.appTheme === 'dark') return 'dark';
    return localStorage.getItem('app-theme') === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

const LED_ACTIVE_POINT_IDS = new Set(['caixa', 'dashboard_cam', 'entrada_tunel']);
const LED_ACTIVE_CONTACTS = LED_CONTACT_POINTS.filter((point) => LED_ACTIVE_POINT_IDS.has(point.id));

type LedDisplayforcePoint = { id: string; name: string; visitors: number };
type LedDisplayforceResponse = {
  total_visitors?: number;
  points?: LedDisplayforcePoint[];
  gender?: {
    male?: number;
    female?: number;
    unknown?: number;
    male_pct?: number;
    female_pct?: number;
  };
  error?: string;
};

function KpiCard({ title, value, sub, color }: { title: string; value: string; sub?: string; color: string }) {
  return (
    <div className="bg-white dark:bg-[#0d1117] border border-slate-200 dark:border-gray-800/60 rounded-2xl px-4 py-3 flex flex-col gap-1 hover:border-slate-300 dark:hover:border-gray-700/60 transition-all">
      <div className="text-[11px] uppercase tracking-widest font-semibold text-slate-600 dark:text-gray-400">{title}</div>
      {sub && <div className="text-[10px] text-slate-500 dark:text-gray-500">{sub}</div>}
      <div className="flex items-end gap-1.5 mt-1">
        <div className="text-2xl font-bold tabular-nums" style={{ color }}>{value}</div>
        <span className="w-1.5 h-1.5 rounded-full mb-1 animate-pulse" style={{ backgroundColor: color }} />
      </div>
    </div>
  );
}

export function ClientDashboardLED() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [clientName, setClientName] = useState('The LED');
  const [clientLogoUrl, setClientLogoUrl] = useState('');
  const [clientLogoLightUrl, setClientLogoLightUrl] = useState('');
  const [clientLogoDarkUrl, setClientLogoDarkUrl] = useState('');
  const [appTheme, setAppTheme] = useState<'dark' | 'light'>(readAppTheme);
  const [startDate, setStartDate] = useState<Date>(() => alignStartOfDay(new Date()));
  const [endDate, setEndDate] = useState<Date>(() => alignEndOfDay(new Date()));
  const [startHour, setStartHour] = useState(0);
  const [endHour, setEndHour] = useState(23);
  const [isLoading, setIsLoading] = useState(false);
  const [contacts, setContacts] = useState<ContactPoint[]>(LED_ACTIVE_CONTACTS);
  const [totalFlow, setTotalFlow] = useState(0);
  const [peakPoint, setPeakPoint] = useState('—');
  const [peakCount, setPeakCount] = useState(0);
  const [adherencePct, setAdherencePct] = useState(0);
  const [malePct, setMalePct] = useState(0);
  const [femalePct, setFemalePct] = useState(0);

  useEffect(() => {
    const updateTheme = () => setAppTheme(readAppTheme());
    window.addEventListener('app-theme-change', updateTheme);
    window.addEventListener('dashboard-theme-change', updateTheme);
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-app-theme', 'class'] });
    return () => {
      window.removeEventListener('app-theme-change', updateTheme);
      window.removeEventListener('dashboard-theme-change', updateTheme);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!id) return;
    supabase
      .from('clients')
      .select('name, logo_url, logo_url_light, logo_url_dark')
      .eq('id', id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.name) setClientName(String(data.name));
        if ((data as any)?.logo_url) setClientLogoUrl(String((data as any).logo_url));
        if ((data as any)?.logo_url_light) setClientLogoLightUrl(String((data as any).logo_url_light));
        if ((data as any)?.logo_url_dark) setClientLogoDarkUrl(String((data as any).logo_url_dark));
      });
  }, [id]);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    const sd = new Date(startDate); sd.setHours(startHour, 0, 0, 0);
    const ed = new Date(endDate); ed.setHours(endHour, 59, 59, 999);

    try {
      const params = new URLSearchParams({ start: sd.toISOString(), end: ed.toISOString() });
      const response = await fetch(`/api/displayforce-led?${params.toString()}`);
      const json = await response.json().catch(() => ({})) as LedDisplayforceResponse;
      if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`);

      const total = Number(json.total_visitors || 0);
      const pointsById = new Map((json.points || []).map((point) => [point.id, point]));
      const updated = LED_ACTIVE_CONTACTS.map((contact) => {
        const visitors = Number(pointsById.get(contact.id)?.visitors || 0);
        return {
          ...contact,
          flowCount: visitors,
          heatValue: total > 0 ? Math.min(1, visitors / total) : 0,
        };
      });
      const fallbackTotal = updated.reduce((sum, item) => sum + (item.flowCount || 0), 0);
      const peak = [...updated].sort((a, b) => (b.flowCount ?? 0) - (a.flowCount ?? 0))[0];
      const caixaVisitors = Number(pointsById.get('caixa')?.visitors || 0);
      const entradaTunelVisitors = Number(pointsById.get('entrada_tunel')?.visitors || 0);
      const adherence = caixaVisitors > 0
        ? Math.round(((entradaTunelVisitors + caixaVisitors) / caixaVisitors) * 100)
        : 0;

      setContacts(updated);
      setTotalFlow(total || fallbackTotal);
      setPeakPoint(peak?.name ?? '—');
      setPeakCount(peak?.flowCount ?? 0);
      setAdherencePct(adherence);
      setMalePct(Number(json.gender?.male_pct || 0));
      setFemalePct(Number(json.gender?.female_pct || 0));
    } catch (error) {
      console.error('[The LED] erro ao buscar DisplayForce:', error);
      setContacts(LED_ACTIVE_CONTACTS.map((point) => ({ ...point, flowCount: 0, heatValue: 0 })));
      setTotalFlow(0);
      setPeakPoint('—');
      setPeakCount(0);
      setAdherencePct(0);
      setMalePct(0);
      setFemalePct(0);
    } finally {
      setIsLoading(false);
    }
  }, [startDate, endDate, startHour, endHour]);

  useEffect(() => { void loadData(); }, [loadData]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadData();
    }, 120000);
    return () => window.clearInterval(timer);
  }, [loadData]);

  if (!id) return null;

  const clientLogoForTheme = appTheme === 'light'
    ? (clientLogoDarkUrl || clientLogoUrl || clientLogoLightUrl)
    : (clientLogoLightUrl || clientLogoUrl || clientLogoDarkUrl);
  const selectOptionStyle = appTheme === 'light'
    ? { backgroundColor: '#ffffff', color: '#0f172a' }
    : { backgroundColor: '#161b22', color: '#ffffff' };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto">
      <div className="flex flex-col gap-5 mb-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="h-12 w-12 sm:h-14 sm:w-14 rounded-2xl bg-white dark:bg-[#0d1117] border border-slate-200 dark:border-gray-800/60 flex items-center justify-center overflow-hidden flex-shrink-0 shadow-lg">
              {clientLogoForTheme
                ? <img src={clientLogoForTheme} alt="Logo" className="h-full w-auto object-contain p-1.5" />
                : <Image size={20} className="text-slate-400 dark:text-gray-600" />}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <h1 className="text-slate-950 dark:text-white text-xl sm:text-2xl font-bold leading-tight">{clientName}</h1>
                <span className="px-2 py-0.5 rounded-md bg-violet-500/15 border border-violet-500/20 text-violet-400 text-[10px] font-semibold uppercase tracking-widest">LED</span>
              </div>
              <p className="text-slate-600 dark:text-gray-400 text-sm mt-0.5">Mapa de Fluxo · Gênero · Pontos de Contato</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate(`/clientes/${id}/dashboard`)}
              className="h-9 px-3.5 rounded-xl bg-white dark:bg-[#0d1117] border border-slate-200 dark:border-gray-800/60 hover:border-slate-300 dark:hover:border-gray-700 text-slate-700 dark:text-gray-300 hover:text-slate-950 dark:hover:text-white text-xs font-medium inline-flex items-center transition-all"
            >
              Dashboard Geral
            </button>
            <button
              type="button"
              onClick={loadData}
              disabled={isLoading}
              className="h-9 w-9 rounded-xl bg-white dark:bg-[#0d1117] border border-slate-200 dark:border-gray-800/60 hover:border-violet-500/40 text-slate-500 dark:text-gray-400 hover:text-violet-600 dark:hover:text-violet-300 flex items-center justify-center transition-all disabled:opacity-50"
              title="Recarregar"
            >
              <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 p-3 bg-white dark:bg-[#0d1117] border border-slate-200 dark:border-gray-800/40 rounded-2xl">
          <div className="flex items-center gap-1.5">
            <div className="relative">
              <input
                type="date"
                className="h-9 bg-white dark:bg-[#161b22] border border-slate-200 dark:border-gray-800/60 text-slate-950 dark:text-white pl-9 pr-2.5 rounded-xl focus:outline-none focus:ring-1 focus:ring-violet-500/50 text-xs font-medium w-[140px] transition-all"
                value={fmtDateInput(startDate)}
                onChange={(e) => { const n = parseDateInput(e.target.value); if (n) setStartDate(n); }}
              />
              <div className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-gray-500">
                <Calendar size={14} />
              </div>
            </div>
            <div className="relative">
              <select
                className="h-9 bg-white dark:bg-[#161b22] border border-slate-200 dark:border-gray-800/60 text-slate-950 dark:text-white pl-8 pr-6 rounded-xl focus:outline-none appearance-none cursor-pointer text-xs font-medium w-[100px] transition-all"
                value={startHour}
                onChange={(e) => setStartHour(Number(e.target.value))}
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i} style={selectOptionStyle}>{String(i).padStart(2, '0')}:00</option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-gray-500">
                <Clock size={13} />
              </div>
            </div>
          </div>

          <span className="text-slate-500 dark:text-gray-600 text-xs">até</span>

          <div className="flex items-center gap-1.5">
            <div className="relative">
              <input
                type="date"
                className="h-9 bg-white dark:bg-[#161b22] border border-slate-200 dark:border-gray-800/60 text-slate-950 dark:text-white pl-9 pr-2.5 rounded-xl focus:outline-none focus:ring-1 focus:ring-violet-500/50 text-xs font-medium w-[140px] transition-all"
                value={fmtDateInput(endDate)}
                onChange={(e) => { const n = parseDateInput(e.target.value, true); if (n) setEndDate(n); }}
              />
              <div className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-gray-500">
                <Calendar size={14} />
              </div>
            </div>
            <div className="relative">
              <select
                className="h-9 bg-white dark:bg-[#161b22] border border-slate-200 dark:border-gray-800/60 text-slate-950 dark:text-white pl-8 pr-6 rounded-xl focus:outline-none appearance-none cursor-pointer text-xs font-medium w-[100px] transition-all"
                value={endHour}
                onChange={(e) => setEndHour(Number(e.target.value))}
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i} style={selectOptionStyle}>{String(i).padStart(2, '0')}:00</option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-gray-500">
                <Clock size={13} />
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={loadData}
            disabled={isLoading}
            className="h-9 px-4 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5 transition-all shadow-lg shadow-violet-500/20"
          >
            <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
            Aplicar
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-5">
        <KpiCard title="Fluxo Total" value={totalFlow.toLocaleString('pt-BR')} sub="Visitantes Display Force" color="#a78bfa" />
        <KpiCard title="Ponto de Pico" value={peakPoint} sub={`${peakCount.toLocaleString('pt-BR')} visitantes`} color="#ef4444" />
        <KpiCard title="Aderência" value={`${adherencePct}%`} sub="Entrada Túnel + Caixa / Caixa" color="#f59e0b" />
        <KpiCard title="Pontos Ativos" value={String(contacts.length)} sub="Caixa · Dashboard · Túnel" color="#10b981" />
        <KpiCard title="Masculino" value={`${malePct.toFixed(1)}%`} sub="Gênero visitantes" color="#38bdf8" />
        <KpiCard title="Feminino" value={`${femalePct.toFixed(1)}%`} sub="Gênero visitantes" color="#ec4899" />
      </div>

      <StorePlan3D contacts={contacts} />

      <DashboardChat
        context={{
          dashboardName: `${clientName} — Mapa de Fluxo`,
          data: {
            periodo: {
              inicio: startDate.toLocaleDateString('pt-BR'),
              fim: endDate.toLocaleDateString('pt-BR'),
              horaInicio: startHour,
              horaFim: endHour,
            },
            fluxo: {
              total: totalFlow,
              pontoDePico: peakPoint,
              visitantesNoPico: peakCount,
              aderencia: `${adherencePct}%`,
              masculino: `${malePct.toFixed(1)}%`,
              feminino: `${femalePct.toFixed(1)}%`,
            },
            pontosDeContato: contacts.map((c) => ({
              nome: c.name,
              visitantes: c.flowCount,
              calor: `${Math.round((c.heatValue ?? 0) * 100)}%`,
            })),
          },
        }}
      />
    </div>
  );
}
