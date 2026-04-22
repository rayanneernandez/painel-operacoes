import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { FACIAL_EXPRESSION_SERIES, getDominantFacialExpression, normalizeFacialExpression } from "./_lib/facialExpressions.js";

// ── Supabase ──────────────────────────────────────────────────────────────────
const _url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const _key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  "";
const supabase = createClient(_url, _key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function sha256(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}
function safeNumber(x: any): number | null {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}
function asISODateUTC(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
}
function normalizeGender(v: any): number {
  if (typeof v.sex === "number") return v.sex;
  if (typeof v.sex === "string") {
    const s = v.sex.toLowerCase();
    if (["male","m","1"].includes(s)) return 1;
    if (["female","f","2"].includes(s)) return 2;
  }
  if (v.gender === "male") return 1;
  if (v.gender === "female") return 2;
  return 0;
}
function bucketAge(age: number): string {
  if (age < 0) return "unknown";
  if (age <= 9) return "0-9"; if (age <= 17) return "10-17";
  if (age <= 24) return "18-24"; if (age <= 34) return "25-34";
  if (age <= 44) return "35-44"; if (age <= 54) return "45-54";
  if (age <= 64) return "55-64"; if (age <= 74) return "65-74";
  return "75+";
}
function percentMap(countMap: Record<string,number>, total: number) {
  const out: Record<string,number> = {};
  if (total <= 0) return out;
  for (const [k, v] of Object.entries(countMap))
    out[k] = Number(((v / total) * 100).toFixed(2));
  return out;
}

function extractDeviceFlowPassersbyCount(row: any) {
  const raw = row?.raw_data;
  const candidates = [
    raw?.tracks_count,
    raw?.tracks_acount,
    raw?.contacts_count,
    raw?.contact_count,
    raw?.overall_tracks_count,
    raw?.passerby_body_tracks_count,
  ];

  let best = 0;
  for (const candidate of candidates) {
    const numeric = Math.round(Number(candidate) || 0);
    if (Number.isFinite(numeric) && numeric > best) best = numeric;
  }

  const tracksLength = Array.isArray(raw?.tracks) ? raw.tracks.length : 0;
  if (Number.isFinite(tracksLength) && tracksLength > best) best = tracksLength;

  return best > 0 ? best : 1;
}

function hasStoredExpressionCache(value: any) {
  if (!value || typeof value !== "object") return false;
  return Object.values(value).some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    return Object.values(entry).some((count) => Number(count) > 0);
  });
}

function mergeAttributesKeepingExpressionCache(existingAttributes: any, nextAttributes: any) {
  const existing = existingAttributes && typeof existingAttributes === "object" ? existingAttributes : {};
  const next = nextAttributes && typeof nextAttributes === "object" ? nextAttributes : {};
  const shouldKeepExistingExpressions = hasStoredExpressionCache(existing?.expressions_hourly);

  // device_flow: preserva passersby (vem do live fetch) mesmo quando cron recalcula,
  // e só sobrescreve audience/tracking se o cron trouxe algo válido.
  const existingDeviceFlow = existing?.device_flow && typeof existing.device_flow === "object" ? existing.device_flow : null;
  const nextDeviceFlow = next?.device_flow && typeof next.device_flow === "object" ? next.device_flow : null;
  const mergedDeviceFlow = (existingDeviceFlow || nextDeviceFlow)
    ? {
        visitors: nextDeviceFlow?.visitors ?? existingDeviceFlow?.visitors ?? 0,
        passersby: nextDeviceFlow?.passersby ?? existingDeviceFlow?.passersby ?? null,
        deviceAudience: Array.isArray(nextDeviceFlow?.deviceAudience) && nextDeviceFlow.deviceAudience.length > 0
          ? nextDeviceFlow.deviceAudience
          : (Array.isArray(existingDeviceFlow?.deviceAudience) ? existingDeviceFlow.deviceAudience : []),
        trackingData: Array.isArray(nextDeviceFlow?.trackingData) && nextDeviceFlow.trackingData.length > 0
          ? nextDeviceFlow.trackingData
          : (Array.isArray(existingDeviceFlow?.trackingData) ? existingDeviceFlow.trackingData : []),
      }
    : undefined;

  return {
    ...next,
    expressions: shouldKeepExistingExpressions ? (existing.expressions ?? next.expressions ?? {}) : (next.expressions ?? existing.expressions ?? {}),
    expressions_totals: shouldKeepExistingExpressions ? (existing.expressions_totals ?? next.expressions_totals ?? {}) : (next.expressions_totals ?? existing.expressions_totals ?? {}),
    expressions_hourly: shouldKeepExistingExpressions ? (existing.expressions_hourly ?? next.expressions_hourly ?? {}) : (next.expressions_hourly ?? existing.expressions_hourly ?? {}),
    ...(mergedDeviceFlow ? { device_flow: mergedDeviceFlow } : {}),
  };
}

