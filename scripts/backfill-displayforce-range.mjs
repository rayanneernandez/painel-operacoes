import crypto from "crypto";
import fs from "fs";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_CLIENTS = ["assai", "panvel"];
const CLIENT_IDS = {
  assai: "b1c05e4d-0417-4853-9af9-8c0725df1880",
  panvel: "c6999bd9-14c0-4e26-abb1-d4b852d34421",
};

const DEFAULT_ENV_FILES = [
  ".env",
  ".env.local",
  ".env.production.local",
];

function readEnvFile(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter(Boolean)
      .filter((line) => !line.trim().startsWith("#"))
      .map((line) => {
        const idx = line.indexOf("=");
        return [line.slice(0, idx), line.slice(idx + 1)];
      })
  );
}

function stripWrappingQuotes(value) {
  if (typeof value !== "string") return value;
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function isPlaceholderEnvValue(name, value) {
  if (typeof value !== "string") return false;
  const normalizedName = name.toUpperCase();
  const normalizedValue = value.trim().toLowerCase();
  if (!normalizedValue) return false;

  if (normalizedName.includes("SUPABASE") && normalizedValue.includes("seu-projeto.supabase.co")) return true;
  if (normalizedName.includes("SUPABASE") && normalizedValue.includes("your-project.supabase.co")) return true;
  if (normalizedName.includes("SUPABASE") && normalizedValue.includes("sua-chave")) return true;
  if (normalizedName.includes("SUPABASE") && normalizedValue.includes("your-key")) return true;
  if (normalizedName.includes("SUPABASE") && normalizedValue.includes("example")) return true;

  return false;
}

function loadEnv() {
  const requestedEnvFile = getArg("env-file", null);
  const envFiles = requestedEnvFile ? [requestedEnvFile] : DEFAULT_ENV_FILES;
  const merged = {};

  for (const envFile of envFiles) {
    if (!fs.existsSync(envFile)) continue;
    const fileValues = readEnvFile(envFile);
    for (const [name, rawValue] of Object.entries(fileValues)) {
      merged[name] = stripWrappingQuotes(rawValue);
    }
  }

  for (const [name, rawValue] of Object.entries(process.env)) {
    if (rawValue == null) continue;
    const value = stripWrappingQuotes(rawValue);
    if (isPlaceholderEnvValue(name, value)) continue;
    merged[name] = value;
  }

  return merged;
}

function getArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function getNumberArg(name, fallback = null) {
  const value = getArg(name, null);
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(label, fn, retries = 5) {
  let lastError = null;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const message = error?.message || String(error);
      console.warn(`[retry] ${label} attempt ${attempt}/${retries} failed: ${message}`);
      if (attempt < retries) {
        const retryAfterMs = Number(error?.retryAfterMs);
        const delayMs = Number.isFinite(retryAfterMs) && retryAfterMs > 0
          ? retryAfterMs
          : 1000 * attempt;
        await sleep(delayMs);
      }
    }
  }
  throw lastError;
}

function sha256(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function startOfUtcDay(dateLike) {
  const d = new Date(dateLike);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

function endOfUtcDay(dateLike) {
  const d = new Date(dateLike);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}

function normalizeUtcRange(startLike, endLike) {
  let start = startOfUtcDay(startLike);
  let end = endOfUtcDay(endLike);
  if (start.getTime() > end.getTime()) {
    const originalStart = start;
    start = startOfUtcDay(endLike);
    end = endOfUtcDay(originalStart);
    console.warn(`[range] Datas invertidas detectadas; ajustando para ${start.toISOString()} → ${end.toISOString()}`);
  }
  return { start, end };
}

function addUtcDays(dateLike, days) {
  const d = new Date(dateLike);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
}

function extractVisitorArray(json) {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.payload)) return json.payload;
  if (Array.isArray(json?.data)) return json.data;
  if (Array.isArray(json?.results)) return json.results;
  if (Array.isArray(json?.items)) return json.items;
  if (Array.isArray(json?.visitors)) return json.visitors;
  if (Array.isArray(json?.records)) return json.records;
  if (Array.isArray(json?.response)) return json.response;
  if (Array.isArray(json?.list)) return json.list;
  if (Array.isArray(json?.data?.items)) return json.data.items;
  if (Array.isArray(json?.data?.results)) return json.data.results;
  if (Array.isArray(json?.data?.visitors)) return json.data.visitors;
  if (Array.isArray(json?.data?.records)) return json.data.records;
  return [];
}

