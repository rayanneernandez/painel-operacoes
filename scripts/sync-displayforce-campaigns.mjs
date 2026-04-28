import fs from "fs";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_ENV_FILES = [
  ".env",
  ".env.local",
  ".env.production.local",
];

const DEFAULT_API_BASE = "https://api.displayforce.ai";
const DEFAULT_FOLDER_ENDPOINT = "/public/v1/device-folder/list";
const DEFAULT_DEVICE_ENDPOINT = "/public/v1/device/list";
const DEFAULT_CAMPAIGN_ENDPOINT = "/public/v1/campaign/list";
const DEFAULT_CONTENT_ENDPOINT = "/public/v1/content/list";
const DEFAULT_SHOWS_ENDPOINT = "/public/v1/stats/content-show/list";
const DEFAULT_VISITORS_ENDPOINT = "/public/v1/stats/visitor/list";
const DEFAULT_DAYS = 120;

function getArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

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
      }),
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
    merged[name] = stripWrappingQuotes(rawValue);
  }

  return merged;
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
      console.warn(`[campaign-sync] ${label} attempt ${attempt}/${retries} falhou: ${message}`);
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

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}

function extractArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  return payload.data || payload.items || payload.payload || payload.results || [];
}

function extractTotal(payload, fallbackLength) {
  const candidate = Number(
    payload?.pagination?.total
    ?? payload?.pagination?.count
    ?? payload?.total
    ?? payload?.count
    ?? payload?.meta?.total
    ?? fallbackLength,
  );
  return Number.isFinite(candidate) ? candidate : fallbackLength;
}

