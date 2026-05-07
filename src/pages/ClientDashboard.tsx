import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  Globe, Clock, Building2, ChevronRight, ChevronDown,
  LayoutGrid, Users, BarChart2, Image, Upload, Calendar,
  Maximize2, Minimize2, Move, Save, X, GripVertical, ArrowUp, ArrowDown, Wand2
} from 'lucide-react';

import { AVAILABLE_WIDGETS, WIDGET_MAP } from '../components/DashboardWidgets';
import type { WidgetType } from '../components/DashboardWidgets';
import { ExportButton } from '../components/ExportButton';
import supabase from '../lib/supabase';
import { FACIAL_EXPRESSION_SERIES, getDominantFacialExpression, normalizeFacialExpression } from '../utils/facialExpressions';

// ── Controle de rebuild em andamento (nível de módulo) ───────────────────────
const _rebuilding = new Set<string>();

// ── Intervalo mínimo entre syncs background (1 hora) ─────────────────────────
const SYNC_INTERVAL_MS = 10 * 60 * 1000;
const lastSyncKey = (cid: string) => `last_bg_sync_${cid}`;
const GRID_AUTO_ROW_PX = 96;
const GRID_ROW_GAP_PX = 16;
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

function shouldSync(clientId: string): boolean {
  try {
    const raw = localStorage.getItem(lastSyncKey(clientId));
    if (!raw) return true;
    const last = Number(raw);
    return Number.isFinite(last) && Date.now() - last > SYNC_INTERVAL_MS;
  } catch { return true; }
}
function markSynced(clientId: string) {
  try { localStorage.setItem(lastSyncKey(clientId), String(Date.now())); } catch {}
}

type CameraType = {
  id: string; name: string; status: 'online' | 'offline';
  type: 'dome' | 'bullet' | 'ptz'; resolution: '1080p' | '4k';
  lastEvent?: string; macAddress?: string;
};
type StoreType = {
  id: string; name: string; address: string; city: string;
  status: 'online' | 'offline'; cameras: CameraType[];
};
type ClientApiConfig = {
  api_endpoint: string; analytics_endpoint: string; api_key: string;
  custom_header_key?: string | null; custom_header_value?: string | null;
  collection_start?: string | null; collection_end?: string | null;
  collect_tracks?: boolean; collect_face_quality?: boolean;
  collect_glasses?: boolean; collect_beard?: boolean;
  collect_hair_color?: boolean; collect_hair_type?: boolean;
  collect_headwear?: boolean;
};

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

function alignUtcStartOfWeek(value: Date | string) {
  const d = alignUtcStartOfDay(value);
  const localDay = d.getDay() || 7;
  d.setDate(d.getDate() - localDay + 1);
  return d;
}

function alignUtcEndOfWeek(value: Date | string) {
  const d = alignUtcStartOfWeek(value);
  d.setDate(d.getDate() + 6);
  d.setHours(23, 59, 59, 999);
  return d;
}

function formatLocalDateKey(value: Date | string) {
  const d = value instanceof Date ? new Date(value) : new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDateInputValue(value: Date | string) {
  return formatLocalDateKey(value);
}

function parseDateInputValue(value: string, endOfDay = false) {
  const [year, month, day] = String(value || '').split('-').map(Number);
  if (!year || !month || !day) return null;
  const parsed = endOfDay
    ? new Date(year, month - 1, day, 23, 59, 59, 999)
    : new Date(year, month - 1, day, 0, 0, 0, 0);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function countInclusiveLocalDayKeys(startDay: string, endDay: string) {
  const start = parseDateInputValue(startDay);
  const end = parseDateInputValue(endDay);
  if (!start || !end) return 0;
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
}

function sumVisitorsPerDay(vpd: Record<string, number> | null | undefined) {
  return Object.values(vpd || {}).reduce((acc, value) => acc + (Number(value) || 0), 0);
}

function hasNestedMetricData(value: any): boolean {
  if (!value || typeof value !== 'object') return false;
  return Object.values(value).some((entry) => {
    if (entry && typeof entry === 'object') return hasNestedMetricData(entry);
    return Number(entry) > 0;
  });
}

function withTimeout<T>(promiseLike: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    Promise.resolve(promiseLike),
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`Timeout em ${label}`)), ms);
    }),
  ]);
}