function normalizeGender(visit) {
  if (typeof visit.sex === "number") return visit.sex;
  if (typeof visit.sex === "string") {
    const s = visit.sex.toLowerCase();
    if (["male", "m", "1"].includes(s)) return 1;
    if (["female", "f", "2"].includes(s)) return 2;
  }
  if (visit.gender === "male") return 1;
  if (visit.gender === "female") return 2;
  return 0;
}

function extractTimes(visit) {
  const startRaw = visit.start ?? visit.timestamp ?? visit.start_time ?? visit.begin ?? null;
  const endRaw = visit.end ?? visit.end_time ?? visit.finish ?? null;
  const startTs = typeof startRaw === "string" ? startRaw : null;
  const endTs = typeof endRaw === "string" ? endRaw : null;
  let durationFromStartEnd = null;
  if (startTs && endTs) {
    const s = Date.parse(startTs);
    const e = Date.parse(endTs);
    if (Number.isFinite(s) && Number.isFinite(e) && e >= s) {
      durationFromStartEnd = Math.round((e - s) / 1000);
    }
  }
  return {
    startTs,
    endTs,
    visitTimeSeconds:
      safeNumber(visit.tracks_duration) ??
      safeNumber(visit.visit_time_seconds) ??
      safeNumber(visit.visit_time) ??
      safeNumber(visit.duration_seconds) ??
      safeNumber(visit.duration) ??
      durationFromStartEnd ??
      null,
    dwellTimeSeconds:
      safeNumber(visit.dwell_time_seconds) ??
      safeNumber(visit.dwell_time) ??
      safeNumber(visit.time_in_frame_seconds) ??
      null,
    contactTimeSeconds:
      safeNumber(visit.content_view_duration) ??
      safeNumber(visit.contact_time_seconds) ??
      safeNumber(visit.contact_time) ??
      null,
  };
}

function buildRows(visits, clientId) {
  const dedupMap = new Map();
  for (const visit of visits) {
    let deviceId = null;
    if (Array.isArray(visit.devices) && visit.devices.length > 0) {
      const n = Number(visit.devices[0]);
      if (Number.isFinite(n)) deviceId = n;
    } else {
      for (const key of ["device", "device_id", "source_id", "camera_id"]) {
        if (key in visit) {
          const n = Number(visit[key]);
          if (Number.isFinite(n)) {
            deviceId = n;
            break;
          }
        }
      }
    }

    const { startTs, endTs, visitTimeSeconds, dwellTimeSeconds, contactTimeSeconds } = extractTimes(visit);
    const visitUid = sha256(
      JSON.stringify({
        client_id: clientId,
        device_id: deviceId,
        visitor_id: visit.visitor_id ?? null,
        start: startTs ?? null,
      })
    );

    dedupMap.set(visitUid, {
      visit_uid: visitUid,
      client_id: clientId,
      device_id: deviceId,
      timestamp: startTs,
      end_timestamp: endTs,
      age: typeof visit.age === "number" ? Math.round(visit.age) : null,
      gender: normalizeGender(visit),
      attributes: {
        face_quality: visit.face_quality ?? null,
        glasses: visit.glasses ?? null,
        facial_hair: visit.facial_hair ?? null,
        hair_color: visit.hair_color ?? null,
        hair_type: visit.hair_type ?? null,
        headwear: visit.headwear ?? null,
      },
      visit_time_seconds: visitTimeSeconds,
      dwell_time_seconds: dwellTimeSeconds,
      contact_time_seconds: contactTimeSeconds,
      raw_data: visit,
    });
  }
  return Array.from(dedupMap.values());
}

async function upsertRows(supabase, rows) {
  let total = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error } = await withRetry(`upsert visitor_analytics ${i}`, () =>
      supabase
        .from("visitor_analytics")
        .upsert(batch, { onConflict: "visit_uid" })
    );
    if (error) throw error;
    total += batch.length;
  }
  return total;
}