// ── Deduplica e normaliza registros da API ────────────────────────────────────
function buildRows(visits: any[], client_id: string) {
  const map = new Map<string, any>();
  for (const v of visits) {
    let device_id: number | null = null;
    if (Array.isArray(v.devices) && v.devices.length > 0) {
      const n = Number(v.devices[0]); if (Number.isFinite(n)) device_id = n;
    } else {
      for (const k of ["device","device_id","source_id","camera_id"]) {
        if (k in v) { const n = Number(v[k]); if (Number.isFinite(n)) { device_id = n; break; } }
      }
    }
    const startRaw = v.start ?? v.timestamp ?? v.start_time ?? v.begin ?? null;
    const endRaw   = v.end ?? v.end_time ?? v.finish ?? null;
    const startTs  = typeof startRaw === "string" ? startRaw : null;
    const endTs    = typeof endRaw   === "string" ? endRaw   : null;
    let dur: number | null = null;
    if (startTs && endTs) {
      const s = Date.parse(startTs), e = Date.parse(endTs);
      if (Number.isFinite(s) && Number.isFinite(e) && e >= s) dur = Math.round((e - s) / 1000);
    }
    const visitTime = safeNumber(v.tracks_duration) ?? safeNumber(v.visit_time_seconds) ?? safeNumber(v.duration) ?? dur ?? null;
    const dwellTime = safeNumber(v.dwell_time_seconds) ?? safeNumber(v.dwell_time) ?? null;
    const contactTime = safeNumber(v.content_view_duration) ?? safeNumber(v.contact_time_seconds) ?? null;
    const dominantExpression = getDominantFacialExpression(v);

    const visit_uid = sha256(JSON.stringify({ client_id, device_id, visitor_id: v.visitor_id ?? null, start: startTs }));
    map.set(visit_uid, {
      visit_uid, client_id, device_id,
      timestamp: startTs, end_timestamp: endTs,
      age: typeof v.age === "number" ? Math.round(v.age) : null,
      gender: normalizeGender(v),
      attributes: {
        face_quality: v.face_quality ?? null,
        glasses: v.glasses ?? null,
        facial_hair: v.facial_hair ?? null,
        hair_color: v.hair_color ?? null,
        hair_type: v.hair_type ?? null,
        headwear: v.headwear ?? null,
        facial_expression: dominantExpression,
      },
      visit_time_seconds: visitTime,
      dwell_time_seconds: dwellTime,
      contact_time_seconds: contactTime,
      raw_data: v,
    });
  }
  return Array.from(map.values());
}

async function upsertVisitorAnalyticsRows(rows: any[]) {
  let total = 0;
  for (let i = 0; i < rows.length; i += 250) {
    const chunk = rows.slice(i, i + 250);
    const { error } = await supabase
      .from("visitor_analytics")
      .upsert(chunk, { onConflict: "visit_uid", ignoreDuplicates: true });
    if (error) {
      console.error("[cron] visitor_analytics upsert error:", error);
      continue;
    }
    total += chunk.length;
  }
  return total;
}

