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
  return Date.now() - Date.parse(data.last_synced_at) > 60 * 60 * 1000;
}

// ── Background sync: respeita o start passado, não usa collection_start ──────
async function runBackgroundSync(client_id: string, cfg: ClientApiConfig, syncStart: string, syncEnd: string, devices: any[]) {
  const syncKey = `${client_id}:${syncStart}:${syncEnd}`;
  if (_activeSyncs.has(syncKey)) { console.log(`[BgSync] Já em andamento, pulando.`); return; }
  _activeSyncs.add(syncKey);
  console.log(`[BgSync] Iniciando: ${syncStart} → ${syncEnd}`);

  try {
    const analyticsUrl = `${(cfg.api_endpoint || "https://api.displayforce.ai").replace(/\/$/, "")}${cfg.analytics_endpoint?.startsWith("/") ? cfg.analytics_endpoint : `/${cfg.analytics_endpoint || "public/v1/stats/visitor/list"}`}`;
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
    const ck = cfg.custom_header_key?.trim(); const cv = cfg.custom_header_value?.trim();
    if (ck && cv) headers[ck] = cv;
    else if (cfg.api_key?.trim()) headers["X-API-Token"] = cfg.api_key.trim();
    else { console.error("[BgSync] api_key não configurada"); return; }

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
    let apiReportedTotal: number | null = null;
    let lastPageSig: string | null = null;

    while (pageCount < 2000) {
      pageCount++;
      let resp: Response;
      try { resp = await fetch(analyticsUrl, { method: "POST", headers, body: JSON.stringify({ ...baseBody, limit: 1000, offset }) }); }
      catch (e) { console.error("[BgSync] Fetch error:", e); break; }
      if (!resp.ok) { console.error(`[BgSync] API ${resp.status}`); break; }

      const json = await resp.json();
      const page: any[] = Array.isArray(json?.payload) ? json.payload : Array.isArray(json?.data) ? json.data : Array.isArray(json?.results) ? json.results : Array.isArray(json) ? json : [];

      if (apiReportedTotal === null) {
        const t = json?.pagination?.total ?? json?.pagination?.count ?? json?.total ?? json?.count ?? json?.meta?.total;
        const n = Number(t); if (Number.isFinite(n) && n > 0) { apiReportedTotal = n; console.log(`[BgSync] Total API: ${apiReportedTotal}`); }
      }

      if (page.length > 0) {
        const sig = `${offset}:${page.length}:${JSON.stringify(page[0]).slice(0, 80)}`;
        if (sig === lastPageSig) { console.warn("[BgSync] Página duplicada, encerrando."); break; }
        lastPageSig = sig;
        totalFetched += page.length;
        const rows = buildAndDeduplicateRows(page, client_id);
        for (let i = 0; i < rows.length; i += 500) {
          const { error } = await supabase.from("visitor_analytics").upsert(rows.slice(i, i + 500), { onConflict: "visit_uid", ignoreDuplicates: true });
          if (error) console.error(`[BgSync] Upsert erro:`, error);
        }
        console.log(`[BgSync] Página ${pageCount}: +${page.length} (total: ${totalFetched})`);
      }

      const reachedTotal = apiReportedTotal !== null && offset + page.length >= apiReportedTotal;
      if (reachedTotal || page.length < 1000 || page.length === 0) break;
      offset += 1000;
      await new Promise(r => setTimeout(r, 200));
    }

    console.log(`[BgSync] ✅ Concluído: ${totalFetched} registros`);

    // ── Após sync: rebuild rollups automaticamente ──────────────────────────
    // 1. Rollup do período sincronizado
    const deviceNums = devices.map(Number).filter(Number.isFinite);
    if (deviceNums.length > 0) {
      const rows = await fetchAllDBRows(client_id, syncStart, syncEnd, deviceNums);
      if (rows.length > 0) await saveRollup(buildRollup(rows, client_id, syncStart, syncEnd));
    } else {
      // Rollup via SQL RPC
      const { data: rpcData, error: rpcErr } = await supabase.rpc("build_visitor_rollup", { p_client_id: client_id, p_start: syncStart, p_end: syncEnd });
      if (!rpcErr && rpcData && Number((rpcData as any).total_visitors) > 0) {
        await supabase.from("visitor_analytics_rollups").upsert(
          { client_id, start: syncStart, end: syncEnd, ...(rpcData as any), updated_at: new Date().toISOString() },
          { onConflict: "client_id,start,end" }
        );
        console.log(`[BgSync] Rollup salvo: ${(rpcData as any).total_visitors} visitantes`);
      }

      // 2. Também atualiza rollup histórico completo (collection_start → hoje)
      const historicStart = cfg.collection_start || syncStart;
      if (historicStart !== syncStart) {
        const { data: rpcHist, error: rpcHistErr } = await supabase.rpc("build_visitor_rollup", { p_client_id: client_id, p_start: historicStart, p_end: syncEnd });
        if (!rpcHistErr && rpcHist && Number((rpcHist as any).total_visitors) > 0) {
          await supabase.from("visitor_analytics_rollups").upsert(
            { client_id, start: historicStart, end: syncEnd, ...(rpcHist as any), updated_at: new Date().toISOString() },
            { onConflict: "client_id,start,end" }
          );
          console.log(`[BgSync] Rollup histórico salvo: ${(rpcHist as any).total_visitors} visitantes`);
        }
      }

      // 3. Atualiza rollup da semana atual
      const now = new Date();
      const dow = now.getUTCDay(); const offset2 = (dow + 6) % 7;
      const weekStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset2, 0, 0, 0, 0));
      const weekEnd   = new Date(Date.UTC(weekStart.getUTCFullYear(), weekStart.getUTCMonth(), weekStart.getUTCDate() + 6, 23, 59, 59, 999));
      const { data: rpcWeek, error: rpcWeekErr } = await supabase.rpc("build_visitor_rollup", { p_client_id: client_id, p_start: weekStart.toISOString(), p_end: weekEnd.toISOString() });
      if (!rpcWeekErr && rpcWeek && Number((rpcWeek as any).total_visitors) > 0) {
        await supabase.from("visitor_analytics_rollups").upsert(
          { client_id, start: weekStart.toISOString(), end: weekEnd.toISOString(), ...(rpcWeek as any), updated_at: new Date().toISOString() },
          { onConflict: "client_id,start,end" }
        );
        console.log(`[BgSync] Rollup semana salvo: ${(rpcWeek as any).total_visitors} visitantes`);
      }
    }

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
      // CORREÇÃO: usa o start passado OU collection_start, não ignora o start do frontend
      const syncStart = String(start || cfg.collection_start || "2025-01-01T00:00:00.000Z");
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

      const fetchFF = async (url: string, body: any) => { let r = await fetch(`${url}?recursive=true&limit=100&offset=0`, { method: "GET", headers }); if (!r.ok) r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) }); return r; };

      const foldersResp = await fetchFF(`${base}/public/v1/folder/list`, { id:[], name:[], parent_ids:[], recursive:true, limit:100, offset:0 });
      if (!foldersResp.ok) { const txt = await foldersResp.text(); return bad(res, foldersResp.status, { error:"Erro ao buscar lojas", details:txt }); }
      const foldersJson = await foldersResp.json();
      const folders = Array.isArray(foldersJson?.data) ? foldersJson.data : Array.isArray(foldersJson?.payload) ? foldersJson.payload : Array.isArray(foldersJson) ? foldersJson : [];

      const devicesResp = await fetchFF(`${base}/public/v1/device/list`, { id:[], name:[], parent_ids:[], recursive:true, params:["id","name","parent_id","parent_ids","tags"], limit:100, offset:0 });
      if (!devicesResp.ok) { const txt = await devicesResp.text(); return bad(res, devicesResp.status, { error:"Erro ao buscar dispositivos", details:txt }); }
      const devicesJson = await devicesResp.json();
      const devicesData = Array.isArray(devicesJson?.data) ? devicesJson.data : Array.isArray(devicesJson?.payload) ? devicesJson.payload : Array.isArray(devicesJson) ? devicesJson : [];

      if (folders.length === 0) return ok(res, { message:"Nenhuma loja encontrada", stores_upserted:0, devices_upserted:0 });

      const { data: dbStores } = await supabase.from("stores").select("id,name,city").eq("client_id", client_id);
      const nameToStore = new Map<string, { id:string; city?:string|null }>();
      (dbStores || []).forEach((s:any) => { const n=String(s?.name||"").trim().toLowerCase(); if(!n||!s?.id)return; nameToStore.set(n,{id:String(s.id),city:s.city}); });

      const folderToStoreId = new Map<string,string>();
      const storesPayload: any[] = [];
      for (const f of folders) {
        const folderId = String(f?.id??"").trim(); const name = String(f?.name||"").trim();
        if (!folderId||!name) continue;
        const existing = nameToStore.get(name.toLowerCase());
        const storeId = existing?.id || crypto.randomUUID();
        folderToStoreId.set(folderId, storeId);
        storesPayload.push({ id:storeId, client_id, name, city:existing?.city??"Não informada" });
      }
      if (storesPayload.length > 0) await supabase.from("stores").upsert(storesPayload);

      const storeIds = storesPayload.map(s => s.id).filter(Boolean);
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
          devicesPayload.push({ id:existingId||crypto.randomUUID(), store_id:storeId, name:String(d?.name||mac), type:"camera", mac_address:mac, external_id:Number.isFinite(extId)?extId:null, status:d?.connection_state==="online"?"online":"offline" });
        });
      });
      if (devicesPayload.length > 0) await supabase.from("devices").upsert(devicesPayload);

      return ok(res, { message:"Lojas sincronizadas", stores_upserted:storesPayload.length, devices_upserted:devicesPayload.length });
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
      const page: any[] = Array.isArray(json?.payload) ? json.payload : Array.isArray(json?.data) ? json.data : Array.isArray(json?.results) ? json.results : Array.isArray(json) ? json : [];
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
          const rollupRow = { client_id, start:rangeStart, end:rangeEnd, total_visitors:totalVisitors, avg_visitors_per_day:stats.avg_visitors_per_day??0, visitors_per_day:stats.visitors_per_day??{}, visitors_per_hour_avg:stats.visitors_per_hour_avg??{}, age_pyramid_percent:stats.age_pyramid_percent??{}, gender_percent:stats.gender_percent??{}, attributes_percent:stats.attributes_percent??{}, avg_visit_time_seconds:stats.avg_visit_time_seconds??null, avg_dwell_time_seconds:null, avg_contact_time_seconds:stats.avg_contact_time_seconds??null, updated_at:new Date().toISOString() };
          await supabase.from("visitor_analytics_rollups").upsert(rollupRow, { onConflict:"client_id,start,end" });
          return ok(res, { message:"Rollup recalculado via SQL", start:rangeStart, end:rangeEnd, externalFetched:0, raw_upserted_new:0, total_in_db:totalVisitors, next_offset:null, done:true, dashboard: { total_visitors:totalVisitors, avg_visitors_per_day:rollupRow.avg_visitors_per_day, visitors_per_day:rollupRow.visitors_per_day, visitors_per_hour_avg:rollupRow.visitors_per_hour_avg, gender_percent:rollupRow.gender_percent, attributes_percent:rollupRow.attributes_percent, age_pyramid_percent:rollupRow.age_pyramid_percent, avg_times_seconds: { avg_visit_time_seconds:rollupRow.avg_visit_time_seconds, avg_dwell_time_seconds:null, avg_attention_seconds:rollupRow.avg_contact_time_seconds } }, stored_rollup:true });
        }
      }
      return ok(res, { message:"Sem dados", start:rangeStart, end:rangeEnd, externalFetched:0, raw_upserted_new:0, next_offset:null, done:true, dashboard:null, stored_rollup:false });
    }

    const toUpsert = buildAndDeduplicateRows(combined, client_id);
    let upserted = 0;
    for (let i = 0; i < toUpsert.length; i += 500) {
      const { error, data } = await supabase.from("visitor_analytics").upsert(toUpsert.slice(i, i+500), { onConflict:"visit_uid", ignoreDuplicates:true }).select("visit_uid");
      if (error) console.error(`Upsert chunk ${i} error:`, error);
      else upserted += data?.length ?? 0;
    }

    return ok(res, { message: done ? "Sincronização concluída" : "Sincronização parcial — continue chamando", start:rangeStart, end:rangeEnd, externalFetched:combined.length, raw_upserted_new:upserted, total_in_db:null, next_offset, done, dashboard:null, stored_rollup:false });

  } catch (err: any) {
    console.error("Erro inesperado:", err);
    return bad(res, 500, { error:"Erro inesperado", details:err?.message||String(err) });
  }
}