// Shared DisplayForce v5 helpers — usado por sync-analytics e cron-sync.
// Faz login multistep, mantém cookie em cache e expõe fetch da série de emoções.
// O cron-sync usa esse módulo para popular `expressions_hourly` no rollup com
// a distribuição completa (neutral/happiness/surprise/anger) por hora — algo
// que o /public/v1/stats/visitor/list não entrega (lá só vem `smile` booleano).

import { createClient } from "@supabase/supabase-js";

const _url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const _key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  "";

const supabase = createClient(_url, _key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DISPLAYFORCE_SESSION_TTL_MS = 30 * 60 * 1000; // 30 min
let displayforceSessionCache = null;
const platformCache = new Map();

function parseSetCookies(currentCookieHeader, response) {
  const setCookieHeader = response.headers.get("set-cookie") || "";
  if (!setCookieHeader) return currentCookieHeader;

  const map = new Map();
  if (currentCookieHeader) {
    for (const item of currentCookieHeader.split(";")) {
      const [k, v] = item.trim().split("=");
      if (k) map.set(k, v ?? "");
    }
  }
  for (const cookieStr of setCookieHeader.split(/,(?=[^;]+=)/g)) {
    const [first] = cookieStr.split(";");
    const [k, v] = (first || "").trim().split("=");
    if (k) map.set(k, v ?? "");
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function formatLocalTimeIso() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const tz = -d.getTimezoneOffset();
  const sign = tz >= 0 ? "+" : "-";
  const abs = Math.abs(tz);
  const hh = pad(Math.floor(abs / 60));
  const mm = pad(abs % 60);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${hh}:${mm}`
  );
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
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

export async function getDisplayforceAuthCookie() {
  if (displayforceSessionCache && displayforceSessionCache.expiresAt > Date.now()) {
    return displayforceSessionCache.cookieHeader;
  }

  const email = process.env.DISPLAYFORCE_EMAIL?.trim();
  const password = process.env.DISPLAYFORCE_PASS?.trim();
  if (!email || !password) {
    throw new Error("DISPLAYFORCE_EMAIL e DISPLAYFORCE_PASS nao estao configurados");
  }

  const baseHeaders = {
    Accept: "application/json,text/plain,*/*",
    "Content-Type": "application/json",
  };

  let cookieHeader = "";
  const apply = (response) => {
    cookieHeader = parseSetCookies(cookieHeader, response);
  };

  const start = await fetchJson("https://api.displayforce.ai/v5/auth/login/multi_step/start", {
    method: "POST",
    headers: baseHeaders,
  });
  apply(start.response);
  const sessionId = start.json?.session_id;
  if (!sessionId) throw new Error("Login DisplayForce sem session_id");

  const localTime = formatLocalTimeIso();
  const steps = [
    ["check_login", { session_id: sessionId, login: email, local_time: localTime }],
    ["commit_pwd", { session_id: sessionId, password, local_time: localTime }],
    ["finish", { session_id: sessionId }],
  ];

  for (const [step, body] of steps) {
    const result = await fetchJson(
      `https://api.displayforce.ai/v5/auth/login/multi_step/${step}`,
      {
        method: "POST",
        headers: { ...baseHeaders, ...(cookieHeader ? { Cookie: cookieHeader } : {}) },
        body: JSON.stringify(body),
      },
    );
    apply(result.response);
  }

  if (!cookieHeader.includes("refresh_token=")) {
    throw new Error("Login DisplayForce sem refresh_token");
  }

  displayforceSessionCache = {
    cookieHeader,
    expiresAt: Date.now() + DISPLAYFORCE_SESSION_TTL_MS,
  };

  return cookieHeader;
}

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildPlatformCandidates(values) {
  const candidates = new Set();
  for (const raw of values) {
    const trimmed = String(raw || "").trim();
    if (!trimmed) continue;
    const slug = slugify(trimmed);
    if (slug) candidates.add(slug);
    const compact = slug.replace(/-/g, "");
    if (compact) candidates.add(compact);
  }
  return [...candidates];
}

