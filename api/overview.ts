import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  "";

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const VALID_TOKENS = ["painel@2026*", process.env.OVERVIEW_TOKEN].filter(Boolean);

function formatDuration(fromIso: string, toIso?: string | null): string {
  const from = new Date(fromIso).getTime();
  const to = toIso ? new Date(toIso).getTime() : Date.now();
  const totalMinutes = Math.max(0, Math.floor((to - from) / 60_000));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function fmtDateBR(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method Not Allowed" });

  // ── Auth ──────────────────────────────────────────────────────────────────
  const authHeader = req.headers.authorization;
  const tokenFromHeader =
    typeof authHeader === "string" && authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : null;
  const tokenFromQuery = req.query?.token as string | undefined;
  const providedToken = tokenFromHeader || tokenFromQuery;

  if (VALID_TOKENS.length > 0 && (!providedToken || !VALID_TOKENS.includes(providedToken))) {
    return res.status(401).json({
      error: "Nao autorizado. Informe o token via 'Authorization: Bearer <token>' ou '?token=<token>'",
    });
  }

  // ── Parâmetros ────────────────────────────────────────────────────────────
  // ?days=7   → janela do histórico de quedas (padrão 7 dias)
  // ?client=assai → filtra por nome de cliente (parcial, case-insensitive)
  const historyDays = Math.min(90, Math.max(1, parseInt(String(req.query?.days || "7"), 10) || 7));
  const clientFilter = String(req.query?.client || "").toLowerCase().trim();

  try {
    const now = new Date();
    const historyFrom = new Date(now.getTime() - historyDays * 24 * 60 * 60 * 1000).toISOString();

    // 1. Clientes
    let clientsQuery = supabase.from("clients").select("id, name").order("name");
    const { data: clients, error: clientsError } = await clientsQuery;
    if (clientsError) throw new Error(`Erro ao buscar clientes: ${clientsError.message}`);

    const filteredClients = clientFilter
      ? (clients || []).filter((c: any) => String(c.name || "").toLowerCase().includes(clientFilter))
      : (clients || []);

    const networks = [];

    for (const client of filteredClients) {
      const clientId = String(client.id);
      const clientName = String(client.name || clientId);

      // 2. Lojas
      const { data: stores } = await supabase
        .from("stores")
        .select("id, name, city")
        .eq("client_id", clientId)
        .order("name");

      const storeIds = (stores || []).map((s: any) => String(s.id));
      if (storeIds.length === 0) continue;

      // 3. Devices (dedup por MAC)
      const { data: devices } = await supabase
        .from("devices")
        .select("id, name, mac_address, status, store_id")
        .in("store_id", storeIds);

      const macMap = new Map<string, any>();
      for (const d of devices || []) {
        const key = d.mac_address ? `mac:${d.mac_address}` : `id:${d.id}`;
        const prev = macMap.get(key);
        if (!prev) { macMap.set(key, d); continue; }
        const p = (s: string) => s === "offline" ? 3 : s === "not_connected" ? 2 : 1;
        if (p(d.status) > p(prev.status)) macMap.set(key, d);
      }
      const dedupedDevices = [...macMap.values()];

      const total        = dedupedDevices.length;
      const onlineCount  = dedupedDevices.filter((d) => d.status === "online").length;
      const offlineCount = dedupedDevices.filter((d) => d.status === "offline").length;
      const notConnCount = dedupedDevices.filter((d) => d.status === "not_connected").length;

      // 4. Lojas com breakdown
      const storeById: Record<string, any> = {};
      (stores || []).forEach((s: any) => { storeById[s.id] = s; });

      const storeMap = new Map<string, any>();
      for (const d of dedupedDevices) {
        const store = storeById[d.store_id];
        if (!store) continue;
        if (!storeMap.has(d.store_id))
          storeMap.set(d.store_id, { name: store.name, city: store.city || "", online: 0, offline: 0, not_connected: 0, total: 0 });
        const e = storeMap.get(d.store_id)!;
        e.total++;
        if (d.status === "online") e.online++;
        else if (d.status === "offline") e.offline++;
        else e.not_connected++;
      }
      const storeList = [...storeMap.values()]
        .sort((a, b) => b.offline - a.offline || a.name.localeCompare(b.name, "pt-BR"));

      // 5. Histórico de quedas (ativas + resolvidas dentro da janela)
      const { data: alerts } = await supabase
        .from("device_offline_alerts")
        .select("id, device_name, store_name, first_detected_at, last_seen_online_at, resolved_at")
        .eq("client_id", clientId)
        .or(`resolved_at.is.null,first_detected_at.gte.${historyFrom}`)
        .order("first_detected_at", { ascending: false })
        .limit(500);

      const offline_now: any[] = [];
      const history: any[] = [];

      for (const a of alerts || []) {
        const returnedAt = a.last_seen_online_at || a.resolved_at || null;
        const isActive = !a.resolved_at;

        const entry = {
          device_name:      a.device_name,
          store_name:       a.store_name || "",
          queda_detectada:  fmtDateBR(a.first_detected_at),
          queda_detectada_iso: a.first_detected_at,
          retorno_online:   returnedAt ? fmtDateBR(returnedAt) : null,
          retorno_online_iso: returnedAt || null,
          tempo_offline:    formatDuration(a.first_detected_at, returnedAt),
          status:           isActive ? "offline" : "resolvido",
        };

        if (isActive) offline_now.push(entry);
        else history.push(entry);
      }

      networks.push({
        client_id:   clientId,
        client_name: clientName,
        summary: {
          total,
          online:        onlineCount,
          offline:       offlineCount,
          not_connected: notConnCount,
        },
        stores: storeList,
        offline_agora: offline_now,
        historico_quedas: history,
      });
    }

    return res.status(200).json({
      ok: true,
      generated_at: now.toISOString(),
      generated_at_br: fmtDateBR(now.toISOString()),
      history_window_days: historyDays,
      networks,
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Erro interno" });
  }
}
