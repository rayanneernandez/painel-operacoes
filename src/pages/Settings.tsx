import { useState, useEffect, useCallback, useRef, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings as SettingsIcon, Save, LayoutDashboard, Plus, X, ArrowUp, ArrowDown, GripVertical, Building2, Eye, Edit3, Monitor, CheckCircle2, Bot, Clock, RefreshCw, AlertCircle, RotateCcw } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { AVAILABLE_WIDGETS, WIDGET_MAP } from '../components/DashboardWidgets';
import type { WidgetType } from '../components/DashboardWidgets';
import supabase from '../lib/supabase';

// ── Bot Config Types ──────────────────────────────────────────
interface BotConfig {
  id?: string;
  horario_execucao: string;
  timeout_email_seg: number;
}

const emptyBotConfig = (): BotConfig => ({
  horario_execucao: '07:00',
  timeout_email_seg: 1200,
});

const GRID_AUTO_ROW_PX = 96;
const GRID_ROW_GAP_PX = 16;
const PREVIEW_TOTAL_VISITORS = 2412;
const PREVIEW_AVG_VISITORS_PER_DAY = 1206;
const PREVIEW_AVG_VISIT_SECONDS = 13;
const PREVIEW_AVG_ATTENTION_SECONDS = 9;
const PREVIEW_QUARTER_DATA = [
  { label: 'MAR', visitors: 223500, sales: 0 },
  { label: 'ABR', visitors: 265200, sales: 0 },
  { label: 'MAI', visitors: 110024, sales: 0 },
];
const PREVIEW_GENDER_DATA = [
  { label: 'Masculino', value: 68 },
  { label: 'Feminino', value: 32 },
];
const PREVIEW_DAILY_DATA = [25300, 24800, 25050, 29200, 17900, 9200, 6400];
const PREVIEW_HOURLY_DATA = [12, 16, 20, 24, 28, 40, 82, 164, 302, 688, 502, 188, 126, 132, 148, 186, 210, 224, 238, 212, 174, 120, 68, 30];
const PREVIEW_AGE_DATA = [
  { age: '1-19', m: 8, f: 7 },
  { age: '20-29', m: 23, f: 18 },
  { age: '30-45', m: 16, f: 13 },
  { age: '46-100', m: 10, f: 5 },
];
const PREVIEW_ATTR_DATA = [
  { label: 'Óculos', value: 34 },
  { label: 'Barba', value: 27 },
  { label: 'Chapéu/Boné', value: 11 },
  { label: '_glasses_none', value: 66 },
  { label: '_glasses_usual', value: 24 },
  { label: '_glasses_dark', value: 10 },
  { label: '_facial_shaved', value: 42 },
  { label: '_facial_beard', value: 31 },
  { label: '_facial_goatee', value: 17 },
  { label: '_facial_mustache', value: 10 },
];
const PREVIEW_HAIR_TYPE_DATA = [
  { label: 'normal', value: 46 },
  { label: 'receding', value: 29 },
  { label: 'bald', value: 18 },
  { label: 'covered', value: 7 },
];
const PREVIEW_HAIR_COLOR_DATA = [
  { label: 'black', value: 39 },
  { label: 'brown', value: 31 },
  { label: 'blonde', value: 16 },
  { label: 'gray', value: 9 },
  { label: 'red', value: 5 },
];
const PREVIEW_DEVICE_FLOW_AUDIENCE = [
  { label: 'Assai Campinas Abolicao FL144', value: 25.2 },
  { label: 'Assai Penha Tiquatira FL275', value: 18.5 },
  { label: 'Assai Nacoes Unidas FL199', value: 13.4 },
  { label: 'Assai Barueri FL337', value: 12.9 },
];
const PREVIEW_DEVICE_TYPE_AUDIENCE = [
  { label: 'camera loja 1', value: 28.3 },
  { label: 'caixa loja 1', value: 16.5 },
  { label: 'gondola loja 1', value: 9.8 },
];
const PREVIEW_TRACKING_DATA = [
  { label: 'entrada -> caixa', value: 19.0, count: 458 },
  { label: 'entrada -> totem', value: 17.7, count: 427 },
  { label: 'entrada -> totem -> caixa', value: 2.9, count: 70 },
  { label: 'entrada -> led', value: 2.7, count: 65 },
  { label: 'entrada -> gondola maquiagem', value: 2.6, count: 63 },
  { label: 'entrada -> totem -> caixa -> gondola perfumaria', value: 0.7, count: 17 },
  { label: 'entrada -> totem conveniencia -> caixa', value: 0.3, count: 8 },
];
const PREVIEW_FACIAL_LABELS = ['01/05', '02/05', '03/05', '04/05', '05/05', '06/05', '07/05'];
const PREVIEW_FACIAL_SERIES = [
  { label: 'Neutro', values: [42, 44, 46, 40, 45, 43, 41], color: '#60a5fa' },
  { label: 'Felicidade', values: [18, 20, 22, 21, 19, 23, 24], color: '#fbbf24' },
  { label: 'Surpresa', values: [4, 6, 5, 7, 5, 4, 6], color: '#22c55e' },
  { label: 'Raiva', values: [2, 3, 2, 4, 3, 2, 2], color: '#fb7185' },
];
const GRID_SPAN_TO_HEIGHT: Record<number, number> = {
  2: (GRID_AUTO_ROW_PX * 2) + GRID_ROW_GAP_PX,
  3: (GRID_AUTO_ROW_PX * 3) + (GRID_ROW_GAP_PX * 2),
  4: (GRID_AUTO_ROW_PX * 4) + (GRID_ROW_GAP_PX * 3),
  5: (GRID_AUTO_ROW_PX * 5) + (GRID_ROW_GAP_PX * 4),
};
const RECOMMENDED_WIDGET_HEIGHTS: Record<string, number> = {
  chart_sales_quarter: GRID_SPAN_TO_HEIGHT[2],
  flow_trend: GRID_SPAN_TO_HEIGHT[3],
  hourly_flow: GRID_SPAN_TO_HEIGHT[3],
  chart_facial_expressions: GRID_SPAN_TO_HEIGHT[3],
  chart_device_flow: GRID_SPAN_TO_HEIGHT[4],
  device_type_audience: GRID_SPAN_TO_HEIGHT[4],
  age_pyramid: GRID_SPAN_TO_HEIGHT[3],
  chart_age_ranges: GRID_SPAN_TO_HEIGHT[3],
  gender_dist: GRID_SPAN_TO_HEIGHT[3],
  attributes: GRID_SPAN_TO_HEIGHT[3],
  chart_vision: GRID_SPAN_TO_HEIGHT[3],
  chart_facial_hair: GRID_SPAN_TO_HEIGHT[3],
  chart_hair_type: GRID_SPAN_TO_HEIGHT[3],
  chart_hair_color: GRID_SPAN_TO_HEIGHT[3],
  heatmap: GRID_SPAN_TO_HEIGHT[5],
  campaigns: GRID_SPAN_TO_HEIGHT[3],
};