async function fetchJsonWithTimeout<T = any>(input: RequestInfo | URL, init: RequestInit, ms: number, label: string): Promise<T | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);
  try {
    const resp = await fetch(input, { ...init, signal: controller.signal });
    return resp.ok ? await resp.json() as T : null;
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error(`Timeout em ${label}`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function rollupMetadataScore(rollup: any): number {
  if (!rollup || typeof rollup !== 'object') return 0;
  let score = 0;
  if (hasNestedMetricData(rollup.gender_percent)) score += 10;
  if (hasNestedMetricData(rollup.age_pyramid_percent)) score += 10;
  if (hasNestedMetricData(rollup.attributes_percent)) score += 20 + countPositiveMetricLeaves(rollup.attributes_percent) * 3;
  if (Number(rollup.avg_visit_time_seconds) > 0) score += 2;
  if (Number(rollup.avg_contact_time_seconds) > 0) score += 2;
  return score;
}

const ATTRIBUTE_CATEGORIES = ['glasses', 'facial_hair', 'hair_color', 'hair_type', 'headwear'] as const;

function countPositiveMetricLeaves(value: any): number {
  if (!value || typeof value !== 'object') return 0;
  let total = 0;
  for (const entry of Object.values(value)) {
    if (entry && typeof entry === 'object') {
      total += countPositiveMetricLeaves(entry);
      continue;
    }
    if (Number(entry) > 0) total += 1;
  }
  return total;
}

function getPositiveMetricValues(value: any): number[] {
  if (!value || typeof value !== 'object') return [];
  const out: number[] = [];
  for (const entry of Object.values(value)) {
    if (entry && typeof entry === 'object') {
      out.push(...getPositiveMetricValues(entry));
      continue;
    }
    const numeric = Number(entry);
    if (numeric > 0) out.push(numeric);
  }
  return out;
}

function dominantMetricShare(value: any): number {
  const values = getPositiveMetricValues(value);
  if (values.length === 0) return 0;
  const total = values.reduce((acc, current) => acc + current, 0);
  if (total <= 0) return 0;
  return Math.max(...values) / total;
}

function mergeAttributeCategories(baseAttributes: any, fallbackAttributes: any) {
  const base = baseAttributes && typeof baseAttributes === 'object' ? baseAttributes : {};
  const fallback = fallbackAttributes && typeof fallbackAttributes === 'object' ? fallbackAttributes : {};
  const merged: Record<string, any> = { ...fallback, ...base };

  for (const category of ATTRIBUTE_CATEGORIES) {
    const baseCategory = base?.[category];
    const fallbackCategory = fallback?.[category];
    const baseHasData = hasNestedMetricData(baseCategory);
    const fallbackHasData = hasNestedMetricData(fallbackCategory);
    const baseRichness = countPositiveMetricLeaves(baseCategory);
    const fallbackRichness = countPositiveMetricLeaves(fallbackCategory);
    const baseDominance = dominantMetricShare(baseCategory);

    const shouldPreferFallback =
      fallbackHasData &&
      (
        !baseHasData ||
        (baseRichness <= 1 && fallbackRichness > baseRichness) ||
        (baseRichness > 0 && fallbackRichness >= baseRichness + 2) ||
        (
          category === 'glasses' &&
          baseHasData &&
          fallbackRichness >= 2 &&
          baseDominance >= 0.985
        )
      );

    merged[category] = shouldPreferFallback
      ? (fallbackCategory ?? {})
      : (baseHasData ? baseCategory : (fallbackCategory ?? {}));
  }

  return merged;
}

function hydrateRollupMetadata(baseRollup: any, fallbackRollup: any) {
  if (!baseRollup || !fallbackRollup) return baseRollup;
  return {
    ...fallbackRollup,
    ...baseRollup,
    gender_percent: hasNestedMetricData(baseRollup.gender_percent) ? baseRollup.gender_percent : (fallbackRollup.gender_percent ?? {}),
    age_pyramid_percent: hasNestedMetricData(baseRollup.age_pyramid_percent) ? baseRollup.age_pyramid_percent : (fallbackRollup.age_pyramid_percent ?? {}),
    attributes_percent: mergeAttributeCategories(baseRollup.attributes_percent, fallbackRollup.attributes_percent),
    avg_visit_time_seconds: Number(baseRollup.avg_visit_time_seconds) > 0 ? baseRollup.avg_visit_time_seconds : (fallbackRollup.avg_visit_time_seconds ?? baseRollup.avg_visit_time_seconds ?? null),
    avg_contact_time_seconds: Number(baseRollup.avg_contact_time_seconds) > 0 ? baseRollup.avg_contact_time_seconds : (fallbackRollup.avg_contact_time_seconds ?? baseRollup.avg_contact_time_seconds ?? null),
  };
}

function countInclusiveUtcDays(startValue: Date | string, endValue: Date | string) {
  const start = startValue ? alignUtcStartOfDay(startValue) : null;
  const end = endValue ? alignUtcStartOfDay(endValue) : null;
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
}

function countRollupDays(rollup: any) {
  return countInclusiveUtcDays(rollup?.start, rollup?.end);
}

function buildFacialExpressionHourAxis(startValue: Date | string, endValue: Date | string) {
  void startValue;
  void endValue;
  const hourKeys = Array.from({ length: 24 }, (_, hour) => String(hour));
  const labels = hourKeys.map((hour) => `${hour}h`);
  return { hourKeys, labels };
}

function buildEmptyFacialExpressionSeries(length: number) {
  return FACIAL_EXPRESSION_SERIES.map(({ label }) => ({
    label,
    values: Array.from({ length }, () => 0),
  }));
}

function hasFacialExpressionSeriesData(series: Array<{ label: string; values: number[] }> | null | undefined) {
  return Array.isArray(series) && series.some((item) => Array.isArray(item?.values) && item.values.some((value) => Number(value) > 0));
}

function mergeFacialExpressionSeries(
  primarySeries: Array<{ label: string; values: number[] }> | null | undefined,
  fallbackSeries: Array<{ label: string; values: number[] }> | null | undefined,
) {
  return FACIAL_EXPRESSION_SERIES.map(({ label }) => {
    const primary = (primarySeries || []).find((entry) => String(entry?.label).toLowerCase() === label.toLowerCase());
    const fallback = (fallbackSeries || []).find((entry) => String(entry?.label).toLowerCase() === label.toLowerCase());
    const primaryValues = Array.isArray(primary?.values) ? primary.values : [];
    const fallbackValues = Array.isArray(fallback?.values) ? fallback.values : [];
    const length = Math.max(primaryValues.length, fallbackValues.length, 24);
    return {
      label,
      values: Array.from({ length }, (_, index) => {
        const primaryValue = Number(primaryValues[index] ?? 0) || 0;
        const fallbackValue = Number(fallbackValues[index] ?? 0) || 0;
        return primaryValue > 0 ? primaryValue : fallbackValue;
      }),
    };
  });
}

function rangeTouchesTodayLocal(rangeStart: string, rangeEnd: string) {
  const startDay = formatLocalDateKey(rangeStart);
  const endDay = formatLocalDateKey(rangeEnd);
  const todayDay = formatLocalDateKey(new Date());
  return startDay <= todayDay && endDay >= todayDay;
}

function normalizeFacialExpressionHourCounts(counts: any) {
  return Object.fromEntries(
    FACIAL_EXPRESSION_SERIES.map(({ key }) => [key, Number(counts?.[key] ?? 0) || 0]),
  ) as Record<'neutral' | 'happiness' | 'surprise' | 'anger', number>;
}

function buildFacialExpressionSeriesFromRows(rows: any[]) {
  const series = buildEmptyFacialExpressionSeries(24);
  const valuesByKey = new Map(FACIAL_EXPRESSION_SERIES.map(({ key }, index) => [key, series[index].values]));

  for (const row of rows || []) {
    const timestamp = typeof row?.timestamp === 'string' ? row.timestamp : null;
    if (!timestamp) continue;
    const index = new Date(timestamp).getHours();
    if (!Number.isFinite(index) || index < 0 || index > 23) continue;

    // Tenta detectar expressão; se não conseguir, usa "neutral" como padrão.
    // A API pública Displayforce só retorna smile (sem anger/surprise), então
    // a maioria das visitas sem smile=true ficaria com expression=null e seria
    // ignorada, deixando horas inteiras sem dados no gráfico.
    const expression =
      normalizeFacialExpression(row?.attributes?.facial_expression) ??
      getDominantFacialExpression(row?.raw_data) ??
      'neutral';

    const target = valuesByKey.get(expression);
    if (!target) continue;
    target[index] += 1;
  }

  return series;
}

function buildFacialExpressionSeriesFromRollups(rollups: any[], rangeStart: string, rangeEnd: string) {
  const startMs = Date.parse(rangeStart);
  const endMs = Date.parse(rangeEnd);
  const series = buildEmptyFacialExpressionSeries(24);
  const valuesByKey = new Map(FACIAL_EXPRESSION_SERIES.map(({ key }, index) => [key, series[index].values]));
  const bestHourTotals = new Map<string, number>();
  const bestHourCounts = new Map<string, Record<'neutral' | 'happiness' | 'surprise' | 'anger', number>>();
  let hasAnyData = false;

  for (const rollup of rollups || []) {
    const hourlySource = rollup?.attributes_percent?.expressions_hourly;
    if (!hourlySource || typeof hourlySource !== 'object') continue;

    for (const [hourKey, counts] of Object.entries(hourlySource)) {
      if (!counts || typeof counts !== 'object') continue;
      const bucketDate = new Date(`${hourKey}:00:00.000Z`);
      const bucketMs = bucketDate.getTime();
      if (!Number.isFinite(bucketMs) || bucketMs < startMs || bucketMs > endMs) continue;

      const normalizedCounts = normalizeFacialExpressionHourCounts(counts);
      const total = Object.values(normalizedCounts).reduce((acc, value) => acc + value, 0);
      if (total <= 0) continue;

      const currentBest = bestHourTotals.get(hourKey) ?? -1;
      if (total < currentBest) continue;

      bestHourTotals.set(hourKey, total);
      bestHourCounts.set(hourKey, normalizedCounts);
    }
  }

  for (const [hourKey, normalizedCounts] of bestHourCounts.entries()) {
    const index = new Date(`${hourKey}:00:00.000Z`).getHours();
    if (!Number.isFinite(index) || index < 0 || index > 23) continue;

    for (const { key } of FACIAL_EXPRESSION_SERIES) {
      const target = valuesByKey.get(key);
      if (!target) continue;
      target[index] += normalizedCounts[key];
      hasAnyData = hasAnyData || normalizedCounts[key] > 0;
    }
  }

  return hasAnyData ? series : null;
}

function buildLatestFacialExpressionSeriesFromRollups(rollups: any[]) {
  const dailyCandidates: Array<{
    updatedAtMs: number;
    lastBucketMs: number;
    total: number;
    hours: Array<[string, Record<'neutral' | 'happiness' | 'surprise' | 'anger', number>]>;
  }> = [];

  for (const rollup of rollups || []) {
    const hourlySource = rollup?.attributes_percent?.expressions_hourly;
    if (!hourlySource || typeof hourlySource !== 'object') continue;

    const rollupUpdatedAtMs = Date.parse(
      String(rollup?.updated_at ?? rollup?.end ?? rollup?.start ?? '')
    );
    const days = new Map<string, {
      updatedAtMs: number;
      lastBucketMs: number;
      total: number;
      hours: Array<[string, Record<'neutral' | 'happiness' | 'surprise' | 'anger', number>]>;
    }>();

    for (const [hourKey, counts] of Object.entries(hourlySource)) {
      if (!counts || typeof counts !== 'object') continue;

      const bucketDate = new Date(`${hourKey}:00:00.000Z`);
      const bucketMs = bucketDate.getTime();
      if (!Number.isFinite(bucketMs)) continue;

      const normalizedCounts = normalizeFacialExpressionHourCounts(counts);
      const total = Object.values(normalizedCounts).reduce((acc, value) => acc + value, 0);
      if (total <= 0) continue;

      const dayKey = formatLocalDateKey(bucketDate);
      const existingDay = days.get(dayKey);
      if (existingDay) {
        existingDay.lastBucketMs = Math.max(existingDay.lastBucketMs, bucketMs);
        existingDay.total += total;
        existingDay.hours.push([hourKey, normalizedCounts]);
      } else {
        days.set(dayKey, {
          updatedAtMs: Number.isFinite(rollupUpdatedAtMs) ? rollupUpdatedAtMs : bucketMs,
          lastBucketMs: bucketMs,
          total,
          hours: [[hourKey, normalizedCounts]],
        });
      }
    }

    dailyCandidates.push(...days.values());
  }

  const bestCandidate = dailyCandidates.sort((a, b) => {
    if (b.lastBucketMs !== a.lastBucketMs) return b.lastBucketMs - a.lastBucketMs;
    if (b.updatedAtMs !== a.updatedAtMs) return b.updatedAtMs - a.updatedAtMs;
    return b.total - a.total;
  })[0];

  if (!bestCandidate) return null;

  const series = buildEmptyFacialExpressionSeries(24);
  const valuesByKey = new Map(FACIAL_EXPRESSION_SERIES.map(({ key }, index) => [key, series[index].values]));

  for (const [hourKey, normalizedCounts] of bestCandidate.hours) {
    const index = new Date(`${hourKey}:00:00.000Z`).getHours();
    if (!Number.isFinite(index) || index < 0 || index > 23) continue;

    for (const { key } of FACIAL_EXPRESSION_SERIES) {
      const target = valuesByKey.get(key);
      if (!target) continue;
      target[index] += normalizedCounts[key];
    }
  }

  return hasFacialExpressionSeriesData(series) ? series : null;
}

function extractDeviceFlowFromRollups(rollups: any[]) {
  let bestPartial: any = null;
  for (const rollup of rollups || []) {
    const deviceFlow = rollup?.attributes_percent?.device_flow;
    if (!deviceFlow || typeof deviceFlow !== 'object') continue;
    const hasAudience = Array.isArray(deviceFlow.deviceAudience) && deviceFlow.deviceAudience.length > 0;
    const hasTracking = Array.isArray(deviceFlow.trackingData) && deviceFlow.trackingData.length > 0;
    const hasLegacyTrackingLabels = Array.isArray(deviceFlow.trackingData)
      && deviceFlow.trackingData.length > 0
      && deviceFlow.trackingData.every((entry: any) => /^\d+\s+devices?$/i.test(String(entry?.label ?? '').trim()));
    // Só usa cache quando os dois blocos visuais principais estão completos.
    if (hasAudience && hasTracking && !hasLegacyTrackingLabels) return deviceFlow;
    if (!bestPartial) bestPartial = deviceFlow;
  }
  return bestPartial;
}

function overlapVisitorsForRange(rollup: any, startDay: string, endDay: string) {
  const vpd: Record<string, number> = rollup?.visitors_per_day ?? {};
  let total = 0;
  for (const [day, value] of Object.entries(vpd)) {
    const normalizedDay = day.slice(0, 10);
    if (normalizedDay < startDay || normalizedDay > endDay) continue;
    total += Number(value) || 0;
  }
  return total > 0 ? total : Number(rollup?.total_visitors ?? 0);
}

function aggregateAttributesFromRollups(rollups: any[], startDay: string, endDay: string) {
  const categories = ['glasses', 'facial_hair', 'hair_color', 'hair_type', 'headwear'];
  const targetDays = countInclusiveLocalDayKeys(startDay, endDay);
  const candidateRollups = (rollups || []).filter((rollup) => {
    if (!hasNestedMetricData(rollup?.attributes_percent)) return false;
    const days = countRollupDays(rollup);
    return days <= 7 || days === targetDays;
  });
  const out: Record<string, Record<string, number>> = {};

  for (const category of categories) {
    const weightedTotals: Record<string, number> = {};
    let totalWeight = 0;

    for (const rollup of candidateRollups) {
      const source = rollup?.attributes_percent?.[category];
      const weight = overlapVisitorsForRange(rollup, startDay, endDay);
      if (!source || typeof source !== 'object' || weight <= 0) continue;
      const entries = Object.entries(source).filter(([, value]) => Number(value) > 0);
      if (entries.length === 0) continue;
      totalWeight += weight;
      for (const [key, value] of entries) {
        weightedTotals[key] = (weightedTotals[key] || 0) + Number(value) * weight;
      }
    }

    out[category] = totalWeight > 0
      ? Object.fromEntries(
          Object.entries(weightedTotals).map(([key, value]) => [key, Number((value / totalWeight).toFixed(2))])
        )
      : {};
  }

  return out;
}

const DISPLAYFORCE_AGE_ORDER = ['1-19', '20-29', '30-45', '46-100'] as const;
const LEGACY_AGE_ORDER = ['18-', '18-24', '25-34', '35-44', '45-54', '55-64', '65+'] as const;

export function ClientDashboard() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user: authUser } = useAuth();

  const [view, setView] = useState<'network' | 'store' | 'camera'>('network');
  const [selectedStore, setSelectedStore] = useState<StoreType | null>(null);
  const [selectedCamera, setSelectedCamera] = useState<CameraType | null>(null);
  const [stores, setStores] = useState<StoreType[]>([]);
  const [clientData, setClientData] = useState<{ name: string; logo?: string } | null>(null);
  const [apiConfig, setApiConfig] = useState<ClientApiConfig | null>(null);

  const [selectedStartDate, setSelectedStartDate] = useState<Date>(() => {
    return alignUtcStartOfDay(new Date());
  });
  const [selectedEndDate, setSelectedEndDate] = useState<Date>(() => {
    return alignUtcEndOfDay(new Date());
  });
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [draftStartDate, setDraftStartDate] = useState<Date>(() => {
    return alignUtcStartOfDay(new Date());
  });
  const [draftEndDate, setDraftEndDate] = useState<Date>(() => {
    return alignUtcEndOfDay(new Date());
  });
  const autoTodayRef = useRef(true);
  const didApplyD1DefaultRef = useRef(false);
  const loadSeqRef = useRef(0);
  const latestLoadDataRef = useRef<null | (() => Promise<void>)>(null);
  const bgReloadTimeoutsRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const activeFilterKeyRef = useRef('');
  // Flag para clientes que usam D-2 como data padrão (ex: Panvel)
  const useD2DefaultRef = useRef(false);

  const [syncMessage, setSyncMessage] = useState('');
  const [isSyncingStores, setIsSyncingStores] = useState(false);
  const syncingRef = useRef(false);
  const salesSourceRef = useRef<'unknown' | 'sales_daily' | 'sales' | 'none'>('unknown');

  const [isFullscreen, setIsFullscreen] = useState(false);
  const dashboardRef = useRef<HTMLDivElement>(null);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      dashboardRef.current?.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  useEffect(() => {
    if (!syncMessage || !syncMessage.startsWith('✅')) return;
    const t = setTimeout(() => setSyncMessage(''), 5000);
    return () => clearTimeout(t);
  }, [syncMessage]);

  // Intervalo padrão do dashboard: sempre começa em "hoje".
  // O filtro aplicado continua respeitado na sessão atual, mas um reload não deve
  // reabrir a tela em um período antigo e mascarar o dia atual.
  useEffect(() => {
    const tick = () => {
      if (!autoTodayRef.current) return;
      const s = alignUtcStartOfDay(new Date());
      const e = alignUtcEndOfDay(new Date());
      if (selectedStartDate.getTime() !== s.getTime()) setSelectedStartDate(s);
      if (selectedEndDate.getTime() !== e.getTime()) setSelectedEndDate(e);
      setDraftStartDate(s);
      setDraftEndDate(e);
    };
    tick();
    const t = setInterval(tick, 60 * 1000);
    return () => clearInterval(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!showDatePicker) {
      setDraftStartDate(selectedStartDate);
      setDraftEndDate(selectedEndDate);
    }
  }, [selectedStartDate, selectedEndDate, showDatePicker]);

  // Dashboard state
  const [totalVisitors, setTotalVisitors] = useState(0);
  const [dailyStats, setDailyStats] = useState<number[]>([0, 0, 0, 0, 0, 0, 0]);
  const [hourlyStats, setHourlyStats] = useState<number[]>(new Array(24).fill(0));
  const [avgVisitorsPerDay, setAvgVisitorsPerDay] = useState(0);
  const [avgVisitSeconds, setAvgVisitSeconds] = useState(0);
  const [avgAttentionSeconds, setAvgAttentionSeconds] = useState(0);
  const [genderStats, setGenderStats] = useState<{ label: string; value: number }[]>([]);
  const [attributeStats, setAttributeStats] = useState<{ label: string; value: number }[]>([]);
  const [ageStats, setAgeStats] = useState<{ age: string; m: number; f: number }[]>([]);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const SPANS = [3, 4, 6, 8, 12] as const;
  type Span = typeof SPANS[number];
  const [widgetLayout, setWidgetLayout] = useState<Record<string, { colSpanLg?: Span; heightPx?: number }>>({});
  const [activeWidgets, setActiveWidgets] = useState<WidgetType[]>([]);
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  const [isLoadingData, setIsLoadingData] = useState(false);

  // Modo de edicao de layout (drag-and-drop inline)
  const [editLayoutMode, setEditLayoutMode] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [savingLayout, setSavingLayout] = useState(false);
  const [layoutSnapshot, setLayoutSnapshot] = useState<WidgetType[] | null>(null);

  const handleWidgetDragStart = (e: React.DragEvent, index: number) => {
    if (!editLayoutMode) return;
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', String(index)); } catch {}
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

  const widgetsGridRef = useRef<HTMLDivElement | null>(null);

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
      if (d < bestDist) { bestDist = d; bestIdx = idx; }
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

  const getDefaultHeightPx = (widget: WidgetType) => {
    if (widget.type === 'kpi') return 48;
    const recommended = RECOMMENDED_WIDGET_HEIGHTS[widget.id];
    if (Number.isFinite(recommended)) return recommended;
    return NaN;
  };

  // Mantem o layout legado quando nao ha altura personalizada; quando houver,
  // converte a altura configurada em row-span real para evitar sobreposicao.
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

  // Auto-organiza: pega todos os KPIs (cards pequenos) e move para o topo,
  // depois charts medios, depois grandes/tabelas. Preserva a ordem relativa.
  const autoArrangeWidgets = () => {
    setActiveWidgets((prev) => {
      const rank = (w: WidgetType) => {
        if (w.type === 'kpi') return 0;
        if (w.id === 'campaigns') return 3;
        if (w.type === 'table') return 2;
        return 1; // chart e demais
      };
      // Ordenacao estavel por rank, preservando ordem original como tie-break
      return [...prev]
        .map((w, i) => ({ w, i, r: rank(w) }))
        .sort((a, b) => a.r - b.r || a.i - b.i)
        .map((x) => x.w);
    });
  };

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

  const saveLayoutOrder = async () => {
    if (!id) return;
    setSavingLayout(true);
    try {
      const widgetIds = activeWidgets.map((w) => w.id);
      const widgetLayoutPayload: Record<string, { colSpanLg?: number; heightPx?: number }> = {};
      for (const w of activeWidgets) {
        const cur = widgetLayout[w.id] || {};
        const entry: { colSpanLg?: number; heightPx?: number } = {};
        if (cur.colSpanLg) entry.colSpanLg = Number(cur.colSpanLg);
        if (Number.isFinite(Number(cur.heightPx))) entry.heightPx = Math.round(Number(cur.heightPx));
        if (Object.keys(entry).length) widgetLayoutPayload[w.id] = entry;
      }
      const payload = { widget_ids: widgetIds, widget_layout: widgetLayoutPayload };

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
      } catch (err) {
        console.warn('[Dashboard] Falha ao salvar layout no Supabase:', err);
      }

      try { localStorage.setItem(`dashboard-config-user-${id}`, JSON.stringify(payload)); } catch {}

      setLayoutSnapshot(null);
      setEditLayoutMode(false);
    } catch (err) {
      console.error('[Dashboard] Erro ao salvar layout:', err);
      alert('Erro ao salvar layout. Tente novamente.');
    } finally {
      setSavingLayout(false);
    }
  };

  const [isLoadingQuarter, setIsLoadingQuarter] = useState(false);
  const [quarterBars, setQuarterBars] = useState<{ label: string; visitors: number; sales: number }[]>([]);
  const [quarterVisitorsTotal, setQuarterVisitorsTotal] = useState(0);
  const [quarterSalesTotal, setQuarterSalesTotal] = useState(0);

  const [visitorsPerDayMap, setVisitorsPerDayMap] = useState<Record<string, number>>({});
  const [hairTypeData, setHairTypeData] = useState<{ label: string; value: number }[]>([]);
  const [hairColorData, setHairColorData] = useState<{ label: string; value: number }[]>([]);
  const [facialExpressionLabels, setFacialExpressionLabels] = useState<string[]>([]);
  const [facialExpressionSeries, setFacialExpressionSeries] = useState<{ label: string; values: number[] }[]>([]);
  // deviceFlowVisitors removido — widget usa totalVisitors (KPI) como fonte única da verdade
  const [deviceFlowAudience, setDeviceFlowAudience] = useState<{ label: string; rawKey?: string; value: number; count?: number }[]>([]);
  const [deviceFlowStoreAudience, setDeviceFlowStoreAudience] = useState<{ label: string; rawKey?: string; value: number; count?: number }[]>([]);
  const [deviceFlowTracking, setDeviceFlowTracking] = useState<{ label: string; value: number; count?: number }[]>([]);
  const [isLoadingCompare, setIsLoadingCompare] = useState(false);
  const [comparePrevVisitorsPerDay, setComparePrevVisitorsPerDay] = useState<Record<string, number>>({});

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60); const sec = Math.round(s % 60);
    const h = Math.floor(m / 60); const mm = m % 60;
    return h > 0
      ? `${String(h).padStart(2,'0')}:${String(mm).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
      : `${String(mm).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  };

  const pctMapToTopData = (m: any, maxItems = 3) => {
    const entries = Object.entries(m || {})
      .map(([k, v]) => ({ label: String(k), value: Number(v) || 0 }))
      .filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
    const top = entries.slice(0, maxItems);
    const rest = entries.slice(maxItems);
    const restSum = rest.reduce((acc, r) => acc + r.value, 0);
    if (restSum > 0) top.push({ label: 'Outros', value: restSum });
    return top;
  };

  const deviceIds = useMemo(() => {
    if (view === 'camera' && selectedCamera) {
      const n = Number((selectedCamera as any).macAddress);
      return Number.isFinite(n) ? [n] : [];
    }
    if ((view === 'store' || (view === 'network' && selectedStore)) && selectedStore) {
      return selectedStore.cameras.map((c) => Number((c as any).macAddress)).filter((n) => Number.isFinite(n));
    }
    return [];
  }, [view, selectedStore, selectedCamera]);

  const deviceNameByMac = useMemo(() => {
    const map = new Map<string, string>();
    for (const store of stores) {
      for (const camera of store.cameras || []) {
        const key = String((camera as any).macAddress ?? '').trim();
        const name = String(camera?.name ?? '').trim();
        if (!key || !name) continue;
        map.set(key, name);
      }
    }
    return map;
  }, [stores]);

  // macAddress (Displayforce device ID numérico) → nome da loja
  // Usado quando deviceFlowAudience tem rawKey (dados de visitor_analytics ao vivo)
  const deviceKeyToStoreName = useMemo(() => {
    const map = new Map<string, string>();
    for (const store of stores) {
      for (const camera of store.cameras || []) {
        const key = String((camera as any).macAddress ?? '').trim();
        if (key) map.set(key, store.name);
      }
    }
    return map;
  }, [stores]);

  // nome da câmera → nome da loja
  // Fallback para quando deviceFlowAudience vem do cache do rollup (label já resolvido, sem rawKey)
  const cameraNameToStoreName = useMemo(() => {
    const map = new Map<string, string>();
    for (const store of stores) {
      for (const camera of store.cameras || []) {
        const name = String(camera?.name ?? '').trim();
        if (name) map.set(name, store.name);
      }
    }
    return map;
  }, [stores]);

  const resolveDeviceFlowLabel = useCallback((label: string) => {
    return String(label ?? '').replace(/Device\s+(\d+)/gi, (_match, rawId) => {
      const normalized = String(rawId ?? '').trim();
      return deviceNameByMac.get(normalized) || `Device ${normalized}`;
    });
  }, [deviceNameByMac]);

  // O widget de fluxo agora usa apenas visitantes filtrados como base de cálculo.

  // Índice rápido: prefixo numérico do nome da loja → store.name completo
  // Ex: "309" → "309 Panvel Dom Joaquim Posto - RS"
  const storeByNumber = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of stores) {
      const m = s.name.match(/^(\d+)\b/);
      if (m) map.set(m[1], s.name);
    }
    return map;
  }, [stores]);

  /**
   * Extrai número de filial de um label de device.
   * Suporta os formatos observados na Displayforce:
   *   "428 Dom Estreito - Entrada 1"   → "428"  (começa com número)
   *   "Filial 387 - Câmera Entrada 1"  → "387"  (padrão "Filial NNN")
   *   "Filial 21/455 - Caixa"          → "455"  (padrão "Filial NN/NNN" — usa nº após /)
   */
  const extractStoreNumber = useCallback((label: string): string | null => {
    // Formato 1: começa com dígitos
    const direct = label.match(/^(\d+)\b/);
    if (direct) return direct[1];
    // Formato 2: "Filial NNN" ou "Filial NN/NNN" — captura o último número
    // Ex: "Filial 21/455" → captura "455" (ignora o prefixo "21/")
    const filial = label.match(/\bfilial\s+(?:\d+\/)?(\d+)\b/i);
    if (filial) return filial[1];
    return null;
  }, []);

  /**
   * Resolve o device key para o nome da loja usando 3 estratégias em cascata:
   * 1. mac_address (ID numérico Displayforce) → store.name
   * 2. nome da câmera resolvido               → store.name
   * 3. número de filial no label              → store.name
   *    Detecta tanto "428 ..." quanto "Filial 428 ..."
   */
  const resolveDeviceToStore = useCallback((deviceKey: string): string | undefined => {
    let sName = deviceKeyToStoreName.get(deviceKey);
    if (sName) return sName;
    const resolved = resolveDeviceFlowLabel(`Device ${deviceKey}`);
    sName = cameraNameToStoreName.get(resolved);
    if (sName) return sName;
    const num = extractStoreNumber(resolved);
    if (num) sName = storeByNumber.get(num);
    return sName;
  }, [deviceKeyToStoreName, cameraNameToStoreName, resolveDeviceFlowLabel, storeByNumber, extractStoreNumber]);

  /**
   * Audiência por loja — recomputa automaticamente quando deviceFlowAudience
   * OU stores mudam. Isso resolve a race condition onde stores ainda estava
   * vazio quando buildDeviceFlowFromRows foi chamado pela primeira vez.
   */
  const deviceFlowAudienceByStore = useMemo(() => {
    // Inicia todas as lojas a 0 (garante que apareçam mesmo sem dados no período)
    const storeAccum = new Map<string, number>();
    const sourceAudience = deviceFlowStoreAudience.length > 0 ? deviceFlowStoreAudience : deviceFlowAudience;
    const visitorBase = Math.max(0, Number(totalVisitors) || 0);
    for (const s of stores) storeAccum.set(s.name, 0);

    for (const entry of sourceAudience) {
      // Caso 1: rawKey = ID numérico do device (dados ao vivo)
      const rawKey = String(entry?.rawKey ?? '').replace(/^Device\s+/i, '');
      let storeName: string | undefined = rawKey ? deviceKeyToStoreName.get(rawKey) : undefined;

      // Caso 2: label já é nome da câmera (dados do cache do rollup)
      if (!storeName) {
        const resolvedLabel = resolveDeviceFlowLabel(String(entry?.label ?? ''));
        storeName = cameraNameToStoreName.get(resolvedLabel);
        // Caso 3: número de filial no label ("428 Dom Estreito" → "428" / "Filial 428" → "428")
        if (!storeName) {
          const num = extractStoreNumber(resolvedLabel);
          if (num) storeName = storeByNumber.get(num);
        }
      }

      if (!storeName) continue;
      const rawCount = Number(entry?.count ?? 0);
      const fallbackCount = visitorBase > 0 ? ((Number(entry?.value) || 0) / 100) * visitorBase : 0;
      const normalizedCount = rawCount > 0 ? rawCount : fallbackCount;
      if (normalizedCount <= 0) continue;
      storeAccum.set(storeName, (storeAccum.get(storeName) || 0) + normalizedCount);
    }

    return [...storeAccum.entries()]
      .map(([label, count]) => ({
        label,
        value: visitorBase > 0 ? Number(((count / visitorBase) * 100).toFixed(1)) : 0,
      }))
      .sort((a, b) => b.value - a.value);
  }, [deviceFlowStoreAudience, deviceFlowAudience, totalVisitors, stores, deviceKeyToStoreName, cameraNameToStoreName, resolveDeviceFlowLabel, storeByNumber, extractStoreNumber]);

  const buildDeviceFlowFromRows = useCallback((rows: any[], fallback?: any, visitorBase?: number) => {
    const safeRows = Array.isArray(rows) ? rows : [];
    const resolvedVisitorBase = Number(visitorBase ?? 0) > 0
      ? Number(visitorBase)
      : (Number(fallback?.visitors ?? 0) > 0 ? Number(fallback?.visitors) : safeRows.length);

    const getDeviceKeys = (row: any): string[] => {
      const rawDevices = Array.isArray(row?.raw_data?.devices) ? row.raw_data.devices : [];
      const keys = rawDevices.map((v: any) => String(v ?? '').trim()).filter(Boolean);
      if (keys.length > 0) return Array.from(new Set<string>(keys));
      const fb = String(row?.device_id ?? '').trim();
      return fb ? [fb] : [];
    };

    const originDeviceCounts = new Map<string, number>();
    const deviceCounts = new Map<string, number>();
    for (const row of safeRows) {
      const deviceKeys = getDeviceKeys(row);
      const originDeviceKey = String(row?.device_id ?? '').trim() || deviceKeys[0] || '';
      if (originDeviceKey) {
        originDeviceCounts.set(originDeviceKey, (originDeviceCounts.get(originDeviceKey) ?? 0) + 1);
      }
      for (const dk of deviceKeys) {
        deviceCounts.set(dk, (deviceCounts.get(dk) ?? 0) + 1);
      }
    }

    const toPercent = (count: number) => (
      resolvedVisitorBase > 0 ? Number(((count / resolvedVisitorBase) * 100).toFixed(1)) : 0
    );
    const buildAudienceRows = (counts: Map<string, number>) => [...counts.entries()]
      .map(([deviceKey, count]) => ({
        label: resolveDeviceFlowLabel(`Device ${deviceKey}`),
        rawKey: deviceKey,
        count,
        value: toPercent(count),
      }))
      .sort((a, b) => b.count - a.count || b.value - a.value);

    const deviceAudience = buildAudienceRows(deviceCounts);
    const storeAudience = buildAudienceRows(originDeviceCounts);

    const formatJourneyWord = (word: string) => {
      const raw = String(word ?? '').trim();
      if (!raw) return '';
      const lower = raw.toLowerCase();
      if (lower === 'led') return 'LED';
      if (lower === 'entrada') return 'Entrada';
      if (lower === 'totem') return 'Totem';
      if (lower === 'caixa') return 'Caixa';
      if (lower === 'gondola' || lower === 'gôndola' || lower === 'gond') return 'Gôndola';
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    };
    const getJourneyStepLabel = (label: string) => {
      const resolvedLabel = resolveDeviceFlowLabel(String(label ?? ''));
      const segment = resolvedLabel.split(/\s+-\s+/).pop() ?? resolvedLabel;
      const cleaned = segment
        .replace(/\bc[âa]mera\b/gi, ' ')
        .replace(/\bdevice\b/gi, ' ')
        .replace(/[0-9]+/g, ' ')
        .replace(/[_/]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (!cleaned) return null;

      const patterns: Array<{ regex: RegExp; label: string }> = [
        { regex: /\bentrada\b/i, label: 'Entrada' },
        { regex: /\btotem\b/i, label: 'Totem' },
        { regex: /\bcaixa\b/i, label: 'Caixa' },
        { regex: /\bg[oô]ndola\b|\bgond\b/i, label: 'Gôndola' },
        { regex: /\bled\b/i, label: 'LED' },
      ];

      for (const pattern of patterns) {
        const match = cleaned.match(pattern.regex);
        if (!match || match.index == null) continue;
        const suffix = cleaned
          .slice(match.index + match[0].length)
          .trim()
          .split(/\s+/)
          .map(formatJourneyWord)
          .filter(Boolean)
          .join(' ');
        return suffix ? `${pattern.label} ${suffix}` : pattern.label;
      }

      return null;
    };
    const trackingCounts = new Map<string, number>();
    for (const row of safeRows) {
      const journey = getDeviceKeys(row)
        .map((dk) => getJourneyStepLabel(`Device ${dk}`))
        .filter((step): step is string => Boolean(step))
        .filter((step, index, list) => index === 0 || step !== list[index - 1]);
      if (journey.length < 2) continue;
      const key = journey.join(' -> ');
      trackingCounts.set(key, (trackingCounts.get(key) ?? 0) + 1);
    }
    const trackingData = [...trackingCounts.entries()]
      .map(([label, count]) => ({ label, count, value: toPercent(count) }))
      .sort((a, b) => b.count - a.count);

    const fallbackStoreAudience = Array.isArray(fallback?.storeAudience) ? fallback.storeAudience : [];
    const fallbackTracking = Array.isArray(fallback?.trackingData) ? fallback.trackingData : [];
    return {
      visitors: resolvedVisitorBase > 0 ? resolvedVisitorBase : null,
      deviceAudience,
      storeAudience: storeAudience.length > 0 ? storeAudience : fallbackStoreAudience,
      trackingData: trackingData.length > 0 ? trackingData : fallbackTracking,
    };
  }, [resolveDeviceFlowLabel]);

  useEffect(() => {
    activeFilterKeyRef.current = [
      id || '',
      selectedStartDate.toISOString(),
      selectedEndDate.toISOString(),
      deviceIds.join(','),
    ].join('|');

    bgReloadTimeoutsRef.current.forEach(clearTimeout);
    bgReloadTimeoutsRef.current = [];
  }, [id, selectedStartDate, selectedEndDate, deviceIds]);

  function applyRollup(rollup: any, options?: { updatedAt?: string | Date | null }) {
    if (!rollup) return false;
    const resolvedTotalVisitors = Math.round(Number(rollup.total_visitors ?? 0));
    const filteredDayCount = countInclusiveUtcDays(selectedStartDate, selectedEndDate);
    setTotalVisitors(resolvedTotalVisitors);
    setAvgVisitorsPerDay(
      Math.round(
        resolvedTotalVisitors /
        Math.max(filteredDayCount || countRollupDays(rollup) || 1, 1),
      ),
    );
    setAvgVisitSeconds(Math.round(rollup.avg_visit_time_seconds ?? 0));
    setAvgAttentionSeconds(Math.round(
      rollup.avg_attention_seconds ?? rollup.avg_contact_time_seconds ?? rollup.avg_attention_sec ?? 0
    ));
    const vpd: Record<string, number> = rollup.visitors_per_day ?? {};
    setVisitorsPerDayMap(vpd);
    const vph: Record<string, number> = rollup.visitors_per_hour_avg ?? {};
    const hours = new Array(24).fill(0);
    Object.entries(vph).forEach(([h, v]) => { hours[Number(h)] = Math.round(Number(v)); });
    setHourlyStats(hours);
    const gp: Record<string, number> = rollup.gender_percent ?? {};
    setGenderStats([
      { label: 'Masculino', value: Math.round(gp.male ?? 0) },
      { label: 'Feminino',  value: Math.round(gp.female ?? 0) },
    ]);
    const ap: any = rollup.attributes_percent ?? {};
    const glassesRaw = ap.glasses ?? {};
    const facialRaw  = ap.facial_hair ?? {};
    const glassesHasCats = Object.keys(glassesRaw).some(k => ['usual','dark','none'].includes(k));
    const facialHasCats  = Object.keys(facialRaw).some(k  => ['shaved','beard','goatee','stubble','mustache'].includes(k));
    const glassesWithPct = glassesHasCats
      ? Number(glassesRaw.usual ?? 0) + Number(glassesRaw.dark ?? 0)
      : Number(glassesRaw.true ?? 0);
    const glassesTotal = Math.round(glassesWithPct);
    const facialTotal = facialHasCats
      ? Math.round(Object.entries(facialRaw).filter(([k]) => k !== 'shaved').reduce((a, [, v]) => a + Number(v), 0))
      : Math.round(facialRaw.true ?? 0);
    const glassesData: { label: string; value: number }[] = glassesHasCats
      ? Object.entries(glassesRaw).filter(([, v]) => Number(v) > 0).map(([k, v]) => ({ label: k, value: Number(v) }))
      : glassesTotal > 0 ? [{ label: 'true', value: glassesTotal }, { label: 'false', value: Math.max(0, 100 - glassesTotal) }] : [];
    const facialData: { label: string; value: number }[] = facialHasCats
      ? Object.entries(facialRaw).filter(([, v]) => Number(v) > 0).map(([k, v]) => ({ label: k, value: Number(v) }))
      : facialTotal > 0 ? [{ label: 'beard', value: facialTotal }, { label: 'shaved', value: Math.max(0, 100 - facialTotal) }] : [];
    setHairTypeData(pctMapToTopData(ap.hair_type));
    setHairColorData(pctMapToTopData(ap.hair_color));
    const headwearPct = Math.round(Number(ap.headwear?.true ?? 0));
    setAttributeStats([
      { label: 'Óculos',      value: glassesTotal },
      { label: 'Barba',       value: facialTotal },
      { label: 'Máscara',     value: 0 },
      { label: 'Chapéu/Boné', value: headwearPct },
      ...glassesData.map(d => ({ label: `_glasses_${d.label}`, value: d.value })),
      ...facialData.map(d  => ({ label: `_facial_${d.label}`,  value: d.value })),
    ]);
    const agePct: Record<string, number> = rollup.age_pyramid_percent ?? {};
    const ageMap: Record<string, { m: number; f: number }> = {};
    const bucketMap: Record<string, string> = {
      '1-19': '1-19', '20-29': '20-29', '30-45': '30-45', '46-100': '46-100',
      '65-74': '65+', '75+': '65+', '55-64': '55-64', '45-54': '45-54',
      '35-44': '35-44', '25-34': '25-34', '18-24': '18-24', '0-9': '18-', '10-17': '18-',
    };
    const genderPct: Record<string, number> = rollup.gender_percent ?? {};
    const maleRatio   = (genderPct.male   ?? 50) / 100;
    const femaleRatio = (genderPct.female ?? 50) / 100;
    Object.entries(agePct).forEach(([bucket, pct]) => {
      const label = bucketMap[bucket] ?? bucket;
      if (!ageMap[label]) ageMap[label] = { m: 0, f: 0 };
      const p = Number(pct);
      ageMap[label].m += Number((p * maleRatio).toFixed(1));
      ageMap[label].f += Number((p * femaleRatio).toFixed(1));
    });
    const hasDisplayforceAgeBuckets = DISPLAYFORCE_AGE_ORDER.some((age) => age in ageMap);
    const orderedAges = hasDisplayforceAgeBuckets ? [...DISPLAYFORCE_AGE_ORDER] : [...LEGACY_AGE_ORDER];
    setAgeStats(
      orderedAges
        .map((age) => ({ age, m: ageMap[age]?.m ?? 0, f: ageMap[age]?.f ?? 0 }))
        .filter((age) => hasDisplayforceAgeBuckets || age.m > 0 || age.f > 0 || orderedAges.length === LEGACY_AGE_ORDER.length)
    );
    const updatedAtRaw = options?.updatedAt ?? rollup?.updated_at ?? null;
    if (updatedAtRaw) {
      const updatedAt = updatedAtRaw instanceof Date ? updatedAtRaw : new Date(updatedAtRaw);
      if (!Number.isNaN(updatedAt.getTime())) {
        setLastUpdate(updatedAt);
      }
    }
    return true;
  }

  function zeroAll() {
    setTotalVisitors(0); setHourlyStats(new Array(24).fill(0));
    setAvgVisitorsPerDay(0); setAvgVisitSeconds(0); setAvgAttentionSeconds(0);
    setGenderStats([]); setAttributeStats([]); setAgeStats([]);
    setVisitorsPerDayMap({}); setHairTypeData([]); setHairColorData([]);
    setFacialExpressionLabels([]);
    setFacialExpressionSeries([]);

    setDeviceFlowAudience([]);
    setDeviceFlowStoreAudience([]);
    setDeviceFlowTracking([]);

    setComparePrevVisitorsPerDay({});
  }

  const loadFacialExpressions = useCallback(async (
    clientId: string,
    rangeStart: string,
    rangeEnd: string,
    deviceFilter: number[],
    isCurrent: () => boolean,
    candidateRollups: any[] = [],
  ) => {
    const { hourKeys, labels } = buildFacialExpressionHourAxis(rangeStart, rangeEnd);
    if (hourKeys.length === 0) {
      if (isCurrent()) {
        setFacialExpressionLabels([]);
        setFacialExpressionSeries([]);
      }
      return;
    }

    const cachedSeries = buildFacialExpressionSeriesFromRollups(candidateRollups, rangeStart, rangeEnd);
    const latestStoredSeries =
      deviceFilter.length === 0
        ? buildLatestFacialExpressionSeriesFromRollups(candidateRollups)
        : null;
    const immediateSeries = cachedSeries ?? latestStoredSeries;

    // Mostra dados cacheados imediatamente enquanto carrega dados frescos
    if (immediateSeries && isCurrent()) {
      setFacialExpressionLabels(labels);
      setFacialExpressionSeries(immediateSeries);
      // NÃO retorna cedo: continua para buscar dados do período atual
      // (o rollup em cache pode estar desatualizado — só vai até o último cron)
    }

    // ── Passo 1: busca dados frescos de visitor_analytics ─────────────────
    // Com filtro de device quando loja selecionada; network-wide quando Rede Global
    const PAGE = 1000;
    const allRows: any[] = [];
    let from = 0;

    while (true) {
      let query = supabase
        .from('visitor_analytics')
        .select('timestamp,attributes,raw_data,device_id')
        .eq('client_id', clientId)
        .gte('timestamp', rangeStart)
        .lte('timestamp', rangeEnd)
        .order('timestamp', { ascending: true })
        .range(from, from + PAGE - 1);

      if (deviceFilter.length > 0) query = query.in('device_id', deviceFilter);

      const { data, error } = await withTimeout<{ data: any[] | null; error: any }>(
        query as any,
        10000,
        'visitor_analytics expressoes faciais',
      );
      if (error) {
        console.warn('[Dashboard] Erro ao carregar expressoes faciais:', error);
        break;
      }

      if (!Array.isArray(data) || data.length === 0) break;
      allRows.push(...data);
      if (data.length < PAGE) break;
      from += PAGE;
    }

    if (!isCurrent()) return;
    const rowSeries = buildFacialExpressionSeriesFromRows(allRows);
    const mergedRowSeries = mergeFacialExpressionSeries(rowSeries, immediateSeries);
    const bestSeries = hasFacialExpressionSeriesData(mergedRowSeries) ? mergedRowSeries : (immediateSeries ?? rowSeries);
    setFacialExpressionLabels(labels);
    setFacialExpressionSeries(bestSeries ?? rowSeries);

    // ── Passo 1b: sync automático quando período é hoje e dados estão desatualizados ──
    // O cron só roda uma vez por dia — se o usuário abre o dashboard às 10h,
    // visitor_analytics pode ter dados só até o último cron (~6h). As expressões
    // ficariam desatualizadas. Este trigger busca dados frescos em background
    // e atualiza o gráfico ~30s depois.
    const todayStr = new Date().toISOString().slice(0, 10);
    const rangeEndDay = String(rangeEnd).slice(0, 10);
    const rangeStartDay = String(rangeStart).slice(0, 10);
    const touchesToday = rangeStartDay <= todayStr && rangeEndDay >= todayStr;
    const currentHour = new Date().getHours();
    const rowsHaveCurrentHour = allRows.some(r => new Date(r.timestamp).getHours() === currentHour);

    if (touchesToday && !rowsHaveCurrentHour) {
      fetch('/api/sync-analytics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          background_sync: true,
          start: rangeStart,
          end: rangeEnd,
          ...(deviceFilter.length > 0 ? { devices: deviceFilter } : {}),
        }),
      }).catch(() => {});

      setTimeout(async () => {
        if (!isCurrent()) return;
        const freshRows: any[] = [];
        let fr = 0;
        while (true) {
          let q2 = supabase
            .from('visitor_analytics')
            .select('timestamp,attributes,raw_data,device_id')
            .eq('client_id', clientId)
            .gte('timestamp', rangeStart)
            .lte('timestamp', rangeEnd)
            .order('timestamp', { ascending: true })
            .range(fr, fr + 999);
          if (deviceFilter.length > 0) q2 = q2.in('device_id', deviceFilter);
          const { data: d2 } = await (q2 as any);
          if (!Array.isArray(d2) || d2.length === 0) break;
          freshRows.push(...d2);
          if (d2.length < 1000) break;
          fr += 1000;
        }
        if (!isCurrent() || freshRows.length === 0) return;
        const freshSeries = buildFacialExpressionSeriesFromRows(freshRows);
        if (hasFacialExpressionSeriesData(freshSeries)) {
          setFacialExpressionLabels(labels);
          setFacialExpressionSeries(freshSeries);
        }
      }, 30000);
    }

    // ── Passo 2: chama a API v5 Displayforce para Surpresa/Raiva/Nojo em tempo real ─
    // REQUER: DISPLAYFORCE_EMAIL e DISPLAYFORCE_PASS configurados no Vercel (env vars)
    // Sem isso, surprise/anger/disgust ficam 0 pois a API pública v1 só tem 'smile'.
    // A API pública v1 só tem smile — para neutral/happiness/surprise/anger
    // precisamos da API v5 privada (cookie auth). Só vale para Rede Global
    // pois a v5 não filtra por device.
    if (deviceFilter.length === 0) {
      try {
        const liveResult = await fetchJsonWithTimeout('/api/sync-analytics', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: clientId,
            live_facial_expressions: true,
            start: rangeStart,
            end: rangeEnd,
            auth: 'painel@2026*',
          }),
        }, 12000, 'live expressions v5');
        if (isCurrent() && Array.isArray(liveResult?.series) && hasFacialExpressionSeriesData(liveResult.series)) {
          // A v5 retorna dados em UTC (values[10] = 10h UTC).
          // O gráfico usa horário LOCAL (slot 7 = 7h local = 10h UTC em BRT).
          // getTimezoneOffset() = 180 no Brasil (BRT = UTC-3).
          // Para converter UTC→local: localH = (utcH - offset/60 + 24) % 24
          const tzOffHours = new Date().getTimezoneOffset() / 60; // 3 em BRT

          const toLocalIndexed = (utcValues: number[]): number[] =>
            Array.from({ length: 24 }, (_, localH) => {
              const utcH = (localH + tzOffHours + 24) % 24;
              return utcValues[utcH] ?? 0;
            });

          const liveByLabel = new Map(
            liveResult.series.map((s: { label: string; values: number[] }) => [
              String(s.label).toLowerCase(), s
            ])
          );
          const merged = FACIAL_EXPRESSION_SERIES.map(({ label }) => {
            const liveSerie = liveByLabel.get(label.toLowerCase()) as { label: string; values: number[] } | undefined;
            const baseSerie = mergedRowSeries.find(r => String(r.label).toLowerCase() === label.toLowerCase()) as { label: string; values: number[] } | undefined;
            const rowVals: number[] = baseSerie?.values ?? new Array(24).fill(0);
            if (!liveSerie) {
              return { label, values: rowVals };
            }
            // Converte índices UTC da v5 para horário local antes de mesclar
            const liveLocal = toLocalIndexed(liveSerie.values);
            return {
              label,
              values: liveLocal.map((liveVal: number, h: number) =>
                liveVal > 0 ? liveVal : (rowVals[h] ?? 0)
              ),
            };
          });
          setFacialExpressionSeries(merged);
        }
      } catch (_) {
        // Mantém os dados das linhas — v5 API pode estar indisponível
      }
    }
  }, []);

  const loadDeviceFlowWidget = useCallback(async (
    clientId: string,
    rangeStart: string,
    rangeEnd: string,
    deviceFilter: number[],
    isCurrent: () => boolean,
    candidateRollups: any[] = [],
  ) => {
    const cached = extractDeviceFlowFromRollups(candidateRollups);
    const cachedHasAudience = Array.isArray(cached?.deviceAudience) && cached.deviceAudience.length > 0;
    const cachedHasTracking = Array.isArray(cached?.trackingData) && cached.trackingData.length > 0;
    const visitorBase = Number(candidateRollups?.[0]?.total_visitors ?? 0) || 0;
    const applyDeviceFlowState = (payload: {
      visitors?: number | null;
      deviceAudience?: { label: string; rawKey?: string; value: number; count?: number }[];
      storeAudience?: { label: string; rawKey?: string; value: number; count?: number }[];
      trackingData?: { label: string; value: number; count?: number }[];
    }) => {
      setDeviceFlowAudience(Array.isArray(payload?.deviceAudience) ? payload.deviceAudience : []);
      setDeviceFlowStoreAudience(Array.isArray(payload?.storeAudience) ? payload.storeAudience : []);
      setDeviceFlowTracking(Array.isArray(payload?.trackingData) ? payload.trackingData : []);
    };

    // Mostra dados do rollup como preview rápido enquanto o fresh carrega,
    // mas NUNCA retorna cedo: o rollup representa o período completo de coleta,
    // não o período filtrado na tela. Sem o fetch fresco, lojas que só tiveram
    // visitas no período selecionado (mas não na época do rollup) aparecem zeradas.
    if ((cachedHasAudience || cachedHasTracking) && isCurrent()) {
      applyDeviceFlowState(cached);
      // Continua abaixo para sobrescrever com dados do período selecionado
    }

    try {
      const PAGE = 1000;
      const allRows: any[] = [];
      let from = 0;

      while (true) {
        let query = supabase
          .from('visitor_analytics')
          .select('device_id,raw_data')
          .eq('client_id', clientId)
          .gte('timestamp', rangeStart)
          .lte('timestamp', rangeEnd)
          .order('timestamp', { ascending: true })
          .range(from, from + PAGE - 1);

        if (deviceFilter.length > 0) query = query.in('device_id', deviceFilter);

        const { data, error } = await withTimeout<{ data: any[] | null; error: any }>(
          query as any,
          10000,
          'visitor_analytics fluxo audiencia device',
        );
        if (error) throw error;
        if (!Array.isArray(data) || data.length === 0) break;
        allRows.push(...data);
        if (data.length < PAGE) break;
        from += PAGE;
      }

      const rebuilt = buildDeviceFlowFromRows(allRows, cached, visitorBase);
      if (!isCurrent()) return;
      applyDeviceFlowState(rebuilt);

      if (!Array.isArray(rebuilt?.trackingData) || rebuilt.trackingData.length === 0) {
        try {
          const liveFlowResult = await fetchJsonWithTimeout('/api/sync-analytics', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              client_id: clientId,
              live_device_flow: true,
              start: rangeStart,
              end: rangeEnd,
              auth: 'painel@2026*',
              ...(deviceFilter.length > 0 ? { devices: deviceFilter } : {}),
            }),
          }, 12000, 'live device flow');
          if (isCurrent() && liveFlowResult?.device_flow) {
            applyDeviceFlowState(liveFlowResult.device_flow);
          }
        } catch (_) {
          // Mantém o rebuild local quando o endpoint live estiver indisponível.
        }
      }

      // OBS: removida a chamada live_device_flow daqui. Bate apenas no banco — o cron-sync diário
      // grava attributes_percent.device_flow no rollup e o período filtrado é reconstruído do banco.
    } catch (error) {
      console.warn('[Dashboard] Falha ao carregar fluxo/audiencia device:', error);
      if (!isCurrent()) return;
      applyDeviceFlowState(cached || {});
    }
  }, [buildDeviceFlowFromRows]);

  // ── loadData: busca dados respeitando o período selecionado ──────────────
  const loadData = useCallback(async () => {
    if (!id) return;
    const seq = ++loadSeqRef.current;
    const isCurrent = () => seq === loadSeqRef.current;

    setIsLoadingData(true);
    try {
      const startAligned = alignUtcStartOfDay(selectedStartDate);
      const endAligned = alignUtcEndOfDay(selectedEndDate);
      const startIso = startAligned.toISOString();
      const endIso   = endAligned.toISOString();
      const startDay = formatLocalDateKey(selectedStartDate);
      const endDay   = formatLocalDateKey(selectedEndDate);
      const todayDay = formatLocalDateKey(new Date());
      const rangeTouchesToday = startDay <= todayDay && endDay >= todayDay;
      const syncExpressions = async (candidateRollups: any[] = []) => {
        await loadFacialExpressions(id, startIso, endIso, deviceIds, isCurrent, candidateRollups);
      };
      const syncDeviceFlow = async (candidateRollups: any[] = []) => {
        await loadDeviceFlowWidget(id, startIso, endIso, deviceIds, isCurrent, candidateRollups);
      };

      // ── Loja selecionada mas cameras ainda não carregadas (race condition) ──
      // Quando o usuário seleciona uma loja, selectedStore é definido mas
      // selectedStore.cameras pode ainda estar vazio (refreshClientAndStores
      // assíncrono). Se cairmos no caminho Rede Global com selectedStore ativo,
      // mostraríamos dados de TODA a rede para uma loja específica.
      // → Aguarda até 3s por cameras; se não carregarem, mostra zeros.
      if (selectedStore && deviceIds.length === 0) {
        zeroAll();
        // Aguarda cameras carregarem (até 3 tentativas de 1s)
        let waited = 0;
        while (waited < 3 && selectedStore && deviceIds.length === 0) {
          await new Promise(r => setTimeout(r, 1000));
          waited++;
        }
        if (!isCurrent()) return;
        if (deviceIds.length === 0) {
          // Ainda sem cameras → dispara sync e fica em zero (evita dados de rede global)
          syncStoresFromServer(true).catch(() => {});
          return;
        }
      }

      // ── Filtro por dispositivo (loja selecionada com dispositivos) ───────
      // Se há IDs de dispositivo, filtra exclusivamente por eles.
      // Limpa imediatamente os dados antigos (rede global) para não mostrar
      // dados de uma loja diferente enquanto a API responde.
      if (deviceIds.length > 0) {
        zeroAll();
        try {
          const json = await fetchJsonWithTimeout('/api/sync-analytics', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ client_id: id, start: startIso, end: endIso, rebuild_rollup: true, devices: deviceIds }),
          }, 15000, 'sync-analytics devices');
          if (!isCurrent()) return;
          if (json?.dashboard && Number(json.dashboard.total_visitors) > 0) {
            const rollupPayload = {
              total_visitors:         json.dashboard.total_visitors,
              avg_visitors_per_day:   json.dashboard.avg_visitors_per_day,
              avg_visit_time_seconds: json.dashboard.avg_times_seconds?.avg_visit_time_seconds ?? 0,
              avg_attention_seconds:  json.dashboard.avg_times_seconds?.avg_attention_seconds ?? 0,
              visitors_per_day:       json.dashboard.visitors_per_day,
              visitors_per_hour_avg:  json.dashboard.visitors_per_hour_avg,
              gender_percent:         json.dashboard.gender_percent,
              attributes_percent:     json.dashboard.attributes_percent,
              age_pyramid_percent:    json.dashboard.age_pyramid_percent,
            };
            applyRollup(rollupPayload, { updatedAt: json?.dashboard?.updated_at ?? null });
            await Promise.all([
              syncExpressions([rollupPayload]),
              syncDeviceFlow([rollupPayload]),
            ]);
          } else {
            // A API sync-analytics retornou 0/null (pode ser timeout do Vercel).
            // Computa todas as métricas DIRETAMENTE do visitor_analytics no cliente
            // para garantir que todos os KPIs e gráficos mostrem dados corretos.
            const PAGE_ROWS = 1000;
            const allRows: any[] = [];
            let rowFrom = 0;
            while (true) {
              const { data: rowPage } = await withTimeout(
                supabase
                  .from('visitor_analytics')
                  .select('timestamp,visit_time_seconds,contact_time_seconds,gender,age,attributes,raw_data')
                  .eq('client_id', id)
                  .in('device_id', deviceIds)
                  .gte('timestamp', startIso)
                  .lte('timestamp', endIso)
                  .order('timestamp', { ascending: true })
                  .range(rowFrom, rowFrom + PAGE_ROWS - 1) as any,
                10000,
                'visitor_analytics rows for device',
              ) as any;
              if (!Array.isArray(rowPage) || rowPage.length === 0) break;
              allRows.push(...rowPage);
              if (rowPage.length < PAGE_ROWS) break;
              rowFrom += PAGE_ROWS;
              if (rowFrom > 50000) break;
            }

            if (allRows.length > 0 && isCurrent()) {
              const total       = allRows.length;
              const dRange      = Math.max(1, Math.ceil((endAligned.getTime() - startAligned.getTime() + 1) / 86400000));
              const visitTimes  = allRows.map(r => Number(r.visit_time_seconds) || 0).filter(v => v > 0);
              const contactTimes= allRows.map(r => Number(r.contact_time_seconds) || 0).filter(v => v > 0);
              const avgVisit    = visitTimes.length   > 0 ? Math.round(visitTimes.reduce((a,b)=>a+b,0)   / visitTimes.length)   : 0;
              const avgContact  = contactTimes.length > 0 ? Math.round(contactTimes.reduce((a,b)=>a+b,0) / contactTimes.length) : 0;

              // Distribuições horárias, diárias, gênero e faixa etária
              const perHourTotal = new Array(24).fill(0);
              const perDay: Record<string, number> = {};
              const genderC = { male: 0, female: 0 };
              const ageBuckets: Record<string, { m: number; f: number }> = {
                '<18':{m:0,f:0},'18-24':{m:0,f:0},'25-34':{m:0,f:0},'35-44':{m:0,f:0},
                '45-54':{m:0,f:0},'55-64':{m:0,f:0},'65+':{m:0,f:0},
              };
              const toAgeBucket = (age: number) => {
                if (age < 18) return '<18'; if (age < 25) return '18-24';
                if (age < 35) return '25-34'; if (age < 45) return '35-44';
                if (age < 55) return '45-54'; if (age < 65) return '55-64';
                return '65+';
              };

              allRows.forEach(r => {
                const ts = new Date(r.timestamp);
                if (!isNaN(ts.getTime())) {
                  perHourTotal[ts.getUTCHours()]++;
                  const dk = ts.toISOString().slice(0, 10);
                  perDay[dk] = (perDay[dk] ?? 0) + 1;
                }
                const g = r.gender;
                const isMale   = g === 1 || g === 'male';
                const isFemale = g === 2 || g === 'female';
                if (isMale)   genderC.male++;
                if (isFemale) genderC.female++;
                const ageVal = Number(r.age);
                if (Number.isFinite(ageVal) && ageVal > 0) {
                  const bucket = toAgeBucket(ageVal);
                  if (isMale)   ageBuckets[bucket].m++;
                  else if (isFemale) ageBuckets[bucket].f++;
                }
              });

              const perHourAvg = perHourTotal.map(v => Math.round(v / dRange));
              const gTotal = genderC.male + genderC.female;

              // Constrói ageStats no formato esperado pelo WidgetAgePyramid
              const ageStatsBuilt = Object.entries(ageBuckets)
                .filter(([, v]) => v.m + v.f > 0)
                .map(([age, v]) => ({ age, m: Math.round(v.m / Math.max(total,1) * 100), f: Math.round(v.f / Math.max(total,1) * 100) }));

              setTotalVisitors(total);
              setAvgVisitorsPerDay(Math.round(total / dRange));
              setAvgVisitSeconds(avgVisit);
              setAvgAttentionSeconds(avgContact);
              setHourlyStats(perHourAvg);
              setVisitorsPerDayMap(perDay);
              if (gTotal > 0) setGenderStats([
                { label: 'Masculino', value: Math.round(genderC.male   / gTotal * 100) },
                { label: 'Feminino',  value: Math.round(genderC.female / gTotal * 100) },
              ]);
              if (ageStatsBuilt.length > 0) setAgeStats(ageStatsBuilt);

              // ── Atributos: óculos, pelos faciais, tipo/cor de cabelo ────────
              // O formato esperado pelos widgets é IDÊNTICO ao produzido por applyRollup:
              //   Visão:       entradas com label '_glasses_none', '_glasses_usual', etc.
              //   PelosFaciais: entradas com label '_facial_beard', '_facial_shaved', etc.
              //   Totais:       'Óculos' e 'Barba' (percentual do total com essa feição)
              const glassesC:  Record<string,number> = {};
              const facialC:   Record<string,number> = {};
              const hairTypeC: Record<string,number> = {};
              const hairColorC:Record<string,number> = {};
              let glassesKnown = 0, facialKnown = 0, htKnown = 0, hcKnown = 0;
              let glassesWith = 0, facialWith = 0;

              const parseAttrs = (r: any): any => {
                if (r.attributes) {
                  try { return typeof r.attributes === 'string' ? JSON.parse(r.attributes) : r.attributes; } catch { /* skip */ }
                }
                if (r.raw_data) {
                  try {
                    const rd = typeof r.raw_data === 'string' ? JSON.parse(r.raw_data) : r.raw_data;
                    return rd?.attributes ?? null;
                  } catch { /* skip */ }
                }
                return null;
              };

              const isPresent = (k: string) =>
                k && k !== 'unknown' && k !== 'false' && k !== '0';
              const isWithGlasses = (k: string) =>
                isPresent(k) && k !== 'none' && k !== 'no_glasses';
              const isWithFacial = (k: string) =>
                isPresent(k) && k !== 'shaved' && k !== 'none' && k !== 'no_beard';

              allRows.forEach(r => {
                const attrs = parseAttrs(r);
                if (!attrs) return;

                const g = String(attrs.glasses ?? attrs.glasses_category ?? '').toLowerCase().trim();
                if (g && g !== 'unknown') {
                  glassesKnown++;
                  glassesC[g] = (glassesC[g] ?? 0) + 1;
                  if (isWithGlasses(g)) glassesWith++;
                }

                const f = String(attrs.facial_hair ?? attrs.beard ?? attrs.facial_hair_category ?? '').toLowerCase().trim();
                if (f && f !== 'unknown') {
                  facialKnown++;
                  facialC[f] = (facialC[f] ?? 0) + 1;
                  if (isWithFacial(f)) facialWith++;
                }

                const ht = String(attrs.hair_type ?? attrs.hair_type_category ?? '').toLowerCase().trim();
                if (ht && ht !== 'unknown') {
                  htKnown++;
                  hairTypeC[ht] = (hairTypeC[ht] ?? 0) + 1;
                }

                const hc = String(attrs.hair_color ?? attrs.hair_color_category ?? '').toLowerCase().trim();
                if (hc && hc !== 'unknown') {
                  hcKnown++;
                  hairColorC[hc] = (hairColorC[hc] ?? 0) + 1;
                }
              });

              if (glassesKnown > 0 || facialKnown > 0) {
                const glassesPct = glassesKnown > 0 ? Math.round(glassesWith / glassesKnown * 100) : 0;
                const facialPct  = facialKnown  > 0 ? Math.round(facialWith  / facialKnown  * 100) : 0;

                const attrStats: { label: string; value: number }[] = [
                  { label: 'Óculos',      value: glassesPct },
                  { label: 'Barba',       value: facialPct  },
                  { label: 'Máscara',     value: 0 },
                  { label: 'Chapéu/Boné', value: 0 },
                  // Entradas categóricas com prefixo (_glasses_ / _facial_) para os widgets
                  ...Object.entries(glassesC).map(([k, cnt]) => ({
                    label: `_glasses_${k}`,
                    value: Math.round(cnt / glassesKnown * 100),
                  })).filter(e => e.value > 0),
                  ...Object.entries(facialC).map(([k, cnt]) => ({
                    label: `_facial_${k}`,
                    value: Math.round(cnt / facialKnown * 100),
                  })).filter(e => e.value > 0),
                ];
                setAttributeStats(attrStats);
              }

              if (htKnown > 0) {
                setHairTypeData(
                  Object.entries(hairTypeC).map(([label, cnt]) => ({ label, value: Math.round(cnt / htKnown * 100) }))
                    .sort((a,b) => b.value - a.value).slice(0, 4)
                );
              }
              if (hcKnown > 0) {
                setHairColorData(
                  Object.entries(hairColorC).map(([label, cnt]) => ({ label, value: Math.round(cnt / hcKnown * 100) }))
                    .sort((a,b) => b.value - a.value).slice(0, 4)
                );
              }

              await Promise.all([
                syncExpressions([]),
                syncDeviceFlow([]),
              ]);
            } else {
              console.log('[loadData] visitor_analytics vazio para os devices:', deviceIds, '— acionando sync em background');
              // Dispara sync em background para popular visitor_analytics com dados do Displayforce
              // (os devices podem ter sido adicionados ao banco pelo sync_stores recente)
              fetch('/api/sync-analytics', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  client_id: id,
                  background_sync: true,
                  force_full_sync: false,
                  devices: deviceIds,
                  start: startIso,
                  end: endIso,
                }),
              }).catch(() => {}); // fire-and-forget
              zeroAll();
            }
          }
        } catch (e) {
          console.warn('[loadData] Erro no filtro por dispositivo:', e);
          zeroAll();
        }
        return;
      }

      // ── Rede global ────────────────────────────────────────────────────
      // Busca rollups que se sobrepõem ao período selecionado
      // e extrai apenas os dias dentro do período
      const selectedDays = Math.max(
        1,
        Math.ceil((selectedEndDate.getTime() - selectedStartDate.getTime()) / 86400000) + 1
      );

      const { data: exactRollups } = await withTimeout(
        supabase
          .from('visitor_analytics_rollups')
          .select('*')
          .eq('client_id', id)
          .eq('start', startIso)
          .eq('end', endIso)
          .gt('total_visitors', 0)
          .order('updated_at', { ascending: false })
          .limit(1),
        10000,
        'rollup exato'
      );

      if (!isCurrent()) return;

      const exactRollup = exactRollups?.[0];
      let exactRollupCandidate: any = null;
      let exactRollupCandidateTotal = 0;
      if (exactRollup && !rangeTouchesToday) {
        const exactRollupDailyTotal = sumVisitorsPerDay(exactRollup.visitors_per_day);
        const exactRollupTotal = Number(exactRollup.total_visitors ?? 0);
        const exactRollupLooksConsistent =
          exactRollupTotal > 0 &&
          exactRollupDailyTotal > 0 &&
          Math.abs(exactRollupTotal - exactRollupDailyTotal) <= Math.max(5, Math.ceil(exactRollupTotal * 0.01));

        if (!exactRollupLooksConsistent) {
          console.warn(
            `[loadData] Ignorando rollup inconsistente ${exactRollupTotal} vs soma diária ${exactRollupDailyTotal} (${startDay}→${endDay})`
          );
        } else {
          exactRollupCandidate = exactRollup;
          exactRollupCandidateTotal = exactRollupTotal;
        }
      }

      const { data: allRollups } = await withTimeout(
        supabase
          .from('visitor_analytics_rollups')
          .select('*')
          .eq('client_id', id)
          .lte('start', endIso)
          .gte('end', startIso)
          .gt('total_visitors', 0)
          .order('updated_at', { ascending: false })
          .limit(50),
        10000,
        'rollups do periodo'
      );

      if (!isCurrent()) return;

      const { data: metadataRollups } = await withTimeout(
        supabase
          .from('visitor_analytics_rollups')
          .select('*')
          .eq('client_id', id)
          .gt('total_visitors', 0)
          .order('updated_at', { ascending: false })
          .limit(20),
        10000,
        'rollups metadata fallback'
      );

      if (!isCurrent()) return;

      const metadataFallbackRollup =
        [exactRollupCandidate, ...(allRollups || []), ...(metadataRollups || [])]
          .filter(Boolean)
          .sort((a, b) => rollupMetadataScore(b) - rollupMetadataScore(a))[0] ?? null;
      const aggregatedAttributesFallback = aggregateAttributesFromRollups(
        [exactRollupCandidate, ...(allRollups || []), ...(metadataRollups || [])].filter(Boolean),
        startDay,
        endDay
      );
      const hydrateForApply = (rollup: any) => {
        const hydrated = hydrateRollupMetadata(rollup, metadataFallbackRollup);
        if (!hydrated) return hydrated;
        if (!hasNestedMetricData(aggregatedAttributesFallback)) {
          return hydrated;
        }
        return {
          ...hydrated,
          attributes_percent: mergeAttributeCategories(hydrated.attributes_percent, aggregatedAttributesFallback),
        };
      };

      if (allRollups && allRollups.length > 0) {
        // Mescla visitors_per_day de todos os rollups, filtrando pelo período
        const mergedVpd: Record<string, number> = {};
        let mergedTotal = 0;
        const metaRollup = allRollups[0];

        for (const r of allRollups) {
          const vpd: Record<string, number> = r.visitors_per_day ?? {};
          for (const [day, cnt] of Object.entries(vpd)) {
            const d = day.slice(0, 10);
            if (d < startDay || d > endDay) continue;

            const val = Number(cnt) || 0;
            const prev = mergedVpd[d];
            if (prev === undefined) {
              mergedVpd[d] = val;
              mergedTotal += val;
            } else if (val > prev) {
              mergedVpd[d] = val;
              mergedTotal += (val - prev);
            }
          }
        }

        if (mergedTotal > 0) {
          if (!exactRollupCandidate && selectedDays === 1) {
            console.log('[loadData] Rollups sobrepostos sem cache exato local, recalculando periodo para evitar mistura de dias.');
          } else {
          const preferMergedOverExact =
            !!exactRollupCandidate &&
            Math.abs(mergedTotal - exactRollupCandidateTotal) >
              Math.max(25, Math.ceil(Math.max(mergedTotal, exactRollupCandidateTotal) * 0.01));

          if (exactRollupCandidate && !preferMergedOverExact) {
            console.log(`[loadData] exact rollup: ${exactRollupCandidateTotal}`);
            const hydratedExact = hydrateForApply(exactRollupCandidate);
            applyRollup(hydratedExact, { updatedAt: exactRollupCandidate.updated_at ?? null });
            await Promise.all([
              syncExpressions([hydratedExact, ...(allRollups || []), ...(metadataRollups || [])]),
              syncDeviceFlow([hydratedExact, ...(allRollups || []), ...(metadataRollups || [])]),
            ]);
            return;
          }

          if (preferMergedOverExact) {
            console.warn(
              `[loadData] Ignorando rollup exato defasado ${exactRollupCandidateTotal} e usando soma diária ${mergedTotal} (${startDay}→${endDay})`
            );
          }

          const daysInPeriod = selectedDays;
          console.log(`[loadData] ✅ ${mergedTotal} visitantes (${startDay}→${endDay})`);
          const mergedRollup = hydrateForApply({
            ...metaRollup,
            total_visitors:       mergedTotal,
            avg_visitors_per_day: Math.round(mergedTotal / daysInPeriod),
            visitors_per_day:     mergedVpd,
          });
          applyRollup(mergedRollup, { updatedAt: metaRollup?.updated_at ?? exactRollupCandidate?.updated_at ?? null });
          await Promise.all([
            syncExpressions([mergedRollup, ...(allRollups || []), ...(metadataRollups || [])]),
            syncDeviceFlow([mergedRollup, ...(allRollups || []), ...(metadataRollups || [])]),
          ]);
          return;
          }
        }

        // Rollups encontrados mas sem dados para o período específico
        // → NÃO retornar zero aqui: continua para tentar rebuild via backend
        // (ex: rollup histórico existe mas ainda não tem dados de "hoje" → busca da API)
        console.log('[loadData] Rollups sem dados para o período, tentando rebuild:', startDay, '→', endDay);
      }

      // ── Sem rollups úteis: tenta rebuild via backend ───────────────────
      if (exactRollupCandidate) {
        console.log(`[loadData] exact rollup fallback: ${exactRollupCandidateTotal}`);
        const hydratedExact = hydrateForApply(exactRollupCandidate);
        applyRollup(hydratedExact, { updatedAt: exactRollupCandidate.updated_at ?? null });
        await Promise.all([
          syncExpressions([hydratedExact, ...(allRollups || []), ...(metadataRollups || [])]),
          syncDeviceFlow([hydratedExact, ...(allRollups || []), ...(metadataRollups || [])]),
        ]);
        return;
      }

      const rebuildKey = `${id}:${startDay}:${endDay}`;
      if (_rebuilding.has(rebuildKey)) {
        setIsLoadingData(false);
        return;
      }

      _rebuilding.add(rebuildKey);
      setSyncMessage('Calculando dados...');
      try {
        const json = await fetchJsonWithTimeout('/api/sync-analytics', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: id, start: startIso, end: endIso, rebuild_rollup: true }),
        }, 20000, 'sync-analytics rebuild');
        if (!isCurrent()) return;

        if (json?.dashboard && Number(json.dashboard.total_visitors) > 0) {
          console.log('[loadData] ✅ Rebuild:', json.dashboard.total_visitors);
          const rollupPayload = {
            total_visitors:         json.dashboard.total_visitors,
            avg_visitors_per_day:   json.dashboard.avg_visitors_per_day,
            avg_visit_time_seconds: json.dashboard.avg_times_seconds?.avg_visit_time_seconds ?? 0,
            avg_attention_seconds:  json.dashboard.avg_times_seconds?.avg_attention_seconds ?? 0,
            visitors_per_day:       json.dashboard.visitors_per_day,
            visitors_per_hour_avg:  json.dashboard.visitors_per_hour_avg,
            gender_percent:         json.dashboard.gender_percent,
            attributes_percent:     json.dashboard.attributes_percent,
            age_pyramid_percent:    json.dashboard.age_pyramid_percent,
          };
          applyRollup(rollupPayload, { updatedAt: json?.dashboard?.updated_at ?? null });
          await Promise.all([
            syncExpressions([rollupPayload]),
            syncDeviceFlow([rollupPayload]),
          ]);
          setSyncMessage(`✅ ${Number(json.dashboard.total_visitors).toLocaleString()} visitantes.`);
        } else {
          zeroAll();
          setSyncMessage('');
        }
      } catch (e) {
        console.warn('[loadData] rebuild falhou:', e);
        zeroAll();
        setSyncMessage('');
      } finally {
        _rebuilding.delete(rebuildKey);
      }
    } catch (err) {
      console.error('[loadData] erro:', err);
    } finally {
      if (isCurrent()) setIsLoadingData(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, selectedStartDate, selectedEndDate, deviceIds]);

  // ── triggerBackgroundSync — dispara sync silencioso via background_sync ───
  useEffect(() => {
    latestLoadDataRef.current = loadData;
  }, [loadData]);

  const triggerBackgroundSync = useCallback(async (force = false) => {
    if (!id || syncingRef.current) return;
    if (!force && !shouldSync(id)) return;
    if (document.visibilityState !== 'visible') return;

    syncingRef.current = true;
    console.log(`[BgSync] Disparando sync (force=${force})...`);

    try {
      // Para clientes D-2 (ex: Panvel), o sync começa em D-2 para garantir que esses dados
      // sejam buscados da API e salvos no banco antes de serem exibidos no dashboard
      const syncStartDate = useD2DefaultRef.current
        ? (() => { const d = new Date(); d.setDate(d.getDate() - 2); d.setUTCHours(0, 0, 0, 0); return d.toISOString(); })()
        : undefined;

      const resp = await fetch('/api/sync-analytics', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: id,
          ...(syncStartDate ? { start: syncStartDate } : {}),
          end: new Date().toISOString(),
          background_sync: true,
          force_full_sync: force,
          ...(deviceIds.length > 0 ? { devices: deviceIds } : {}),
        }),
      });

      if (resp.ok) {
        const json = await resp.json();
        if (json.started) {
          markSynced(id);
          console.log('[BgSync] Iniciado. Recarregará em 15s...');
          // Recarrega dados após o sync processar — começa em 15s e tenta mais vezes
          const delays = [15_000, 30_000, 60_000, 120_000, 240_000];
          let loaded = false;
          const scheduledFilterKey = activeFilterKeyRef.current;
          bgReloadTimeoutsRef.current.forEach(clearTimeout);
          bgReloadTimeoutsRef.current = [];
          delays.forEach((delay, idx) => {
            const timeoutId = setTimeout(async () => {
              if (loaded || document.visibilityState !== 'visible') return;
              if (scheduledFilterKey !== activeFilterKeyRef.current) {
                console.log('[BgSync] Ignorando recarga antiga apÃ³s troca de filtro');
                return;
              }
              await latestLoadDataRef.current?.();
              if (scheduledFilterKey !== activeFilterKeyRef.current) return;
              loaded = true;
              console.log(`[BgSync] Dados recarregados (tentativa ${idx + 1})`);
            }, delay);
            bgReloadTimeoutsRef.current.push(timeoutId);
          });
        }
      }
    } catch (e) {
      console.warn('[BgSync] erro:', e);
    } finally {
      syncingRef.current = false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, deviceIds]);

  // ── loadData quando período muda ──────────────────────────────────────────
  useEffect(() => { loadData(); }, [loadData]);

  const lastQuarterMonths = useCallback((anchor: Date) => {
    const y = anchor.getUTCFullYear();
    const endMonth = anchor.getUTCMonth();
    const out: { label: string; startIso: string; endIso: string }[] = [];
    for (let i = 2; i >= 0; i--) {
      const d = new Date(Date.UTC(y, endMonth - i, 1, 0, 0, 0, 0));
      const yy = d.getUTCFullYear(); const m2 = d.getUTCMonth();
      const label = d.toLocaleString('pt-BR', { month: 'short', timeZone: 'UTC' }).replace('.', '').toUpperCase();
      out.push({
        label,
        startIso: new Date(Date.UTC(yy, m2, 1, 0, 0, 0, 0)).toISOString(),
        endIso:   new Date(Date.UTC(yy, m2 + 1, 0, 23, 59, 59, 999)).toISOString(),
      });
    }
    return out;
  }, []);

  const quarterMonthsForFilter = useCallback((rangeStart: Date, rangeEnd: Date) => {
    void rangeStart;
    return lastQuarterMonths(alignUtcEndOfDay(rangeEnd));
  }, [lastQuarterMonths]);

  const refreshLastUpdate = useCallback(async () => {
    if (!id) return;
    try {
      const { data: syncState } = await withTimeout<{ data: { last_synced_at: string | null } | null }>(
        supabase
          .from('client_sync_state')
          .select('last_synced_at')
          .eq('client_id', id)
          .maybeSingle() as any,
        5000,
        'ultimo sync'
      );

      const syncedAt = syncState?.last_synced_at ? new Date(syncState.last_synced_at) : null;
      if (syncedAt && !Number.isNaN(syncedAt.getTime())) {
        setLastUpdate(syncedAt);
        return;
      }

      const { data: latestRollups } = await withTimeout<{ data: Array<{ updated_at: string | null }> | null }>(
        supabase
          .from('visitor_analytics_rollups')
          .select('updated_at')
          .eq('client_id', id)
          .order('updated_at', { ascending: false })
          .limit(1) as any,
        5000,
        'ultimo rollup atualizado'
      );

      const fallbackAt = latestRollups?.[0]?.updated_at ? new Date(latestRollups[0].updated_at) : null;
      if (fallbackAt && !Number.isNaN(fallbackAt.getTime())) {
        setLastUpdate(fallbackAt);
      }
    } catch (error) {
      console.warn('[Dashboard] Erro ao carregar timestamp de atualização:', error);
    }
  }, [id]);

  const fetchSalesFromDb = useCallback(async (rangeStartIso: string, rangeEndIso: string) => {
    if (!id) return 0;
    if (salesSourceRef.current === 'none') return 0;
    const storeId = selectedStore?.id || null;
    const isNotFound = (err: any) => { const s = err?.status ?? err?.statusCode; const m = String(err?.message || ''); return s === 404 || /not found/i.test(m) || /does not exist/i.test(m); };
    const applySalesFilter = (q: any, mode: 'device' | 'store' | 'none') => {
      if (mode === 'device' && deviceIds.length > 0) return q.in('device_id', deviceIds);
      if (mode === 'store' && storeId) return q.eq('store_id', storeId);
      return q;
    };
    const sumSalesCount = async (table: 'sales_daily' | 'sales', dateCol: 'date' | 'created_at') => {
      const attempts: ('device' | 'store' | 'none')[] = [];
      if (deviceIds.length > 0) attempts.push('device');
      if (storeId) attempts.push('store');
      attempts.push('none');
      for (const mode of attempts) {
        const { data, error } = await withTimeout<{ data: any[] | null; error: any }>(
          applySalesFilter(supabase.from(table).select(`${dateCol},sales_count`).eq('client_id', id).gte(dateCol, rangeStartIso).lte(dateCol, rangeEndIso).range(0, 9999), mode) as any,
          8000,
          `${table}.${dateCol}.${mode}`
        );
        if (error) { if (isNotFound(error)) return null; continue; }
        return ((data as any[]) || []).reduce((acc, r) => acc + (Number(r?.sales_count) || 0), 0);
      }
      return undefined;
    };
    const countRows = async (table: 'sales_daily' | 'sales', dateCol: 'date' | 'created_at') => {
      const attempts: ('device' | 'store' | 'none')[] = [];
      if (deviceIds.length > 0) attempts.push('device');
      if (storeId) attempts.push('store');
      attempts.push('none');
      for (const mode of attempts) {
        const { count, error } = await withTimeout<{ count: number | null; error: any }>(
          applySalesFilter(supabase.from(table).select('*', { count: 'exact', head: true }).eq('client_id', id).gte(dateCol, rangeStartIso).lte(dateCol, rangeEndIso), mode) as any,
          8000,
          `${table}.${dateCol}.${mode}.count`
        );
        if (error) { if (isNotFound(error)) return null; continue; }
        return Number(count) || 0;
      }
      return undefined;
    };
    const readFrom = async (table: 'sales_daily' | 'sales') => {
      const a = await sumSalesCount(table, 'date');       if (typeof a === 'number') return a; if (a === null) return null;
      const b = await sumSalesCount(table, 'created_at'); if (typeof b === 'number') return b; if (b === null) return null;
      const c = await countRows(table, 'created_at');     if (typeof c === 'number') return c; if (c === null) return null;
      const d = await countRows(table, 'date');           if (typeof d === 'number') return d; if (d === null) return null;
      return 0;
    };
    if (salesSourceRef.current === 'sales_daily') { const v = await readFrom('sales_daily'); if (v === null) { salesSourceRef.current = 'none'; return 0; } return v ?? 0; }
    if (salesSourceRef.current === 'sales')       { const v = await readFrom('sales');       if (v === null) { salesSourceRef.current = 'none'; return 0; } return v ?? 0; }
    const vd = await readFrom('sales_daily'); if (typeof vd === 'number') { salesSourceRef.current = 'sales_daily'; return vd; }
    const vs = await readFrom('sales');       if (typeof vs === 'number') { salesSourceRef.current = 'sales';       return vs; }
    salesSourceRef.current = 'none';
    return 0;
  }, [id, deviceIds, selectedStore?.id]);

  const fetchVisitorsFromDb = useCallback(async (rangeStartIso: string, rangeEndIso: string) => {
    if (!id) return 0;
    let q = supabase.from('visitor_analytics').select('*', { count: 'exact', head: true })
      .eq('client_id', id).gte('timestamp', rangeStartIso).lte('timestamp', rangeEndIso);
    if (deviceIds.length > 0) q = q.in('device_id', deviceIds);
    let count: number | null = 0;
    let error = null as any;
    try {
      ({ count, error } = await withTimeout<{ count: number | null; error: any }>(q as any, 8000, 'visitor_analytics trimestre'));
    } catch (timeoutError) {
      console.warn('[Dashboard] Timeout ao contar visitantes (trimestre):', timeoutError);
      return 0;
    }
    if (error) { console.warn('[Dashboard] Erro ao contar visitantes (trimestre):', error); return 0; }
    return Number(count) || 0;
  }, [id, deviceIds]);

  const loadQuarterData = useCallback(async () => {
    if (!id) return;
    // Race condition guard: se loja selecionada mas cameras ainda não carregadas,
    // não mostra dados de rede global
    if (selectedStore && deviceIds.length === 0) return;
    setIsLoadingQuarter(true);
    try {
      const months = quarterMonthsForFilter(selectedStartDate, selectedEndDate);
      const quarterStart = months[0].startIso;
      const quarterEnd   = months[months.length - 1].endIso;
      const qStartDay    = quarterStart.slice(0, 10);
      const qEndDay      = quarterEnd.slice(0, 10);

      let rollupVisitorsPerDay: Record<string, number> | null = null;

      if (deviceIds.length === 0) {
        const { data: rollups } = await withTimeout(
          supabase
            .from('visitor_analytics_rollups')
            .select('visitors_per_day, start, end, updated_at')
            .eq('client_id', id)
            .lte('start', quarterEnd)
            .gte('end', quarterStart)
            .order('updated_at', { ascending: false })
            .limit(200),
          10000,
          'rollups trimestre'
        );

        if (rollups && rollups.length > 0) {
          const merged: Record<string, number> = {};
          for (const r of rollups as any[]) {
            const vpd = r.visitors_per_day as Record<string, number> | null;
            if (!vpd) continue;
            for (const [dateStr, count] of Object.entries(vpd)) {
              const d = dateStr.slice(0, 10);
              if (d >= qStartDay && d <= qEndDay && !(d in merged)) {
                merged[d] = Number(count) || 0;
              }
            }
          }
          if (Object.keys(merged).length > 0) rollupVisitorsPerDay = merged;
        }
      }

      if (!rollupVisitorsPerDay) {
        try {
          const json = await fetchJsonWithTimeout('/api/sync-analytics', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              client_id: id, start: quarterStart, end: quarterEnd, rebuild_rollup: true,
              ...(deviceIds.length > 0 ? { devices: deviceIds } : {}),
            }),
          }, 20000, 'sync-analytics trimestre');
          if (json?.dashboard?.visitors_per_day) {
            const vpd = json.dashboard.visitors_per_day as Record<string, number>;
            rollupVisitorsPerDay = {};
            for (const [d, v] of Object.entries(vpd)) {
              if (d >= qStartDay && d <= qEndDay) rollupVisitorsPerDay[d] = Number(v) || 0;
            }
          }
        } catch (e) { console.warn('[Quarter] Rebuild falhou:', e); }
      }

      const rows: { label: string; visitors: number; sales: number }[] = [];
      for (const month of months) {
        let visitors = 0;
        let coveredDays = 0;
        if (rollupVisitorsPerDay) {
          const mStart = month.startIso.slice(0, 10);
          const mEnd   = month.endIso.slice(0, 10);
          for (const [dateStr, count] of Object.entries(rollupVisitorsPerDay)) {
            if (dateStr >= mStart && dateStr <= mEnd) {
              visitors += Number(count) || 0;
              coveredDays += 1;
            }
          }
        }
        if (!rollupVisitorsPerDay || coveredDays === 0) {
          visitors = await fetchVisitorsFromDb(month.startIso, month.endIso);
        }
        let sales = 0;
        try {
          sales = await fetchSalesFromDb(month.startIso, month.endIso);
        } catch (salesError) {
          console.warn(`[Quarter] Erro ao carregar vendas de ${month.label}:`, salesError);
        }
        rows.push({ label: month.label, visitors, sales });
      }

      setQuarterBars(rows);
      setQuarterVisitorsTotal(rows.reduce((acc, r) => acc + (Number(r.visitors) || 0), 0));
      setQuarterSalesTotal(rows.reduce((acc, r)    => acc + (Number(r.sales)    || 0), 0));
    } catch (e) {
      console.warn('[Dashboard] Erro ao carregar trimestre:', e);
      setQuarterBars([]); setQuarterVisitorsTotal(0); setQuarterSalesTotal(0);
    } finally {
      setIsLoadingQuarter(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, deviceIds, selectedStartDate, selectedEndDate, quarterMonthsForFilter, fetchSalesFromDb, fetchVisitorsFromDb]);

  const loadCompareData = useCallback(async () => {
    if (!id) return;
    if (selectedStore && deviceIds.length === 0) return;
    const dayCount = Math.max(1, Math.floor((selectedEndDate.getTime() - selectedStartDate.getTime()) / 86400000) + 1);
    const prevEnd   = new Date(selectedStartDate.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - (dayCount - 1) * 86400000);
    setIsLoadingCompare(true);
    try {
      const prevStartAligned = new Date(prevStart); prevStartAligned.setUTCHours(0, 0, 0, 0);
      const prevEndAligned   = new Date(prevEnd);   prevEndAligned.setUTCHours(23, 59, 59, 999);
      const prevStartIso = prevStartAligned.toISOString();
      const prevEndIso   = prevEndAligned.toISOString();

      if (deviceIds.length === 0) {
        const { data: rollups } = await withTimeout(
          supabase
            .from('visitor_analytics_rollups')
            .select('visitors_per_day')
            .eq('client_id', id)
            .eq('start', prevStartIso)
            .eq('end', prevEndIso)
            .order('updated_at', { ascending: false })
            .limit(1),
          10000,
          'rollup comparativo'
        );
        const found = rollups?.[0] as any;
        if (found?.visitors_per_day) {
          setComparePrevVisitorsPerDay(found.visitors_per_day || {});
        } else {
          const json = await fetchJsonWithTimeout('/api/sync-analytics', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ client_id: id, start: prevStartIso, end: prevEndIso, rebuild_rollup: true }),
          }, 20000, 'sync-analytics comparativo');
          setComparePrevVisitorsPerDay(json?.dashboard?.visitors_per_day || {});
        }
      } else {
        const json = await fetchJsonWithTimeout('/api/sync-analytics', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: id, start: prevStartIso, end: prevEndIso, rebuild_rollup: true, devices: deviceIds }),
        }, 20000, 'sync-analytics comparativo devices');
        setComparePrevVisitorsPerDay(json?.dashboard?.visitors_per_day || {});
      }
    } catch (e) { console.warn('[Dashboard] Erro comparativo:', e); setComparePrevVisitorsPerDay({}); }
    finally { setIsLoadingCompare(false); }
  }, [id, selectedStartDate, selectedEndDate, deviceIds]);

  const loadWeekFlowData = useCallback(async () => {
    if (!id) return;
    if (selectedStore && deviceIds.length === 0) { setDailyStats([0,0,0,0,0,0,0]); return; }

    // ── Regra do gráfico/KPI "Média Visitantes" ───────────────────────────
    // O gráfico e a média devem respeitar exatamente o período filtrado.
    const weekAnchor = alignUtcStartOfDay(selectedEndDate);
    const s = alignUtcStartOfWeek(weekAnchor);
    const e = alignUtcEndOfWeek(weekAnchor);
    const startIso = s.toISOString();
    const endIso   = e.toISOString();
    const startDay = startIso.slice(0, 10);
    const endDay   = endIso.slice(0, 10);

    // ── Agrega visitors_per_day por dia da semana (sempre SOMA) ───────────
    const toWeekDays = (vpd: Record<string, number>) => {
      const totals = [0, 0, 0, 0, 0, 0, 0];
      Object.entries(vpd || {}).forEach(([dateStr, count]) => {
        const d = parseDateInputValue(dateStr);
        if (!d || isNaN(d.getTime())) return;
        const localDay = d.getDay();
        const idx = localDay === 0 ? 6 : localDay - 1;
        totals[idx] += Number(count) || 0;
      });
      return totals;
    };

    try {
      if (deviceIds.length === 0) {
        // ── Rede global (sem filtro de dispositivo) ───────────────────────
        // 1ª tentativa: usa rollups já salvos (rápido)
        const { data: rollups } = await supabase
          .from('visitor_analytics_rollups')
          .select('visitors_per_day')
          .eq('client_id', id)
          .lte('start', endIso)
          .gte('end', startIso)
          .gt('total_visitors', 0)
          .order('updated_at', { ascending: false })
          .limit(30);

        if (rollups && rollups.length > 0) {
          const mergedVpd: Record<string, number> = {};
          for (const r of rollups) {
            const vpd: Record<string, number> = (r as any).visitors_per_day ?? {};
            for (const [day, cnt] of Object.entries(vpd)) {
              const d = day.slice(0, 10);
              if (d >= startDay && d <= endDay && !(d in mergedVpd)) {
                mergedVpd[d] = Number(cnt) || 0;
              }
            }
          }
          if (Object.keys(mergedVpd).length > 0) {
            const weekDays = toWeekDays(mergedVpd);
            setDailyStats(weekDays);
            return;
          }
        }

        // 2ª tentativa: busca direto na visitor_analytics para o período
        // (cobertura de períodos não incluídos em rollups existentes)
        try {
          const visPerDay: Record<string, number> = {};
          let from2 = 0; const page2 = 1000;
          while (true) {
            const { data: rows, error: rowErr } = await supabase
              .from('visitor_analytics')
              .select('timestamp')
              .eq('client_id', id)
              .gte('timestamp', startIso)
              .lte('timestamp', endIso)
              .order('timestamp', { ascending: true })
              .range(from2, from2 + page2 - 1);
            if (rowErr || !rows || rows.length === 0) break;
            (rows as any[]).forEach((r: any) => {
              const dk = r.timestamp ? formatLocalDateKey(r.timestamp) : '';
              if (dk) visPerDay[dk] = (visPerDay[dk] ?? 0) + 1;
            });
            if (rows.length < page2) break;
            from2 += page2; if (from2 > 50000) break;
          }
          if (Object.keys(visPerDay).length > 0) {
            const weekDays = toWeekDays(visPerDay);
            setDailyStats(weekDays);
            return;
          }
        } catch (_) { /* ignora e cai no zero */ }

        setDailyStats([0, 0, 0, 0, 0, 0, 0]);
        return;
      }

      // ── Filtro por dispositivo (loja selecionada) ─────────────────────
      // Usa a SEMANA INTEIRA mas filtrada pelos devices da loja selecionada.
      // Assim o gráfico mostra o padrão semanal real daquela loja.
      const visPerDayDevice: Record<string, number> = {};
      let from = 0; const page = 1000;
      while (true) {
        const { data, error } = await supabase.from('visitor_analytics').select('timestamp')
          .eq('client_id', id).gte('timestamp', startIso).lte('timestamp', endIso)
          .in('device_id', deviceIds).order('timestamp', { ascending: true }).range(from, from + page - 1);
        if (error || !data || data.length === 0) break;
        (data as any[]).forEach((r: any) => {
          const dk = r.timestamp ? formatLocalDateKey(r.timestamp) : '';
          if (dk) visPerDayDevice[dk] = (visPerDayDevice[dk] ?? 0) + 1;
        });
        if (data.length < page) break;
        from += page; if (from > 20000) break;
      }

      setDailyStats(toWeekDays(visPerDayDevice));
    } catch (e) {
      console.warn('[Dashboard] Erro semana:', e);
      setDailyStats([0, 0, 0, 0, 0, 0, 0]);
    }
  }, [id, selectedEndDate, deviceIds]);

  useEffect(() => { loadWeekFlowData(); }, [loadWeekFlowData]);
  useEffect(() => { loadQuarterData(); }, [loadQuarterData]);
  useEffect(() => { loadCompareData(); }, [loadCompareData]);
  useEffect(() => { refreshLastUpdate(); }, [refreshLastUpdate]);

  const refreshClientAndStores = useCallback(async () => {
    if (!id) return;
    try {
      const { data: client } = await withTimeout(
        supabase.from('clients').select('name, logo_url').eq('id', id).single(),
        10000,
        'clients'
      );
      if (client) {
        setClientData({ name: client.name, logo: client.logo_url });
        useD2DefaultRef.current = false;
        didApplyD1DefaultRef.current = true;
      }

      const { data: storesData } = await withTimeout(
        supabase.from('stores').select('id, name, city').eq('client_id', id),
        10000,
        'stores'
      );
      const storeIds = (storesData || []).map((s: any) => s.id).filter(Boolean);
      const { data: devicesData } = storeIds.length > 0
        ? await withTimeout(
            supabase.from('devices').select('id, name, type, mac_address, status, store_id').in('store_id', storeIds),
            10000,
            'devices'
          )
        : { data: [] };
      const { data: apiCfg } = await withTimeout(
        supabase.from('client_api_configs')
          .select('api_endpoint, analytics_endpoint, api_key, custom_header_key, custom_header_value, collection_start, collection_end, collect_tracks, collect_face_quality, collect_glasses, collect_beard, collect_hair_color, collect_hair_type, collect_headwear')
          .eq('client_id', id).single(),
        10000,
        'client_api_configs'
      );
      if (apiCfg) setApiConfig(apiCfg as ClientApiConfig);
      if (storesData) {
        const devicesByStore: Record<string, any[]> = {};
        (devicesData || []).forEach((device: any) => {
          if (!devicesByStore[device.store_id]) devicesByStore[device.store_id] = [];
          devicesByStore[device.store_id].push({ id: device.id, name: device.name, status: device.status || 'offline', type: device.type || 'dome', resolution: '1080p', macAddress: device.mac_address });
        });
        const seen = new Set<string>();
        const uniqueStores: StoreType[] = storesData
          .filter((s: any) => { if (seen.has(String(s.id))) return false; seen.add(String(s.id)); return true; })
          .map((store: any) => {
            const cams = devicesByStore[store.id] || [];
            const storeOnline = cams.some((c: any) => c.status === 'online');
            return { id: store.id, name: store.name, address: '', city: store.city || '', status: (storeOnline ? 'online' : 'offline') as 'online' | 'offline', cameras: cams };
          });
        setStores(uniqueStores);
      }
    } catch (error) {
      console.warn('[Dashboard] Erro ao carregar cliente/lojas:', error);
    }
  }, [id]);

  const syncStoresFromServer = useCallback(async (force = false) => {
    if (!id) return;
    // Verifica se deve sincronizar: sempre na primeira vez, ou se forçado,
    // ou se a última sync foi há mais de 5 minutos
    const SYNC_TTL_MS = 5 * 60 * 1000;
    const lastSync = Number(localStorage.getItem(`stores_synced_${id}`) || '0');
    if (!force && Date.now() - lastSync < SYNC_TTL_MS) return;

    setIsSyncingStores(true);
    try {
      const resp = await fetch('/api/sync-analytics', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: id, sync_stores: true }),
      });
      const json = resp.ok ? await resp.json() : null;
      if (json) {
        console.log(`[Stores Sync] ${json.stores_upserted ?? 0} lojas, ${json.devices_upserted ?? 0} dispositivos sincronizados`);
        localStorage.setItem(`stores_synced_${id}`, String(Date.now()));
        await refreshClientAndStores(); // recarrega do banco após sync
      }
    } catch (e) { console.warn('[Stores Sync] Erro:', e); }
    finally { setIsSyncingStores(false); }
  }, [id, refreshClientAndStores]);

  useEffect(() => { refreshClientAndStores(); }, [refreshClientAndStores]);

  // ── Limpa dados imediatamente quando muda a loja selecionada ─────────────
  // Evita que dados da Rede Global ou de outra loja fiquem visíveis
  // enquanto loadData ainda está buscando os dados filtrados.
  useEffect(() => {
    zeroAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStore?.id, selectedCamera?.id]);

  // ── Inicialização principal — roda 1x ao montar ──────────────────────────
  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    const run = async () => {
      refreshClientAndStores();
      syncStoresFromServer();

      if (cancelled) return;

      if (shouldSync(id)) {
        triggerBackgroundSync(false);
      }
    };

    void run();

    const t = setInterval(async () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      await loadData();
      if (shouldSync(id)) triggerBackgroundSync(false);
    }, 10 * 60 * 1000);

    const syncInterval = setInterval(() => {
      if (!cancelled && document.visibilityState === 'visible' && shouldSync(id)) {
        triggerBackgroundSync(false);
      }
    }, 30 * 60 * 1000);

    return () => { cancelled = true; clearInterval(t); clearInterval(syncInterval); };
  }, [id, loadData, refreshClientAndStores, syncStoresFromServer, triggerBackgroundSync]);

  // ── Config de widgets ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      bgReloadTimeoutsRef.current.forEach(clearTimeout);
      bgReloadTimeoutsRef.current = [];
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const clampNum = (v: any, min: number, max: number, fallback: number) => {
      const n = Number(v); if (!Number.isFinite(n)) return fallback;
      return Math.min(max, Math.max(min, n));
    };
    const normalizeSpan = (v: any) => {
      const n = Number(v);
      return (SPANS as readonly number[]).includes(n) ? (n as (typeof SPANS)[number]) : null;
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

    const resolveDashboardConfig = (widgetsConfig: any): { ids: string[] | null; widgetLayout: Record<string, { colSpanLg?: Span; heightPx?: number }> } => {
      const ids = Array.isArray(widgetsConfig)
        ? widgetsConfig.filter((x) => typeof x === 'string')
        : widgetsConfig && Array.isArray(widgetsConfig.widget_ids)
          ? widgetsConfig.widget_ids.filter((x: any) => typeof x === 'string') : null;
      const rawLayout = widgetsConfig && typeof widgetsConfig === 'object' ? (widgetsConfig.widget_layout ?? widgetsConfig.widgetLayout) : null;
      const wl: Record<string, { colSpanLg?: Span; heightPx?: number }> = {};
      if (rawLayout && typeof rawLayout === 'object') {
        for (const [wid, cfg] of Object.entries(rawLayout)) {
          const wId = String(wid);
          const span = normalizeSpan((cfg as any)?.colSpanLg ?? cfg);
          const heightPx = normalizeWidgetHeightPx(wId, (cfg as any)?.heightPx, NaN);
          if (span) wl[wId] = { ...(wl[wId] || {}), colSpanLg: span };
          if (Number.isFinite(heightPx)) wl[wId] = { ...(wl[wId] || {}), heightPx: Math.round(heightPx) };
        }
      }
      return { ids, widgetLayout: wl };
    };
    (async () => {
      if (!id) return;
      const fetchConfig = async (scope: 'global' | 'client' | 'client_user') => {
        try {
          const q = supabase.from('dashboard_configs').select('widgets_config, updated_at').eq('layout_name', scope).order('updated_at', { ascending: false }).limit(1);
          const { data } = scope === 'global'
            ? await withTimeout(q.is('client_id', null), 8000, `dashboard_configs.${scope}`)
            : await withTimeout(q.eq('client_id', id), 8000, `dashboard_configs.${scope}`);
          return data?.[0]?.widgets_config ?? null;
        } catch (error) {
          console.warn(`[Dashboard] Erro ao carregar config ${scope}:`, error);
          return null;
        }
      };

      // 1. Widgets permitidos pelo admin (layout 'client' ou 'global')
      let allowedConfig = await fetchConfig('client');
      if (!allowedConfig) allowedConfig = await fetchConfig('global');
      let allowedResolved = resolveDashboardConfig(allowedConfig);
      if (!allowedResolved.ids) {
        const cc = localStorage.getItem(`dashboard-config-${id}`);
        const gc = localStorage.getItem('dashboard-config-global');
        allowedResolved = resolveDashboardConfig(cc ? JSON.parse(cc) : null);
        if (!allowedResolved.ids) allowedResolved = resolveDashboardConfig(gc ? JSON.parse(gc) : null);
      }
      const expandLegacyKpiIds = (ids?: string[] | null) => {
        const next = (ids || []).flatMap((wid) => wid === 'kpi_flow_stats'
          ? ['kpi_total_visitors', 'kpi_avg_visitors_day', 'kpi_avg_visit_time', 'kpi_attention_time']
          : [wid]);
        return next.filter((wid, index) => next.indexOf(wid) === index);
      };
      const defaultIds = ['kpi_total_visitors', 'kpi_avg_visitors_day', 'kpi_avg_visit_time', 'kpi_attention_time', 'flow_trend', 'hourly_flow', 'age_pyramid', 'gender_dist', 'attributes', 'chart_device_flow', 'device_type_audience', 'campaigns'];
      const allowedIds = expandLegacyKpiIds(allowedResolved.ids && allowedResolved.ids.length ? allowedResolved.ids : defaultIds);
      const allowedSet = new Set(allowedIds);

      // 2. Seleção ativa do usuário (layout 'client_user') — só vale para usuário cliente.
      // Admin deve enxergar exatamente o que foi salvo em Settings (global/client).
      let userResolved = resolveDashboardConfig(null);
      if (authUser?.role === 'client') {
        const userConfig = await fetchConfig('client_user');
        userResolved = resolveDashboardConfig(userConfig);
        if (!userResolved.ids) {
          const uc = localStorage.getItem(`dashboard-config-user-${id}`);
          userResolved = resolveDashboardConfig(uc ? JSON.parse(uc) : null);
        }
      }

      // Se o usuário tem seleção salva, usa exatamente ela (filtrada pelos widgets permitidos).
      // Sem seleção salva válida, cai no conjunto permitido pelo admin/global.
      const userActiveIds = userResolved.ids && userResolved.ids.length
        ? expandLegacyKpiIds(userResolved.ids).filter((wid) => allowedSet.has(wid))
        : null;

      const activeIds = userActiveIds && userActiveIds.length > 0
        ? userActiveIds
        : allowedIds;

      // Layout: combina allowed + user (user sobrescreve)
      const mergedLayout = { ...allowedResolved.widgetLayout, ...userResolved.widgetLayout };

      const active = activeIds.map((wid) => AVAILABLE_WIDGETS.find((w) => w.id === wid)).filter(Boolean) as WidgetType[];
      if (!cancelled) { setActiveWidgets(active); setWidgetLayout(mergedLayout); }
    })()
      .catch((error) => {
        console.warn('[Dashboard] Erro ao resolver widgets, usando fallback padrao:', error);
        if (!cancelled) {
          const defaultIds = [
            'kpi_total_visitors',
            'kpi_avg_visitors_day',
            'kpi_avg_visit_time',
            'kpi_attention_time',
            'flow_trend',
            'hourly_flow',
            'age_pyramid',
            'gender_dist',
            'attributes',
            'chart_device_flow',
            'device_type_audience',
            'campaigns',
          ];
          setActiveWidgets(defaultIds.map((wid) => AVAILABLE_WIDGETS.find((w) => w.id === wid)).filter(Boolean) as WidgetType[]);
          setWidgetLayout({});
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingConfig(false);
      });
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    if (location.state?.initialView === 'store' && location.state?.storeId) {
      const store = stores.find((s) => s.id === location.state.storeId);
      if (store) { setSelectedStore(store); setView('network'); }
    }
  }, [location.state, stores]);

  const goToNetwork = () => { setView('network'); setSelectedStore(null); setSelectedCamera(null); };
  const goToStore = (store: StoreType) => { setSelectedStore(store); setView('network'); setSelectedCamera(null); };

  const periodSeries = useMemo(() => {
    const labels: string[] = []; const values: number[] = [];
    const start = alignUtcStartOfDay(selectedStartDate);
    const end   = alignUtcStartOfDay(selectedEndDate);
    for (let d = start; d.getTime() <= end.getTime(); d = new Date(d.getTime() + 86400000)) {
      const key = formatLocalDateKey(d);
      labels.push(d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }));
      values.push(Number(visitorsPerDayMap[key] || 0));
    }
    return { labels, values };
  }, [selectedStartDate, selectedEndDate, visitorsPerDayMap]);

  const flowTrendSeries = useMemo(() => {
    const labels = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab', 'Dom'];
    const values = new Array(7).fill(0);
    const start = alignUtcStartOfDay(selectedStartDate);
    const end = alignUtcStartOfDay(selectedEndDate);

    for (let d = start; d.getTime() <= end.getTime(); d = new Date(d.getTime() + 86400000)) {
      const key = formatLocalDateKey(d);
      const weekday = d.getDay();
      const bucketIndex = weekday === 0 ? 6 : weekday - 1;
      values[bucketIndex] += Number(visitorsPerDayMap[key] || 0);
    }

    return { labels, values };
  }, [selectedStartDate, selectedEndDate, visitorsPerDayMap]);

  const periodWeeks = useMemo(() => {
    const weeks: { label: string; visitors: number; sales: number }[] = [];
    periodSeries.values.forEach((v, i) => {
      const w = Math.floor(i / 7);
      if (!weeks[w]) weeks[w] = { label: `Sem ${w + 1}`, visitors: 0, sales: 0 };
      weeks[w].visitors += Number(v) || 0;
    });
    return weeks;
  }, [periodSeries.values]);

  const compareSeries = useMemo(() => {
    const dayCount = Math.max(1, periodSeries.values.length);
    const prevEnd   = new Date(selectedStartDate.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - (dayCount - 1) * 86400000);
    const prev: number[] = [];
    const start = alignUtcStartOfDay(prevStart);
    const end   = alignUtcStartOfDay(prevEnd);
    for (let d = start; d.getTime() <= end.getTime(); d = new Date(d.getTime() + 86400000)) {
      prev.push(Number(comparePrevVisitorsPerDay[formatLocalDateKey(d)] || 0));
    }
    while (prev.length < dayCount) prev.push(0);
    return { labels: periodSeries.labels, current: periodSeries.values, previous: prev.slice(0, dayCount) };
  }, [periodSeries.labels, periodSeries.values, selectedStartDate, comparePrevVisitorsPerDay]);


  const clientName = clientData?.name || 'Carregando...';
  const clientLogo = clientData?.logo;

  return (
    <div
      ref={dashboardRef}
      className="space-y-6 animate-in fade-in duration-500"
      style={isFullscreen ? { background: '#030712', padding: '24px', overflowY: 'auto', height: '100%' } : undefined}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <button onClick={() => navigate('/clientes')} className="hover:text-emerald-400 transition-colors">Clientes</button>
          <ChevronRight size={14} />
          <button onClick={goToNetwork} className={`hover:text-emerald-400 transition-colors ${view === 'network' && !selectedStore ? 'text-white font-medium' : ''}`}>{clientName}</button>
          {selectedStore && (<><ChevronRight size={14} /><button onClick={() => goToStore(selectedStore)} className="hover:text-emerald-400 transition-colors text-white font-medium">{selectedStore.name}</button></>)}
        </div>

        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div className="flex items-center gap-4 sm:gap-6">
            <div className="h-16 w-16 sm:h-24 sm:min-w-[100px] flex items-center justify-center overflow-hidden group relative cursor-pointer">
              {clientLogo ? (
                <img src={clientLogo} alt="Logo Cliente" className="h-full w-auto object-contain" />
              ) : (
                <div className="flex flex-col items-center justify-center text-gray-700 w-16 h-16 sm:w-20 sm:h-20 bg-gray-900 border border-gray-800 rounded-xl">
                  <Image size={24} />
                  <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-xl">
                    <Upload size={16} className="text-white mb-1" />
                    <span className="text-[8px] text-white font-medium uppercase tracking-wider">Add Logo</span>
                  </div>
                </div>
              )}
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2"><Globe className="text-emerald-500" />Dashboard Geral</h1>
              <p className="text-sm sm:text-base text-gray-400 mt-1">Monitorando {stores.length} lojas nesta rede</p>
              {!apiConfig?.api_key && <p className="text-xs text-yellow-400 mt-1">API não configurada ⚠️</p>}
              {syncMessage && (
                <p className={`text-xs mt-1 ${syncMessage.startsWith('✅') ? 'text-emerald-400' : 'text-blue-400'} flex items-center gap-1`}>
                  {!syncMessage.startsWith('✅') && <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />}
                  {syncMessage}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-start gap-3 w-full lg:w-auto">
            <div className="relative w-full sm:w-auto">
              <select
                className="bg-gray-900 border border-gray-800 text-white pl-10 pr-8 py-2 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 appearance-none cursor-pointer text-sm w-full sm:min-w-[180px]"
                onChange={(e) => { const sid = e.target.value; if (sid === 'all') goToNetwork(); else { const s = stores.find((s) => s.id === sid); if (s) goToStore(s); } }}
                value={selectedStore?.id || 'all'}
              >
                <option value="all" style={{ backgroundColor: '#111827', color: 'white' }}>Rede Global</option>
                {stores.map((store) => <option key={store.id} value={store.id} style={{ backgroundColor: '#111827', color: 'white' }}>{store.name}</option>)}
              </select>
              <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" size={16} />
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" size={14} />
            </div>

            {/* Botão para forçar atualização das lojas do DisplayForce */}
            <button
              onClick={() => syncStoresFromServer(true)}
              disabled={isSyncingStores}
              title="Atualizar lista de lojas do DisplayForce"
              className="flex items-center justify-center bg-gray-900 border border-gray-800 text-white rounded-lg hover:border-emerald-600 hover:text-emerald-400 transition-colors flex-shrink-0 h-[38px] w-[38px] disabled:opacity-50"
            >
              {isSyncingStores
                ? <span className="inline-block w-3.5 h-3.5 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                : <Building2 size={16} className="text-gray-400" />
              }
            </button>

            <div className="flex flex-row items-start gap-2 w-full sm:w-auto">
              {/* Fullscreen */}
              <button
                onClick={toggleFullscreen}
                title={isFullscreen ? 'Sair da tela cheia' : 'Modo apresentação'}
                className="flex items-center justify-center bg-gray-900 border border-gray-800 text-white rounded-lg hover:border-gray-700 transition-colors flex-shrink-0 h-[38px] w-[38px]"
              >
                {isFullscreen ? <Minimize2 size={16} className="text-emerald-400" /> : <Maximize2 size={16} className="text-gray-400" />}
              </button>

              {/* Reorganizar Layout (drag-and-drop inline) */}
              {!editLayoutMode ? (
                <button
                  onClick={enterEditMode}
                  title="Reorganizar widgets - arraste para juntar os cards"
                  className="flex items-center justify-center bg-gray-900 border border-gray-800 text-white rounded-lg hover:border-emerald-600 hover:text-emerald-400 transition-colors flex-shrink-0 h-[38px] w-[38px]"
                >
                  <Move size={16} className="text-gray-400" />
                </button>
              ) : (
                <>
                  <button
                    onClick={autoArrangeWidgets}
                    disabled={savingLayout}
                    title="Auto-organizar: poe os KPIs (cards pequenos) primeiro, depois os graficos. Elimina os espacos vazios."
                    className="flex items-center justify-center bg-gray-900 border border-purple-500/60 text-purple-300 hover:text-white hover:bg-purple-600 rounded-lg transition-colors flex-shrink-0 h-[38px] px-3 gap-1.5 text-xs font-medium disabled:opacity-60"
                  >
                    <Wand2 size={14} />
                    Auto-organizar
                  </button>
                  <button
                    onClick={saveLayoutOrder}
                    disabled={savingLayout}
                    title="Salvar nova organizacao"
                    className="flex items-center justify-center bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors flex-shrink-0 h-[38px] px-3 gap-1.5 text-xs font-medium disabled:opacity-60"
                  >
                    {savingLayout
                      ? <span className="inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      : <Save size={14} />}
                    Salvar
                  </button>
                  <button
                    onClick={cancelEditMode}
                    disabled={savingLayout}
                    title="Cancelar alteracoes"
                    className="flex items-center justify-center bg-gray-900 border border-gray-800 text-white rounded-lg hover:border-red-500 hover:text-red-400 transition-colors flex-shrink-0 h-[38px] w-[38px] disabled:opacity-60"
                  >
                    <X size={16} className="text-gray-400" />
                  </button>
                </>
              )}

              {/* Upload campanhas (apenas admin) */}
              {authUser?.role === 'admin' && (
                <button
                  onClick={() => navigate(`/clientes/${id}/campanhas`)}
                  title="Importar relatório de campanhas do e-mail"
                  className="flex items-center justify-center bg-gray-900 border border-gray-800 text-white rounded-lg hover:border-blue-500 hover:text-blue-400 transition-colors flex-shrink-0 h-[38px] w-[38px]"
                >
                  <Upload size={16} className="text-gray-400" />
                </button>
              )}

              {/* Sync manual */}
              <button
                onClick={() => triggerBackgroundSync(true)}
                disabled={syncingRef.current}
                title="Forçar sincronização agora"
                className="flex items-center justify-center bg-gray-900 border border-gray-800 text-white rounded-lg hover:border-emerald-600 hover:text-emerald-400 transition-colors flex-shrink-0 h-[38px] w-[38px] disabled:opacity-50"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 4v6h-6" /><path d="M1 20v-6h6" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
              </button>

              {/* Export */}
              <ExportButton
                data={{
                  clientId: id ?? '',
                  clientName,
                  lojaFilter: selectedStore?.name ?? null,
                  period: { start: selectedStartDate, end: selectedEndDate },
                  kpis: { totalVisitors, avgVisitorsPerDay, avgVisitSeconds, avgAttentionSeconds },
                  dailyStats: periodSeries.values, dailyLabels: periodSeries.labels, hourlyStats, genderStats, ageStats, attributeStats,
                  hairTypeData, hairColorData, visitorsPerDayMap, quarterBars, dashboardRef,
                }}
              />

              {/* Date Picker */}
              <div className="flex flex-col items-end flex-1 sm:flex-none">
                <div className="relative w-full sm:w-auto">
                  <button
                    onClick={() => {
                      const next = !showDatePicker;
                      if (next) {
                        setDraftStartDate(selectedStartDate);
                        setDraftEndDate(selectedEndDate);
                      }
                      setShowDatePicker(next);
                    }}
                    className="w-full sm:w-auto flex items-center justify-between sm:justify-start gap-2 bg-gray-900 border border-gray-800 text-white px-4 py-2 rounded-lg hover:border-gray-700 transition-colors"
                  >
                    <div className="flex items-center gap-2 flex-nowrap">
                      <Calendar size={16} className="text-gray-500" />
                      <span className="text-sm whitespace-nowrap">{selectedStartDate.toLocaleDateString('pt-BR')} → {selectedEndDate.toLocaleDateString('pt-BR')}</span>
                    </div>
                    <ChevronDown size={14} className="text-gray-500" />
                  </button>
                  {showDatePicker && (
                    <div className="absolute z-10 mt-2 p-3 bg-gray-900 border border-gray-800 rounded-lg shadow-xl right-0 w-full sm:w-auto">
                      <div className="flex flex-col sm:flex-row items-end gap-3">
                        <div className="w-full sm:w-auto">
                          <label className="block text-xs text-gray-400">Início</label>
                          <input type="date" value={formatDateInputValue(draftStartDate)}
                            onChange={(e) => { const d = parseDateInputValue(e.target.value, false); if (d) setDraftStartDate(d); }}
                            className="bg-gray-800 text-white px-3 py-2 rounded-md border border-gray-700" />
                        </div>
                        <div className="w-full sm:w-auto">
                          <label className="block text-xs text-gray-400">Fim</label>
                          <input type="date" value={formatDateInputValue(draftEndDate)}
                            onChange={(e) => { const d = parseDateInputValue(e.target.value, true); if (d) setDraftEndDate(d); }}
                            className="w-full bg-gray-800 text-white px-3 py-2 rounded-md border border-gray-700" />
                        </div>
                        <button
                          onClick={() => {
                            autoTodayRef.current = false;
                            let nextStart = alignUtcStartOfDay(draftStartDate);
                            let nextEnd = alignUtcEndOfDay(draftEndDate);
                            if (nextEnd.getTime() < nextStart.getTime()) nextEnd = new Date(nextStart.getTime() + 86399999);
                            setSelectedStartDate(nextStart);
                            setSelectedEndDate(nextEnd);
                            setShowDatePicker(false);
                            // Persiste o período selecionado para não resetar ao navegar
                            try { localStorage.setItem(`dash_range_${id}`, JSON.stringify({ start: nextStart.toISOString(), end: nextEnd.toISOString(), savedAt: new Date().toISOString() })); } catch {}
                          }}
                          className="w-full sm:w-auto px-3 py-2 bg-emerald-600 text-white rounded-md"
                        >
                          Aplicar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                {lastUpdate && <div className="mt-1 text-[10px] text-gray-500 w-full sm:w-auto text-right">Atualizado: {lastUpdate.toLocaleString('pt-BR')}</div>}
              </div>
            </div>
          </div>
        </div>
      </div>


      {/* Banner indicador de modo edicao */}
      {editLayoutMode && (
        <div className="bg-emerald-500/10 border border-emerald-600/40 text-emerald-300 rounded-xl px-4 py-2.5 text-sm flex items-center gap-2">
          <Move size={14} />
          <span>Modo organizacao ativo - arraste qualquer card ou use as setas para subir/descer. Clique em <strong>Salvar</strong> para confirmar ou <strong>X</strong> para cancelar.</span>
        </div>
      )}

      {/* Widgets */}
      <div className={`bg-gray-900 border ${editLayoutMode ? 'border-emerald-600/50' : 'border-gray-800'} rounded-xl overflow-hidden min-h-[400px] transition-colors`}>
        {view === 'network' && (
          <div ref={widgetsGridRef} onDragOver={handleGridDragOver} onDrop={(e) => { if (editLayoutMode) e.preventDefault(); }} style={{ gridAutoFlow: 'row dense', gridAutoRows: `${GRID_AUTO_ROW_PX}px` }} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 items-stretch content-start gap-4 p-1">
            {isLoadingConfig ? (
              <div className="col-span-full flex justify-center py-20">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" />
              </div>
            ) : activeWidgets.length > 0 ? (
              activeWidgets.map((widget, widgetIndex) => {
                const Component = WIDGET_MAP[widget.id];
                if (!Component) return null;
                const defaultSpanForSize = (size: WidgetType['size']) => {
                  if (size === 'full') return 12; if (size === 'third') return 4;
                  if (size === 'quarter') return 3; if (size === '2/3') return 8;
                  return 6;
                };
                let spanLg = Number(widgetLayout[widget.id]?.colSpanLg) || defaultSpanForSize(widget.size);
                if (![3, 4, 6, 8, 12].includes(spanLg)) spanLg = defaultSpanForSize(widget.size);
                let lgSpan = 'lg:col-span-6';
                if (spanLg === 12) lgSpan = 'lg:col-span-12';
                if (spanLg === 8)  lgSpan = 'lg:col-span-8';
                if (spanLg === 4)  lgSpan = 'lg:col-span-4';
                if (spanLg === 3)  lgSpan = 'lg:col-span-3';
                const mdSpan = spanLg >= 8 ? 'md:col-span-2' : 'md:col-span-1';
                const widgetProps: any = { view: 'network' };
                if (widget.id === 'flow_trend')              { widgetProps.dailyData = flowTrendSeries.values; widgetProps.dailyLabels = flowTrendSeries.labels; widgetProps.genderData = genderStats; }
                if (widget.id === 'hourly_flow')             { widgetProps.hourlyData = hourlyStats; widgetProps.genderData = genderStats; widgetProps.totalVisitors = totalVisitors; }
                if (widget.id === 'chart_facial_expressions') {
                  widgetProps.startDate = selectedStartDate;
                  widgetProps.endDate = selectedEndDate;
                  widgetProps.labels = facialExpressionLabels;
                  widgetProps.series = facialExpressionSeries;
                }
                if (widget.id === 'chart_device_flow')       {
                  widgetProps.visitors  = totalVisitors;
                  const isNetworkView   = !selectedStore && deviceIds.length === 0;
                  widgetProps.deviceAudience = isNetworkView
                    // Rede Global: useMemo deviceFlowAudienceByStore (reage a stores E audience)
                    ? deviceFlowAudienceByStore
                    // Loja selecionada: por device com label resolvido
                    : deviceFlowAudience.map(e => ({
                        ...e,
                        label: resolveDeviceFlowLabel(String(e?.label ?? '')),
                      }));
                  widgetProps.trackingData = [];
                }
                if (widget.id === 'device_type_audience') {
                  widgetProps.deviceAudience = deviceFlowAudience.map(e => ({
                    ...e,
                    label: resolveDeviceFlowLabel(String(e?.label ?? '')),
                  }));
                  widgetProps.trackingData = deviceFlowTracking;
                }
                if (widget.id === 'age_pyramid')             { widgetProps.ageData = ageStats; widgetProps.totalVisitors = totalVisitors; }
                if (widget.id === 'gender_dist')             { widgetProps.genderData = genderStats; widgetProps.totalVisitors = totalVisitors; }
                if (widget.id === 'attributes')                widgetProps.attrData = attributeStats;
                if (widget.id === 'kpi_total_visitors')        widgetProps.totalVisitors = totalVisitors;
                if (widget.id === 'kpi_avg_visitors_day')      widgetProps.avgVisitorsPerDay = avgVisitorsPerDay;
                if (widget.id === 'kpi_avg_visit_time')        widgetProps.avgVisitSeconds = avgVisitSeconds;
                if (widget.id === 'kpi_attention_time')        widgetProps.avgAttentionSeconds = avgAttentionSeconds;
                if (widget.id === 'chart_age_ranges')          widgetProps.ageData = ageStats;
                if (widget.id === 'chart_vision')              widgetProps.attrData = attributeStats;
                if (widget.id === 'chart_facial_hair')         widgetProps.attrData = attributeStats;
                if (widget.id === 'chart_hair_type')           widgetProps.hairTypeData = hairTypeData;
                if (widget.id === 'chart_hair_color')          widgetProps.hairColorData = hairColorData;
                if (widget.id === 'kpi_store_quarter')       { widgetProps.visitors = quarterVisitorsTotal; widgetProps.sales = quarterSalesTotal; widgetProps.loading = isLoadingQuarter; }
                if (widget.id === 'chart_sales_quarter')     { widgetProps.quarterData = quarterBars; widgetProps.loading = isLoadingQuarter; }
                if (widget.id === 'kpi_store_period')        { widgetProps.visitors = totalVisitors; widgetProps.sales = 0; widgetProps.loading = isLoadingData; }
                if (widget.id === 'campaigns') { widgetProps.clientId = id; widgetProps.lojaFilter = selectedStore?.name ?? null; }
                if (widget.id === 'chart_sales_daily')       { widgetProps.labels = periodSeries.labels; widgetProps.visitors = periodSeries.values; widgetProps.loading = isLoadingData; }
                if (widget.id === 'chart_sales_period_bar')  { widgetProps.periodData = periodWeeks; widgetProps.loading = isLoadingData; }
                if (widget.id === 'chart_sales_period_line') { widgetProps.labels = compareSeries.labels; widgetProps.current = compareSeries.current; widgetProps.previous = compareSeries.previous; widgetProps.loading = isLoadingCompare; }
                const heightPx = Number(widgetLayout[widget.id]?.heightPx);
                const defaultHeightPx = getDefaultHeightPx(widget);
                const resolvedHeightPx = Number.isFinite(heightPx) ? heightPx : defaultHeightPx;
                const rowSpan = computeRowSpan(widget, resolvedHeightPx);
                // KPIs esticam para encher a celula (height: 100%);
                // demais widgets respeitam heightPx configurado, ou auto.
                const widgetStyle: React.CSSProperties = { gridRow: `span ${rowSpan}` };
                if (widget.type === 'kpi') {
                  widgetStyle.height = '100%';
                } else if (Number.isFinite(resolvedHeightPx)) {
                  widgetStyle.height = Math.round(Number(resolvedHeightPx));
                }
                const isDragging = editLayoutMode && draggedIndex === widgetIndex;
                return (
                  <div
                    key={widget.id}
                    data-widget-card
                    style={widgetStyle}
                    draggable={editLayoutMode}
                    onDragStart={(e) => handleWidgetDragStart(e, widgetIndex)}
                    onDragOver={(e) => handleWidgetDragOver(e, widgetIndex)}
                    onDragEnd={handleWidgetDragEnd}
                    onDrop={(e) => { if (editLayoutMode) e.preventDefault(); }}
                    className={`relative col-span-1 ${mdSpan} ${lgSpan} animate-in fade-in zoom-in-95 duration-500 ${editLayoutMode ? 'cursor-move ring-1 ring-emerald-600/40 rounded-xl' : ''} ${isDragging ? 'opacity-50 scale-95 ring-2 ring-emerald-500' : ''} transition-all`}
                  >
                    {editLayoutMode && (
                      <div className="absolute top-2 right-2 z-20 flex items-center gap-1">
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); moveWidgetByIndex(widgetIndex, 'up'); }}
                          disabled={widgetIndex === 0}
                          title="Subir card"
                          className="bg-gray-900/95 border border-emerald-500/60 text-emerald-300 hover:text-white hover:bg-emerald-600 rounded-md p-1 shadow-lg disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          <ArrowUp size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); moveWidgetByIndex(widgetIndex, 'down'); }}
                          disabled={widgetIndex === activeWidgets.length - 1}
                          title="Descer card"
                          className="bg-gray-900/95 border border-emerald-500/60 text-emerald-300 hover:text-white hover:bg-emerald-600 rounded-md p-1 shadow-lg disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          <ArrowDown size={12} />
                        </button>
                        <div className="bg-emerald-600/90 text-white rounded-md p-1 shadow-lg pointer-events-none flex items-center gap-1">
                          <GripVertical size={12} />
                          <span className="text-[10px] font-semibold uppercase tracking-wider">Arrastar</span>
                        </div>
                      </div>
                    )}
                    <div className={editLayoutMode ? 'pointer-events-none h-full' : 'h-full'}>
                      <Component {...widgetProps} />
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="col-span-full text-center py-20 text-gray-500">
                <LayoutGrid size={48} className="mx-auto mb-4 opacity-20" />
                <p>Nenhum widget configurado para este dashboard.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
