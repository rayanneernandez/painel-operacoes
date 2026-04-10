import fs from "fs";
import { createClient } from "@supabase/supabase-js";

const PANVEL_CLIENT_ID = "c6999bd9-14c0-4e26-abb1-d4b852d34421";
const PANVEL_PLATFORM_SLUG = "panvel";
const GENERIC_CONTENT_NAMES = new Set([
  "MEDICAMENTOS 1",
  "MEDICAMENTOS",
  "CASA",
  "CONVENIOS",
  "CUPONS",
  "DERMATIV",
  "MACKUP",
  "COLESTEROL",
]);

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
      }),
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
      }),
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
    throw new Error(`${response.status} ${response.statusText} @ ${url}: ${text.slice(0, 400)}`);
  }
  return { response, json };
}

async function loginDisplayforce(env, attempt = 1) {
  const headers = {
    Accept: "application/json,text/plain,*/*",
    "Content-Type": "application/json",
  };

  let cookieHeader = "";
  const applyCookie = (response) => {
    cookieHeader = parseSetCookies(cookieHeader, response);
  };

  try {
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
  } catch (error) {
    if (attempt >= 3) throw error;
    await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    return loginDisplayforce(env, attempt + 1);
  }
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

async function fetchAllCampaigns(cookieHeader, platformId) {
  const out = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const { json } = await jsonRequest(`https://api.displayforce.ai/v5/platforms/${platformId}/campaign/search`, {
      method: "POST",
      headers: {
        Accept: "application/json,text/plain,*/*",
        "Content-Type": "application/json",
        Cookie: cookieHeader,
      },
      body: JSON.stringify({ limit, offset }),
    });

    const page = json?.data || json?.items || [];
    out.push(...page);
    const total = Number(json?.pagination?.total ?? page.length);
    if (page.length < limit || out.length >= total) break;
    offset += limit;
  }

  return out;
}

async function fetchCampaignDetails(cookieHeader, platformId, campaignId) {
  const endpoints = [
    `https://api.displayforce.ai/v5/platforms/${platformId}/campaign/${campaignId}`,
    `https://api.displayforce.ai/v5/platforms/${platformId}/campaign/${campaignId}/contents`,
  ];

  for (const endpoint of endpoints) {
    try {
      const { json } = await jsonRequest(endpoint, {
        headers: {
          Accept: "application/json,text/plain,*/*",
          Cookie: cookieHeader,
        },
      });
      return json;
    } catch {
      // tenta próximo endpoint
    }
  }

  return null;
}

function cleanCampaignContentName(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  const months = "(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)";

  let name = value
    .replace(/\.mp4$/i, "")
    .replace(/\s*\(\d+\)\s*$/i, "")
    .replace(/\s*\([^)]*(?:vertical|horizontal|vert|horiz|ventical)[^)]*\)\s*$/i, "")
    .replace(/[_\s-]+v\d+\s*$/i, "")
    .replace(/[_\-\s]*\d{3,4}\s*[xX]\s*\d{3,4}.*$/i, "");

  name = name.replace(new RegExp(`[_\\-\\s]+\\d{1,2}${months}.*$`, "i"), "");

  return name
    .replace(/[_\-]{2,}/g, "-")
    .replace(/[\s_-]+$/g, "")
    .trim();
}

function chooseBestContentName(names) {
  const candidates = names
    .map((name) => cleanCampaignContentName(name))
    .filter(Boolean);

  if (candidates.length === 0) return null;

  const scored = candidates.map((name) => {
    let score = 0;
    if (/^panvel[-_]/i.test(name)) score += 40;
    if (!GENERIC_CONTENT_NAMES.has(name.toUpperCase())) score += 30;
    if (/(loreal|elseve|lilly|takeda|qdenga|colgate|elmex|nivea|mantecorp|fluimicil|naldecon|zambon|abbott|reclitt|reckitt|listerine|potinhos)/i.test(name)) score += 140;
    if (/(marketing|semana|economia|consumidor|medicamentos|vacina|anual|saude|saúde)/i.test(name)) score -= 50;
    if (GENERIC_CONTENT_NAMES.has(name.toUpperCase())) score -= 90;
    if (/[A-Za-z].*[_-].*[A-Za-z]/.test(name)) score += 10;
    score += Math.min(name.length, 60) / 10;
    return { name, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.name ?? null;
}

async function main() {
  const env = readEnvFile(".env");
  const supabase = createClient(env.SUPABASE_URL || env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const restBase = `${(env.SUPABASE_URL || env.VITE_SUPABASE_URL).replace(/\/$/, "")}/rest/v1/campaigns`;
  const restHeaders = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };

  const { data: rows, error } = await supabase
    .from("campaigns")
    .select("id,name,content_name,loja,tipo_midia")
    .eq("client_id", PANVEL_CLIENT_ID)
    .order("uploaded_at", { ascending: false });

  if (error) throw error;
  if (!rows?.length) {
    console.log("Nenhuma campanha Panvel sem content_name.");
    return;
  }

  const cookieHeader = await loginDisplayforce(env);
  const platformId = await fetchDisplayforceSummary(cookieHeader, PANVEL_PLATFORM_SLUG);
  const campaigns = await fetchAllCampaigns(cookieHeader, platformId);
  const byName = new Map();
  for (const campaign of campaigns) {
    const key = String(campaign?.name || "").trim().toLowerCase();
    if (!key) continue;
    const list = byName.get(key) || [];
    list.push(campaign);
    byName.set(key, list);
  }

  const detailsCache = new Map();
  const updates = [];

  for (const row of rows) {
    const key = String(row.name || "").trim().toLowerCase();
    const matches = byName.get(key) || [];
    let bestName = null;

    for (const match of matches) {
      const cacheKey = String(match.id);
      if (!detailsCache.has(cacheKey)) {
        detailsCache.set(cacheKey, await fetchCampaignDetails(cookieHeader, platformId, match.id));
      }
      const details = detailsCache.get(cacheKey);
      const rawNames = [
        ...(Array.isArray(details?.content) ? details.content.map((item) => item?.name) : []),
        ...(Array.isArray(details?.data) ? details.data.map((item) => item?.name) : []),
        ...(Array.isArray(details) ? details.map((item) => item?.name) : []),
      ].filter(Boolean);
      bestName = chooseBestContentName(rawNames);
      if (bestName) break;
    }

    if (!bestName) continue;
    if (String(row.content_name || "").trim() === bestName) continue;
    updates.push({ id: row.id, content_name: bestName });
  }

  if (!updates.length) {
    console.log("Nenhum content_name encontrado para atualizar.");
    return;
  }

  for (const update of updates) {
    const response = await fetch(`${restBase}?id=eq.${update.id}`, {
      method: "PATCH",
      headers: restHeaders,
      body: JSON.stringify({ content_name: update.content_name }),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Erro ao atualizar campanha ${update.id}: ${response.status} ${response.statusText} ${text.slice(0, 300)}`);
    }
  }

  console.log(JSON.stringify({
    updated: updates.length,
    sample: updates.slice(0, 10),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