export async function resolveDisplayforcePlatform(clientId) {
  const cached = platformCache.get(clientId);
  if (cached !== undefined) return cached;

  const { data: client, error } = await supabase
    .from("clients")
    .select("name,company")
    .eq("id", clientId)
    .maybeSingle();

  if (error) {
    throw new Error(`Erro ao buscar cliente ${clientId}: ${error.message}`);
  }

  const candidates = buildPlatformCandidates([client?.name, client?.company]);
  if (candidates.length === 0) {
    platformCache.set(clientId, null);
    return null;
  }

  const cookieHeader = await getDisplayforceAuthCookie();
  for (const platformSlug of candidates) {
    try {
      const { json } = await fetchJson(
        `https://api.displayforce.ai/v5/platforms/${platformSlug}/summary`,
        {
          headers: {
            Accept: "application/json,text/plain,*/*",
            Cookie: cookieHeader,
          },
        },
      );
      const platformId = Number(json?.platform?.id);
      if (!Number.isFinite(platformId) || platformId <= 0) continue;

      const resolved = { platformId, platformSlug };
      platformCache.set(clientId, resolved);
      return resolved;
    } catch {
      continue;
    }
  }

  platformCache.set(clientId, null);
  return null;
}

function toUnixSeconds(value) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return 0;
  return Math.floor(ms / 1000);
}

function buildHourlyUnixRanges(rangeStart, rangeEnd) {
  const startMs = Date.parse(rangeStart);
  const endMs = Date.parse(rangeEnd);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];

  const buckets = [];
  let cursorMs = Math.floor(startMs / 3600000) * 3600000;
  while (cursorMs < endMs) {
    const nextMs = cursorMs + 3600000;
    const fromSec = Math.floor(cursorMs / 1000);
    const toSec = Math.floor(nextMs / 1000) - 1;
    if (toSec > fromSec) {
      const date = new Date(cursorMs);
      const hourKey = date.toISOString().slice(0, 13);
      buckets.push({ hourKey, from: fromSec, to: toSec });
    }
    cursorMs = nextMs;
  }
  return buckets;
}

/**
 * Busca a série hourly de emoções (neutral/happiness/surprise/anger) na API v5.
 * Retorna no formato esperado por `attributes_percent.expressions_hourly`:
 *   { "YYYY-MM-DDTHH": { neutral, happiness, surprise, anger } }
 *
 * Se cliente não tiver platform mapeada ou range vazio, retorna null.
 */
export async function fetchFacialExpressionHourlyMap(clientId, rangeStart, rangeEnd) {
  const platform = await resolveDisplayforcePlatform(clientId);
  if (!platform) return null;

  const buckets = buildHourlyUnixRanges(rangeStart, rangeEnd);
  if (buckets.length === 0) return {};

  const cookieHeader = await getDisplayforceAuthCookie();
  const out = {};
  const chunkSize = 168; // 7 dias por chamada

  for (let i = 0; i < buckets.length; i += chunkSize) {
    const chunk = buckets.slice(i, i + chunkSize);
    const { json } = await fetchJson(
      `https://api.displayforce.ai/v5/platforms/${platform.platformId}/stats/visitor_view/emotion`,
      {
        method: "POST",
        headers: {
          Accept: "application/json,text/plain,*/*",
          "Content-Type": "application/json",
          Cookie: cookieHeader,
        },
        body: JSON.stringify({
          ranges: chunk.map(({ from, to }) => ({ from, to })),
          finetuning: false,
        }),
      },
    );

    const apiRanges = Array.isArray(json?.ranges) ? json.ranges : [];
    chunk.forEach((bucket, index) => {
      const source = apiRanges[index] ?? {};
      const neutral = Number(source?.neutral ?? 0) || 0;
      const happiness = Number(source?.happiness ?? 0) || 0;
      const surprise = Number(source?.surprise ?? 0) || 0;
      const anger = Number(source?.anger ?? 0) || 0;
      // Só registra hours com algum dado — evita bagunçar o rollup com horas vazias
      if (neutral + happiness + surprise + anger > 0) {
        out[bucket.hourKey] = { neutral, happiness, surprise, anger };
      }
    });
  }

  return out;
}

/**
 * Soma os totais de cada emoção a partir do hourly map.
 */
export function totalsFromHourlyMap(hourlyMap) {
  const totals = { neutral: 0, happiness: 0, surprise: 0, anger: 0 };
  if (!hourlyMap || typeof hourlyMap !== "object") return totals;

  for (const counts of Object.values(hourlyMap)) {
    if (!counts || typeof counts !== "object") continue;
    for (const key of ["neutral", "happiness", "surprise", "anger"]) {
      totals[key] += Number(counts[key] ?? 0) || 0;
    }
  }
  return totals;
}

/**
 * Converte totais em percentuais (com 2 casas decimais).
 */
export function percentFromTotals(totals) {
  const sum = Object.values(totals).reduce((acc, v) => acc + (Number(v) || 0), 0);
  if (sum <= 0) return {};
  const out = {};
  for (const [k, v] of Object.entries(totals)) {
    out[k] = Number((((Number(v) || 0) / sum) * 100).toFixed(2));
  }
  return out;
}
