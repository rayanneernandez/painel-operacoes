import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Save, ArrowLeft, GripVertical, Plus, X,
  ArrowUp, ArrowDown, LayoutDashboard, ChevronDown,
  Eye, Edit3, Monitor,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { AVAILABLE_WIDGETS, WIDGET_MAP } from '../components/DashboardWidgets';
import type { WidgetType } from '../components/DashboardWidgets';
import supabase from '../lib/supabase';

// ── Tamanhos disponíveis ──────────────────────────────────────────────────────
const SPANS = [3, 4, 6, 8, 12] as const;
type Span = typeof SPANS[number];

const SPAN_LABELS: Record<Span, string> = {
  3:  '1/4  — Pequeno',
  4:  '1/3  — Pequeno+',
  6:  '1/2  — Médio',
  8:  '2/3  — Grande',
  12: 'Completo',
};

const DEFAULT_SPAN: Record<WidgetType['size'], Span> = {
  quarter: 3,
  third:   4,
  half:    6,
  '2/3':   8,
  full:    12,
};

type WidgetConfig = {
  widget: WidgetType;
  colSpanLg: Span;
  heightPx?: number;
};

export function ClientDashboardConfig() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [activeWidgets, setActiveWidgets]       = useState<WidgetConfig[]>([]);
  const [availableWidgets, setAvailableWidgets] = useState<WidgetType[]>([]);
  const [isSaving, setIsSaving]   = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [dashboardView, setDashboardView] = useState<'edit' | 'preview'>('edit');
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [isResizing, setIsResizing] = useState(false);

  const previewGridRef = useRef<HTMLDivElement | null>(null);
  const resizingRef = useRef<null | {
    mode: 'x' | 'y';
    widgetId: string;
    startX: number;
    startY: number;
    startSpan: number;
    defaultSpan: number;
    gridWidth: number;
    startHeight: number;
  }>(null);

  useEffect(() => {
    if (!user || !id) return;
    if (user.role === 'client' && user.clientId && user.clientId !== id) {
      navigate(`/clientes/${user.clientId}/dashboard-config`, { replace: true });
    }
  }, [id, navigate, user]);

  // ── Carrega config do Supabase ────────────────────────────────────────────
  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    const clampNum = (v: any, min: number, max: number, fallback: number) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return fallback;
      return Math.min(max, Math.max(min, n));
    };

    const load = async () => {
      setIsLoading(true);
      try {
        const parseConfig = (wc: any): { ids: string[] | null; layout: Record<string, { colSpanLg?: Span; heightPx?: number }> } => {
          let parsedIds: string[] | null = null;
          const layout: Record<string, { colSpanLg?: Span; heightPx?: number }> = {};

          if (Array.isArray(wc)) {
            parsedIds = wc.filter((x: any) => typeof x === 'string');
          } else if (wc && typeof wc === 'object') {
            if (Array.isArray((wc as any).widget_ids)) parsedIds = (wc as any).widget_ids.filter((x: any) => typeof x === 'string');

            const rawLayout = (wc as any).widget_layout ?? (wc as any).widgetLayout;
            if (rawLayout && typeof rawLayout === 'object') {
              for (const [wid, val] of Object.entries(rawLayout)) {
                const wId = String(wid);
                const spanN = Number((val as any)?.colSpanLg ?? val);
                const heightPx = clampNum((val as any)?.heightPx, 180, 1200, NaN);
                if ((SPANS as readonly number[]).includes(spanN)) layout[wId] = { ...(layout[wId] || {}), colSpanLg: spanN as Span };
                if (Number.isFinite(heightPx)) layout[wId] = { ...(layout[wId] || {}), heightPx: Math.round(heightPx) };
              }
            }
          }

          return { ids: parsedIds, layout };
        };

        const fetchWidgetsConfig = async (layout_name: string) => {
          const { data } = await supabase
            .from('dashboard_configs')
            .select('widgets_config, updated_at')
            .eq('layout_name', layout_name)
            .eq('client_id', id)
            .order('updated_at', { ascending: false })
            .limit(1);
          return data?.[0]?.widgets_config ?? null;
        };

        const fetchGlobalWidgetsConfig = async (layout_name: string) => {
          const { data } = await supabase
            .from('dashboard_configs')
            .select('widgets_config, updated_at')
            .eq('layout_name', layout_name)
            .is('client_id', null)
            .order('updated_at', { ascending: false })
            .limit(1);
          return data?.[0]?.widgets_config ?? null;
        };

        let allowedRaw = await fetchWidgetsConfig('client');
        if (!allowedRaw) allowedRaw = await fetchGlobalWidgetsConfig('global');

        let allowed = parseConfig(allowedRaw);
        if (!allowed.ids) {
          const cc = localStorage.getItem(`dashboard-config-${id}`);
          const gc = localStorage.getItem('dashboard-config-global');
          allowed = parseConfig(cc ? JSON.parse(cc) : gc ? JSON.parse(gc) : null);
        }

        const defaultIds = ['kpi_flow_stats', 'flow_trend', 'hourly_flow', 'age_pyramid', 'gender_dist', 'attributes', 'campaigns'];
        const allowedIds = allowed.ids && allowed.ids.length ? allowed.ids : defaultIds;
        const allowedSet = new Set(allowedIds);
        const allowedWidgets = AVAILABLE_WIDGETS.filter((w) => allowedSet.has(w.id));

        let userRaw: any = null;
        try {
          userRaw = await fetchWidgetsConfig('client_user');
        } catch {
          userRaw = null;
        }

        let userCfg = parseConfig(userRaw);
        if (!userCfg.ids) {
          const uc = localStorage.getItem(`dashboard-config-user-${id}`);
          userCfg = parseConfig(uc ? JSON.parse(uc) : null);
        }

        const baseIds = userCfg.ids && userCfg.ids.length ? userCfg.ids : allowedIds;
        const activeIds = baseIds.filter((wid) => allowedSet.has(wid));

        const active: WidgetConfig[] = activeIds
          .map((wid) => AVAILABLE_WIDGETS.find((w) => w.id === wid))
          .filter(Boolean)
          .map((w) => ({
            widget: w!,
            colSpanLg: (userCfg.layout[w!.id]?.colSpanLg ?? allowed.layout[w!.id]?.colSpanLg ?? DEFAULT_SPAN[w!.size]) as Span,
            heightPx: userCfg.layout[w!.id]?.heightPx ?? allowed.layout[w!.id]?.heightPx,
          }));

        const activeIdSet = new Set(activeIds);
        const available = allowedWidgets.filter((w) => !activeIdSet.has(w.id));

        if (!cancelled) {
          setActiveWidgets(active);
          setAvailableWidgets(available);
        }
      } catch (e) {
        console.warn('[Config] Erro ao carregar:', e);
        if (!cancelled) {
          setActiveWidgets([]);
          setAvailableWidgets([]);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [id]);

  // ── Ações ─────────────────────────────────────────────────────────────────
  const addWidget = (widget: WidgetType) => {
    setActiveWidgets([...activeWidgets, { widget, colSpanLg: DEFAULT_SPAN[widget.size] }]);
    setAvailableWidgets(availableWidgets.filter((w) => w.id !== widget.id));
  };

  const removeWidget = (widget: WidgetType) => {
    setAvailableWidgets([...availableWidgets, widget]);
    setActiveWidgets(activeWidgets.filter((c) => c.widget.id !== widget.id));
  };

  const moveWidget = (index: number, direction: 'up' | 'down') => {
    const arr = [...activeWidgets];
    if (direction === 'up' && index > 0)
      [arr[index], arr[index - 1]] = [arr[index - 1], arr[index]];
    else if (direction === 'down' && index < arr.length - 1)
      [arr[index], arr[index + 1]] = [arr[index + 1], arr[index]];
    setActiveWidgets(arr);
  };

  const setSpan = (widgetId: string, span: Span) => {
    setActiveWidgets(activeWidgets.map((c) =>
      c.widget.id === widgetId ? { ...c, colSpanLg: span } : c
    ));
  };


  const closestSpan = useCallback((n: number): Span => {
    let best: Span = SPANS[0];
    let bestDist = Number.POSITIVE_INFINITY;
    for (const s of SPANS) {
      const d = Math.abs(s - n);
      if (d < bestDist) { best = s; bestDist = d; }
    }
    return best;
  }, []);

  const onResizeMove = useCallback((e: MouseEvent) => {
    const r = resizingRef.current;
    if (!r) return;

    if (r.mode === 'x') {
      const colW = Math.max(1, r.gridWidth / 12);
      const raw = r.startSpan + (e.clientX - r.startX) / colW;
      const snapped = closestSpan(Math.max(3, Math.min(12, Math.round(raw))));
      setActiveWidgets((prev) => prev.map((c) => c.widget.id === r.widgetId ? { ...c, colSpanLg: snapped } : c));
      return;
    }

    const nextHeight = Math.min(1200, Math.max(180, r.startHeight + (e.clientY - r.startY)));
    const snappedH = Math.round(nextHeight / 10) * 10;
    setActiveWidgets((prev) => prev.map((c) => c.widget.id === r.widgetId ? { ...c, heightPx: snappedH } : c));
  }, [closestSpan]);

  const stopResize = useCallback(() => {
    resizingRef.current = null;
    setIsResizing(false);
    window.removeEventListener('mousemove', onResizeMove);
    window.removeEventListener('mouseup', stopResize);
  }, [onResizeMove]);

  const startResizeX = useCallback((e: React.MouseEvent, widget: WidgetType) => {
    e.preventDefault();
    e.stopPropagation();

    if (window.innerWidth < 1024) return;

    setIsResizing(true);

    const current = Number(activeWidgets.find((c) => c.widget.id === widget.id)?.colSpanLg) || DEFAULT_SPAN[widget.size];
    const def = DEFAULT_SPAN[widget.size];
    const gridWidth = previewGridRef.current?.getBoundingClientRect().width || window.innerWidth;

    resizingRef.current = { mode: 'x', widgetId: widget.id, startX: e.clientX, startY: 0, startSpan: current, defaultSpan: def, gridWidth, startHeight: 0 };
    window.addEventListener('mousemove', onResizeMove);
    window.addEventListener('mouseup', stopResize);
  }, [activeWidgets, onResizeMove, stopResize]);

  const startResizeY = useCallback((e: React.MouseEvent, widget: WidgetType) => {
    e.preventDefault();
    e.stopPropagation();

    if (window.innerWidth < 1024) return;

    setIsResizing(true);

    const card = (e.currentTarget as HTMLElement).closest('[data-widget-card]') as HTMLElement | null;
    const rect = card?.getBoundingClientRect();
    const startHeight = rect?.height || 320;

    resizingRef.current = { mode: 'y', widgetId: widget.id, startX: 0, startY: e.clientY, startSpan: 0, defaultSpan: 0, gridWidth: 0, startHeight };
    window.addEventListener('mousemove', onResizeMove);
    window.addEventListener('mouseup', stopResize);
  }, [onResizeMove, stopResize]);

  useEffect(() => () => stopResize(), [stopResize]);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
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

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  // ── Salva no Supabase ─────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!id) return;
    setIsSaving(true);
    try {
      const widgetIds = activeWidgets.map((c) => c.widget.id);
      const widgetLayout: Record<string, { colSpanLg: Span; heightPx?: number }> = {};
      activeWidgets.forEach((c) => {
        widgetLayout[c.widget.id] = { colSpanLg: c.colSpanLg };
        if (Number.isFinite(Number(c.heightPx))) widgetLayout[c.widget.id].heightPx = Math.round(Number(c.heightPx));
      });

      const payload = { widget_ids: widgetIds, widget_layout: widgetLayout };

      try {
        const { data: existing } = await supabase
          .from('dashboard_configs')
          .select('id')
          .eq('client_id', id)
          .eq('layout_name', 'client_user')
          .limit(1)
          .single();

        if (existing?.id) {
          await supabase
            .from('dashboard_configs')
            .update({ widgets_config: payload, updated_at: new Date().toISOString() })
            .eq('id', existing.id);
        } else {
          await supabase
            .from('dashboard_configs')
            .insert({ client_id: id, layout_name: 'client_user', widgets_config: payload, updated_at: new Date().toISOString() });
        }
      } catch {
      }

      localStorage.setItem(`dashboard-config-user-${id}`, JSON.stringify(payload));
      navigate(`/clientes/${id}/dashboard`);
    } catch (e) {
      console.error('[Config] Erro ao salvar:', e);
      alert('Erro ao salvar configuração. Tente novamente.');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-950">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 animate-in fade-in duration-500 min-h-screen bg-gray-950 text-gray-100 font-sans">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-gray-800 pb-6">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-800 rounded-lg transition-colors">
            <ArrowLeft size={20} className="text-gray-400" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <LayoutDashboard className="text-emerald-500" />
              Configurar Dashboard
            </h1>
            <p className="text-gray-400 text-sm">Personalize a visualização, ordem e tamanho dos gráficos</p>
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="w-full sm:w-auto justify-center bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white px-6 py-2.5 rounded-lg flex items-center gap-2 font-medium transition-all shadow-lg shadow-emerald-900/20"
        >
          <Save size={18} />
          {isSaving ? 'Salvando...' : 'Salvar Layout'}
        </button>
      </div>

      <div className="flex flex-wrap gap-2 bg-gray-900/50 p-1 rounded-lg w-full sm:w-fit border border-gray-800">
        <button
          onClick={() => setDashboardView('edit')}
          className={`flex-1 sm:flex-none justify-center px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition-all whitespace-normal sm:whitespace-nowrap ${dashboardView === 'edit' ? 'bg-emerald-600 text-white shadow-lg' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}
        >
          <Edit3 size={16} /> Configuração / Editor
        </button>
        <button
          onClick={() => setDashboardView('preview')}
          className={`flex-1 sm:flex-none justify-center px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition-all whitespace-normal sm:whitespace-nowrap ${dashboardView === 'preview' ? 'bg-emerald-600 text-white shadow-lg' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}
        >
          <Eye size={16} /> Pré-visualização Real
        </button>
      </div>

      {dashboardView === 'edit' && (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

        {/* ── Widgets Disponíveis ─────────────────────────────────────────── */}
        <div className="lg:col-span-1 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Widgets Disponíveis</h2>
            <span className="text-xs text-gray-600">{availableWidgets.length} itens</span>
          </div>

          <div className="space-y-3 max-h-[calc(100vh-200px)] overflow-y-auto pr-2">
            {availableWidgets.map((widget) => (
              <div key={widget.id} className="bg-gray-900/50 border border-gray-800 p-4 rounded-xl flex items-center justify-between group hover:border-gray-700 hover:bg-gray-900 transition-all">
                <div>
                  <h3 className="font-bold text-white text-sm">{widget.title}</h3>
                  <p className="text-xs text-gray-500 mt-1">{widget.description}</p>
                  <span className="inline-block mt-2 text-[10px] bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full uppercase border border-gray-700">
                    {widget.size}
                  </span>
                </div>
                <button
                  onClick={() => addWidget(widget)}
                  className="p-2 bg-gray-800 rounded-lg text-emerald-500 hover:bg-emerald-500 hover:text-white transition-colors border border-gray-700 ml-3 flex-shrink-0"
                  title="Adicionar ao Dashboard"
                >
                  <Plus size={18} />
                </button>
              </div>
            ))}
            {availableWidgets.length === 0 && (
              <div className="text-center py-12 text-gray-600 text-sm border border-dashed border-gray-800 rounded-xl bg-gray-900/20">
                Todos os widgets adicionados
              </div>
            )}
          </div>
        </div>

        {/* ── Layout Ativo ────────────────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Layout Ativo</h2>
            <span className="text-xs text-gray-500">Ajuste ordem e largura de cada widget</span>
          </div>

          <div className="bg-gray-950 border border-gray-800 rounded-xl p-6 min-h-[600px] space-y-3 relative">
            <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(#1f2937_1px,transparent_1px)] [background-size:16px_16px] opacity-20 pointer-events-none" />

            {activeWidgets.map((cfg, index) => (
              <div key={cfg.widget.id} className="relative bg-gray-900 border border-gray-800 p-4 rounded-xl flex items-center gap-3 group hover:border-emerald-500/30 transition-all shadow-sm z-10">

                {/* Grip */}
                <div className="text-gray-600 cursor-move px-1 flex-shrink-0">
                  <GripVertical size={20} />
                </div>

                {/* Número */}
                <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-gray-800 flex items-center justify-center text-gray-400 font-bold text-xs border border-gray-700">
                  {index + 1}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-white text-sm truncate">{cfg.widget.title}</h3>
                    {cfg.widget.type === 'chart' && <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />}
                    {cfg.widget.type === 'table' && <span className="w-2 h-2 rounded-full bg-purple-500 flex-shrink-0" />}
                    {cfg.widget.type === 'kpi'   && <span className="w-2 h-2 rounded-full bg-orange-500 flex-shrink-0" />}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 truncate">{cfg.widget.description}</p>
                </div>

                {/* Seletor de tamanho — dropdown */}
                <div className="relative flex-shrink-0">
                  <select
                    value={cfg.colSpanLg}
                    onChange={(e) => setSpan(cfg.widget.id, Number(e.target.value) as Span)}
                    className="appearance-none bg-gray-800 border border-gray-700 text-white text-xs pl-3 pr-7 py-1.5 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer"
                  >
                    {SPANS.map((s) => (
                      <option key={s} value={s} style={{ backgroundColor: '#1f2937' }}>
                        {SPAN_LABELS[s]}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>

                {/* Blocos visuais de largura — clicáveis */}
                <div className="hidden sm:flex items-center gap-1 flex-shrink-0">
                  {SPANS.map((s) => (
                    <button
                      key={s}
                      onClick={() => setSpan(cfg.widget.id, s)}
                      title={SPAN_LABELS[s]}
                      className={`h-5 rounded transition-all ${cfg.colSpanLg === s ? 'bg-emerald-500' : 'bg-gray-700 hover:bg-gray-600'}`}
                      style={{ width: s * 3 }}
                    />
                  ))}
                </div>

                {/* Mover + Remover */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <div className="flex flex-col gap-0.5">
                    <button onClick={() => moveWidget(index, 'up')} disabled={index === 0} className="p-1 rounded bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 disabled:opacity-30 transition-colors">
                      <ArrowUp size={12} />
                    </button>
                    <button onClick={() => moveWidget(index, 'down')} disabled={index === activeWidgets.length - 1} className="p-1 rounded bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 disabled:opacity-30 transition-colors">
                      <ArrowDown size={12} />
                    </button>
                  </div>
                  <div className="w-px h-8 bg-gray-800 mx-1" />
                  <button onClick={() => removeWidget(cfg.widget)} className="p-2 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors">
                    <X size={16} />
                  </button>
                </div>
              </div>
            ))}

            {activeWidgets.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full py-20 text-gray-500">
                <LayoutDashboard size={48} className="mb-4 opacity-20" />
                <p>Nenhum widget selecionado.</p>
                <p className="text-xs mt-2">Adicione widgets da lista ao lado para começar.</p>
              </div>
            )}
          </div>

          {/* Preview de proporções */}
          {activeWidgets.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Preview de Proporções</p>
              <div className="grid grid-cols-12 gap-1">
                {activeWidgets.map((cfg) => (
                  <div
                    key={cfg.widget.id}
                    style={{ gridColumn: `span ${cfg.colSpanLg}` }}
                    className="bg-gray-800 border border-gray-700 rounded p-2 text-center overflow-hidden"
                  >
                    <p className="text-[10px] text-gray-300 font-medium truncate">{cfg.widget.title}</p>
                    <p className="text-[9px] text-gray-500 mt-0.5">{SPAN_LABELS[cfg.colSpanLg]}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      )}

      {dashboardView === 'preview' && (
        <div className="bg-gray-950 border border-gray-800 rounded-2xl p-6 animate-in zoom-in-95 duration-300">
          <div className="mb-6 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between border-b border-gray-800 pb-4">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Monitor size={20} className="text-emerald-500" />
              Pré-visualização
            </h3>
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Arraste para reordenar
            </div>
          </div>

          <div ref={previewGridRef} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-3 p-4 items-start">
            {activeWidgets.map((cfg, index) => {
              const widget = cfg.widget;
              const Component = WIDGET_MAP[widget.id];
              if (!Component) return null;

              let spanLg = Number(cfg.colSpanLg) || DEFAULT_SPAN[widget.size];
              if (![3, 4, 6, 8, 12].includes(spanLg)) spanLg = DEFAULT_SPAN[widget.size];

              let lgSpan = 'lg:col-span-6';
              if (spanLg === 12) lgSpan = 'lg:col-span-12';
              if (spanLg === 8) lgSpan = 'lg:col-span-8';
              if (spanLg === 4) lgSpan = 'lg:col-span-4';
              if (spanLg === 3) lgSpan = 'lg:col-span-3';

              const mdSpan = spanLg >= 8 ? 'md:col-span-2' : 'md:col-span-1';
              const isDragging = draggedIndex === index;
              const heightPx = Number(cfg.heightPx);
              const widgetStyle = Number.isFinite(heightPx) ? { height: Math.round(heightPx) } : undefined;

              return (
                <div
                  key={widget.id}
                  data-widget-card
                  draggable={!isResizing}
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDragEnd={handleDragEnd}
                  style={widgetStyle}
                  className={`col-span-1 ${mdSpan} ${lgSpan} self-start relative group transition-all duration-300 flex flex-col ${isDragging ? 'opacity-50 scale-95 border-2 border-dashed border-emerald-500 rounded-xl' : ''}`}
                >
                  <div className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 bg-gray-900/90 p-1.5 rounded-lg backdrop-blur-sm border border-gray-700 shadow-xl cursor-move">
                    <div className="p-1.5 text-gray-400 hover:text-white transition-colors" title="Arrastar para mover">
                      <GripVertical size={16} />
                    </div>
                    <button
                      type="button"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); removeWidget(widget); }}
                      className="p-1.5 hover:bg-red-500/20 rounded text-gray-300 hover:text-red-400 ml-1 border-l border-gray-700 pl-2 transition-colors"
                      title="Remover"
                    >
                      <X size={14} />
                    </button>
                  </div>

                  <div
                    className="absolute top-0 right-0 z-20 h-full w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 transition-opacity"
                    title={window.innerWidth >= 1024 ? 'Puxe para redimensionar largura' : 'Redimensionamento disponível no desktop'}
                    onMouseDown={(e) => startResizeX(e, widget)}
                    onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  />
                  <div
                    className="absolute bottom-0 left-0 z-20 w-full h-4 cursor-ns-resize opacity-60 hover:opacity-100 transition-opacity"
                    title={window.innerWidth >= 1024 ? 'Puxe para redimensionar altura' : 'Redimensionamento disponível no desktop'}
                    onMouseDown={(e) => startResizeY(e, widget)}
                    onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  />

                  <div className={`${isDragging ? 'pointer-events-none' : ''} flex-1 min-h-0`}>
                    <Component view="network" clientId={id} />
                  </div>
                </div>
              );
            })}

            {activeWidgets.length === 0 && (
              <div className="col-span-full py-20 text-center text-gray-500">
                <p>Nenhum widget configurado para visualização.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}