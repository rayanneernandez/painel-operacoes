import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const _url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const _key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabase = createClient(_url, _key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type ClientApiConfig = {
  api_endpoint: string; analytics_endpoint: string; api_key: string;
  custom_header_key?: string | null; custom_header_value?: string | null;
  collection_start?: string | null; collection_end?: string | null;
  collect_tracks?: boolean; collect_face_quality?: boolean;
  collect_glasses?: boolean; collect_beard?: boolean;
  collect_hair_color?: boolean; collect_hair_type?: boolean;
  collect_headwear?: boolean;
};

function ok(res: VercelResponse, data: any) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json(data);
}
function bad(res: VercelResponse, status: number, data: any) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(data);
}
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
function startOfUtcDay(value: string | Date) {
  const d = value instanceof Date ? new Date(value) : new Date(value);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}
function endOfUtcDay(value: string | Date) {
  const d = value instanceof Date ? new Date(value) : new Date(value);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}
function addUtcDays(value: Date, days: number) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate() + days, value.getUTCHours(), value.getUTCMinutes(), value.getUTCSeconds(), value.getUTCMilliseconds()));
}
function monthStartMonthsAgoUtc(base: Date, monthsAgo: number) {
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - monthsAgo, 1, 0, 0, 0, 0));
}
function buildChunkedRanges(rangeStart: string, rangeEnd: string, chunkDays = 1) {
  const start = startOfUtcDay(rangeStart);
  const end = endOfUtcDay(rangeEnd);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end) return [];

  const ranges: Array<{ start: string; end: string }> = [];
  let cursor = start;
  while (cursor <= end) {
    const chunkEndCandidate = endOfUtcDay(addUtcDays(cursor, Math.max(1, chunkDays) - 1));
    const chunkEnd = chunkEndCandidate < end ? chunkEndCandidate : end;
    ranges.push({ start: cursor.toISOString(), end: chunkEnd.toISOString() });
    cursor = addUtcDays(startOfUtcDay(chunkEnd), 1);
  }
  return ranges;
}

function extractTimes(visit: any) {
  const startRaw = visit.start ?? visit.timestamp ?? visit.start_time ?? visit.begin ?? null;
  const endRaw   = visit.end   ?? visit.end_time   ?? visit.finish    ?? null;
  const startTs  = typeof startRaw === "string" ? startRaw : null;
  const endTs    = typeof endRaw   === "string" ? endRaw   : null;
  let durationFromStartEnd: number | null = null;
  if (startTs && endTs) {
    const s = Date.parse(startTs), e = Date.parse(endTs);
    if (Number.isFinite(s) && Number.isFinite(e) && e >= s)
      durationFromStartEnd = Math.round((e - s) / 1000);
  }
  return {
    startTs, endTs,
    visitTimeSeconds: safeNumber(visit.tracks_duration) ?? safeNumber(visit.visit_time_seconds) ?? safeNumber(visit.visit_time) ?? safeNumber(visit.duration_seconds) ?? safeNumber(visit.duration) ?? durationFromStartEnd ?? null,
    dwellTimeSeconds: safeNumber(visit.dwell_time_seconds) ?? safeNumber(visit.dwell_time) ?? safeNumber(visit.time_in_frame_seconds) ?? null,
    contactTimeSeconds: safeNumber(visit.content_view_duration) ?? safeNumber(visit.contact_time_seconds) ?? safeNumber(visit.contact_time) ?? null,
  };
}

