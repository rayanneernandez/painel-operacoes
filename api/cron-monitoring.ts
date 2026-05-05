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

function buildOrigin(req: VercelRequest) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").trim();
  const forwardedHost = String(req.headers["x-forwarded-host"] || "").trim();
  const host = forwardedHost || String(req.headers.host || process.env.VERCEL_URL || "").trim();
  const protocol = forwardedProto || (host.includes("localhost") ? "http" : "https");

  if (!host) {
    throw new Error("Nao foi possivel determinar a URL base do projeto");
  }

  return host.startsWith("http") ? host : `${protocol}://${host}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const authHeader = req.headers.authorization;
  const providedAuth =
    typeof authHeader === "string" && authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : (req.query?.auth as string);

  const validKeys = ["painel@2026*", process.env.CRON_SECRET].filter(Boolean);
  if (providedAuth && !validKeys.includes(providedAuth)) {
    return res.status(401).json({ error: "Nao autorizado" });
  }

  try {
    const origin = buildOrigin(req);
    const startedAt = Date.now();

    const { data: configs, error } = await supabase
      .from("client_api_configs")
      .select("client_id, api_key, custom_header_key, custom_header_value");

    if (error) {
      return res.status(500).json({
        error: "Erro ao buscar configuracoes de cliente",
        details: error.message,
      });
    }

    const activeConfigs = (configs || []).filter(
      (cfg: any) =>
        String(cfg?.api_key || "").trim() ||
        (String(cfg?.custom_header_key || "").trim() &&
          String(cfg?.custom_header_value || "").trim())
    );

    const results = [];

    for (const cfg of activeConfigs) {
      if (Date.now() - startedAt > 55_000) {
        results.push({
          client_id: cfg.client_id,
          skipped: true,
          reason: "time-budget",
        });
        break;
      }

      try {
        const response = await fetch(`${origin}/api/sync-analytics`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: cfg.client_id,
            sync_stores: true,
          }),
        });

        const payload = await response.json().catch(() => null);
        results.push({
          client_id: cfg.client_id,
          ok: response.ok,
          status: response.status,
          payload,
        });
      } catch (requestError: any) {
        results.push({
          client_id: cfg.client_id,
          ok: false,
          error: requestError?.message || "Falha ao disparar sync_stores",
        });
      }
    }

    return res.status(200).json({
      ok: true,
      ran_at: new Date().toISOString(),
      synced_clients: results.length,
      results,
      duration_ms: Date.now() - startedAt,
    });
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      error: error?.message || "Erro inesperado no cron de monitoramento",
    });
  }
}
