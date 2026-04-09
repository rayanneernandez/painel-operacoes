import fs from "fs";
import { createClient } from "@supabase/supabase-js";

const CLIENTS = {
  assai: {
    clientId: "b1c05e4d-0417-4853-9af9-8c0725df1880",
    platformSlug: "assai",
  },
  panvel: {
    clientId: "c6999bd9-14c0-4e26-abb1-d4b852d34421",
    platformSlug: "panvel",
  },
};

function readEnvFile(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter(Boolean)
      .filter((line) => !line.trim().startsWith("#"))
      .map((line) => {
        const idx = line.indexOf("=");
        return [line.slice(0, idx), line.slice(idx + 1).replace(/^['"]|['"]$/g, "")];
      })
  );
}

function getArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function startOfUtcDay(dateLike) {
  const d = new Date(dateLike);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

function endOfUtcDay(dateLike) {
  const d = new Date(dateLike);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}

function addUtcDays(dateLike, days) {
  const d = new Date(dateLike);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
}

function asISODateUTC(dateLike) {
  const d = new Date(dateLike);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function toUnixSeconds(dateLike) {
  return Math.floor(new Date(dateLike).getTime() / 1000);
}

function toHourlyRanges(day) {
  const out = [];
  const dayStart = startOfUtcDay(day);
  for (let hour = 0; hour < 24; hour += 1) {
    const start = new Date(Date.UTC(dayStart.getUTCFullYear(), dayStart.getUTCMonth(), dayStart.getUTCDate(), hour, 0, 0, 0));
    const end = new Date(Date.UTC(dayStart.getUTCFullYear(), dayStart.getUTCMonth(), dayStart.getUTCDate(), hour, 59, 59, 999));
    out.push({ from: toUnixSeconds(start), to: toUnixSeconds(end) });
  }
  return out;
}

function percentMapFromCounts(counts) {
  const total = Object.values(counts).reduce((acc, value) => acc + (Number(value) || 0), 0);
  if (total <= 0) return {};
  return Object.fromEntries(
    Object.entries(counts).map(([key, value]) => [
      key,
      Number((((Number(value) || 0) / total) * 100).toFixed(2)),
    ])
  );
}

function parseSetCookies(existingCookie, response) {
  const jar = new Map(
    existingCookie
      .split(/;\s*/)
      .filter(Boolean)
      .map((part) => {
        const idx = part.indexOf("=");
        return [part.slice(0, idx), part.slice(idx + 1)];
      })
  );

  const setCookies = response.headers.getSetCookie
    ? response.headers.getSetCookie()
    : (response.headers.get("set-cookie") ? [response.headers.get("set-cookie")] : []);

  for (const cookie of setCookies) {
    const pair = cookie.split(";")[0];
    const idx = pair.indexOf("=");
    if (idx > 0) jar.set(pair.slice(0, idx), pair.slice(idx + 1));
  }
  return [...jar.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
}

function formatLocalTimeIso() {
  const now = new Date();
  const offsetMinutes = -now.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
  return `${local}${sign}${hh}:${mm}`;
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} @ ${url}: ${text.slice(0, 300)}`);
  }
  return { response, json };
}

async function loginDisplayforce(env) {
  const headers = {
    Accept: "application/json,text/plain,*/*",
    "Content-Type": "application/json",
  };

  let cookieHeader = "";
  const applyCookie = (response) => {
    cookieHeader = parseSetCookies(cookieHeader, response);
  };

  const start = await jsonRequest("https://api.displayforce.ai/v5/auth/login/multi_step/start", {
    method: "POST",
    headers,
  });
  applyCookie(start.response);
  const sessionId = start.json?.session_id;
  if (!sessionId) throw new Error("Login DisplayForce sem session_id");

  const localTime = formatLocalTimeIso();
  const steps = [
    ["check_login", { session_id: sessionId, login: env.DISPLAYFORCE_EMAIL, local_time: localTime }],
    ["commit_pwd", { session_id: sessionId, password: env.DISPLAYFORCE_PASS, local_time: localTime }],
    ["finish", { session_id: sessionId }],
  ];

  for (const [step, body] of steps) {
    const result = await jsonRequest(`https://api.displayforce.ai/v5/auth/login/multi_step/${step}`, {
      method: "POST",
      headers: {
        ...headers,
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
      body: JSON.stringify(body),
    });
    applyCookie(result.response);
  }

  if (!cookieHeader.includes("refresh_token=")) {
    throw new Error("Login DisplayForce sem refresh_token");
  }
  return cookieHeader;
}

async function fetchDisplayforceSummary(cookieHeader, platformSlug) {
  const { json } = await jsonRequest(`https://api.displayforce.ai/v5/platforms/${platformSlug}/summary`, {
    headers: {
      Accept: "application/json,text/plain,*/*",
      Cookie: cookieHeader,
    },
  });
  const platformId = Number(json?.platform?.id);
  if (!Number.isFinite(platformId) || platformId <= 0) {
    throw new Error(`Resumo sem platform id para ${platformSlug}`);
  }
  return platformId;
}

async function postStats(cookieHeader, platformId, path, body) {
  const { json } = await jsonRequest(`https://api.displayforce.ai/v5/platforms/${platformId}${path}`, {
    method: "POST",
    headers: {
      Accept: "application/json,text/plain,*/*",
      "Content-Type": "application/json",
      Cookie: cookieHeader,
    },
    body: JSON.stringify(body),
  });
  return json;
}

async function loadExistingRollup(supabase, clientId, startIso, endIso) {
  const { data, error } = await supabase
    .from("visitor_analytics_rollups")
    .select("*")
    .eq("client_id", clientId)
    .eq("start", startIso)
    .eq("end", endIso)
    .maybeSingle();

  if (error) throw error;
  return data || {};
}

async function assignMissingIds(supabase, rows) {
  const missingIndexes = [];
  rows.forEach((row, index) => {
    if (!Number.isFinite(Number(row.id))) missingIndexes.push(index);
  });
  if (missingIndexes.length === 0) return rows;

  const { data, error } = await supabase
    .from("visitor_analytics_rollups")
    .select("id")
    .order("id", { ascending: false })
    .limit(1);

  if (error) throw error;
  let nextId = Number(data?.[0]?.id ?? 0) + 1;
  for (const index of missingIndexes) {
    rows[index] = { ...rows[index], id: nextId };
    nextId += 1;
  }
  return rows;
}

function buildGenderPercent(sexEntry) {
  return percentMapFromCounts({
    male: Number(sexEntry?.male ?? 0),
    female: Number(sexEntry?.female ?? 0),
  });
}

function buildAgePercent(ageEntry, fallback = {}) {
  const counts = Object.fromEntries(
    Object.entries(ageEntry || {}).filter(([key]) => key !== "from" && key !== "to")
  );
  const percent = percentMapFromCounts(counts);
  return Object.keys(percent).length > 0 ? percent : fallback;
}

function buildHourMap(hourlyAudience) {
  const out = {};
  for (let hour = 0; hour < Math.min(24, hourlyAudience.length); hour += 1) {
    out[String(hour)] = Number(hourlyAudience[hour]?.unique_visitors_count ?? 0);
  }
  return out;
}

function averageHourMaps(hourMaps, daysCount) {
  const out = {};
  for (let hour = 0; hour < 24; hour += 1) {
    const key = String(hour);
    const total = hourMaps.reduce((acc, item) => acc + (Number(item[key]) || 0), 0);
    out[key] = Number((total / Math.max(1, daysCount)).toFixed(2));
  }
  return out;
}

function buildRangeRow({
  existing = {},
  clientId,
  startIso,
  endIso,
  totalVisitors,
  visitorsPerDay,
  visitorsPerHourAvg,
  genderPercent,
  agePyramidPercent,
  avgVisitTimeSeconds,
  avgContactTimeSeconds,
}) {
  const daysCount = Math.max(1, Object.keys(visitorsPerDay).length);
  return {
    ...existing,
    client_id: clientId,
    start: startIso,
    end: endIso,
    total_visitors: totalVisitors,
    avg_visitors_per_day: Number((totalVisitors / daysCount).toFixed(2)),
    visitors_per_day: visitorsPerDay,
    visitors_per_hour_avg: visitorsPerHourAvg,
    gender_percent: Object.keys(genderPercent || {}).length > 0 ? genderPercent : (existing.gender_percent || {}),
    age_pyramid_percent: Object.keys(agePyramidPercent || {}).length > 0 ? agePyramidPercent : (existing.age_pyramid_percent || {}),
    attributes_percent: existing.attributes_percent || {},
    avg_visit_time_seconds: avgVisitTimeSeconds ?? existing.avg_visit_time_seconds ?? null,
    avg_contact_time_seconds: avgContactTimeSeconds ?? existing.avg_contact_time_seconds ?? null,
    updated_at: new Date().toISOString(),
  };
}

async function syncClientRollups(supabase, cookieHeader, clientKey, rangeStart, rangeEnd) {
  const cfg = CLIENTS[clientKey];
  if (!cfg) throw new Error(`Cliente não suportado para rollup DisplayForce: ${clientKey}`);

  const platformId = await fetchDisplayforceSummary(cookieHeader, cfg.platformSlug);
  const dayRanges = [];
  const days = [];
  for (let cursor = new Date(rangeStart); cursor <= rangeEnd; cursor = addUtcDays(cursor, 1)) {
    const dayStart = startOfUtcDay(cursor);
    const dayEnd = endOfUtcDay(cursor);
    dayRanges.push({ from: toUnixSeconds(dayStart), to: toUnixSeconds(dayEnd) });
    days.push({ dayStart, dayEnd });
  }

  const overallRange = { from: toUnixSeconds(rangeStart), to: toUnixSeconds(rangeEnd) };
  const rangesWithOverall = [...dayRanges, overallRange];

  const [audience, attention, sex, age] = await Promise.all([
    postStats(cookieHeader, platformId, "/stats/visitor_view/audience", { ranges: rangesWithOverall, finetuning: false }),
    postStats(cookieHeader, platformId, "/stats/visitor_view/attention", { ranges: rangesWithOverall, finetuning: false }),
    postStats(cookieHeader, platformId, "/stats/visitor_view/sex", { ranges: rangesWithOverall, finetuning: false }),
    postStats(cookieHeader, platformId, "/stats/visitor_view/age", { ranges: rangesWithOverall, finetuning: false }),
  ]);

  const audienceRanges = audience?.ranges || [];
  const attentionRanges = attention?.ranges || [];
  const sexRanges = sex?.ranges || [];
  const ageRanges = age?.ranges || [];
  const overallAudience = audienceRanges.at(-1) || {};
  const overallAttention = attentionRanges.at(-1) || {};
  const overallSex = sexRanges.at(-1) || {};
  const overallAge = ageRanges.at(-1) || {};

  const dailyRows = [];
  const hourMaps = [];
  const visitorsPerDay = {};

  for (let index = 0; index < days.length; index += 1) {
    const { dayStart, dayEnd } = days[index];
    const dayIso = asISODateUTC(dayStart);
    const startIso = dayStart.toISOString();
    const endIso = dayEnd.toISOString();
    const [existing, hourlyAudience] = await Promise.all([
      loadExistingRollup(supabase, cfg.clientId, startIso, endIso),
      postStats(cookieHeader, platformId, "/stats/visitor_view/audience", {
        ranges: [...toHourlyRanges(dayStart), { from: toUnixSeconds(dayStart), to: toUnixSeconds(dayEnd) }],
        finetuning: false,
      }),
    ]);

    const dayAudience = audienceRanges[index] || {};
    const dayAttention = attentionRanges[index] || {};
    const daySex = sexRanges[index] || {};
    const dayAge = ageRanges[index] || {};
    const hourlyRanges = (hourlyAudience?.ranges || []).slice(0, 24);
    const hourMap = buildHourMap(hourlyRanges);
    hourMaps.push(hourMap);
    const totalVisitors = Number(dayAudience.unique_visitors_count ?? 0);
    visitorsPerDay[dayIso] = totalVisitors;

    dailyRows.push(
      buildRangeRow({
        existing,
        clientId: cfg.clientId,
        startIso,
        endIso,
        totalVisitors,
        visitorsPerDay: { [dayIso]: totalVisitors },
        visitorsPerHourAvg: hourMap,
        genderPercent: buildGenderPercent(daySex),
        agePyramidPercent: buildAgePercent(dayAge, existing.age_pyramid_percent || {}),
        avgVisitTimeSeconds: Number(dayAttention.visit_duration ?? existing.avg_visit_time_seconds ?? 0) || null,
        avgContactTimeSeconds: Number(dayAttention.attention_duration ?? existing.avg_contact_time_seconds ?? 0) || null,
      })
    );
  }

  const rangeStartIso = rangeStart.toISOString();
  const rangeEndIso = rangeEnd.toISOString();
  const existingRange = await loadExistingRollup(supabase, cfg.clientId, rangeStartIso, rangeEndIso);
  const exactRow = buildRangeRow({
    existing: existingRange,
    clientId: cfg.clientId,
    startIso: rangeStartIso,
    endIso: rangeEndIso,
    totalVisitors: Number(overallAudience.unique_visitors_count ?? 0),
    visitorsPerDay,
    visitorsPerHourAvg: averageHourMaps(hourMaps, days.length),
    genderPercent: buildGenderPercent(overallSex),
    agePyramidPercent: buildAgePercent(overallAge, existingRange.age_pyramid_percent || {}),
    avgVisitTimeSeconds: Number(overallAttention.visit_duration ?? existingRange.avg_visit_time_seconds ?? 0) || null,
    avgContactTimeSeconds: Number(overallAttention.attention_duration ?? existingRange.avg_contact_time_seconds ?? 0) || null,
  });

  const rowsToSave = await assignMissingIds(supabase, [...dailyRows, exactRow]);
  const { error } = await supabase
    .from("visitor_analytics_rollups")
    .upsert(rowsToSave, { onConflict: "client_id,start,end" });

  if (error) throw error;

  return {
    client_id: cfg.clientId,
    platform_id: platformId,
    total_visitors: exactRow.total_visitors,
    visitors_per_day: exactRow.visitors_per_day,
  };
}

async function main() {
  const env = readEnvFile(".env");
  const supabase = createClient(env.SUPABASE_URL || env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const startArg = getArg("start", "2026-04-01");
  const endArg = getArg("end", "2026-04-09");
  const clientsArg = getArg("clients", "assai,panvel");
  const clientKeys = clientsArg.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);

  if (!env.DISPLAYFORCE_EMAIL || !env.DISPLAYFORCE_PASS) {
    throw new Error("DISPLAYFORCE_EMAIL e DISPLAYFORCE_PASS são obrigatórios");
  }

  const rangeStart = startOfUtcDay(`${startArg}T00:00:00.000Z`);
  const rangeEnd = endOfUtcDay(`${endArg}T00:00:00.000Z`);
  const cookieHeader = await loginDisplayforce(env);
  const summary = [];

  for (const clientKey of clientKeys) {
    console.log(`\n=== ${clientKey} ===`);
    const result = await syncClientRollups(supabase, cookieHeader, clientKey, rangeStart, rangeEnd);
    summary.push(result);
    console.log(JSON.stringify(result, null, 2));
  }

  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