// ── Constrói rollup em memória ────────────────────────────────────────────────
function buildRollup(rows: any[], client_id: string, rangeStart: string, rangeEnd: string) {
  const startMs = Date.parse(rangeStart), endMs = Date.parse(rangeEnd);
  const daysInRange = Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(1, Math.ceil((endMs - startMs + 1) / 86400000)) : 1;
  const perDay: Record<string,number> = {};
  const perHour: Record<string,number> = {};
  for (let h = 0; h < 24; h++) perHour[String(h)] = 0;
  const ageCounts: Record<string,number> = { "0-9":0,"10-17":0,"18-24":0,"25-34":0,"35-44":0,"45-54":0,"55-64":0,"65-74":0,"75+":0,unknown:0 };
  const genderCounts: Record<string,number> = { male:0, female:0, unknown:0 };
  const glassesCounts:    Record<string,number> = {};
  const hairColorCounts:  Record<string,number> = {};
  const hairTypeCounts:   Record<string,number> = {};
  const headwearCounts:   Record<string,number> = {};
  const facialHairCounts: Record<string,number> = {};
  const expressionCounts: Record<string,number> = {};
  const expressionHourlyCounts: Record<string, Record<string, number>> = {};
  let expressionKnown = 0;
  let sumVisit=0, cntVisit=0, sumContact=0, cntContact=0;

  // device_flow — alimenta o widget Fluxo e Audiência Device direto do banco
  const deviceCounts = new Map<string, number>();
  const trackingIslands = new Map<string, { label: string; count: number }>();
  let totalPassersby = 0;

  for (const r of rows) {
    // device_flow: conta visitas por device e combinações reais de devices da ilha
    const rawDevices = Array.isArray(r?.raw_data?.devices) ? r.raw_data.devices : [];
    const normalizedDeviceKeys: string[] = rawDevices
      .map((v: any) => String(v ?? "").trim())
      .filter(Boolean);
    const deviceKeys = normalizedDeviceKeys.length > 0
      ? [...new Set(normalizedDeviceKeys)]
      : (r?.device_id ? [String(r.device_id).trim()].filter(Boolean) : []);
    for (const key of deviceKeys) {
      deviceCounts.set(key, (deviceCounts.get(key) ?? 0) + 1);
    }
    const islandKey = [...deviceKeys].sort().join("|");
    if (islandKey) {
      const current = trackingIslands.get(islandKey);
      trackingIslands.set(islandKey, {
        label: current?.label || deviceKeys.map((key) => `Device ${key}`).join(" + "),
        count: (current?.count ?? 0) + 1,
      });
    }
    totalPassersby += extractDeviceFlowPassersbyCount(r);

    let hourKey: string | null = null;
    if (r.timestamp) {
      const d = new Date(r.timestamp);
      if (!isNaN(d.getTime())) {
        const dk = asISODateUTC(d);
        hourKey = d.toISOString().slice(0, 13);
        perDay[dk] = (perDay[dk] ?? 0) + 1;
        perHour[String(d.getUTCHours())] = (perHour[String(d.getUTCHours())] ?? 0) + 1;
      }
    }
    if (typeof r.age === "number" && Number.isFinite(r.age)) ageCounts[bucketAge(Math.round(r.age))]++;
    else ageCounts.unknown++;
    if (r.gender === 1) genderCounts.male++; else if (r.gender === 2) genderCounts.female++; else genderCounts.unknown++;
    if (typeof r.visit_time_seconds === "number" && Number.isFinite(r.visit_time_seconds)) { sumVisit += r.visit_time_seconds; cntVisit++; }
    if (typeof r.contact_time_seconds === "number" && Number.isFinite(r.contact_time_seconds) && r.contact_time_seconds > 0) { sumContact += r.contact_time_seconds; cntContact++; }

    // Atributos físicos — null conta como "none"/"unknown" para denominador correto
    const attrs = r.attributes ?? {};
    { const k = attrs.glasses    != null ? String(attrs.glasses).toLowerCase()    : "none";    glassesCounts[k]    = (glassesCounts[k]    ?? 0) + 1; }
    { const k = attrs.hair_color != null ? String(attrs.hair_color).toLowerCase() : "unknown"; hairColorCounts[k]  = (hairColorCounts[k]  ?? 0) + 1; }
    { const k = attrs.hair_type  != null ? String(attrs.hair_type).toLowerCase()  : "unknown"; hairTypeCounts[k]   = (hairTypeCounts[k]   ?? 0) + 1; }
    { const k = attrs.headwear   != null ? String(attrs.headwear).toLowerCase()   : "none";    headwearCounts[k]   = (headwearCounts[k]   ?? 0) + 1; }
    { const k = attrs.facial_hair!= null ? String(attrs.facial_hair).toLowerCase(): "none";    facialHairCounts[k] = (facialHairCounts[k] ?? 0) + 1; }
    const expression = normalizeFacialExpression(attrs.facial_expression) ?? getDominantFacialExpression(r.raw_data);
    if (expression) {
      expressionCounts[expression] = (expressionCounts[expression] ?? 0) + 1;
      if (hourKey) {
        const hourlyEntry = expressionHourlyCounts[hourKey] ?? Object.fromEntries(FACIAL_EXPRESSION_SERIES.map(({ key }) => [key, 0])) as Record<string, number>;
        hourlyEntry[expression] = (hourlyEntry[expression] ?? 0) + 1;
        expressionHourlyCounts[hourKey] = hourlyEntry;
      }
      expressionKnown++;
    }
  }

  const total = rows.length;
  const perHourAvg: Record<string,number> = {};
  for (let h = 0; h < 24; h++) perHourAvg[String(h)] = Number(((perHour[String(h)] ?? 0) / daysInRange).toFixed(2));
  const n = Math.max(total, 1);
  const nAttr = (k: Record<string,number>) => Object.values(k).reduce((a,b) => a+b, 0) || 1;

  // device_flow a partir das contagens acumuladas — top 4 devices ranqueados por visita
  const deviceAudience = [...deviceCounts.entries()]
    .map(([deviceKey, count]) => ({
      label: `Device ${deviceKey}`,
      value: total > 0 ? Number(((count / total) * 100).toFixed(1)) : 0,
      rawCount: count,
    }))
    .sort((a, b) => b.rawCount - a.rawCount)
    .slice(0, 4)
    .map(({ label, value }) => ({ label, value }));
  const trackingData = [...trackingIslands.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 4)
    .map(({ label, count }) => ({
      label,
      value: total > 0 ? Number(((count / total) * 100).toFixed(1)) : 0,
    }))
    .filter((item) => item.value > 0);

  return {
    client_id, start: rangeStart, end: rangeEnd,
    total_visitors: total,
    avg_visitors_per_day: Number((total / daysInRange).toFixed(2)),
    visitors_per_day: perDay,
    visitors_per_hour_avg: perHourAvg,
    age_pyramid_percent: percentMap(ageCounts, n),
    gender_percent: percentMap(genderCounts, n),
    attributes_percent: {
      glasses:     percentMap(glassesCounts,    nAttr(glassesCounts)),
      hair_color:  percentMap(hairColorCounts,  nAttr(hairColorCounts)),
      hair_type:   percentMap(hairTypeCounts,   nAttr(hairTypeCounts)),
      headwear:    percentMap(headwearCounts,   nAttr(headwearCounts)),
      facial_hair: percentMap(facialHairCounts, nAttr(facialHairCounts)),
      expressions: expressionKnown > 0 ? percentMap(expressionCounts, expressionKnown) : {},
      expressions_totals: expressionKnown > 0 ? expressionCounts : {},
      expressions_hourly: expressionKnown > 0 ? expressionHourlyCounts : {},
      device_flow: {
        visitors: total,
        passersby: Math.max(total, totalPassersby) || null,
        deviceAudience,
        trackingData,
      },
    },
    avg_visit_time_seconds:   cntVisit   > 0 ? Number((sumVisit   / cntVisit).toFixed(2))   : null,
    avg_contact_time_seconds: cntContact > 0 ? Number((sumContact / cntContact).toFixed(2)) : null,
    updated_at: new Date().toISOString(),
  };
}

