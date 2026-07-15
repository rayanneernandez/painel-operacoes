import { createClient } from "jsr:@supabase/supabase-js@2";
import { clientIp, sha256Hex, timingSafeEqual } from "../_shared/crypto.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const MIN_CAPTURE_INTERVAL_MS = 25 * 60 * 1000;

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const ip = clientIp(req);
  const deviceId = req.headers.get("x-device-id");
  const token = req.headers.get("x-device-token");

  const logFailure = async (reason: string) => {
    await supabase.from("printview_ingest_failures").insert({ device_id: deviceId, reason, ip });
  };

  if (!deviceId || !token) {
    await logFailure("missing_credentials");
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  const { data: device } = await supabase
    .from("printview_devices")
    .select("id, name, token_hash, status, last_capture_at, capture_count")
    .eq("id", deviceId)
    .maybeSingle();

  if (!device) {
    await logFailure("device_not_found");
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  const tokenHash = await sha256Hex(token);
  if (!timingSafeEqual(tokenHash, device.token_hash)) {
    await logFailure("bad_token");
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  if (device.status !== "active") {
    await logFailure("device_revoked");
    return new Response(JSON.stringify({ error: "revoked" }), { status: 403 });
  }

  let body: { screenshot_base64?: string; local_ip?: string; connection_type?: string } = {};
  try {
    const raw = await req.text();
    if (raw) body = JSON.parse(raw);
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400 });
  }

  const now = new Date();
  const update: Record<string, unknown> = {
    last_heartbeat_at: now.toISOString(),
    last_ip: ip,
  };
  if (body.local_ip) update.local_ip = body.local_ip;
  if (body.connection_type) update.connection_type = body.connection_type;

  let screenshotStored = false;
  let rateLimited = false;

  if (body.screenshot_base64) {
    const lastCapture = device.last_capture_at ? new Date(device.last_capture_at) : null;
    if (lastCapture && now.getTime() - lastCapture.getTime() < MIN_CAPTURE_INTERVAL_MS) {
      rateLimited = true;
    } else {
      const bytes = base64ToBytes(body.screenshot_base64);
      // fixed path per device -- each capture overwrites the previous one,
      // only the latest screenshot is ever kept
      const path = `${deviceId}/latest.jpg`;

      const { error: uploadError } = await supabase.storage
        .from("printview_screenshots")
        .upload(path, bytes, { contentType: "image/jpeg", upsert: true });

      if (!uploadError) {
        update.last_capture_at = now.toISOString();
        update.capture_count = (device.capture_count ?? 0) + 1;
        update.latest_screenshot_path = path;
        screenshotStored = true;
      } else {
        await logFailure(`upload_failed: ${uploadError.message}`);
      }
    }
  }

  await supabase.from("printview_devices").update(update).eq("id", deviceId);

  return new Response(
    JSON.stringify({
      ok: true,
      screenshot_stored: screenshotStored,
      rate_limited: rateLimited,
      name: device.name,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
});
