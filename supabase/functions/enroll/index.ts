import { createClient } from "jsr:@supabase/supabase-js@2";
import { clientIp, generateToken, sha256Hex } from "../_shared/crypto.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const ENROLLMENT_KEY = Deno.env.get("PRINTVIEW_ENROLLMENT_KEY")!;

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const ip = clientIp(req);
  let body: {
    enrollment_key?: string;
    device_name?: string;
    hostname?: string;
    os_user?: string;
    local_ip?: string;
    connection_type?: string;
  };

  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400 });
  }

  const { enrollment_key, device_name, hostname, os_user, local_ip, connection_type } = body;

  const logFailure = async (reason: string) => {
    await supabase.from("printview_enroll_events").insert({
      device_name: device_name ?? null,
      hostname: hostname ?? null,
      os_user: os_user ?? null,
      ip,
      success: false,
      reason,
    });
  };

  if (!enrollment_key || enrollment_key !== ENROLLMENT_KEY) {
    await logFailure("bad_enrollment_key");
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  if (!device_name || !hostname || !os_user) {
    await logFailure("missing_fields");
    return new Response(JSON.stringify({ error: "missing_fields" }), { status: 400 });
  }

  const { data: existing } = await supabase
    .from("printview_devices")
    .select("id")
    .eq("hostname", hostname)
    .eq("status", "active")
    .maybeSingle();

  if (existing) {
    await logFailure("hostname_already_active");
    return new Response(
      JSON.stringify({
        error: "already_enrolled",
        message:
          "Este hostname ja possui um dispositivo ativo. Revogue-o no painel antes de reinstalar.",
      }),
      { status: 409 },
    );
  }

  const token = generateToken();
  const tokenHash = await sha256Hex(token);

  const { data: device, error } = await supabase
    .from("printview_devices")
    .insert({
      name: device_name,
      hostname,
      os_user,
      last_ip: ip,
      local_ip: local_ip ?? null,
      connection_type: connection_type ?? null,
      token_hash: tokenHash,
      status: "active",
    })
    .select("id")
    .single();

  if (error || !device) {
    await logFailure(`insert_failed: ${error?.message ?? "unknown"}`);
    return new Response(JSON.stringify({ error: "insert_failed" }), { status: 500 });
  }

  await supabase.from("printview_enroll_events").insert({
    device_name,
    hostname,
    os_user,
    ip,
    success: true,
    reason: null,
  });

  return new Response(
    JSON.stringify({ device_id: device.id, token }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
});