function normalizeGender(visit: any): number {
  if (typeof visit.sex === "number") return visit.sex;
  if (typeof visit.sex === "string") {
    const s = visit.sex.toLowerCase();
    if (["male","m","1"].includes(s)) return 1;
    if (["female","f","2"].includes(s)) return 2;
  }
  if (visit.gender === "male") return 1;
  if (visit.gender === "female") return 2;
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
function toBool(val: any): boolean | null {
  if (typeof val === "boolean") return val;
  if (typeof val === "number") return val === 1 ? true : val === 0 ? false : null;
  if (typeof val === "string") {
    const s = val.trim().toLowerCase();
    if (["true","yes","y","1","on"].includes(s)) return true;
    if (["false","no","n","0","off"].includes(s)) return false;
  }
  return null;
}
function headwearToBool(val: any): boolean | null {
  const b = toBool(val); if (b !== null) return b;
  if (typeof val === "string") {
    const s = val.trim().toLowerCase();
    if (["no","none","false","0"].includes(s)) return false;
    if (s.length > 0) return true;
  }
  return null;
}

// Extrai array de visitantes de qualquer estrutura de resposta da DisplayForce.
// Suporta 3 formatos principais + variações:
//   1. { payload: [] }  — formato padrão DisplayForce
//   2. { data: [] } ou { data: { items:[], results:[] } }
//   3. { results: [] } | { items: [] } | { list: [] } | { response: [] }
//   4. Array direto
function extractVisitorArray(json: any): any[] {
  if (Array.isArray(json))                    return json;
  if (Array.isArray(json?.payload))           return json.payload;
  if (Array.isArray(json?.data))              return json.data;
  if (Array.isArray(json?.results))           return json.results;
  if (Array.isArray(json?.items))             return json.items;
  if (Array.isArray(json?.visitors))          return json.visitors;
  if (Array.isArray(json?.records))           return json.records;
  if (Array.isArray(json?.response))          return json.response;
  if (Array.isArray(json?.list))              return json.list;
  if (Array.isArray(json?.data?.items))       return json.data.items;
  if (Array.isArray(json?.data?.results))     return json.data.results;
  if (Array.isArray(json?.data?.visitors))    return json.data.visitors;
  if (Array.isArray(json?.data?.records))     return json.data.records;
  return [];
}

function buildAndDeduplicateRows(combined: any[], client_id: string) {
  const dedupMap = new Map<string, any>();
  for (const visit of combined) {
    let deviceId: number | null = null;
    if (Array.isArray(visit.devices) && visit.devices.length > 0) {
      const n = Number(visit.devices[0]); if (Number.isFinite(n)) deviceId = n;
    } else {
      for (const k of ["device","device_id","source_id","camera_id"]) {
        if (k in visit) { const n = Number(visit[k]); if (Number.isFinite(n)) { deviceId = n; break; } }
      }
    }
    const { startTs, endTs, visitTimeSeconds, dwellTimeSeconds, contactTimeSeconds } = extractTimes(visit);
    const visit_uid = sha256(JSON.stringify({ client_id, device_id: deviceId, visitor_id: visit.visitor_id ?? null, start: startTs ?? null }));
    dedupMap.set(visit_uid, {
      visit_uid, client_id, device_id: deviceId,
      timestamp: startTs, end_timestamp: endTs,
      age: typeof visit.age === "number" ? Math.round(visit.age) : null,
      gender: normalizeGender(visit),
      attributes: { face_quality: visit.face_quality ?? null, glasses: visit.glasses ?? null, facial_hair: visit.facial_hair ?? null, hair_color: visit.hair_color ?? null, hair_type: visit.hair_type ?? null, headwear: visit.headwear ?? null },
      visit_time_seconds: visitTimeSeconds, dwell_time_seconds: dwellTimeSeconds, contact_time_seconds: contactTimeSeconds,
      raw_data: visit,
    });
  }
  return Array.from(dedupMap.values());
}

async function fetchAllDBRows(client_id: string, rangeStart: string, rangeEnd: string, deviceNums: number[]): Promise<any[]> {
  const PAGE = 1000;
  let knownTotal: number | null = null;
  try {
    let countQ = supabase.from("visitor_analytics").select("*", { count: "exact", head: true }).eq("client_id", client_id).gte("timestamp", rangeStart).lte("timestamp", rangeEnd);
    if (deviceNums.length > 0) countQ = countQ.in("device_id", deviceNums);
    const { count, error: countErr } = await countQ;
    if (!countErr && typeof count === "number") knownTotal = count;
  } catch (e) { console.warn("[fetchAllDBRows] HEAD count falhou:", e); }
  const all: any[] = [];
  let from = 0;
  while (true) {
    let q = supabase.from("visitor_analytics").select("visit_uid,timestamp,end_timestamp,age,gender,attributes,device_id,visit_time_seconds,dwell_time_seconds,contact_time_seconds").eq("client_id", client_id).gte("timestamp", rangeStart).lte("timestamp", rangeEnd).order("timestamp", { ascending: true }).range(from, from + PAGE - 1);
    if (deviceNums.length > 0) q = q.in("device_id", deviceNums);
    const { data, error } = await q;
    if (error) { console.error(`[fetchAllDBRows] Erro offset=${from}:`, error); break; }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (knownTotal !== null && all.length >= knownTotal) break;
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

function buildRollup(rows: any[], client_id: string, rangeStart: string, rangeEnd: string) {
  const startMs = Date.parse(rangeStart), endMs = Date.parse(rangeEnd);
  const daysInRange = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs ? Math.max(1, Math.ceil((endMs - startMs + 1) / 86400000)) : 1;
  const perDayCount: Record<string, number> = {};
  const perHourTotal: Record<string, number> = {};
  for (let h = 0; h < 24; h++) perHourTotal[String(h)] = 0;
  const ageCounts: Record<string, number> = { "0-9":0,"10-17":0,"18-24":0,"25-34":0,"35-44":0,"45-54":0,"55-64":0,"65-74":0,"75+":0,unknown:0 };
  const genderCounts: Record<string, number> = { male:0, female:0, unknown:0 };
  const glassesCount: Record<string, number> = {};
  const facialHairCount: Record<string, number> = {};
  const headwearCount: Record<string, number> = {};
  const hairColorCount: Record<string, number> = {};
  const hairTypeCount: Record<string, number> = {};
  let glassesKnown=0, facialHairKnown=0, headwearKnown=0, hairColorKnown=0, hairTypeKnown=0;
  let sumVisit=0, cntVisit=0, sumDwell=0, cntDwell=0, sumContact=0, cntContact=0;

  for (const row of rows) {
    if (row.timestamp) {
      const d = new Date(row.timestamp);
      if (!isNaN(d.getTime())) {
        const dk = asISODateUTC(d);
        perDayCount[dk] = (perDayCount[dk] ?? 0) + 1;
        perHourTotal[String(d.getUTCHours())] = (perHourTotal[String(d.getUTCHours())] ?? 0) + 1;
      }
    }
    if (typeof row.age === "number" && Number.isFinite(row.age)) { const b = bucketAge(Math.round(row.age)); ageCounts[b] = (ageCounts[b] ?? 0) + 1; } else { ageCounts.unknown += 1; }
    if (row.gender === 1) genderCounts.male++; else if (row.gender === 2) genderCounts.female++; else genderCounts.unknown++;
    const a = row.attributes || {};
    const gVal = a.glasses;
    if (gVal !== null && gVal !== undefined) { const gKey = String(gVal).trim().toLowerCase(); const gNorm = ["true","yes","1","on"].includes(gKey) ? "usual" : ["false","no","0","off"].includes(gKey) ? "none" : gKey || null; if (gNorm) { glassesCount[gNorm] = (glassesCount[gNorm] ?? 0) + 1; glassesKnown++; } }
    const fVal = a.facial_hair;
    if (fVal !== null && fVal !== undefined) { const fKey = String(fVal).trim().toLowerCase(); const fNorm = fKey === "true" ? "beard" : fKey === "false" ? "shaved" : fKey || null; if (fNorm) { facialHairCount[fNorm] = (facialHairCount[fNorm] ?? 0) + 1; facialHairKnown++; } }
    const hwb = headwearToBool(a.headwear);
    if (hwb !== null) { headwearCount[String(hwb)] = (headwearCount[String(hwb)] ?? 0) + 1; headwearKnown++; }
    if (typeof a.hair_color === "string" && a.hair_color.trim()) { const hck = a.hair_color.trim().toLowerCase(); hairColorCount[hck] = (hairColorCount[hck] ?? 0) + 1; hairColorKnown++; }
    if (typeof a.hair_type === "string" && a.hair_type.trim()) { const htk = a.hair_type.trim().toLowerCase(); hairTypeCount[htk] = (hairTypeCount[htk] ?? 0) + 1; hairTypeKnown++; }
    if (typeof row.visit_time_seconds === "number" && Number.isFinite(row.visit_time_seconds)) { sumVisit += row.visit_time_seconds; cntVisit++; } else if (row.timestamp && row.end_timestamp) { const s = Date.parse(row.timestamp), e = Date.parse(row.end_timestamp); if (Number.isFinite(s) && Number.isFinite(e) && e >= s) { sumVisit += Math.round((e-s)/1000); cntVisit++; } }
    if (typeof row.dwell_time_seconds === "number" && Number.isFinite(row.dwell_time_seconds)) { sumDwell += row.dwell_time_seconds; cntDwell++; }
    if (typeof row.contact_time_seconds === "number" && Number.isFinite(row.contact_time_seconds) && row.contact_time_seconds > 0) { sumContact += row.contact_time_seconds; cntContact++; }
  }

  const totalVisitors = rows.length;
  const perHourAvg: Record<string,number> = {};
  for (let h = 0; h < 24; h++) perHourAvg[String(h)] = Number(((perHourTotal[String(h)] ?? 0) / daysInRange).toFixed(2));
  const n = Math.max(rows.length, 1);

  return {
    client_id, start: rangeStart, end: rangeEnd,
    total_visitors: totalVisitors,
    avg_visitors_per_day: Number((totalVisitors / daysInRange).toFixed(2)),
    visitors_per_day: perDayCount,
    visitors_per_hour_avg: perHourAvg,
    age_pyramid_percent: percentMap(ageCounts, n),
    gender_percent: percentMap(genderCounts, n),
    attributes_percent: {
      glasses:     glassesKnown    > 0 ? percentMap(glassesCount,    glassesKnown)    : {},
      facial_hair: facialHairKnown > 0 ? percentMap(facialHairCount, facialHairKnown) : {},
      headwear:    headwearKnown   > 0 ? percentMap(headwearCount,   headwearKnown)   : {},
      hair_color:  hairColorKnown  > 0 ? percentMap(hairColorCount,  hairColorKnown)  : {},
      hair_type:   hairTypeKnown   > 0 ? percentMap(hairTypeCount,   hairTypeKnown)   : {},
    },
    avg_visit_time_seconds:   cntVisit   > 0 ? Number((sumVisit   / cntVisit).toFixed(2))   : null,
    avg_dwell_time_seconds:   cntDwell   > 0 ? Number((sumDwell   / cntDwell).toFixed(2))   : null,
    avg_contact_time_seconds: cntContact > 0 ? Number((sumContact / cntContact).toFixed(2)) : null,
    updated_at: new Date().toISOString(),
  };
}

// Salva rollup no banco
async function saveRollup(rr: ReturnType<typeof buildRollup>) {
  const { error } = await supabase.from("visitor_analytics_rollups").upsert(rr, { onConflict: "client_id,start,end" });
  if (error) console.error("[saveRollup] Erro:", error);
  return !error;
}

const _serverRebuilding = new Set<string>();
const _activeSyncs      = new Set<string>();

async function markSyncDone(client_id: string) {
  await supabase.from("client_sync_state").upsert(
    { client_id, last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { onConflict: "client_id" }
  );
}

async function needsSync(client_id: string, forceSync = false): Promise<boolean> {
  if (forceSync) return true;
  const { data } = await supabase.from("client_sync_state").select("last_synced_at").eq("client_id", client_id).single();
  if (!data?.last_synced_at) return true;
  return Date.now() - Date.parse(data.last_synced_at) > 10 * 60 * 1000;
}

async function runSingleWindowSync(client_id: string, cfg: ClientApiConfig, syncStart: string, syncEnd: string, devices: any[]) {
  const analyticsUrl = `${(cfg.api_endpoint || "https://api.displayforce.ai").replace(/\/$/, "")}${cfg.analytics_endpoint?.startsWith("/") ? cfg.analytics_endpoint : `/${cfg.analytics_endpoint || "public/v1/stats/visitor/list"}`}`;
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  const ck = cfg.custom_header_key?.trim(); const cv = cfg.custom_header_value?.trim();
  if (ck && cv) headers[ck] = cv;
  else if (cfg.api_key?.trim()) headers["X-API-Token"] = cfg.api_key.trim();
  else { console.error("[BgSync] api_key não configurada"); return { totalFetched: 0 }; }

  const baseBody: any = {
    start: syncStart, end: syncEnd,
    tracks: cfg.collect_tracks ?? true, face_quality: cfg.collect_face_quality ?? true,
    glasses: cfg.collect_glasses ?? true, facial_hair: cfg.collect_beard ?? true,
    hair_color: cfg.collect_hair_color ?? true, hair_type: cfg.collect_hair_type ?? true,
    headwear: cfg.collect_headwear ?? true,
    additional_attributes: ["smile","pitch","yaw","x","y","height"],
  };
  if (devices.length > 0) baseBody.devices = devices;

  let offset = 0, pageCount = 0, totalFetched = 0;
  let apiReportedGlobalTotal: number | null = null;
  let lastPageFirstItem: string | null = null;

  while (pageCount < 200) {
    pageCount++;
    let resp: Response;
    try {
      resp = await fetch(analyticsUrl, { method: "POST", headers, body: JSON.stringify({ ...baseBody, limit: 1000, offset }) });
    } catch (e) {
      console.error("[BgSync] Fetch error:", e);
      break;
    }
    if (!resp.ok) { console.error(`[BgSync] API ${resp.status}`); break; }

    const json = await resp.json();
    const page: any[] = extractVisitorArray(json);

    // Só confia no total global se for maior que 1 página (evita confundir total_page com total_global)
    if (apiReportedGlobalTotal === null) {
      const t = json?.pagination?.total ?? json?.pagination?.count ?? json?.total ?? json?.count ?? json?.meta?.total;
      const n = Number(t);
      if (Number.isFinite(n) && n > 1000) {
        apiReportedGlobalTotal = n;
        console.log(`[BgSync] Total global API (${syncStart.slice(0, 10)}): ${apiReportedGlobalTotal}`);
      }
    }

    if (page.length === 0) break;

    // Detecta loop infinito: se a API ignorar o offset e sempre retornar a mesma primeira linha
    const firstItemSig = JSON.stringify(page[0]).slice(0, 120);
    if (firstItemSig === lastPageFirstItem) {
      console.warn("[BgSync] API retornou mesma página (offset ignorado), encerrando.");
      break;
    }
    lastPageFirstItem = firstItemSig;

    totalFetched += page.length;
    const rows = buildAndDeduplicateRows(page, client_id);
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from("visitor_analytics").upsert(rows.slice(i, i + 500), { onConflict: "visit_uid", ignoreDuplicates: true });
      if (error) console.error("[BgSync] Upsert erro:", error);
    }
    console.log(`[BgSync] Janela ${syncStart.slice(0, 10)} → ${syncEnd.slice(0, 10)} | p${pageCount} offset=${offset}: +${page.length} (total: ${totalFetched})`);

    // Para somente quando a página está incompleta OU quando temos certeza do total global
    const reachedGlobalTotal = apiReportedGlobalTotal !== null && offset + page.length >= apiReportedGlobalTotal;
    if (reachedGlobalTotal || page.length < 1000) break;
    offset += page.length;
    await new Promise(r => setTimeout(r, 150));
  }

  return { totalFetched };
}

async function rebuildBackgroundRollups(client_id: string, cfg: ClientApiConfig, syncStart: string, syncEnd: string, devices: any[]) {
  const HISTORIC_END = "9999-12-31T23:59:59.999Z";
  const now = new Date();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  const todayEnd   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
  const deviceNums = devices.map(Number).filter(Number.isFinite);

  if (deviceNums.length > 0) {
    const rows = await fetchAllDBRows(client_id, syncStart, syncEnd, deviceNums);
    if (rows.length > 0) await saveRollup(buildRollup(rows, client_id, syncStart, syncEnd));
    return;
  }

  // Gera rollup para cada dia do período sincronizado individualmente.
  // Isso garante que o dashboard encontre dados ao filtrar qualquer data específica.
  const cursor = startOfUtcDay(syncStart);
  const endDay = endOfUtcDay(syncEnd);
  let d = new Date(cursor.getTime());
  while (d <= endDay) {
    const dayStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
    const dayEnd   = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
    const { data: rpcDay, error: rpcDayErr } = await supabase.rpc("build_visitor_rollup", {
      p_client_id: client_id, p_start: dayStart.toISOString(), p_end: dayEnd.toISOString(),
    });
    if (!rpcDayErr && rpcDay && Number((rpcDay as any).total_visitors) > 0) {
      await supabase.from("visitor_analytics_rollups").upsert(
        { client_id, start: dayStart.toISOString(), end: dayEnd.toISOString(), ...(rpcDay as any), updated_at: new Date().toISOString() },
        { onConflict: "client_id,start,end" }
      );
      console.log(`[BgSync] Rollup ${asISODateUTC(dayStart)} salvo: ${(rpcDay as any).total_visitors} visitantes`);
    }
    d = addUtcDays(d, 1);
  }

  // Também atualiza rollup histórico global (end=9999) para consultas de período amplo
  const historicStart = cfg.collection_start || syncStart;
  const { data: rpcHist, error: rpcHistErr } = await supabase.rpc("build_visitor_rollup", {
    p_client_id: client_id, p_start: historicStart, p_end: syncEnd,
  });
  if (!rpcHistErr && rpcHist && Number((rpcHist as any).total_visitors) > 0) {
    await supabase.from("visitor_analytics_rollups").upsert(
      { client_id, start: historicStart, end: HISTORIC_END, ...(rpcHist as any), updated_at: new Date().toISOString() },
      { onConflict: "client_id,start,end" }
    );
    console.log(`[BgSync] Rollup histórico salvo: ${(rpcHist as any).total_visitors} visitantes`);
  }
}

// ── Background sync: usa janelas menores para completar melhor dias densos ──────
async function runBackgroundSync(client_id: string, cfg: ClientApiConfig, syncStart: string, syncEnd: string, devices: any[]) {
  const syncKey = `${client_id}:${syncStart}:${syncEnd}`;
  if (_activeSyncs.has(syncKey)) { console.log(`[BgSync] Já em andamento, pulando.`); return; }
  _activeSyncs.add(syncKey);
  console.log(`[BgSync] Iniciando: ${syncStart} → ${syncEnd}`);

  try {
    const daySpan = Math.max(1, Math.ceil((endOfUtcDay(syncEnd).getTime() - startOfUtcDay(syncStart).getTime() + 1) / 86400000));
    const chunkDays = devices.length > 0 ? Math.min(daySpan, 2) : 1;
    // Inverte as janelas para processar os dias MAIS RECENTES primeiro.
    // Sem limite: o Vercel tem 60s e cada janela leva ~3-5s, então até 12 dias cabe.
    const windows = buildChunkedRanges(syncStart, syncEnd, chunkDays).reverse();

    let totalFetched = 0;
    for (const windowRange of windows) {
      const result = await runSingleWindowSync(client_id, cfg, windowRange.start, windowRange.end, devices);
      totalFetched += result.totalFetched;
      await new Promise(r => setTimeout(r, 250));
    }

    console.log(`[BgSync] ✅ Concluído: ${totalFetched} registros`);
    await rebuildBackgroundRollups(client_id, cfg, syncStart, syncEnd, devices);

    await markSyncDone(client_id);
  } catch (e) {
    console.error("[BgSync] Erro inesperado:", e);
  } finally {
    _activeSyncs.delete(syncKey);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") return bad(res, 405, { error: "Method Not Allowed" });

    const { client_id, start, end, devices, auth, offset: incomingOffset, force_full_sync, rebuild_rollup, sync_stores, check_sync_needed, background_sync } = (req.body as any) ?? {};

    const authHeader = req.headers.authorization;
    const providedAuth = typeof authHeader === "string" && authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : auth;
    if (providedAuth && providedAuth !== "painel@2026*") return bad(res, 401, { error: "Não autorizado" });
    if (!client_id) return bad(res, 400, { error: "client_id é obrigatório" });

    const { data: apiCfg, error: apiCfgErr } = await supabase.from("client_api_configs")
      .select("api_endpoint,analytics_endpoint,api_key,custom_header_key,custom_header_value,collection_start,collection_end,collect_tracks,collect_face_quality,collect_glasses,collect_beard,collect_hair_color,collect_hair_type,collect_headwear")
      .eq("client_id", client_id).single();
    if (apiCfgErr || !apiCfg) return bad(res, 400, { error: "Config da API não encontrada", details: apiCfgErr });
    const cfg = apiCfg as ClientApiConfig;

    // ── check_sync_needed ────────────────────────────────────────────────────
    if (check_sync_needed === true) {
      const needed = await needsSync(client_id, false);
      const { data: state } = await supabase.from("client_sync_state").select("last_synced_at").eq("client_id", client_id).single();
      return ok(res, { needs_sync: needed, last_synced_at: state?.last_synced_at ?? null });
    }

    // ── background_sync ──────────────────────────────────────────────────────
    if (background_sync === true) {
      const forceSync = force_full_sync === true;
      const needed = await needsSync(client_id, forceSync);
      if (!needed) return ok(res, { message: "Sync não necessário", needs_sync: false, started: false });

      const now = new Date();
      const defaultStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 2, 0, 0, 0, 0)).toISOString();
      const recoveryStart = monthStartMonthsAgoUtc(now, 2).toISOString();
      const collectionStart = String(cfg.collection_start || "2025-01-01T00:00:00.000Z");
      const forceStart = Date.parse(collectionStart) > Date.parse(recoveryStart) ? collectionStart : recoveryStart;
      const syncStart = String(start || (forceSync ? forceStart : (Date.parse(collectionStart) > Date.parse(defaultStart) ? collectionStart : defaultStart)));
      const syncEnd   = String(end   || cfg.collection_end   || now.toISOString());
      const deviceList = Array.isArray(devices) ? devices : [];

      runBackgroundSync(client_id, cfg, syncStart, syncEnd, deviceList).catch(e => console.error("[BgSync] Erro:", e));

      return ok(res, { message: "Sync iniciado em background", needs_sync: true, started: true, range: { start: syncStart, end: syncEnd } });
    }

    // ── sync_stores ──────────────────────────────────────────────────────────
    if (sync_stores === true) {
      const base = (cfg.api_endpoint || "https://api.displayforce.ai").replace(/\/$/, "");
      const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
      const ck = cfg.custom_header_key?.trim(); const cv = cfg.custom_header_value?.trim();
      if (ck && cv) headers[ck] = cv; else if (cfg.api_key?.trim()) headers["X-API-Token"] = cfg.api_key.trim();

      // Usa extractVisitorArray definida globalmente para extrair array de qualquer formato

      // Busca paginada de uma URL (usePost=true força POST para que params sejam enviados no body)
      const fetchAllPages = async (url: string, bodyBase: any, usePost = false): Promise<any[]> => {
        const all: any[] = [];
        let offset = 0; const limit = 500;
        while (true) {
          const body = { ...bodyBase, limit, offset };
          let r: Response;
          if (usePost) {
            r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
          } else {
            r = await fetch(`${url}?recursive=true&limit=${limit}&offset=${offset}`, { method: "GET", headers });
            if (!r.ok) r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
          }
          if (!r.ok) { console.warn(`[sync_stores] ${url} retornou ${r.status}`); break; }
          const json = await r.json();
          const page = extractVisitorArray(json);
          if (page.length === 0) break;
          all.push(...page);
          const total = Number(json?.pagination?.total ?? json?.total ?? json?.count ?? 0);
          if (page.length < limit || (total > 0 && all.length >= total)) break;
          offset += limit;
          if (offset > 10000) break; // segurança
        }
        return all;
      };

      // Tenta device-folder/list (nome correto da API), com fallback para folder/list
      let folders = await fetchAllPages(`${base}/public/v1/device-folder/list`,
        { id:[], name:[], parent_ids:[], recursive:true });
      if (folders.length === 0) {
        folders = await fetchAllPages(`${base}/public/v1/folder/list`,
          { id:[], name:[], parent_ids:[], recursive:true });
      }
      console.log(`[sync_stores] Lojas encontradas: ${folders.length}`);

      // Busca dispositivos com os campos corretos conforme a API Displayforce
      const devicesData = await fetchAllPages(`${base}/public/v1/device/list`,
        { id:[], name:[], parent_ids:[], recursive:true }, true);
      console.log(`[sync_stores] Dispositivos encontrados: ${devicesData.length}`);
      // Log do primeiro dispositivo para diagnóstico de campos disponíveis
      if (devicesData.length > 0) {
        console.log(`[sync_stores] Exemplo de dispositivo (raw):`, JSON.stringify(devicesData[0]));
        console.log(`[sync_stores] Chaves disponíveis:`, Object.keys(devicesData[0]));
        const connRaw0 = devicesData[0]?.connection_state ?? devicesData[0]?.online ?? devicesData[0]?.is_online ?? devicesData[0]?.connected ?? devicesData[0]?.status ?? devicesData[0]?.state;
        console.log(`[sync_stores] connection_state raw=`, JSON.stringify(connRaw0), `type=`, typeof connRaw0);
      }

      if (folders.length === 0) return ok(res, { message:"Nenhuma loja encontrada na API DisplayForce", stores_upserted:0, devices_upserted:0 });

      const { data: dbStores } = await supabase.from("stores").select("id,name,city").eq("client_id", client_id);
      const nameToStore = new Map<string, { id:string; city?:string|null }>();
      (dbStores || []).forEach((s:any) => { const n=String(s?.name||"").trim().toLowerCase(); if(!n||!s?.id)return; nameToStore.set(n,{id:String(s.id),city:s.city}); });

      // Helper: extrai string segura de campo que pode ser objeto ou string
      const toSafeStr = (v: any): string => {
        if (typeof v === 'string') return v.trim();
        if (v && typeof v === 'object') {
          const inner = v?.city ?? v?.name ?? v?.address ?? v?.label ?? '';
          return typeof inner === 'string' ? inner.trim() : '';
        }
        return '';
      };

      // Mapa de cidade por pasta (extraída do endereço dos dispositivos nessa pasta)
      const cityByFolder = new Map<string, string>();
      devicesData.forEach((d: any) => {
        const pid = String(d?.parent_id ?? '').trim();
        if (!pid || cityByFolder.has(pid)) return;
        const addr = toSafeStr(d?.address) || toSafeStr(d?.location) || toSafeStr(d?.city);
        if (addr) cityByFolder.set(pid, addr);
      });

      const folderToStoreId = new Map<string,string>();
      const storesPayload: any[] = [];
      for (const f of folders) {
        const folderId = String(f?.id??"").trim(); const name = String(f?.name||"").trim();
        if (!folderId||!name) continue;
        const existing = nameToStore.get(name.toLowerCase());
        const storeId = existing?.id || crypto.randomUUID();
        folderToStoreId.set(folderId, storeId);
        // Usa cidade da pasta (da API), ou da loja existente no banco, ou endereço extraído do dispositivo
        const folderCity = toSafeStr(f?.address) || toSafeStr(f?.city) || toSafeStr(f?.location);
        const city = folderCity || existing?.city || cityByFolder.get(folderId) || null;
        storesPayload.push({ id:storeId, client_id, name, city });
      }
      if (storesPayload.length > 0) await supabase.from("stores").upsert(storesPayload);

      // Remove do banco as lojas deste cliente que não existem mais na API
      // (ex: loja renomeada, encerrada ou removida do DisplayForce)
      const storeIds = storesPayload.map(s => s.id).filter(Boolean);
      if (storeIds.length > 0) {
        const { data: allDbStores } = await supabase.from("stores").select("id").eq("client_id", client_id);
        const orphanIds = (allDbStores || []).map((s: any) => String(s.id)).filter(dbId => !storeIds.includes(dbId));
        if (orphanIds.length > 0) {
          console.log(`[sync_stores] Removendo ${orphanIds.length} loja(s) obsoleta(s) do banco:`, orphanIds);
          // Primeiro remove os dispositivos das lojas obsoletas
          await supabase.from("devices").delete().in("store_id", orphanIds);
          // Depois remove as lojas obsoletas
          await supabase.from("stores").delete().in("id", orphanIds);
        }
      }

      const { data: dbDevs } = storeIds.length ? await supabase.from("devices").select("id,mac_address,store_id").in("store_id", storeIds) : { data: [] as any[] };
      const devIdByStoreMac = new Map<string,string>();
      (dbDevs||[]).forEach((d:any) => { const sid=String(d?.store_id||""); const mac=String(d?.mac_address||"").trim(); const did=String(d?.id||""); if(!sid||!mac||!did)return; devIdByStoreMac.set(`${sid}:${mac}`,did); });

      const devicesByFolder = new Map<string,any[]>();
      devicesData.forEach((d:any) => { const pid=d?.parent_id; if(pid==null)return; const k=String(pid); const arr=devicesByFolder.get(k)||[]; arr.push(d); devicesByFolder.set(k,arr); });

      const devicesPayload: any[] = [];
      folderToStoreId.forEach((storeId, folderId) => {
        const list = devicesByFolder.get(folderId)||[];
        list.forEach((d:any) => {
          const mac=String(d?.id??"").trim(); if(!mac)return;
          const existingId=devIdByStoreMac.get(`${storeId}:${mac}`);
          const extId=Number(mac);
          // Campos possíveis para status de conexão na API Displayforce
          const connRaw = d?.connection_state ?? d?.player_status ?? d?.online ?? d?.is_online
            ?? d?.connected ?? d?.status ?? d?.state ?? d?.active
            ?? d?.player_state ?? d?.playback_state ?? d?.activation_state;
          const connStr = String(connRaw ?? '').toLowerCase().trim();
          // connection_state da Displayforce: true/false, 0/1, "online"/"offline", "connected", etc.
          // activation_state indica se está ativado (não necessariamente online)
          const isOnline = connRaw === true || connRaw === 1 ||
            ['online','connected','active','reprodução','reproduction','playing',
             'running','true','1','yes','on','reproduzindo','ativo','activated',
             'normal','ready','idle'].includes(connStr);
          const devStatus = isOnline ? 'online' : 'offline';
          devicesPayload.push({ id:existingId||crypto.randomUUID(), store_id:storeId, name:String(d?.name||mac), type:"camera", mac_address:mac, external_id:Number.isFinite(extId)?extId:null, status:devStatus });
        });
      });
      if (devicesPayload.length > 0) await supabase.from("devices").upsert(devicesPayload);

      // Remove dispositivos de stores não sincronizadas (segurança adicional)
      // Nota: PostgREST NOT IN não usa aspas simples nos valores — usar join sem aspas
      if (storeIds.length > 0) {
        const allSyncedMacs = devicesPayload.map(d => d.mac_address).filter(Boolean);
        if (allSyncedMacs.length > 0) {
          await supabase.from("devices")
            .delete()
            .in("store_id", storeIds)
            .not("mac_address", "in", `(${allSyncedMacs.join(",")})`);
        }
      }

      const storesRemoved = storeIds.length > 0
        ? ((await supabase.from("stores").select("id", { count: "exact", head: true }).eq("client_id", client_id)).count ?? 0)
        : 0;

      // Diagnóstico: verifica correspondência entre folder_id e device parent_id
      const diagDevice = devicesData[0];
      const diagKeys = diagDevice ? Object.keys(diagDevice) : [];
      const diagParentId = diagDevice?.parent_id ?? diagDevice?.folder_id ?? diagDevice?.group_id ?? 'N/A';
      const diagFolderIds = folders.slice(0, 3).map((f: any) => ({ id: f?.id, name: f?.name }));
      const sampleFolderKeys = [...folderToStoreId.entries()].slice(0, 3).map(([fid, sid]) => ({ folderId: fid, storeId: sid, devicesFound: devicesByFolder.get(fid)?.length ?? 0 }));
      const sampleDevParentIds = devicesData.slice(0, 3).map((d: any) => ({ parent_id: d?.parent_id, name: d?.name }));
      const samplePayload = devicesPayload.slice(0, 3).map(d => ({ store_id: d.store_id, mac: d.mac_address, status: d.status }));
      // Verifica no banco quantos dispositivos existem agora para esses store IDs
      const { count: devCountAfter } = await supabase.from("devices").select("id", { count: "exact", head: true }).in("store_id", storeIds);
      return ok(res, { message:"Lojas sincronizadas", stores_upserted:storesPayload.length, devices_upserted:devicesPayload.length, stores_total: storeIds.length, devices_total_api: devicesData.length, devices_in_db_after: devCountAfter, diag: { device_keys: diagKeys, device_parent_id_sample: diagParentId, folder_id_sample: diagFolderIds, folder_device_match: sampleFolderKeys, device_parent_ids: sampleDevParentIds, payload_sample: samplePayload } });
    }

    const now        = new Date();
    const rangeStart = String(start || cfg.collection_start || "2025-01-01T00:00:00.000Z");
    const rangeEnd   = String(end   || cfg.collection_end   || now.toISOString());
    const baseBody: any = {
      start: rangeStart, end: rangeEnd,
      tracks: cfg.collect_tracks ?? true, face_quality: cfg.collect_face_quality ?? true,
      glasses: cfg.collect_glasses ?? true, facial_hair: cfg.collect_beard ?? true,
      hair_color: cfg.collect_hair_color ?? true, hair_type: cfg.collect_hair_type ?? true,
      headwear: cfg.collect_headwear ?? true,
      additional_attributes: ["smile","pitch","yaw","x","y","height"],
    };
    if (Array.isArray(devices) && devices.length > 0) baseBody.devices = devices;

    const limit  = 1000;
    let   offset = Number.isFinite(Number(incomingOffset)) ? Number(incomingOffset) : 0;
    const combined: any[] = [];
    const startedAt = Date.now();
    const MAX_MS    = force_full_sync ? 20000 : 6000;
    const MAX_PAGES = force_full_sync ? 500   : 50;
    const deviceNums = Array.isArray(devices) ? (devices as any[]).map(Number).filter(Number.isFinite) : [];

    const analyticsUrl = `${(cfg.api_endpoint||"https://api.displayforce.ai").replace(/\/$/,"")}${cfg.analytics_endpoint?.startsWith("/")?cfg.analytics_endpoint:`/${cfg.analytics_endpoint||"public/v1/stats/visitor/list"}`}`;
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
    const ck = cfg.custom_header_key?.trim(); const cv = cfg.custom_header_value?.trim();
    if (ck && cv) headers[ck] = cv; else if (cfg.api_key?.trim()) headers["X-API-Token"] = cfg.api_key.trim();
    else return bad(res, 400, { error: "api_key não configurada" });

    // ── rebuild_rollup ────────────────────────────────────────────────────────
    if (rebuild_rollup === true) {
      if (deviceNums.length > 0) {
        const rows = await fetchAllDBRows(client_id, rangeStart, rangeEnd, deviceNums);
        if (rows.length === 0) return ok(res, { message:"Sem dados no banco", start:rangeStart, end:rangeEnd, externalFetched:0, raw_upserted_new:0, total_in_db:0, next_offset:null, done:true, dashboard:null, stored_rollup:false });
        const rr = buildRollup(rows, client_id, rangeStart, rangeEnd);
        return ok(res, { message:"Rollup recalculado (dispositivo)", start:rangeStart, end:rangeEnd, externalFetched:0, raw_upserted_new:0, total_in_db:rr.total_visitors, next_offset:null, done:true, dashboard: { total_visitors:rr.total_visitors, avg_visitors_per_day:rr.avg_visitors_per_day, visitors_per_day:rr.visitors_per_day, visitors_per_hour_avg:rr.visitors_per_hour_avg, gender_percent:rr.gender_percent, attributes_percent:rr.attributes_percent, age_pyramid_percent:rr.age_pyramid_percent, avg_times_seconds: { avg_visit_time_seconds:rr.avg_visit_time_seconds, avg_dwell_time_seconds:rr.avg_dwell_time_seconds, avg_attention_seconds:rr.avg_contact_time_seconds } }, stored_rollup:false });
      }

      const lockKey = `${client_id}:${rangeStart}:${rangeEnd}`;
      if (_serverRebuilding.has(lockKey)) {
        const { data: existing } = await supabase.from("visitor_analytics_rollups").select("*").eq("client_id", client_id).eq("start", rangeStart).eq("end", rangeEnd).order("updated_at", { ascending: false }).limit(1);
        if (existing?.[0]) {
          const r = existing[0];
          return ok(res, { message:"Rebuild em andamento — rollup existente", start:rangeStart, end:rangeEnd, externalFetched:0, raw_upserted_new:0, total_in_db:r.total_visitors, next_offset:null, done:true, dashboard: { total_visitors:r.total_visitors, avg_visitors_per_day:r.avg_visitors_per_day, visitors_per_day:r.visitors_per_day, visitors_per_hour_avg:r.visitors_per_hour_avg, gender_percent:r.gender_percent, attributes_percent:r.attributes_percent, age_pyramid_percent:r.age_pyramid_percent, avg_times_seconds: { avg_visit_time_seconds:r.avg_visit_time_seconds, avg_dwell_time_seconds:null, avg_attention_seconds:r.avg_contact_time_seconds??null } }, stored_rollup:true });
        }
        return ok(res, { message:"Rebuild em andamento", done:false, next_offset:null });
      }

      _serverRebuilding.add(lockKey);
      try {
        const { data: rpcData, error: rpcErr } = await supabase.rpc("build_visitor_rollup", { p_client_id: client_id, p_start: rangeStart, p_end: rangeEnd });
        if (rpcErr) { console.error("[rebuild_rollup] RPC error:", rpcErr); return bad(res, 500, { error:"Erro ao calcular rollup via SQL", details:rpcErr }); }
        const stats = rpcData as any;
        const totalVisitors = Number(stats?.total_visitors ?? 0);
        if (totalVisitors === 0) return ok(res, { message:"Sem dados no banco", start:rangeStart, end:rangeEnd, externalFetched:0, raw_upserted_new:0, total_in_db:0, next_offset:null, done:true, dashboard:null, stored_rollup:false });
        const rollupRow = { client_id, start:rangeStart, end:rangeEnd, total_visitors:totalVisitors, avg_visitors_per_day:stats.avg_visitors_per_day??0, visitors_per_day:stats.visitors_per_day??{}, visitors_per_hour_avg:stats.visitors_per_hour_avg??{}, age_pyramid_percent:stats.age_pyramid_percent??{}, gender_percent:stats.gender_percent??{}, attributes_percent:stats.attributes_percent??{}, avg_visit_time_seconds:stats.avg_visit_time_seconds??null, avg_dwell_time_seconds:null, avg_contact_time_seconds:stats.avg_contact_time_seconds??null, updated_at:new Date().toISOString() };
        const { error: saveErr } = await supabase.from("visitor_analytics_rollups").upsert(rollupRow, { onConflict:"client_id,start,end" });
        if (saveErr) console.error("[rebuild_rollup] Erro ao salvar:", saveErr);
        return ok(res, { message:"Rollup recalculado via SQL", start:rangeStart, end:rangeEnd, externalFetched:0, raw_upserted_new:0, total_in_db:totalVisitors, next_offset:null, done:true, dashboard: { total_visitors:totalVisitors, avg_visitors_per_day:rollupRow.avg_visitors_per_day, visitors_per_day:rollupRow.visitors_per_day, visitors_per_hour_avg:rollupRow.visitors_per_hour_avg, gender_percent:rollupRow.gender_percent, attributes_percent:rollupRow.attributes_percent, age_pyramid_percent:rollupRow.age_pyramid_percent, avg_times_seconds: { avg_visit_time_seconds:rollupRow.avg_visit_time_seconds, avg_dwell_time_seconds:null, avg_attention_seconds:rollupRow.avg_contact_time_seconds } }, stored_rollup:!saveErr });
      } finally { _serverRebuilding.delete(lockKey); }
    }

    // ── Paginação da API externa ──────────────────────────────────────────────
    let apiReportedTotal: number | null = null;
    let lastSig: string | null = null;
    let pageCount = 0;

    while (true) {
      if (pageCount > 0 && Date.now() - startedAt > MAX_MS) break;
      if (++pageCount > MAX_PAGES) break;
      const resp = await fetch(analyticsUrl, { method:"POST", headers, body:JSON.stringify({...baseBody, limit, offset}) });
      if (!resp.ok) { const txt = await resp.text(); return bad(res, resp.status, { error:"Erro na API externa", details:txt }); }
      const json = await resp.json();
      const page: any[] = extractVisitorArray(json);
      if (apiReportedTotal === null) { const totalNum = Number(json?.pagination?.total ?? json?.pagination?.count ?? json?.total ?? json?.count ?? json?.meta?.total); if (Number.isFinite(totalNum) && totalNum > 0) apiReportedTotal = totalNum; }
      if (page.length > 0) {
        const first:any = page[0]; const last:any = page[page.length-1];
        const sig = sha256(JSON.stringify([offset, page.length, first?.visitor_id??null, first?.start??first?.timestamp??null, last?.visitor_id??null, last?.start??last?.timestamp??null]));
        if (lastSig && sig === lastSig) { offset = 0; break; }
        lastSig = sig; combined.push(...page);
      }
      if (page.length < limit || (apiReportedTotal !== null && offset + page.length >= apiReportedTotal) || page.length === 0) { offset = 0; break; }
      offset += limit;
      if (offset > 10_000_000) break;
    }

    const next_offset = offset === 0 ? null : offset;
    const done = next_offset === null;

    if (combined.length === 0) {
      // Sem dados novos da API — reconstrói do banco
      if (deviceNums.length > 0) {
        const rows = await fetchAllDBRows(client_id, rangeStart, rangeEnd, deviceNums);
        if (rows.length === 0) return ok(res, { message:"Sem dados", start:rangeStart, end:rangeEnd, externalFetched:0, raw_upserted_new:0, next_offset:null, done:true, dashboard:null, stored_rollup:false });
        const rr = buildRollup(rows, client_id, rangeStart, rangeEnd);
        return ok(res, { message:"Rollup recalculado (dispositivo)", start:rangeStart, end:rangeEnd, externalFetched:0, raw_upserted_new:0, total_in_db:rr.total_visitors, next_offset:null, done:true, dashboard: { total_visitors:rr.total_visitors, avg_visitors_per_day:rr.avg_visitors_per_day, visitors_per_day:rr.visitors_per_day, visitors_per_hour_avg:rr.visitors_per_hour_avg, gender_percent:rr.gender_percent, attributes_percent:rr.attributes_percent, age_pyramid_percent:rr.age_pyramid_percent, avg_times_seconds: { avg_visit_time_seconds:rr.avg_visit_time_seconds, avg_dwell_time_seconds:rr.avg_dwell_time_seconds, avg_attention_seconds:rr.avg_contact_time_seconds } }, stored_rollup:false });
      }
      const { data: rpcData, error: rpcErr } = await supabase.rpc("build_visitor_rollup", { p_client_id:client_id, p_start:rangeStart, p_end:rangeEnd });
      if (!rpcErr && rpcData) {
        const stats = rpcData as any; const totalVisitors = Number(stats?.total_visitors ?? 0);
        if (totalVisitors > 0) {
          const rollupRow = { client_id, start:rangeStart, end:rangeEnd, total_visitors:totalVisitors, avg_visitors_per_day:stats.avg_visitors_per_day??0, visitors_per_day:stats.visitors_per_day??{}, visitors_per_hour_avg:stats.visitors_per_hour_avg??{}, age_pyramid_percent:stats.age_pyramid_percent??{}, gender_percent:stats.gender_percent??{}, attributes_percent:stats.attributes_percent??{}, avg_visit_time_seconds:stats.avg_visit_time_seconds??null, avg_dwell_time_seconds:null, avg_contact_time_seconds:stats.avg_contact_time_seconds??null, updated_at:n