export function Settings() {
  const navigate = useNavigate();
  const { user } = useAuth();

  // ── Section Tabs ─────────────────────────────────────────────
  const [activeSection, setActiveSection] = useState<'dashboard' | 'bot'>('dashboard');

  // ── Bot Config State ─────────────────────────────────────────
  const [botConfig, setBotConfig]           = useState<BotConfig>(emptyBotConfig());
  const [botSaveStatus, setBotSaveStatus]   = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [botLoading, setBotLoading]         = useState(false);

  useEffect(() => {
    if (!user) return;
    if (user.role !== 'admin') {
      if (user.role === 'client' && user.clientId) navigate(`/clientes/${user.clientId}/dashboard-config`, { replace: true });
      else navigate('/', { replace: true });
    }
  }, [navigate, user]);
  // Dashboard Config State
  const [activeWidgets, setActiveWidgets] = useState<WidgetType[]>([]);
  const [availableWidgets, setAvailableWidgets] = useState<WidgetType[]>([]);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  const SPANS = [3, 4, 6, 8, 12] as const;
  type Span = typeof SPANS[number];
  const [widgetLayout, setWidgetLayout] = useState<Record<string, { colSpanLg?: Span; heightPx?: number }>>({});

  // Clients State
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);

  // Scope and View Mode
  const [selectedScope, setSelectedScope] = useState<string>('global'); // 'global' or client ID
  const [dashboardView, setDashboardView] = useState<'edit' | 'preview'>('edit');
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [configReloadKey, setConfigReloadKey] = useState(0);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  useEffect(() => {
    // Fetch Clients for Dropdown
    const fetchClients = async () => {
      try {
        const { data, error } = await supabase.from('clients').select('id, name').order('name');
        if (error) throw error;
        setClients(data || []);
      } catch (error) {
        console.error('Erro ao buscar clientes:', error);
      }
    };
    fetchClients();
  }, []);

  // ── Bot Config: Carregar ──────────────────────────────────────
  useEffect(() => {
    if (activeSection !== 'bot') return;
    setBotLoading(true);
    supabase.from('bot_configs').select('id, horario_execucao, timeout_email_seg').limit(1).maybeSingle()
      .then(({ data }) => {
        if (data) setBotConfig({
          id:               data.id,
          horario_execucao: data.horario_execucao  || '07:00',
          timeout_email_seg: data.timeout_email_seg || 1200,
        });
        setBotLoading(false);
      });
  }, [activeSection]);

  // ── Bot Config: Salvar ────────────────────────────────────────
  const handleBotSave = async () => {
    setBotSaveStatus('saving');
    try {
      const payload = {
        horario_execucao:  botConfig.horario_execucao,
        timeout_email_seg: botConfig.timeout_email_seg,
        updated_at:        new Date().toISOString(),
      };
      if (botConfig.id) {
        const { error } = await supabase.from('bot_configs').update(payload).eq('id', botConfig.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('bot_configs').insert(payload).select().single();
        if (error) throw error;
        if (data) setBotConfig(prev => ({ ...prev, id: data.id }));
      }
      setBotSaveStatus('saved');
      setTimeout(() => setBotSaveStatus('idle'), 3000);
    } catch (e) {
      console.error('Erro ao salvar configuração do bot:', e);
      setBotSaveStatus('error');
      setTimeout(() => setBotSaveStatus('idle'), 4000);
    }
  };

  const normalizeSpan = (v: any) => {
    const n = Number(v);
    return (SPANS as readonly number[]).includes(n) ? (n as (typeof SPANS)[number]) : null;
  };

  const defaultSpanForSize = (size: WidgetType['size']) => {
    if (size === 'full') return 12;
    if (size === 'third') return 4;
    if (size === 'quarter') return 3;
    if (size === '2/3') return 8;
    return 6;
  };

  const clampNum = (v: any, min: number, max: number, fallback: number) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  };

  const getMinHeightPx = (widgetId: string) => {
    const w = AVAILABLE_WIDGETS.find((x) => x.id === widgetId);
    if (!w) return 80;
    if (w.type === 'kpi') return 12;
    if (w.type === 'table') return GRID_SPAN_TO_HEIGHT[2];
    const recommended = RECOMMENDED_WIDGET_HEIGHTS[widgetId];
    if (Number.isFinite(recommended)) return recommended;
    return 80;
  };

  const getResizeStepPx = (widgetId: string) => {
    const w = AVAILABLE_WIDGETS.find((x) => x.id === widgetId);
    if (w?.type === 'kpi') return 1;
    return GRID_AUTO_ROW_PX + GRID_ROW_GAP_PX;
  };

  const getDefaultHeightPx = (widget: WidgetType) => {
    if (widget.type === 'kpi') return 48;
    const recommended = RECOMMENDED_WIDGET_HEIGHTS[widget.id];
    if (Number.isFinite(recommended)) return recommended;
    return NaN;
  };

  const normalizeWidgetHeightPx = (widgetId: string, raw: any, fallback = NaN) => {
    const minHeight = getMinHeightPx(widgetId);
    const clamped = clampNum(raw, minHeight, 1200, fallback);
    if (!Number.isFinite(clamped)) return fallback;
    const widget = AVAILABLE_WIDGETS.find((x) => x.id === widgetId);
    if (widget?.type === 'kpi') return Math.round(clamped);
    const rowUnit = GRID_AUTO_ROW_PX + GRID_ROW_GAP_PX;
    const snappedSpan = Math.max(2, Math.round((clamped + GRID_ROW_GAP_PX) / rowUnit));
    const snappedHeight = (snappedSpan * rowUnit) - GRID_ROW_GAP_PX;
    return Math.max(minHeight, Math.min(1200, snappedHeight));
  };

  const computeRowSpan = (widget: WidgetType, heightPx?: number): number => {
    if (widget.type === 'kpi') return 1;
    const fallbackSpan =
      widget.id === 'campaigns' ? 3 :
      widget.type === 'table' ? 3 :
      widget.size === 'full' ? 3 : 2;
    if (!Number.isFinite(Number(heightPx))) return fallbackSpan;
    const resolvedHeightPx = Math.max(1, Math.round(Number(heightPx)));
    return Math.max(1, Math.ceil((resolvedHeightPx + GRID_ROW_GAP_PX) / (GRID_AUTO_ROW_PX + GRID_ROW_GAP_PX)));
  };

  const resolveDashboardConfig = (widgetsConfig: any): { ids: string[] | null; widgetLayout: Record<string, { colSpanLg?: Span; heightPx?: number }> } => {
    const ids = Array.isArray(widgetsConfig)
      ? widgetsConfig.filter((x) => typeof x === 'string')
      : widgetsConfig && Array.isArray(widgetsConfig.widget_ids)
        ? widgetsConfig.widget_ids.filter((x: any) => typeof x === 'string')
        : null;

    const rawLayout = widgetsConfig && typeof widgetsConfig === 'object' ? (widgetsConfig.widget_layout ?? widgetsConfig.widgetLayout) : null;
    const wl: Record<string, { colSpanLg?: Span; heightPx?: number }> = {};
    if (rawLayout && typeof rawLayout === 'object') {
      for (const [wid, cfg] of Object.entries(rawLayout)) {
        const id = String(wid);
        const span = normalizeSpan((cfg as any)?.colSpanLg ?? cfg);
        const heightPx = normalizeWidgetHeightPx(id, (cfg as any)?.heightPx, NaN);

        if (span) wl[id] = { ...(wl[id] || {}), colSpanLg: span };
        if (Number.isFinite(heightPx)) wl[id] = { ...(wl[id] || {}), heightPx: Math.round(heightPx) };
      }
    }

    return { ids, widgetLayout: wl };
  };

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const isGlobal = selectedScope === 'global';

      const fetchConfig = async (scope: 'global' | 'client') => {
        const q = supabase
          .from('dashboard_configs')
          .select('widgets_config, updated_at')
          .eq('layout_name', scope)
          .order('updated_at', { ascending: false })
          .limit(1);

        const { data } = scope === 'global'
          ? await q.is('client_id', null)
          : await q.eq('client_id', selectedScope);

        return data?.[0]?.widgets_config ?? null;
      };

      let widgetsConfig = await fetchConfig(isGlobal ? 'global' : 'client');
      if (!widgetsConfig && !isGlobal) widgetsConfig = await fetchConfig('global');

      let resolved = resolveDashboardConfig(widgetsConfig);

      if (!resolved.ids) {
        const storageKey = isGlobal ? 'dashboard-config-global' : `dashboard-config-${selectedScope}`;
        const savedConfig = localStorage.getItem(storageKey);
        if (savedConfig) resolved = resolveDashboardConfig(JSON.parse(savedConfig));
        if (!resolved.ids && !isGlobal) {
          const globalConfig = localStorage.getItem('dashboard-config-global');
          if (globalConfig) resolved = resolveDashboardConfig(JSON.parse(globalConfig));
        }
      }

      const defaultIds = ['kpi_total_visitors', 'kpi_avg_visitors_day', 'kpi_avg_visit_time', 'kpi_attention_time', 'flow_trend', 'hourly_flow', 'age_pyramid', 'gender_dist', 'attributes', 'chart_device_flow', 'device_type_audience', 'campaigns'];
      const finalIds = resolved.ids && resolved.ids.length
        ? resolved.ids
        : defaultIds;

      const active = finalIds
        .map((wid) => AVAILABLE_WIDGETS.find((w) => w.id === wid))
        .filter(Boolean) as WidgetType[];
      const available = AVAILABLE_WIDGETS.filter((w) => !finalIds.includes(w.id));

      if (!cancelled) {
        setActiveWidgets(active);
        setAvailableWidgets(available);
        setWidgetLayout(resolved.widgetLayout);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedScope, configReloadKey]);

  const addWidget = (widget: WidgetType) => {
    setActiveWidgets([...activeWidgets, widget]);
    setAvailableWidgets(availableWidgets.filter(w => w.id !== widget.id));
    setSaveStatus('idle');
  };

  const removeWidget = (widget: WidgetType) => {
    setAvailableWidgets([...availableWidgets, widget]);
    setActiveWidgets(activeWidgets.filter(w => w.id !== widget.id));
    setWidgetLayout((prev) => {
      const next = { ...prev };
      delete next[widget.id];
      return next;
    });
    setSaveStatus('idle');
  };

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

  const closestSpan = (n: number): Span => {
    let best: Span = SPANS[0];
    let bestDist = Number.POSITIVE_INFINITY;
    for (const s of SPANS) {
      const d = Math.abs(s - n);
      if (d < bestDist) { best = s; bestDist = d; }
    }
    return best;
  };

  const onResizeMove = useCallback((e: MouseEvent) => {
    const r = resizingRef.current;
    if (!r) return;

    if (r.mode === 'x') {
      const colW = Math.max(1, r.gridWidth / 12);
      const raw = r.startSpan + (e.clientX - r.startX) / colW;
      const snapped = closestSpan(Math.max(3, Math.min(12, Math.round(raw))));

      setWidgetLayout((prev) => {
        const next = { ...prev };
        const prevCfg = next[r.widgetId] || {};
        if (Number(snapped) === Number(r.defaultSpan)) {
          const { heightPx } = prevCfg as any;
          if (heightPx == null) delete next[r.widgetId];
          else next[r.widgetId] = { heightPx };
        } else {
          next[r.widgetId] = { ...prevCfg, colSpanLg: snapped };
        }
        return next;
      });
      setSaveStatus('idle');
      return;
    }

    const minH = getMinHeightPx(r.widgetId);
    const step = Math.max(1, getResizeStepPx(r.widgetId));
    const nextHeight = clampNum(r.startHeight + (e.clientY - r.startY), minH, 1200, r.startHeight);
    const snappedH = normalizeWidgetHeightPx(r.widgetId, Math.round(nextHeight / step) * step, minH);

    setWidgetLayout((prev) => {
      const next = { ...prev };
      const prevCfg = next[r.widgetId] || {};
      next[r.widgetId] = { ...prevCfg, heightPx: snappedH };
      return next;
    });
    setSaveStatus('idle');
  }, []);

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

    const current = Number(widgetLayout[widget.id]?.colSpanLg) || defaultSpanForSize(widget.size);
    const def = defaultSpanForSize(widget.size);
    const gridWidth = previewGridRef.current?.getBoundingClientRect().width || window.innerWidth;

    resizingRef.current = { mode: 'x', widgetId: widget.id, startX: e.clientX, startY: 0, startSpan: current, defaultSpan: def, gridWidth, startHeight: 0 };
    window.addEventListener('mousemove', onResizeMove);
    window.addEventListener('mouseup', stopResize);
  }, [onResizeMove, stopResize, widgetLayout]);

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

  const moveWidget = (index: number, direction: 'up' | 'down') => {
    const newWidgets = [...activeWidgets];
    if (direction === 'up' && index > 0) {
      [newWidgets[index], newWidgets[index - 1]] = [newWidgets[index - 1], newWidgets[index]];
    } else if (direction === 'down' && index < newWidgets.length - 1) {
      [newWidgets[index], newWidgets[index + 1]] = [newWidgets[index + 1], newWidgets[index]];
    }
    setActiveWidgets(newWidgets);
    setSaveStatus('idle');
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = "move";
    // Set a transparent drag image or customize it if needed
    // e.dataTransfer.setDragImage(e.currentTarget, 0, 0);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    
    if (draggedIndex === null || draggedIndex === index) return;

    // Real-time reordering
    const newWidgets = [...activeWidgets];
    const draggedItem = newWidgets[draggedIndex];
    
    // Remove from old position
    newWidgets.splice(draggedIndex, 1);
    // Insert at new position
    newWidgets.splice(index, 0, draggedItem);
    
    setActiveWidgets(newWidgets);
    setDraggedIndex(index);
  };

  const handleGridDragOver = (e: React.DragEvent) => {
    if (draggedIndex === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const grid = previewGridRef.current;
    if (!grid) return;
    const cards = Array.from(grid.querySelectorAll<HTMLElement>('[data-widget-card]'));
    if (cards.length === 0) return;
    const x = e.clientX;
    const y = e.clientY;
    let bestIdx = -1;
    let bestDist = Number.POSITIVE_INFINITY;
    cards.forEach((el, idx) => {
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dist = Math.hypot(x - cx, y - cy);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = idx;
      }
    });
    if (bestIdx === -1 || bestIdx === draggedIndex) return;
    const newWidgets = [...activeWidgets];
    const draggedItem = newWidgets[draggedIndex];
    newWidgets.splice(draggedIndex, 1);
    newWidgets.splice(bestIdx, 0, draggedItem);
    setActiveWidgets(newWidgets);
    setDraggedIndex(bestIdx);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setSaveStatus('idle');
  };

  const getPreviewProps = (widget: WidgetType) => {
    const scopeClientId = selectedScope === 'global' ? undefined : selectedScope;
    const props: Record<string, unknown> = { view: 'network', clientId: scopeClientId };

    if (widget.id === 'kpi_total_visitors') props.totalVisitors = PREVIEW_TOTAL_VISITORS;
    if (widget.id === 'kpi_avg_visitors_day') props.avgVisitorsPerDay = PREVIEW_AVG_VISITORS_PER_DAY;
    if (widget.id === 'kpi_avg_visit_time') props.avgVisitSeconds = PREVIEW_AVG_VISIT_SECONDS;
    if (widget.id === 'kpi_attention_time') props.avgAttentionSeconds = PREVIEW_AVG_ATTENTION_SECONDS;
    if (widget.id === 'chart_sales_quarter') props.quarterData = PREVIEW_QUARTER_DATA;
    if (widget.id === 'chart_device_flow') {
      props.visitors = PREVIEW_TOTAL_VISITORS;
      props.deviceAudience = PREVIEW_DEVICE_FLOW_AUDIENCE;
    }
    if (widget.id === 'device_type_audience') {
      props.deviceAudience = PREVIEW_DEVICE_TYPE_AUDIENCE;
      props.trackingData = PREVIEW_TRACKING_DATA;
    }
    if (widget.id === 'flow_trend') {
      props.dailyData = PREVIEW_DAILY_DATA;
      props.genderData = PREVIEW_GENDER_DATA;
    }
    if (widget.id === 'hourly_flow') {
      props.hourlyData = PREVIEW_HOURLY_DATA;
      props.genderData = PREVIEW_GENDER_DATA;
      props.totalVisitors = PREVIEW_TOTAL_VISITORS;
    }
    if (widget.id === 'age_pyramid') {
      props.ageData = PREVIEW_AGE_DATA;
      props.totalVisitors = PREVIEW_TOTAL_VISITORS;
    }
    if (widget.id === 'chart_age_ranges') props.ageData = PREVIEW_AGE_DATA;
    if (widget.id === 'gender_dist') {
      props.genderData = PREVIEW_GENDER_DATA;
      props.totalVisitors = PREVIEW_TOTAL_VISITORS;
    }
    if (widget.id === 'attributes' || widget.id === 'chart_vision' || widget.id === 'chart_facial_hair') {
      props.attrData = PREVIEW_ATTR_DATA;
    }
    if (widget.id === 'chart_hair_type') props.hairTypeData = PREVIEW_HAIR_TYPE_DATA;
    if (widget.id === 'chart_hair_color') props.hairColorData = PREVIEW_HAIR_COLOR_DATA;
    if (widget.id === 'chart_facial_expressions') {
      props.startDate = '2026-05-01';
      props.endDate = '2026-05-07';
      props.labels = PREVIEW_FACIAL_LABELS;
      props.series = PREVIEW_FACIAL_SERIES;
    }
    if (widget.id === 'campaigns') {
      props.clientId = scopeClientId;
      props.lojaFilter = null;
    }

    return props;
  };

  const handleSave = async () => {
    setSaveStatus('saving');

    try {
      const isGlobal = selectedScope === 'global';
      const layoutName: 'global' | 'client' = isGlobal ? 'global' : 'client';
      const clientId = isGlobal ? null : selectedScope;
      const widgetIds = activeWidgets.map((w) => w.id);

      const widgetLayoutPayload: Record<string, { colSpanLg?: number; heightPx?: number }> = {};
      Object.entries(widgetLayout).forEach(([wid, cfg]) => {
        const span = normalizeSpan((cfg as any)?.colSpanLg);
        const h = normalizeWidgetHeightPx(wid, (cfg as any)?.heightPx, NaN);
        if (span) widgetLayoutPayload[wid] = { ...(widgetLayoutPayload[wid] || {}), colSpanLg: span };
        if (Number.isFinite(h)) widgetLayoutPayload[wid] = { ...(widgetLayoutPayload[wid] || {}), heightPx: Math.round(h) };
      });

      const findQ = supabase
        .from('dashboard_configs')
        .select('id, updated_at')
        .eq('layout_name', layoutName)
        .order('updated_at', { ascending: false })
        .limit(1);

      const { data: existing } = clientId == null
        ? await findQ.is('client_id', null)
        : await findQ.eq('client_id', clientId);

      const existingId = existing?.[0]?.id as string | undefined;
      const payload = {
        layout_name: layoutName,
        client_id: clientId,
        widgets_config: { widget_ids: widgetIds, widget_layout: widgetLayoutPayload },
        updated_at: new Date().toISOString(),
      };

      if (existingId) {
        const { error } = await supabase.from('dashboard_configs').update(payload).eq('id', existingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('dashboard_configs').insert({ id: crypto.randomUUID(), ...payload });
        if (error) throw error;
      }

      const storageKey = isGlobal ? 'dashboard-config-global' : `dashboard-config-${selectedScope}`;
      localStorage.setItem(storageKey, JSON.stringify({ widget_ids: widgetIds, widget_layout: widgetLayoutPayload }));

      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (e) {
      console.error('Erro ao salvar dashboard_configs:', e);
      setSaveStatus('idle');
    }
  };

  const handleResetScopeToGlobal = () => {
    if (selectedScope === 'global') return;
    setResetConfirmOpen(true);
  };

  const confirmResetScopeToGlobal = async () => {
    if (selectedScope === 'global') return;

    setSaveStatus('saving');
    try {
      const { error } = await supabase
        .from('dashboard_configs')
        .delete()
        .eq('layout_name', 'client')
        .eq('client_id', selectedScope);
      if (error) throw error;
      localStorage.removeItem(`dashboard-config-${selectedScope}`);
      setResetConfirmOpen(false);
      setSaveStatus('saved');
      setConfigReloadKey((v) => v + 1);
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (e) {
      console.error('Erro ao resetar dashboard da rede para o padrão global:', e);
      setSaveStatus('idle');
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-20">

      {/* Top Header */}
      <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-xl backdrop-blur-sm">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <SettingsIcon className="text-indigo-500" size={28} />
            Configurações do Dashboard
          </h1>
          <p className="text-gray-400 mt-1 text-sm">Gerencie preferências globais e personalizações por rede</p>
        </div>

        {/* Section Tab Switcher */}
        <div className="flex gap-2 bg-gray-950 p-1 rounded-xl border border-gray-800">
          <button
            onClick={() => setActiveSection('dashboard')}
            className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-all ${activeSection === 'dashboard' ? 'bg-indigo-600 text-white shadow-lg' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}
          >
            <LayoutDashboard size={15} /> Dashboard
          </button>
          <button
            onClick={() => setActiveSection('bot')}
            className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-all ${activeSection === 'bot' ? 'bg-emerald-600 text-white shadow-lg' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}
          >
            <Bot size={15} /> Bot DisplayForce
          </button>
        </div>
        
        {activeSection === 'dashboard' && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-gray-950 px-4 py-2 rounded-xl border border-gray-800">
              <Building2 size={16} className="text-emerald-500" />
              <span className="text-sm text-gray-400">Editando:</span>
              <select
                value={selectedScope}
                onChange={(e) => setSelectedScope(e.target.value)}
                className="bg-gray-950 text-white font-medium focus:outline-none min-w-[150px] rounded-md px-2 py-1 border border-gray-800"
              >
                <option value="global" style={{ backgroundColor: '#0b1220', color: 'white' }}>Padrão Global</option>
                {clients.map(client => (
                  <option key={client.id} value={client.id} style={{ backgroundColor: '#0b1220', color: 'white' }}>{client.name}</option>
                ))}
              </select>
            </div>
            {selectedScope !== 'global' && (
              <button
                onClick={handleResetScopeToGlobal}
                type="button"
                aria-label="Voltar ao padrão global"
                title="Voltar ao padrão global"
                className="group inline-flex h-10 w-10 items-center justify-center rounded-full border border-gray-700/70 bg-gray-950/50 text-gray-400 transition-all hover:border-indigo-500/40 hover:bg-indigo-500/10 hover:text-indigo-200 active:scale-95"
              >
                <RotateCcw size={15} className="transition-transform duration-200 group-hover:-rotate-45" />
              </button>
            )}
            <button
              onClick={handleSave}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-6 py-2.5 rounded-xl flex items-center gap-2 transition-all shadow-lg shadow-indigo-900/20 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
            >
              {saveStatus === 'saved' ? <CheckCircle2 size={18} /> : <Save size={18} />}
              {saveStatus === 'saving' ? 'Salvando...' : saveStatus === 'saved' ? 'Salvo!' : 'Salvar'}
            </button>
          </div>
        )}
        {activeSection === 'bot' && (
          <button
            onClick={handleBotSave}
            disabled={botSaveStatus === 'saving'}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium px-6 py-2.5 rounded-xl flex items-center gap-2 transition-all shadow-lg active:scale-95"
          >
            {botSaveStatus === 'saving' ? <RefreshCw size={16} className="animate-spin" /> : botSaveStatus === 'saved' ? <CheckCircle2 size={16} /> : botSaveStatus === 'error' ? <AlertCircle size={16} /> : <Save size={16} />}
            {botSaveStatus === 'saving' ? 'Salvando...' : botSaveStatus === 'saved' ? 'Salvo!' : botSaveStatus === 'error' ? 'Erro ao salvar' : 'Salvar Configurações'}
          </button>
        )}
      </div>

      {/* Content Area */}
      <div className="min-h-[500px]">

        {/* DASHBOARD CONFIGURATION */}
        {activeSection === 'dashboard' && (
        <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
            
            {/* Dashboard Sub-Tabs */}
            <div className="flex gap-2 bg-gray-900/50 p-1 rounded-lg w-fit border border-gray-800">
               <button 
                 onClick={() => setDashboardView('edit')}
                 className={`px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition-all ${dashboardView === 'edit' ? 'bg-indigo-600 text-white shadow-lg' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}
               >
                 <Edit3 size={16} /> Configuração / Editor
               </button>
               <button 
                 onClick={() => setDashboardView('preview')}
                 className={`px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition-all ${dashboardView === 'preview' ? 'bg-emerald-600 text-white shadow-lg' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}
               >
                 <Eye size={16} /> Pré-visualização Real
               </button>
            </div>

            {/* EDITOR MODE */}
            {dashboardView === 'edit' && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Available Widgets */}
                <div className="lg:col-span-1 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Widgets Disponíveis</h3>
                    <span className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full">{availableWidgets.length}</span>
                  </div>
                  <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                    {availableWidgets.map(widget => (
                      <div key={widget.id} className="bg-gray-900 border border-gray-800 p-4 rounded-xl flex items-center justify-between group hover:border-gray-600 hover:bg-gray-800 transition-all shadow-sm">
                        <div>
                          <p className="text-sm font-bold text-white">{widget.title}</p>
                          <p className="text-[10px] text-gray-400 uppercase mt-1 bg-gray-950 inline-block px-2 py-0.5 rounded border border-gray-800">{widget.size}</p>
                        </div>
                        <button onClick={() => addWidget(widget)} className="p-2 bg-gray-950 text-emerald-500 rounded-lg hover:bg-emerald-500 hover:text-white transition-colors border border-gray-800 hover:border-emerald-500">
                          <Plus size={18} />
                        </button>
                      </div>
                    ))}
                    {availableWidgets.length === 0 && (
                      <div className="p-8 text-center border-2 border-dashed border-gray-800 rounded-xl">
                        <p className="text-gray-500 text-sm">Todos os widgets adicionados</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Active Layout */}
                <div className="lg:col-span-2 space-y-4">
                   <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Layout Ativo ({selectedScope === 'global' ? 'Global' : 'Rede Selecionada'})</h3>
                      <p className="text-xs text-gray-500">Arraste para reordenar</p>
                   </div>

                   <div className="bg-gray-950/50 border border-gray-800 rounded-2xl p-6 min-h-[400px] space-y-3">
                      {activeWidgets.map((widget, index) => (
                        <div key={widget.id} className="flex items-center gap-4 bg-gray-900 border border-gray-800 p-4 rounded-xl group hover:border-indigo-500/50 transition-all shadow-sm">
                          <span className="text-gray-600 cursor-move group-hover:text-indigo-400 transition-colors"><GripVertical size={20} /></span>
                          <span className="w-8 h-8 rounded-lg bg-gray-950 flex items-center justify-center text-sm font-bold text-gray-500 border border-gray-800">{index + 1}</span>
                          <div className="flex-1">
                            <p className="text-base font-bold text-white">{widget.title}</p>
                            <p className="text-xs text-gray-400">{widget.description}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex bg-gray-950 rounded-lg border border-gray-800 overflow-hidden">
                              <button onClick={() => moveWidget(index, 'up')} disabled={index === 0} className="p-2 text-gray-500 hover:text-white hover:bg-gray-800 disabled:opacity-30 border-r border-gray-800"><ArrowUp size={16} /></button>
                              <button onClick={() => moveWidget(index, 'down')} disabled={index === activeWidgets.length - 1} className="p-2 text-gray-500 hover:text-white hover:bg-gray-800 disabled:opacity-30"><ArrowDown size={16} /></button>
                            </div>
                            <button onClick={() => removeWidget(widget)} className="p-2 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors ml-2"><X size={18} /></button>
                          </div>
                        </div>
                      ))}
                      {activeWidgets.length === 0 && (
                         <div className="h-full flex flex-col items-center justify-center text-gray-500 py-20">
                            <LayoutDashboard size={48} className="mb-4 opacity-20" />
                            <p>Nenhum widget selecionado</p>
                            <p className="text-sm">Adicione widgets do painel à esquerda</p>
                         </div>
                      )}
                   </div>
                </div>
              </div>
            )}

            {/* PREVIEW MODE */}
            {dashboardView === 'preview' && (
              <div className="bg-gray-950 border border-gray-800 rounded-2xl p-6 animate-in zoom-in-95 duration-300">
                <div className="mb-6 flex items-center justify-between border-b border-gray-800 pb-4">
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                     <Monitor size={20} className="text-emerald-500" />
                     Pré-visualização: {selectedScope === 'global' ? 'Global' : clients.find(c => c.id === selectedScope)?.name}
                  </h3>
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"/>
                    Visualização em Tempo Real
                  </div>
                </div>
                
                <div
                  ref={previewGridRef}
                  onDragOver={handleGridDragOver}
                  onDrop={(e) => { e.preventDefault(); }}
                  style={{ gridAutoFlow: 'row dense', gridAutoRows: `${GRID_AUTO_ROW_PX}px` }}
                  className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-4 p-4 items-stretch content-start"
                >
                  {activeWidgets.map((widget, index) => {
                    const Component = WIDGET_MAP[widget.id];
                    if (!Component) return null;

                    let spanLg = Number(widgetLayout[widget.id]?.colSpanLg) || defaultSpanForSize(widget.size);
                    if (![3, 4, 6, 8, 12].includes(spanLg)) spanLg = defaultSpanForSize(widget.size);

                    let lgSpan = 'lg:col-span-6';
                    if (spanLg === 12) lgSpan = 'lg:col-span-12';
                    if (spanLg === 8) lgSpan = 'lg:col-span-8';
                    if (spanLg === 4) lgSpan = 'lg:col-span-4';
                    if (spanLg === 3) lgSpan = 'lg:col-span-3';

                    const mdSpan = spanLg >= 8 ? 'md:col-span-2' : 'md:col-span-1';

                    const isDragging = draggedIndex === index;
                    const heightPx = Number(widgetLayout[widget.id]?.heightPx);
                    const defaultHeightPx = getDefaultHeightPx(widget);
                    const resolvedHeightPx = Number.isFinite(heightPx) ? heightPx : defaultHeightPx;
                    const rowSpan = computeRowSpan(widget, resolvedHeightPx);
                    const widgetStyle: CSSProperties = { gridRow: `span ${rowSpan}` };
                    if (widget.type === 'kpi') {
                      widgetStyle.height = '100%';
                    } else if (Number.isFinite(resolvedHeightPx)) {
                      widgetStyle.height = Math.round(Number(resolvedHeightPx));
                    }
                    const previewProps = getPreviewProps(widget);

                    return (
                      <div 
                        key={widget.id}
                        data-widget-card
                        draggable={!isResizing}
                        onDragStart={(e) => handleDragStart(e, index)}
                        onDragOver={(e) => handleDragOver(e, index)}
                        onDragEnd={handleDragEnd}
                        style={widgetStyle}
                        className={`col-span-1 ${mdSpan} ${lgSpan} relative group transition-all duration-300 overflow-hidden ${isDragging ? 'opacity-50 scale-95 border-2 border-dashed border-indigo-500 rounded-xl' : ''}`}
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
                        <div className={isDragging ? 'pointer-events-none h-full' : 'h-full'}>
                          <Component {...previewProps} />
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
        )}

        {/* BOT DISPLAYFORCE CONFIGURATION */}
        {activeSection === 'bot' && (
          <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">

            {botLoading ? (
              <div className="flex items-center justify-center py-20 text-gray-500">
                <RefreshCw size={20} className="animate-spin mr-3" /> Carregando configurações...
              </div>
            ) : (
              <>
                {/* Info */}
                <div className="bg-emerald-900/20 border border-emerald-800/50 rounded-xl p-4 flex gap-3 items-start">
                  <Bot size={18} className="text-emerald-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-emerald-300 font-medium text-sm">Bot DisplayForce</p>
                    <p className="text-gray-400 text-xs mt-1">
                      O bot acessa o DisplayForce automaticamente, exporta os relatórios <strong className="text-gray-300">"Views of visitors"</strong> de cada cliente cadastrado e atualiza o painel.
                      Novos clientes adicionados ao sistema são detectados automaticamente na próxima execução.
                    </p>
                  </div>
                </div>

                {/* Agendamento */}
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
                  <h3 className="text-white font-semibold flex items-center gap-2 text-sm uppercase tracking-wider">
                    <Clock size={15} className="text-yellow-400" /> Agendamento
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs text-gray-400 block mb-1.5">Horário de execução diária</label>
                      <div className="flex items-center bg-gray-950 border border-gray-700 rounded-lg px-3 gap-2">
                        <Clock size={14} className="text-gray-500" />
                        <input
                          type="time"
                          value={botConfig.horario_execucao}
                          onChange={e => setBotConfig(p => ({ ...p, horario_execucao: e.target.value }))}
                          className="flex-1 bg-transparent py-2.5 text-sm text-white focus:outline-none"
                        />
                      </div>
                      <p className="text-xs text-gray-600 mt-1">O bot será executado todos os dias nesse horário.</p>
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 block mb-1.5">Timeout aguardando e-mail (segundos)</label>
                      <div className="flex items-center bg-gray-950 border border-gray-700 rounded-lg px-3 gap-2">
                        <Clock size={14} className="text-gray-500" />
                        <input
                          type="number"
                          value={botConfig.timeout_email_seg}
                          onChange={e => setBotConfig(p => ({ ...p, timeout_email_seg: Number(e.target.value) }))}
                          className="flex-1 bg-transparent py-2.5 text-sm text-white focus:outline-none"
                        />
                      </div>
                      <p className="text-xs text-gray-600 mt-1">Padrão: 1200s (20 min). Tempo máximo aguardando o e-mail do DisplayForce chegar.</p>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

      </div>

      {resetConfirmOpen && selectedScope !== 'global' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
          <div className="w-full max-w-md rounded-2xl border border-gray-800 bg-gray-950 shadow-2xl shadow-black/40 overflow-hidden">
            <div className="p-5 border-b border-gray-800 bg-gradient-to-r from-indigo-500/10 to-transparent">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10 border border-indigo-500/20">
                  <RotateCcw size={18} className="text-indigo-300" />
                </div>
                <div>
                  <h3 className="text-white font-semibold">Voltar ao padrão global</h3>
                  <p className="text-sm text-gray-400 mt-1">
                    A configuração personalizada de <span className="text-white font-medium">{clients.find((c) => c.id === selectedScope)?.name ?? 'esta rede'}</span> será removida.
                  </p>
                </div>
              </div>
            </div>
            <div className="p-5">
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100 flex items-start gap-3">
                <AlertCircle size={16} className="mt-0.5 text-amber-300" />
                <span>Depois disso, essa rede volta a herdar automaticamente o layout global salvo.</span>
              </div>
              <div className="mt-5 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setResetConfirmOpen(false)}
                  className="rounded-xl border border-gray-700 bg-gray-900 px-4 py-2 text-sm font-medium text-gray-300 transition hover:border-gray-600 hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={confirmResetScopeToGlobal}
                  className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-60"
                  disabled={saveStatus === 'saving'}
                >
                  {saveStatus === 'saving' ? 'Aplicando...' : 'Confirmar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