function splitRowsByUtcDay(rows: any[]) {
  const byDay = new Map<string, any[]>();
  for (const row of rows) {
    if (!row?.timestamp) continue;
    const d = new Date(row.timestamp);
    if (isNaN(d.getTime())) continue;
    const key = asISODateUTC(d);
    const existing = byDay.get(key) || [];
    existing.push(row);
    byDay.set(key, existing);
  }
  return byDay;
}

// ── Sync de um cliente ────────────────────────────────────────────────────────
async function syncClient(client_id: string, cfg: any, overrideSyncStart?: string, overrideSyncEnd?: string): Promise<{ synced: number; error?: string }> {
  try {
    const now = new Date();
    const syncEnd    = overrideSyncEnd   ?? now.toISOString();
    const todayEnd   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999)).toISOString();
    const HISTORIC_END = "9999-12-31T23:59:59.999Z";

    const collectionStart = cfg.collection_start || "2025-01-01T00:00:00.000Z";
    // Janela automática curta para reduzir timeout e ainda cobrir ontem/anteontem.
    const defaultStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 2, 0, 0, 0, 0)).toISOString();
    const syncStart = overrideSyncStart ?? (Date.parse(collectionStart) > Date.parse(defaultStart) ? collectionStart : defaultStart);

    const apiBase = (cfg.api_endpoint || "https://api.displayforce.ai").replace(/\/$/, "");
    const endpoint = cfg.analytics_endpoint?.startsWith("/") ? cfg.analytics_endpoint : `/${cfg.analytics_endpoint || "public/v1/stats/visitor/list"}`;
    const analyticsUrl = `${apiBase}${endpoint}`;

    const headers: Record<string,string> = { "Content-Type": "application/json", Accept: "application/json" };
    const ck = cfg.custom_header_key?.trim(); const cv = cfg.custom_header_value?.trim();
    if (ck && cv) headers[ck] = cv;
    else if (cfg.api_key?.trim()) headers["X-API-Token"] = cfg.api_key.trim();
    else return { synced: 0, error: "api_key não configurada" };

    const baseBody = {
      start: syncStart, end: syncEnd,
      tracks: true, face_quality: true, glasses: true,
      facial_hair: true, hair_color: true, hair_type: true, headwear: true,
      additional_attributes: ["smile","pitch","yaw","x","y","height"],
    };

    // Limite por página — a API DisplayForce capeia em 1000 independente do valor pedido.
    // Usamos 1000 explicitamente para controlar a paginação corretamente.
    const PAGE_LIMIT = 1000;

    // Coleta todos os rows da API em memória (sem deadline por cliente)
    const allRows: any[] = [];
    let offset = 0, totalFetched = 0;
    for (let page = 0; page < 200; page++) {

      // Timeout de 15s por request individual para não travar numa página lenta
      const controller = new AbortController();
      const fetchTimeout = setTimeout(() => controller.abort(), 15_000);

      let resp: Response;
      try {
        resp = await fetch(analyticsUrl, {
          method: "POST", headers,
          body: JSON.stringify({ ...baseBody, limit: PAGE_LIMIT, offset }),
          signal: controller.signal,
        });
      } catch (e: any) {
        clearTimeout(fetchTimeout);
        console.error(`[cron] Fetch error client ${client_id} página ${page}:`, e?.message ?? e);
        break;
      } finally {
        clearTimeout(fetchTimeout);
      }
      if (!resp.ok) { console.error(`[cron] API ${resp.status} client ${client_id}`); break; }

      const json = await resp.json();
      const items: any[] = Array.isArray(json?.payload) ? json.payload : Array.isArray(json?.data) ? json.data : Array.isArray(json?.results) ? json.results : Array.isArray(json) ? json : [];
      if (items.length === 0) break;

      const rows = buildRows(items, client_id);
      allRows.push(...rows);
      await upsertVisitorAnalyticsRows(rows);

      totalFetched += items.length;
      const apiTotal = Number(json?.pagination?.total ?? json?.total ?? 0);
      console.log(`[cron] client=${client_id} p${page}: ${items.length} itens | offset=${offset} | total API=${apiTotal} | coletados=${totalFetched}`);

      // Avança offset pelo número real retornado (API pode retornar menos que PAGE_LIMIT na última página)
      offset += items.length;

      // Para quando chegou ao total declarado pela API
      if (apiTotal > 0 && offset >= apiTotal) break;
      // Se API não declara total: para quando retornou menos que o limite pedido (última página)
      if (apiTotal <= 0 && items.length < PAGE_LIMIT) break;

      await new Promise(r => setTimeout(r, 100));
    }

    // ── Rollups em memória a partir dos dados da API (sem re-query ao banco) ─
    if (allRows.length > 0) {
      // Salva rollup diário EXATO para cada dia sincronizado.
      const rowsByDay = splitRowsByUtcDay(allRows);
      for (const [dayKey, dayRows] of rowsByDay.entries()) {
        const dayStart = `${dayKey}T00:00:00.000Z`;
        const dayEnd = `${dayKey}T23:59:59.999Z`;
        const rrDay = buildRollup(dayRows, client_id, dayStart, dayEnd);
        const { data: existingDayRollup } = await supabase
          .from("visitor_analytics_rollups")
          .select("attributes_percent")
          .eq("client_id", client_id)
          .eq("start", dayStart)
          .eq("end", dayEnd)
          .maybeSingle();
        await supabase.from("visitor_analytics_rollups").upsert({
          ...rrDay,
          attributes_percent: mergeAttributesKeepingExpressionCache(existingDayRollup?.attributes_percent, rrDay.attributes_percent),
        }, { onConflict: "client_id,start,end" });
        console.log(`[cron] Rollup ${dayKey}: ${rrDay.total_visitors} visitantes`);
      }

      // 2. Rollup do período sincronizado
      const rrSync = buildRollup(allRows, client_id, syncStart, todayEnd);

      // 3. Atualiza rollup histórico (end=9999) mesclando os dias novos
      //    Usa dados da API diretamente — sem query extra ao Supabase
      const { data: historicRollup } = await supabase
        .from("visitor_analytics_rollups")
        .select("visitors_per_day, total_visitors, attributes_percent")
        .eq("client_id", client_id)
        .gt("end", "2099-01-01T00:00:00Z")
        .maybeSingle();

      if (historicRollup) {
        const existingPerDay = (historicRollup.visitors_per_day as Record<string,number>) || {};
        // Mescla: mantém histórico antigo e usa sempre o MAIOR valor por dia.
        // Isso evita que dados parciais de um sync incompleto sobrescrevam dados melhores de syncs anteriores.
        const mergedPerDay: Record<string,number> = { ...existingPerDay };
        for (const [date, count] of Object.entries(rrSync.visitors_per_day)) {
          mergedPerDay[date] = Math.max(mergedPerDay[date] ?? 0, count as number);
        }
        const mergedTotal  = Object.values(mergedPerDay).reduce((a, b) => (a as number) + (b as number), 0) as number;

        await supabase.from("visitor_analytics_rollups")
          .update({
            visitors_per_day:         mergedPerDay,
            total_visitors:           mergedTotal,
            visitors_per_hour_avg:    rrSync.visitors_per_hour_avg,
            age_pyramid_percent:      rrSync.age_pyramid_percent,
            gender_percent:           rrSync.gender_percent,
            attributes_percent:       mergeAttributesKeepingExpressionCache(historicRollup.attributes_percent, rrSync.attributes_percent),
            avg_visit_time_seconds:   rrSync.avg_visit_time_seconds,
            avg_contact_time_seconds: rrSync.avg_contact_time_seconds,
            updated_at:               new Date().toISOString(),
          })
          .eq("client_id", client_id)
          .gt("end", "2099-01-01T00:00:00Z");

        console.log(`[cron] Rollup histórico atualizado: ${mergedTotal} visitantes`);
      } else {
        // Nenhum rollup histórico ainda: cria com os dados disponíveis
        await supabase.from("visitor_analytics_rollups").upsert(
          { ...rrSync, start: collectionStart, end: HISTORIC_END, attributes_percent: mergeAttributesKeepingExpressionCache(undefined, rrSync.attributes_percent) },
          { onConflict: "client_id,start,end" }
        );
        console.log(`[cron] Rollup histórico criado: ${rrSync.total_visitors} visitantes`);
      }
    }

    await supabase.from("client_sync_state").upsert(
      { client_id, last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      { onConflict: "client_id" }
    );

    console.log(`[cron] ✅ Cliente ${client_id}: ${totalFetched} registros sincronizados`);
    return { synced: totalFetched };
  } catch (e: any) {
    console.error(`[cron] Erro inesperado cliente ${client_id}:`, e);
    return { synced: 0, error: e?.message };
  }
}

