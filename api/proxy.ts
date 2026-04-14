/**
 * /api/proxy.ts — Proxy server-side para a API Displayforce
 *
 * Resolve o bloqueio de CORS: o browser nunca fala diretamente com
 * api.displayforce.ai, sempre passa por este endpoint Vercel que
 * faz a chamada de servidor para servidor (sem restrição de CORS).
 *
 * Body esperado (POST):
 *   {
 *     endpoint : string   // ex: "https://api.displayforce.ai"
 *     path     : string   // ex: "/public/v1/device-folder/list"
 *     method   : "GET" | "POST"
 *     token    : string   // X-API-Token do cliente
 *     body?    : object   // payload para POST
 *     params?  : object   // query params para GET
 *   }
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";

const ALLOWED_HOSTS = ["api.displayforce.ai", "displayforce.ai"];

function cors(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);

  // Pre-flight CORS
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { endpoint, path, method = "POST", token, body: reqBody, params } = (req.body ?? {}) as any;

  if (!endpoint || !path || !token) {
    return res.status(400).json({ error: "endpoint, path e token são obrigatórios" });
  }

  // Segurança: só aceita hosts Displayforce
  try {
    const host = new URL(endpoint).hostname;
    if (!ALLOWED_HOSTS.some(h => host === h || host.endsWith("." + h))) {
      return res.status(403).json({ error: "Endpoint não permitido" });
    }
  } catch {
    return res.status(400).json({ error: "endpoint inválido" });
  }

  const base = String(endpoint).replace(/\/$/, "");
  const pathClean = path.startsWith("/") ? path : `/${path}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept":       "application/json",
    "X-API-Token":  token.trim(),
  };

  let url = `${base}${pathClean}`;

  // Monta query string para GET
  if (method === "GET" && params && typeof params === "object") {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])
    ).toString();
    if (qs) url += `?${qs}`;
  }

  try {
    const upstream = await fetch(url, {
      method,
      headers,
      ...(method === "POST" && reqBody != null ? { body: JSON.stringify(reqBody) } : {}),
    });

    const contentType = upstream.headers.get("content-type") || "";
    const text = await upstream.text();

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: `Upstream retornou ${upstream.status}`,
        details: text.slice(0, 500),
      });
    }

    if (contentType.includes("application/json")) {
      try {
        return res.status(200).json(JSON.parse(text));
      } catch {
        return res.status(200).send(text);
      }
    }
    return res.status(200).send(text);

  } catch (e: any) {
    console.error("[proxy] Erro ao chamar upstream:", e?.message ?? e);
    return res.status(502).json({ error: "Erro ao conectar com a API externa", details: e?.message });
  }
}
