import type { VercelRequest, VercelResponse } from "@vercel/node";
import fs from "node:fs";
import path from "node:path";

type Visit = Record<string, any>;

const DEFAULT_API_BASE = "https://api.displayforce.ai";
const VISITORS_ENDPOINT = "/public/v1/stats/visitor/list";
const DEVICES_ENDPOINT = "/public/v1/device/list";

const POINTS = [
  { id: "caixa", name: "Caixa", match: ["caixa", "cashier", "checkout"] },
  { id: "dashboard_cam", name: "Dashboard", match: ["dashboard"] },
  { id: "entrada_tunel", name: "Entrada Tunel", match: ["entrada tunel", "tunel entrada", "tunnel entrance"] },
];

function cors(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
}

function extractArray(json: any): any[] {
  if (Array.isArray(json)) return json;
  for (const key of ["payload", "data", "results", "items", "visitors", "records", "response", "list"]) {
    if (Array.isArray(json?.[key])) return json[key];
  }
  for (const key of ["items", "results", "visitors", "records"]) {
    if (Array.isArray(json?.data?.[key])) return json.data[key];
  }
  return [];
}

function extractTotal(json: any, fallback: number): number {
  for (const key of ["total", "count", "total_count", "recordsTotal"]) {
    const n = Number(json?.[key]);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  const nested = Number(json?.data?.total ?? json?.data?.count);
  return Number.isFinite(nested) && nested >= 0 ? nested : fallback;
}

async function postAllPages(base: string, path: string, token: string, bodyBase: any, pageSize = 1000, maxPages = 20): Promise<any[]> {
  const all: any[] = [];
  for (let page = 0, offset = 0; page < maxPages; page += 1) {
    const response = await fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "X-API-Token": token,
      },
      body: JSON.stringify({ ...bodyBase, limit: pageSize, offset }),
    });
    const text = await response.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    if (!response.ok) {
      throw new Error(`DisplayForce ${path} retornou ${response.status}: ${text.slice(0, 240)}`);
    }
    const pageItems = extractArray(json);
    all.push(...pageItems);
    const total = extractTotal(json, pageItems.length);
    if (pageItems.length < pageSize || all.length >= total || pageItems.length === 0) break;
    offset += pageSize;
  }
  return all;
}

function normalizeText(value: unknown): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function deviceName(device: any): string {
  return String(device?.name || device?.title || device?.label || device?.description || device?.id || "");
}

function buildDevicePointMap(devices: any[]) {
  const map = new Map<number, string>();
  for (const device of devices) {
    const id = Number(device?.id ?? device?.device_id ?? device?.deviceId);
    if (!Number.isFinite(id)) continue;
    const haystack = normalizeText([
      deviceName(device),
      device?.folder_name,
      device?.path,
      device?.address,
      device?.location,
    ].filter(Boolean).join(" "));
    const point = POINTS.find((p) => p.match.some((term) => haystack.includes(normalizeText(term))));
    if (point) map.set(id, point.id);
  }
  return map;
}

function visitDeviceIds(visit: Visit): number[] {
  const ids = new Set<number>();
  const push = (value: any) => {
    const n = Number(value);
    if (Number.isFinite(n)) ids.add(n);
  };
  if (Array.isArray(visit.devices)) visit.devices.forEach(push);
  for (const key of ["device", "device_id", "deviceId", "source_id", "camera_id"]) push(visit[key]);
  if (Array.isArray(visit.tracks)) {
    for (const track of visit.tracks) push(track?.device_id ?? track?.device ?? track?.deviceId);
  }
  return [...ids];
}

function normalizeGender(visit: Visit): "male" | "female" | "unknown" {
  const raw = visit.sex ?? visit.gender;
  if (typeof raw === "number") {
    if (raw === 1) return "male";
    if (raw === 2) return "female";
  }
  const value = normalizeText(raw);
  if (["male", "m", "masculino", "homem", "1"].includes(value)) return "male";
  if (["female", "f", "feminino", "mulher", "2"].includes(value)) return "female";
  return "unknown";
}

function pct(value: number, total: number) {
  return total > 0 ? Number(((value / total) * 100).toFixed(1)) : 0;
}

function localEnvValue(...keys: string[]) {
  for (const key of keys) {
    const value = process.env[key];
    if (value?.trim()) return value.trim();
  }

  try {
    const envPath = path.join(process.cwd(), ".env");
    const content = fs.readFileSync(envPath, "utf8");
    for (const key of keys) {
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = content.match(new RegExp(`^\\s*${escaped}\\s*=\\s*(.+)\\s*$`, "m"));
      const value = match?.[1]?.trim().replace(/^["']|["']$/g, "");
      if (value) return value;
    }
  } catch {
    // .env local e opcional; em producao vem de process.env.
  }

  return "";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method Not Allowed" });

  const token = localEnvValue("DISPLAYFORCE_LED_TOKEN", "DISPLAYFORCE_TOKEN", "VITE_DISPLAYFORCE_TOKEN");
  if (!token) return res.status(500).json({ error: "DISPLAYFORCE_LED_TOKEN ausente no ambiente" });

  const start = String(req.query.start || "");
  const end = String(req.query.end || "");
  if (!start || !end) return res.status(400).json({ error: "start e end sao obrigatorios em ISO string" });

  const base = String(process.env.DISPLAYFORCE_API_BASE || DEFAULT_API_BASE).replace(/\/$/, "");

  try {
    const [devices, visitors] = await Promise.all([
      postAllPages(base, DEVICES_ENDPOINT, token, { recursive: true }, 1000, 10).catch(() => []),
      postAllPages(base, VISITORS_ENDPOINT, token, { start, end, tracks: true }, 1000, 10),
    ]);

    const devicePointMap = buildDevicePointMap(devices);
    const pointVisitors = new Map(POINTS.map((p) => [p.id, new Set<string>()]));
    const allVisitors = new Set<string>();
    const genderCounts = { male: 0, female: 0, unknown: 0 };
    const seenGenderVisitors = new Set<string>();

    visitors.forEach((visit, index) => {
      const visitorId = String(visit?.visitor_id ?? visit?.session_id ?? `visit-${index}`);
      allVisitors.add(visitorId);
      if (!seenGenderVisitors.has(visitorId)) {
        genderCounts[normalizeGender(visit)] += 1;
        seenGenderVisitors.add(visitorId);
      }

      const ids = visitDeviceIds(visit);
      const matchedPointIds = [
        ...new Set(ids.map((id) => devicePointMap.get(id)).filter((pointId): pointId is string => Boolean(pointId))),
      ];
      matchedPointIds.forEach((pointId) => pointVisitors.get(pointId)?.add(visitorId));
    });

    const total = allVisitors.size || visitors.length;
    const points = POINTS.map((point) => ({
      id: point.id,
      name: point.name,
      visitors: pointVisitors.get(point.id)?.size || 0,
    }));
    const bestPoint = [...points].sort((a, b) => b.visitors - a.visitors)[0] || points[0];

    return res.status(200).json({
      total_visitors: total,
      points,
      peak_point: bestPoint,
      gender: {
        male: genderCounts.male,
        female: genderCounts.female,
        unknown: genderCounts.unknown,
        male_pct: pct(genderCounts.male, seenGenderVisitors.size),
        female_pct: pct(genderCounts.female, seenGenderVisitors.size),
      },
      raw_count: visitors.length,
      device_matches: Object.fromEntries(devicePointMap),
    });
  } catch (error: any) {
    console.error("[displayforce-led]", error?.message || error);
    return res.status(502).json({ error: "Erro ao consultar DisplayForce", details: error?.message || String(error) });
  }
}