// ── Handler principal ─────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Vercel Cron usa GET; aceita POST para acionamento manual
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // Segurança básica: aceita Authorization header ou query param
  const authHeader = req.headers.authorization;
  const providedAuth = typeof authHeader === "string" && authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : (req.query?.auth as string);

  // Vercel Cron injeta automaticamente CRON_SECRET no header; aceita também nossa chave manual
  const validKeys = ["painel@2026*", process.env.CRON_SECRET].filter(Boolean);
  if (providedAuth && !validKeys.includes(providedAuth)) {
    return res.status(401).json({ error: "Não autorizado" });
  }

  const startTime = Date.now();
  console.log(`[cron] Iniciando sync em ${new Date().toISOString()}`);

  // Busca todos os clientes com API configurada e ativa
  const { data: configs, error: cfgErr } = await supabase
    .from("client_api_configs")
    .select("client_id, api_endpoint, analytics_endpoint, api_key, custom_header_key, custom_header_value, collection_start, collection_end");

  if (cfgErr) {
    console.error("[cron] Erro ao buscar client_api_configs:", cfgErr);
    return res.status(500).json({ error: "Erro ao buscar configurações", details: cfgErr });
  }

  if (!configs || configs.length === 0) {
    return res.status(200).json({ message: "Nenhum cliente com API configurada", synced_clients: 0 });
  }

  // Filtra clientes com api_key configurada
  const activeConfigs = configs.filter((c: any) => c.api_key?.trim() || (c.custom_header_key?.trim() && c.custom_header_value?.trim()));
  console.log(`[cron] ${activeConfigs.length} clientes ativos para sync`);

  // Suporte a backfill histórico: body pode conter syncStart/syncEnd e client_id específico
  const body = req.body ?? {};
  const overrideSyncStart: string | undefined = body.syncStart || undefined;
  const overrideSyncEnd:   string | undefined = body.syncEnd   || undefined;
  const onlyClientId:      string | undefined = body.client_id || undefined;

  const configsToRun = onlyClientId
    ? activeConfigs.filter((c: any) => c.client_id === onlyClientId)
    : activeConfigs;

  const syncStateByClient = new Map<string, string | null>();
  if (configsToRun.length > 0) {
    const { data: syncStates } = await supabase
      .from("client_sync_state")
      .select("client_id,last_synced_at")
      .in("client_id", configsToRun.map((c: any) => c.client_id));
    for (const row of (syncStates || [])) {
      syncStateByClient.set(String((row as any).client_id), (row as any).last_synced_at ?? null);
    }
  }

  const orderedConfigs = [...configsToRun].sort((a: any, b: any) => {
    const da = Date.parse(syncStateByClient.get(a.client_id) || "1970-01-01T00:00:00.000Z");
    const db = Date.parse(syncStateByClient.get(b.client_id) || "1970-01-01T00:00:00.000Z");
    return da - db;
  });

  const runConfigs = onlyClientId ? orderedConfigs : orderedConfigs.slice(0, 1);

  const results: any[] = [];
  for (const cfg of runConfigs) {
    // Segurança global: se já passaram 55s desde o início, pula clientes restantes
    if (Date.now() - startTime > 55_000) {
      console.warn("[cron] Limite de tempo global atingido, pulando clientes restantes");
      break;
    }
    const result = await syncClient(cfg.client_id, cfg, overrideSyncStart, overrideSyncEnd);
    results.push({ client_id: cfg.client_id, ...result });
  }

  const totalSynced = results.reduce((acc, r) => acc + (r.synced || 0), 0);
  console.log(`[cron] ✅ Concluído: ${totalSynced} registros em ${results.length} clientes (${Date.now() - startTime}ms)`);

  return res.status(200).json({
    message: "Sync concluído",
    timestamp: new Date().toISOString(),
    synced_clients: results.length,
    total_records: totalSynced,
    duration_ms: Date.now() - startTime,
    results,
  });
}
