import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

// ── Supabase ──────────────────────────────────────────────────────────────────
const _url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const _key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
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

    const visit_uid = sha256(JSON.stringify({ client_id, device_id, visitor_id: v.visitor_id ?? null, start: startTs }));
    map.set(visit_uid, {
      visit_uid, client_id, device_id,
      timestamp: startTs, end_timestamp: endTs,
      age: typeof v.age === "number" ? Math.round(v.age) : null,
      gender: normalizeGender(v),
      attributes: { face_quality: v.face_quality ?? null, glasses: v.glasses ?? null, facial_hair: v.facial_hair ?? null, hair_color: v.hair_color ?? null, hair_type: v.hair_type ?? null, headwear: v.headwear ?? null },
      visit_time_seconds: visitTime,
      dwell_time_seconds: dwellTime,
      contact_time_seconds: contactTime,
      raw_data: v,
    });
  }
  return Array.from(map.values());
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
  let sumVisit=0, cntVisit=0, sumContact=0, cntContact=0;

  for (const r of rows) {
    if (r.timestamp) {
      const d = new Date(r.timestamp);
      if (!isNaN(d.getTime())) {
        const dk = asISODateUTC(d);
        perDay[dk] = (perDay[dk] ?? 0) + 1;
        perHour[String(d.getUTCHours())] = (perHour[String(d.getUTCHours())] ?? 0) + 1;
      }
    }
    if (typeof r.age === "number" && Number.isFinite(r.age)) ageCounts[bucketAge(Math.round(r.age))]++;
    else ageCounts.unknown++;
    if (r.gender === 1) genderCounts.male++; else if (r.gender === 2) genderCounts.female++; else genderCounts.unknown++;
    if (typeof r.visit_time_seconds === "number" && Number.isFinite(r.visit_time_seconds)) { sumVisit += r.visit_time_seconds; cntVisit++; }
    if (typeof r.contact_time_seconds === "number" && Number.isFinite(r.contact_time_seconds) && r.contact_time_seconds > 0) { sumContact += r.contact_time_seconds; cntContact++; }
  }

  const total = rows.length;
  const perHourAvg: Record<string,number> = {};
  for (let h = 0; h < 24; h++) perHourAvg[String(h)] = Number(((perHour[String(h)] ?? 0) / daysInRange).toFixed(2));
  const n = Math.max(total, 1);

  return {
    client_id, start: rangeStart, end: rangeEnd,
    total_visitors: total,
    avg_visitors_per_day: Number((total / daysInRange).toFixed(2)),
    visitors_per_day: perDay,
    visitors_per_hour_avg: perHourAvg,
    age_pyramid_percent: percentMap(ageCounts, n),
    gender_percent: percentMap(genderCounts, n),
    attributes_percent: {},
    avg_visit_time_seconds:   cntVisit   > 0 ? Number((sumVisit   / cntVisit).toFixed(2))   : null,
    avg_contact_time_seconds: cntContact > 0 ? Number((sumContact / cntContact).toFixed(2)) : null,
    updated_at: new Date().toISOString(),
  };
}