async function fetchDayVisits(cfg, startIso, endIso) {
  const apiBase = (cfg.api_endpoint || "https://api.displayforce.ai").replace(/\/$/, "");
  const endpoint = cfg.analytics_endpoint?.startsWith("/")
    ? cfg.analytics_endpoint
    : `/${cfg.analytics_endpoint || "public/v1/stats/visitor/list"}`;
  const url = `${apiBase}${endpoint}`;

  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  const ck = cfg.custom_header_key?.trim();
  const cv = cfg.custom_header_value?.trim();
  if (ck && cv) headers[ck] = cv;
  else if (cfg.api_key?.trim()) headers["X-API-Token"] = cfg.api_key.trim();
  else throw new Error(`Sem credencial da API para ${cfg.client_id}`);

  const isPanvel = cfg.client_id === CLIENT_IDS.panvel;
  const requestedPageLimit = getNumberArg("page-limit", null);
  const requestedMaxPages = getNumberArg("max-pages", 500);
  const requestedPanvelRetryMs = getNumberArg("panvel-retry-ms", null);
  const requestedPanvelDelayMs = getNumberArg("panvel-delay-ms", null);
  const pageLimit = requestedPageLimit && requestedPageLimit > 0
    ? requestedPageLimit
    : (isPanvel ? 500 : 1000);
  const maxPages = requestedMaxPages && requestedMaxPages > 0 ? requestedMaxPages : 500;
  const retryAfterMs = isPanvel
    ? (requestedPanvelRetryMs && requestedPanvelRetryMs > 0 ? requestedPanvelRetryMs : 30000)
    : 10000;
  const pageDelayMs = isPanvel
    ? (requestedPanvelDelayMs && requestedPanvelDelayMs > 0 ? requestedPanvelDelayMs : 1500)
    : 120;
  const bodyBase = {
    start: startIso,
    end: endIso,
    tracks: cfg.collect_tracks ?? true,
    face_quality: cfg.collect_face_quality ?? true,
    glasses: cfg.collect_glasses ?? true,
    facial_hair: cfg.collect_beard ?? true,
    hair_color: cfg.collect_hair_color ?? true,
    hair_type: cfg.collect_hair_type ?? true,
    headwear: cfg.collect_headwear ?? true,
    additional_attributes: ["smile", "pitch", "yaw", "x", "y", "height"],
  };

  const visits = [];
  let offset = 0;
  let page = 0;
  let apiTotal = null;
  let lastSig = null;

  while (page < maxPages) {
    page += 1;
    const json = await withRetry(`fetch ${cfg.client_id} ${startIso.slice(0, 10)} offset ${offset}`, async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), isPanvel ? 120000 : 45000);
      try {
        const resp = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({ ...bodyBase, limit: pageLimit, offset }),
          signal: controller.signal,
        });

        if (!resp.ok) {
          const text = await resp.text();
          const error = new Error(`API ${resp.status} ${text}`);
          if (resp.status === 429) {
            error.retryAfterMs = retryAfterMs;
          }
          throw error;
        }

        return await resp.json();
      } finally {
        clearTimeout(timeout);
      }
    }, 5);

    const items = extractVisitorArray(json);
    if (apiTotal === null) {
      const totalNum = Number(json?.pagination?.total ?? json?.pagination?.count ?? json?.total ?? json?.count ?? 0);
      if (Number.isFinite(totalNum) && totalNum > 0) apiTotal = totalNum;
    }
    if (items.length === 0) break;

    const sig = sha256(
      JSON.stringify([
        offset,
        items.length,
        items[0]?.visitor_id ?? null,
        items[0]?.start ?? items[0]?.timestamp ?? null,
        items.at(-1)?.visitor_id ?? null,
        items.at(-1)?.start ?? items.at(-1)?.timestamp ?? null,
      ])
    );
    if (lastSig && sig === lastSig) break;
    lastSig = sig;

    visits.push(...items);
    if (items.length < pageLimit) break;
    if (apiTotal !== null && offset + items.length >= apiTotal) break;

    offset += items.length;
    await sleep(pageDelayMs);
  }

  return { visits, apiTotal };
}

async function buildAndSaveRollup(supabase, clientId, startIso, endIso) {
  const rpc = await withRetry(`rpc rollup ${clientId} ${startIso} ${endIso}`, () =>
    supabase.rpc("build_visitor_rollup", {
      p_client_id: clientId,
      p_start: startIso,
      p_end: endIso,
    })
  );
  if (rpc.error) throw rpc.error;
  if (!rpc.data) return null;

  const row = {
    client_id: clientId,
    start: startIso,
    end: endIso,
    ...rpc.data,
    updated_at: new Date().toISOString(),
  };
  const { error } = await withRetry(`upsert rollup ${clientId} ${startIso}`, () =>
    supabase.from("visitor_analytics_rollups").upsert(row, {
      onConflict: "client_id,start,end",
    })
  );
  if (error) throw error;
  return row;
}