function formatUtcDateTime(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function parseDateArg(value, endOfDay = false) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error(`Data invalida: ${raw}. Use o formato YYYY-MM-DD.`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  return endOfDay
    ? new Date(Date.UTC(year, month, day, 23, 59, 59, 999))
    : new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
}

function startOfUtcDay(dateLike) {
  const d = new Date(dateLike);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

function endOfUtcDay(dateLike) {
  const d = new Date(dateLike);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}

function calcDuration(startValue, endValue) {
  const startMs = Date.parse(startValue || "");
  const endMs = Date.parse(endValue || "");
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return { duration_days: null, duration_hms: null };
  }
  const totalSeconds = Math.max(0, Math.round((endMs - startMs) / 1000));
  const hh = Math.floor(totalSeconds / 3600);
  const mm = Math.floor((totalSeconds % 3600) / 60);
  const ss = totalSeconds % 60;
  return {
    duration_days: Number((totalSeconds / 86400).toFixed(2)),
    duration_hms: `${hh}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`,
  };
}

function cleanContentName(raw) {
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

function mapCampaignStatus(campaign, nowIso) {
  const status = String(campaign?.status || "").trim().toLowerCase();
  const archived = campaign?.archived === true;
  const startMs = Date.parse(campaign?.start_at || "");
  const endMs = Date.parse(campaign?.end_at || "");
  const nowMs = Date.parse(nowIso);

  if (archived) return "Encerrada";
  if (status === "active") return "Ativa";
  if (status === "planned" || status === "draft") return "Agendada";
  if (status === "paused" || status === "stopped" || status === "finished") return "Encerrada";
  if (Number.isFinite(startMs) && startMs > nowMs) return "Agendada";
  if (Number.isFinite(endMs) && endMs < nowMs) return "Encerrada";
  return "Ativa";
}

function campaignIsRelevant(campaign, rangeStartMs, rangeEndMs) {
  const status = String(campaign?.status || "").trim().toLowerCase();
  if (campaign?.archived === true) {
    const updatedMs = Date.parse(campaign?.updated_at || "");
    return Number.isFinite(updatedMs) && updatedMs >= rangeStartMs;
  }

  if (status === "active" || status === "planned" || status === "draft") return true;

  const startMs = Date.parse(campaign?.start_at || "");
  const endMs = Date.parse(campaign?.end_at || "");
  const updatedMs = Date.parse(campaign?.updated_at || "");

  if (Number.isFinite(updatedMs) && updatedMs >= rangeStartMs) return true;
  if (Number.isFinite(startMs) && Number.isFinite(endMs)) {
    return endMs >= rangeStartMs && startMs <= rangeEndMs;
  }
  if (Number.isFinite(endMs) && endMs >= rangeStartMs) return true;
  if (Number.isFinite(startMs) && startMs <= rangeEndMs) return true;
  return false;
}

function getApiBase(cfg) {
  return String(cfg?.api_endpoint || DEFAULT_API_BASE).replace(/\/$/, "");
}

function endpointOrDefault(value, fallback) {
  const raw = String(value || fallback || "").trim();
  if (!raw) return fallback;
  return raw.startsWith("/") ? raw : `/${raw}`;
}

function buildHeaders(cfg) {
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  const customKey = String(cfg?.custom_header_key || "").trim();
  const customValue = String(cfg?.custom_header_value || "").trim();
  const apiKey = String(cfg?.api_key || "").trim();

  if (customKey && customValue) {
    headers[customKey] = customValue;
  } else if (apiKey) {
    headers["X-API-Token"] = apiKey;
  } else {
    throw new Error(`Cliente ${cfg?.client_id} sem credencial de API configurada`);
  }

  return headers;
}

async function fetchJson(url, init, label) {
  return withRetry(label, async () => {
    const response = await fetch(url, init);
    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : null;
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    if (!response.ok) {
      const error = new Error(`${response.status} ${response.statusText} @ ${url}: ${text.slice(0, 400)}`);
      if ((response.status === 429 || response.status >= 500) && Number.isFinite(retryAfterMs)) {
        error.retryAfterMs = retryAfterMs;
      }
      throw error;
    }

    return json;
  });
}

async function fetchAllPages(url, headers, bodyBase, label, pageSize = 1000) {
  const items = [];
  let offset = 0;

  while (true) {
    const body = { ...bodyBase, limit: pageSize, offset };
    const payload = await fetchJson(
      url,
      {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      },
      `${label} offset=${offset}`,
    );

    const page = extractArray(payload);
    items.push(...page);
    const total = extractTotal(payload, page.length);
    if (page.length < pageSize || items.length >= total || page.length === 0) break;
    offset += pageSize;
    await sleep(120);
  }

  return items;
}

async function fetchFolderList(base, headers, cfg) {
  const primaryUrl = `${base}${endpointOrDefault(cfg?.folder_endpoint, DEFAULT_FOLDER_ENDPOINT)}`;
  const fallbackUrl = `${base}/public/v1/folder/list`;

  try {
    return await fetchAllPages(primaryUrl, headers, { recursive: true }, "folders", 1000);
  } catch (error) {
    console.warn(`[campaign-sync] folder endpoint principal falhou, tentando fallback: ${error?.message || error}`);
    return fetchAllPages(fallbackUrl, headers, { recursive: true }, "folders-fallback", 1000);
  }
}

function deriveDeviceStoreName(deviceName, folderName) {
  const cleanDeviceName = String(deviceName || "").trim();
  if (folderName) {
    const prefix = `${folderName} - `;
    if (cleanDeviceName.startsWith(prefix)) {
      return { loja: folderName, tipo_midia: cleanDeviceName.slice(prefix.length).trim() || "—" };
    }
  }

  if (cleanDeviceName.includes(" - ")) {
    const [loja, ...rest] = cleanDeviceName.split(" - ");
    return {
      loja: String(folderName || loja).trim() || "—",
      tipo_midia: rest.join(" - ").trim() || "—",
    };
  }

  return {
    loja: String(folderName || cleanDeviceName || "—").trim() || "—",
    tipo_midia: "—",
  };
}

function buildDeviceMap(folders, devices, clientId) {
  const folderById = new Map(
    folders
      .filter((folder) => folder?.id != null)
      .map((folder) => [Number(folder.id), folder]),
  );

  const deviceMap = new Map();
  for (const device of devices) {
    const deviceId = Number(device?.id);
    if (!Number.isFinite(deviceId)) continue;
    const parentId = Number(device?.parent_id);
    const folder = Number.isFinite(parentId) ? folderById.get(parentId) : null;
    const derived = deriveDeviceStoreName(device?.name, folder?.name);
    deviceMap.set(deviceId, {
      client_id: clientId,
      loja: derived.loja,
      tipo_midia: derived.tipo_midia,
      name: String(device?.name || "").trim() || `Device ${deviceId}`,
      external_id: deviceId,
    });
  }
  return deviceMap;
}

function allocateVisitors(totalVisitors, rowWeights) {
  if (!Array.isArray(rowWeights) || rowWeights.length === 0) return [];
  const safeTotal = Math.max(0, Math.round(Number(totalVisitors) || 0));
  if (safeTotal === 0) return rowWeights.map(() => 0);

  const normalizedWeights = rowWeights.map((weight) => Math.max(0, Number(weight) || 0));
  const fallbackWeights = normalizedWeights.every((weight) => weight === 0)
    ? normalizedWeights.map(() => 1)
    : normalizedWeights;
  const sumWeights = fallbackWeights.reduce((acc, weight) => acc + weight, 0) || fallbackWeights.length;

  const rawShares = fallbackWeights.map((weight) => (safeTotal * weight) / sumWeights);
  const baseShares = rawShares.map((share) => Math.floor(share));
  let remaining = safeTotal - baseShares.reduce((acc, share) => acc + share, 0);

  const fractions = rawShares
    .map((share, index) => ({ index, fraction: share - Math.floor(share) }))
    .sort((a, b) => b.fraction - a.fraction);

  for (let i = 0; i < fractions.length && remaining > 0; i += 1) {
    baseShares[fractions[i].index] += 1;
    remaining -= 1;
  }

  return baseShares;
}

async function mapBatches(items, batchSize, worker) {
  const results = [];
  for (const batch of chunk(items, batchSize)) {
    const page = await Promise.all(batch.map(worker));
    results.push(...page);
  }
  return results;
}

async function loadTargets(supabase, requestedClientKeys) {
  const { data: clients, error: clientsError } = await supabase
    .from("clients")
    .select("id,name,status");
  if (clientsError) throw clientsError;

  const clientRows = (clients || [])
    .filter((client) => client?.id && client?.name)
    .map((client) => ({
      id: String(client.id),
      name: String(client.name),
      status: String(client.status || ""),
      key: slugify(client.name),
    }));

  const { data: apiConfigs, error: apiConfigsError } = await supabase
    .from("client_api_configs")
    .select("*");
  if (apiConfigsError) throw apiConfigsError;

  const configByClientId = new Map(
    (apiConfigs || [])
      .filter((cfg) => cfg?.client_id)
      .map((cfg) => [String(cfg.client_id), cfg]),
  );

  const requestedKeys = requestedClientKeys.length > 0
    ? new Set(requestedClientKeys.map((value) => slugify(value)))
    : null;

  const activeLike = new Set(["active", "ativo"]);
  const filteredClients = clientRows.filter((client) => {
    if (!configByClientId.has(client.id)) return false;
    if (requestedKeys) return requestedKeys.has(client.key);
    return activeLike.has(client.status.toLowerCase()) || clientRows.length <= 3;
  });

  return filteredClients.map((client) => ({
    client,
    cfg: configByClientId.get(client.id),
  }));
}

async function fetchRelevantCampaigns(base, headers, rangeStartIso, rangeEndIso) {
  const allCampaigns = await fetchAllPages(
    `${base}${DEFAULT_CAMPAIGN_ENDPOINT}`,
    headers,
    {},
    "campaigns",
    1000,
  );

  const rangeStartMs = Date.parse(rangeStartIso);
  const rangeEndMs = Date.parse(rangeEndIso);
  return allCampaigns.filter((campaign) => campaignIsRelevant(campaign, rangeStartMs, rangeEndMs));
}

async function fetchContentMapForCampaigns(base, headers, campaigns) {
  const contentByCampaign = new Map();
  const contentById = new Map();

  await mapBatches(campaigns, 4, async (campaign) => {
    const campaignId = Number(campaign?.id);
    if (!Number.isFinite(campaignId)) return null;
    const contents = await fetchAllPages(
      `${base}${DEFAULT_CONTENT_ENDPOINT}`,
      headers,
      { campaign_ids: [campaignId] },
      `content campaign=${campaignId}`,
      1000,
    );

    const deduped = [];
    const seen = new Set();
    for (const content of contents) {
      const contentId = Number(content?.id);
      if (!Number.isFinite(contentId) || seen.has(contentId)) continue;
      seen.add(contentId);
      deduped.push(content);
      contentById.set(contentId, content);
    }
    contentByCampaign.set(campaignId, deduped);
    await sleep(80);
    return null;
  });

  return { contentByCampaign, contentById };
}

async function fetchShowsAggregate(base, headers, rangeStartIso, rangeEndIso, contentIds, showsEndpoint) {
  const showAgg = new Map();

  for (const idsChunk of chunk(contentIds, 100)) {
    const shows = await fetchAllPages(
      `${base}${showsEndpoint}`,
      headers,
      { start: rangeStartIso, end: rangeEndIso, content: idsChunk },
      `shows content_chunk=${idsChunk[0]}-${idsChunk[idsChunk.length - 1]}`,
      10000,
    );

    for (const show of shows) {
      const campaignId = Number(show?.campaign_id);
      const contentId = Number(show?.content_id);
      const deviceId = Number(show?.device_id);
      if (!Number.isFinite(campaignId) || !Number.isFinite(contentId) || !Number.isFinite(deviceId)) continue;
      const key = `${campaignId}||${contentId}||${deviceId}`;
      const current = showAgg.get(key) || { count: 0, minStart: null, maxEnd: null };
      current.count += 1;
      const start = formatUtcDateTime(show?.start);
      const end = formatUtcDateTime(show?.end);
      if (start && (!current.minStart || start < current.minStart)) current.minStart = start;
      if (end && (!current.maxEnd || end > current.maxEnd)) current.maxEnd = end;
      showAgg.set(key, current);
    }

    await sleep(120);
  }

  return showAgg;
}

async function fetchVisitorAggregate(base, headers, rangeStartIso, rangeEndIso, campaignIds, visitorsEndpoint) {
  const visitorAgg = new Map();

  for (const idsChunk of chunk(campaignIds, 25)) {
    const visits = await fetchAllPages(
      `${base}${visitorsEndpoint}`,
      headers,
      { start: rangeStartIso, end: rangeEndIso, campaigns: idsChunk },
      `visitors campaign_chunk=${idsChunk[0]}-${idsChunk[idsChunk.length - 1]}`,
      1000,
    );

    for (const visit of visits) {
      const visitorId = String(visit?.visitor_id || "").trim();
      if (!visitorId) continue;
      const campaignsInVisit = Array.isArray(visit?.campaigns) ? visit.campaigns.map(Number).filter(Number.isFinite) : [];
      const devicesInVisit = Array.isArray(visit?.devices) ? visit.devices.map(Number).filter(Number.isFinite) : [];
      const attention = Math.max(0, Math.round(Number(visit?.tracks_duration) || 0));
      for (const campaignId of campaignsInVisit) {
        for (const deviceId of devicesInVisit) {
          const key = `${campaignId}||${deviceId}`;
          const current = visitorAgg.get(key) || { visitorIds: new Set(), attentionSum: 0, attentionCount: 0 };
          current.visitorIds.add(visitorId);
          current.attentionSum += attention;
          current.attentionCount += 1;
          visitorAgg.set(key, current);
        }
      }
    }

    await sleep(120);
  }

  return visitorAgg;
}

function buildCampaignRows({
  clientId,
  campaigns,
  contentByCampaign,
  deviceMap,
  showAgg,
  visitorAgg,
  nowIso,
}) {
  const rows = [];
  const campaignNames = new Set();

  for (const campaign of campaigns) {
    const campaignId = Number(campaign?.id);
    if (!Number.isFinite(campaignId)) continue;

    const campaignName = String(campaign?.name || "").trim() || `Campaign ${campaignId}`;
    const mappedStatus = mapCampaignStatus(campaign, nowIso);
    const contents = contentByCampaign.get(campaignId) || [];
    const contentItems = contents.length > 0 ? contents : [null];

    const deviceIdSet = new Set();
    for (const deviceId of Array.isArray(campaign?.devices) ? campaign.devices : []) {
      const numeric = Number(deviceId);
      if (Number.isFinite(numeric)) deviceIdSet.add(numeric);
    }
    for (const key of showAgg.keys()) {
      const [showCampaignId, , showDeviceId] = key.split("||").map(Number);
      if (showCampaignId === campaignId && Number.isFinite(showDeviceId)) deviceIdSet.add(showDeviceId);
    }
    for (const key of visitorAgg.keys()) {
      const [visitorCampaignId, visitorDeviceId] = key.split("||").map(Number);
      if (visitorCampaignId === campaignId && Number.isFinite(visitorDeviceId)) deviceIdSet.add(visitorDeviceId);
    }

    const deviceIds = deviceIdSet.size > 0 ? [...deviceIdSet] : [null];
    campaignNames.add(campaignName);

    for (const deviceId of deviceIds) {
      const deviceMeta = Number.isFinite(deviceId) ? deviceMap.get(deviceId) : null;
      const storeName = deviceMeta?.loja || "—";
      const mediaType = deviceMeta?.tipo_midia || "—";
      const visitorKey = Number.isFinite(deviceId) ? `${campaignId}||${deviceId}` : null;
      const visitorMeta = visitorKey ? visitorAgg.get(visitorKey) : null;
      const totalVisitors = visitorMeta?.visitorIds?.size || 0;
      const avgAttention = visitorMeta?.attentionCount
        ? Math.round(visitorMeta.attentionSum / visitorMeta.attentionCount)
        : 0;

      const rowDrafts = contentItems.map((content) => {
        const contentId = Number(content?.id);
        const showKey = Number.isFinite(deviceId) && Number.isFinite(contentId)
          ? `${campaignId}||${contentId}||${deviceId}`
          : null;
        const showMeta = showKey ? showAgg.get(showKey) : null;
        const cleanedContent = cleanContentName(content?.name);
        const label = cleanedContent || cleanContentName(campaignName) || campaignName;
        return {
          campaignName,
          contentLabel: label,
          contentRawName: String(content?.name || campaignName || "").trim() || campaignName,
          storeName,
          mediaType,
          displayCount: Number(showMeta?.count || 0),
          firstSeenAt: showMeta?.minStart || formatUtcDateTime(campaign?.start_at) || nowIso,
          lastSeenAt: showMeta?.maxEnd || formatUtcDateTime(campaign?.updated_at) || formatUtcDateTime(campaign?.end_at) || nowIso,
          status: mappedStatus,
        };
      });

      const allocatedVisitors = allocateVisitors(totalVisitors, rowDrafts.map((row) => row.displayCount));
      rowDrafts.forEach((draft, index) => {
        const startDate = draft.firstSeenAt || formatUtcDateTime(campaign?.start_at) || nowIso;
        const endDate = draft.lastSeenAt
          || formatUtcDateTime(campaign?.end_at)
          || (draft.status === "Ativa" ? nowIso : nowIso);
        const { duration_days, duration_hms } = calcDuration(startDate, endDate);
        rows.push({
          id: crypto.randomUUID(),
          client_id: clientId,
          name: draft.campaignName,
          content_name: draft.contentLabel || draft.campaignName,
          tipo_midia: draft.mediaType,
          loja: draft.storeName,
          start_date: startDate,
          end_date: endDate,
          duration_days,
          duration_hms,
          display_count: draft.displayCount,
          visitors: allocatedVisitors[index] || 0,
          avg_attention_sec: avgAttention,
          uploaded_at: nowIso,
          status: draft.status,
          first_seen_at: draft.firstSeenAt || startDate,
          last_seen_at: draft.lastSeenAt || endDate,
        });
      });
    }
  }

  return {
    rows,
    campaignNames: [...campaignNames],
  };
}

async function deleteExistingCampaignSnapshots(supabase, clientId, campaignNames) {
  for (const namesChunk of chunk(campaignNames.filter(Boolean), 100)) {
    const { error } = await supabase
      .from("campaigns")
      .delete()
      .eq("client_id", clientId)
      .in("name", namesChunk);
    if (error) throw error;
  }
}

async function insertCampaignRows(supabase, rows) {
  for (const rowsChunk of chunk(rows, 500)) {
    const { error } = await supabase
      .from("campaigns")
      .upsert(rowsChunk, { onConflict: "id" });
    if (error) throw error;
  }
}

async function syncClientCampaigns(supabase, target, options) {
  const nowIso = new Date().toISOString();
  const base = getApiBase(target.cfg);
  const headers = buildHeaders(target.cfg);
  const rangeStartIso = options.startIso;
  const rangeEndIso = options.endIso;
  const folderEndpoint = endpointOrDefault(target.cfg?.folder_endpoint, DEFAULT_FOLDER_ENDPOINT);
  const deviceEndpoint = endpointOrDefault(target.cfg?.device_endpoint, DEFAULT_DEVICE_ENDPOINT);
  const visitorsEndpoint = endpointOrDefault(target.cfg?.analytics_endpoint, DEFAULT_VISITORS_ENDPOINT);
  const showsEndpoint = endpointOrDefault(target.cfg?.shows_endpoint, DEFAULT_SHOWS_ENDPOINT);

  console.log(`[campaign-sync] ${target.client.name}: carregando catálogos`);
  const folders = await fetchFolderList(base, headers, { folder_endpoint: folderEndpoint });
  const devices = await fetchAllPages(
    `${base}${deviceEndpoint}`,
    headers,
    { recursive: true },
    `${target.client.key}-devices`,
    1000,
  );
  const deviceMap = buildDeviceMap(folders, devices, target.client.id);

  const campaigns = await fetchRelevantCampaigns(base, headers, rangeStartIso, rangeEndIso);
  console.log(`[campaign-sync] ${target.client.name}: ${campaigns.length} campanhas relevantes no período`);
  if (campaigns.length === 0) {
    return { client: target.client.key, deleted: 0, inserted: 0, campaigns: 0 };
  }

  const { contentByCampaign, contentById } = await fetchContentMapForCampaigns(base, headers, campaigns);
  const contentIds = [...contentById.keys()];
  const campaignIds = campaigns.map((campaign) => Number(campaign.id)).filter(Number.isFinite);

  const showAgg = contentIds.length > 0
    ? await fetchShowsAggregate(base, headers, rangeStartIso, rangeEndIso, contentIds, showsEndpoint)
    : new Map();
  const visitorAgg = campaignIds.length > 0
    ? await fetchVisitorAggregate(base, headers, rangeStartIso, rangeEndIso, campaignIds, visitorsEndpoint)
    : new Map();

  const built = buildCampaignRows({
    clientId: target.client.id,
    campaigns,
    contentByCampaign,
    deviceMap,
    showAgg,
    visitorAgg,
    nowIso,
  });

  await deleteExistingCampaignSnapshots(supabase, target.client.id, built.campaignNames);
  if (built.rows.length > 0) {
    await insertCampaignRows(supabase, built.rows);
  }

  return {
    client: target.client.key,
    deleted: built.campaignNames.length,
    inserted: built.rows.length,
    campaigns: campaigns.length,
    contents: contentIds.length,
    shows: showAgg.size,
  };
}

async function main() {
  if (hasFlag("help")) {
    console.log("Uso:");
    console.log("  node scripts/sync-displayforce-campaigns.mjs");
    console.log("  node scripts/sync-displayforce-campaigns.mjs --days=180");
    console.log("  node scripts/sync-displayforce-campaigns.mjs --start=2026-04-01 --end=2026-04-30");
    console.log("  node scripts/sync-displayforce-campaigns.mjs --clients=panvel,assai");
    console.log("  node scripts/sync-displayforce-campaigns.mjs --env-file=.env.production.local");
    process.exit(0);
  }

  const env = loadEnv();
  const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY precisam estar configurados");
  }

  const days = Math.max(1, Number(getArg("days", DEFAULT_DAYS)) || DEFAULT_DAYS);
  const startArg = getArg("start", null);
  const endArg = getArg("end", null);
  const requestedClients = String(getArg("clients", ""))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const parsedStart = parseDateArg(startArg, false);
  const parsedEnd = parseDateArg(endArg, true);
  if ((parsedStart && !parsedEnd) || (!parsedStart && parsedEnd)) {
    throw new Error("Use --start e --end juntos para um backfill exato.");
  }

  const rangeEnd = parsedEnd || endOfUtcDay(new Date());
  const rangeStart = parsedStart || startOfUtcDay(new Date(Date.now() - (days - 1) * 86400000));
  if (rangeStart > rangeEnd) {
    throw new Error("O inicio nao pode ser maior que o fim.");
  }
  const startIso = formatUtcDateTime(rangeStart);
  const endIso = formatUtcDateTime(rangeEnd);

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const targets = await loadTargets(supabase, requestedClients);
  if (targets.length === 0) {
    throw new Error("Nenhum cliente com API configurada foi encontrado para sincronizar");
  }

  console.log(`[campaign-sync] período de snapshot: ${startIso} → ${endIso}`);
  console.log(`[campaign-sync] clientes: ${targets.map((target) => target.client.name).join(", ")}`);

  const results = [];
  for (const target of targets) {
    results.push(await syncClientCampaigns(supabase, target, { startIso, endIso }));
    await sleep(250);
  }

  console.log(JSON.stringify({ ok: true, range: { start: startIso, end: endIso }, results }, null, 2));
}

main().catch((error) => {
  console.error("[campaign-sync] falha:", error?.message || error);
  if (error?.stack) console.error(error.stack);
  if (error?.cause) console.error("[campaign-sync] causa:", error.cause);
  process.exit(1);
});