// ── Sync de um cliente ────────────────────────────────────────────────────────
async function syncClient(client_id: string, cfg: any): Promise<{ synced: number; error?: string }> {
  try {
    const now = new Date();
    const syncEnd    = now.toISOString();
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0)).toISOString();
    const todayEnd   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999)).toISOString();
    const HISTORIC_END = "9999-12-31T23:59:59.999Z";

    // Sync incremental: usa last_synced_at como ponto de partida (máx 2 dias atrás)
    // Garante que cada execução processa apenas os dados novos desde a última sync
    const { data: prevState } = await supabase
      .from("client_sync_state")
      .select("last_synced_at")
      .eq("client_id", client_id)
      .maybeSingle();

    const twoDaysAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 0, 0, 0, 0)).toISOString();
    const syncStart  = (prevState?.last_synced_at && prevState.last_synced_at > twoDaysAgo)
      ? prevState.last_synced_at
      : twoDaysAgo;

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

    // Coleta todos os rows da API em memória para usar no rollup (evita re-query ao banco)
    const allRows: any[] = [];
    let offset = 0, totalFetched = 0;
    for (let page = 0; page < 100; page++) {
      let resp: Response;
      try { resp = await fetch(analyticsUrl, { method: "POST", headers, body: JSON.stringify({ ...baseBody, limit: 1000, offset }) }); }
      catch (e: any) { console.error(`[cron] Fetch error client ${client_id}:`, e); break; }
      if (!resp.ok) { console.error(`[cron] API ${resp.status} client ${client_id}`); break; }

      const json = await resp.json();
      const items: any[] = Array.isArray(json?.payload) ? json.payload : Array.isArray(json?.data) ? json.data : Array.isArray(json?.results) ? json.results : Array.isArray(json) ? json : [];
      if (items.length === 0) break;

      const rows = buildRows(items, client_id);
      allRows.push(...rows); // guarda para rollup em memória
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await supabase.from("visitor_analytics").upsert(rows.slice(i, i + 500), { onConflict: "visit_uid", ignoreDuplicates: true });
        if (error) console.error(`[cron] Upsert error client ${client_id}:`, error);
      }

      totalFetched += items.length;
      const apiTotal = Number(json?.pagination?.total ?? json?.total ?? 0);
      if (items.length < 1000 || (apiTotal > 0 && offset + items.length >= apiTotal)) break;
      offset += 1000;
      await new Promise(r => setTimeout(r, 100));
    }

    // ── Rollups em memória a partir dos dados da API (sem re-query ao banco) ─
    const collectionStart = cfg.collection_start || "2025-01-01T00:00:00.000Z";

    if (allRows.length > 0) {
      // 1. Rollup de hoje (filtro em memória, sem RPC)
      const rowsToday = allRows.filter(r => r.timestamp && r.timestamp >= todayStart);
      if (rowsToday.length > 0) {
        const rrToday = buildRollup(rowsToday, client_id, todayStart, todayEnd);
        await supabase.from("visitor_analytics_rollups").upsert(rrToday, { onConflict: "client_id,start,end" });
        console.log(`[cron] Rollup hoje: ${rrToday.total_visitors} visitantes`);
      }

      // 2. Rollup do período sincronizado (2 dias)
      const rrSync = buildRollup(allRows, client_id, syncStart, todayEnd);

      // 3. Atualiza rollup histórico (end=9999) mesclando os dias novos
      //    Usa dados da API diretamente — sem query extra ao Supabase
      const { data: historicRollup } = await supabase
        .from("visitor_analytics_rollups")
        .select("visitors_per_day, total_visitors")
        .eq("client_id", client_id)
        .gt("end", "2099-01-01T00:00:00Z")
        .maybeSingle();

      if (historicRollup) {
        const existingPerDay = (historicRollup.visitors_per_day as Record<string,number>) || {};
        // Mescla: mantém histórico antigo, sobrescreve dias recentes com dados frescos da API
        const mergedPerDay = { ...existingPerDay, ...rrSync.visitors_per_day };
        const mergedTotal  = Object.values(mergedPerDay).reduce((a, b) => (a as number) + (b as number), 0) as number;

        await supabase.from("visitor_analytics_rollups")
          .update({
            visitors_per_day:         mergedPerDay,
            total_visitors:           mergedTotal,
            visitors_per_hour_avg:    rrSync.visitors_per_hour_avg,
            age_pyramid_percent:      rrSync.age_pyramid_percent,
            gender_percent:           rrSync.gender_percent,
            attributes_percent:       rrSync.attributes_percent,
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
          { ...rrSync, start: collectionStart, end: HISTORIC_END },
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

  const results: any[] = [];
  for (const cfg of activeConfigs) {
    // Para evitar timeout do Vercel (máx 10s Hobby / 60s Pro), limita tempo por cliente
    if (Date.now() - startTime > 50_000) {
      console.warn("[cron] Limite de tempo atingido, pulando clientes restantes");
      break;
    }
    const result = await syncClient(cfg.client_id, cfg);
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