async function resolveConfigs(supabase, clientNames) {
  const ids = clientNames.map((name) => CLIENT_IDS[name] ?? name);
  const { data, error } = await withRetry("load client configs", () =>
    supabase
      .from("client_api_configs")
      .select("*")
      .in("client_id", ids)
  );
  if (error) throw error;
  const cfgById = new Map((data || []).map((cfg) => [cfg.client_id, cfg]));
  return ids.map((id) => {
    const cfg = cfgById.get(id);
    if (!cfg) throw new Error(`Config não encontrada para ${id}`);
    return cfg;
  });
}

async function main() {
  const env = loadEnv();
  const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("SUPABASE_URL/VITE_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY/SUPABASE_KEY sao obrigatorios");
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const startArg = getArg("start", "2026-04-01");
  const endArg = getArg("end", "2026-04-09");
  const clientArg = getArg("clients", DEFAULT_CLIENTS.join(","));
  const excludeToday = hasFlag("exclude-today");
  const clientNames = clientArg.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  const configs = await resolveConfigs(supabase, clientNames);

  let { start: rangeStart, end: rangeEnd } = normalizeUtcRange(
    `${startArg}T00:00:00.000Z`,
    `${endArg}T00:00:00.000Z`
  );

  if (excludeToday) {
    const todayStart = startOfUtcDay(new Date());
    if (rangeEnd.getTime() >= todayStart.getTime()) {
      rangeEnd = endOfUtcDay(addUtcDays(todayStart, -1));
      console.log(`[range] Excluindo dia atual do backfill: ${todayStart.toISOString().slice(0, 10)}`);
    }
  }

  if (rangeStart.getTime() > rangeEnd.getTime()) {
    console.log("[range] Nenhum dia historico restante apos excluir o dia atual.");
    return;
  }

  const days = [];
  for (let cursor = new Date(rangeStart); cursor <= rangeEnd; cursor = addUtcDays(cursor, 1)) {
    days.push(new Date(cursor));
  }

  const summary = [];

  for (const cfg of configs) {
    const clientSummary = { client_id: cfg.client_id, days: [] };
    console.log(`\n=== ${cfg.client_id} ===`);

    for (const day of days) {
      const dayStart = startOfUtcDay(day).toISOString();
      const dayEnd = endOfUtcDay(day).toISOString();
      const dayKey = dayStart.slice(0, 10);

      const { visits, apiTotal } = await fetchDayVisits(cfg, dayStart, dayEnd);
      const rows = buildRows(visits, cfg.client_id);
      const upserted = rows.length > 0 ? await upsertRows(supabase, rows) : 0;
      const rollup = await buildAndSaveRollup(supabase, cfg.client_id, dayStart, dayEnd);
      const raw = await withRetry(`count raw ${cfg.client_id} ${dayKey}`, () =>
        supabase
          .from("visitor_analytics")
          .select("*", { count: "exact", head: true })
          .eq("client_id", cfg.client_id)
          .gte("timestamp", dayStart)
          .lte("timestamp", dayEnd)
      );

      const result = {
        day: dayKey,
        apiFetched: visits.length,
        apiTotal,
        rowsPrepared: rows.length,
        upserted,
        dbCount: raw.count ?? 0,
        rollupTotal: rollup?.total_visitors ?? 0,
      };
      clientSummary.days.push(result);
      console.log(JSON.stringify(result));
      await sleep(150);
    }

    const rangeStartIso = rangeStart.toISOString();
    const rangeEndIso = rangeEnd.toISOString();
    const rangeRollup = await buildAndSaveRollup(supabase, cfg.client_id, rangeStartIso, rangeEndIso);
    const rangeRaw = await withRetry(`count raw range ${cfg.client_id}`, () =>
      supabase
        .from("visitor_analytics")
        .select("*", { count: "exact", head: true })
        .eq("client_id", cfg.client_id)
        .gte("timestamp", rangeStartIso)
        .lte("timestamp", rangeEndIso)
    );

    clientSummary.range = {
      start: rangeStartIso,
      end: rangeEndIso,
      dbCount: rangeRaw.count ?? 0,
      rollupTotal: rangeRollup?.total_visitors ?? 0,
    };
    summary.push(clientSummary);
  }

  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
