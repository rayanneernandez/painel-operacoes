// /api/sync-analytics.ts
// Vercel Function: Puxa dados da DisplayForce, grava RAW no Supabase e gera agregados do dashboard

import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "crypto";
import { supabaseAdmin as supabase } from "../src/lib/supabaseAdmin";

type ClientApiConfig = {
  api_endpoint: string;
  analytics_endpoint: string;
  api_key: string;
  custom_header_key?: string | null;
  custom_header_value?: string | null;
  collection_start?: string | null;
  collection_end?: string | null;
  collect_tracks?: boolean;
  collect_face_quality?: boolean;
  collect_glasses?: boolean;
  collect_beard?: boolean;
  collect_hair_color?: boolean;
  collect_hair_type?: boolean;
  collect_headwear?: boolean;
};

function ok(res: VercelResponse, data: any) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json(data);
}
function bad(res: VercelResponse, status: number, data: any) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(data);
}

function sha256(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function asISODateUTC(d: Date) {
  // YYYY-MM-DD em UTC
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function safeNumber(x: any): number | null {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

/**
 * Tenta inferir timestamps/duração sem depender 100% do formato.
 */
function extractTimes(visit: any): {
  startTs: string | null;
  endTs: string | null;
  visitTimeSeconds: number | null;
  dwellTimeSeconds: number | null;
  contactTimeSeconds: number | null;
} {
  const startRaw = visit.start ?? visit.timestamp ?? visit.start_time ?? visit.begin ?? null;
  const endRaw = visit.end ?? visit.end_time ?? visit.finish ?? null;

  const startTs = typeof startRaw === "string" ? startRaw : null;
  const endTs = typeof endRaw === "string" ? endRaw : null;

  let durationFromStartEnd: number | null = null;
  if (startTs && endTs) {
    const s = Date.parse(startTs);
    const e = Date.parse(endTs);
    if (Number.isFinite(s) && Number.isFinite(e) && e >= s) {
      durationFromStartEnd = Math.round((e - s) / 1000);
    }
  }

  const visitTimeSeconds =
    safeNumber(visit.visit_time_seconds) ??
    safeNumber(visit.visit_time) ??
    safeNumber(visit.duration_seconds) ??
    safeNumber(visit.duration) ??
    durationFromStartEnd ??
    null;

  const dwellTimeSeconds =
    safeNumber(visit.dwell_time_seconds) ??
    safeNumber(visit.dwell_time) ??
    safeNumber(visit.time_in_frame_seconds) ??
    null;

  const contactTimeSeconds =
    safeNumber(visit.contact_time_seconds) ??
    safeNumber(visit.contact_time) ??
    null;

  return { startTs, endTs, visitTimeSeconds, dwellTimeSeconds, contactTimeSeconds };
}

function normalizeGenderFromSex(visit: any): number {
  // 1 male, 2 female, 0 unknown
  if (typeof visit.sex === "number") return visit.sex;
  if (typeof visit.sex === "string") {
    const s = visit.sex.toLowerCase();
    if (s === "male" || s === "m" || s === "1") return 1;
    if (s === "female" || s === "f" || s === "2") return 2;
  }
  if (visit.gender === "male") return 1;
  if (visit.gender === "female") return 2;
  return 0;
}

function bucketAge(age: number): string {
  if (age < 0) return "unknown";
  if (age <= 9) return "0-9";
  if (age <= 17) return "10-17";
  if (age <= 24) return "18-24";
  if (age <= 34) return "25-34";
  if (age <= 44) return "35-44";
  if (age <= 54) return "45-54";
  if (age <= 64) return "55-64";
  if (age <= 74) return "65-74";
  return "75+";
}

function percentMap(countMap: Record<string, number>, total: number) {
  const out: Record<string, number> = {};
  if (total <= 0) return out;
  for (const [k, v] of Object.entries(countMap)) {
    out[k] = Number(((v / total) * 100).toFixed(2));
  }
  return out;
}

// ----- Normalização dos atributos (DisplayForce pode vir boolean, string, number) -----

function toBool(val: any): boolean | null {
  if (typeof val === "boolean") return val;
  if (typeof val === "number") return val === 1 ? true : val === 0 ? false : null;
  if (typeof val === "string") {
    const s = val.trim().toLowerCase();
    if (["true", "yes", "y", "1", "on"].includes(s)) return true;
    if (["false", "no", "n", "0", "off"].includes(s)) return false;
  }
  return null;
}

function facialHairToBool(val: any): boolean | null {
  // exemplos comuns: "shaved", "beard", "mustache", "none", boolean
  const b = toBool(val);
  if (b !== null) return b;

  if (typeof val === "string") {
    const s = val.trim().toLowerCase();
    if (["shaved", "none", "no", "false", "0"].includes(s)) return false;
    // qualquer descrição != shaved/none -> considera "tem"
    if (s.length > 0) return true;
  }
  return null;
}

function headwearToBool(val: any): boolean | null {
  // exemplos: "no", "yes", "cap", "hat", boolean
  const b = toBool(val);
  if (b !== null) return b;

  if (typeof val === "string") {
    const s = val.trim().toLowerCase();
    if (["no", "none", "false", "0"].includes(s)) return false;
    if (s.length > 0) return true;
  }
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") return bad(res, 405, { error: "Method Not Allowed" });

    const { client_id, start, end, devices, auth } = (req.body as any) ?? {};

    // Auth opcional
    const authHeader = req.headers.authorization;
    const providedAuth =
      typeof authHeader === "string" && authHeader.startsWith("Bearer ")
        ? authHeader.slice("Bearer ".length)
        : auth;

    if (providedAuth && providedAuth !== "painel@2026*") {
      return bad(res, 401, { error: "Não autorizado" });
    }

    if (!client_id) return bad(res, 400, { error: "client_id é obrigatório" });

    // 1) Carregar config da API do cliente
    const { data: apiCfg, error: apiCfgErr } = await supabase
      .from("client_api_configs")
      .select(
        `
        api_endpoint,
        analytics_endpoint,
        api_key,
        custom_header_key,
        custom_header_value,
        collection_start,
        collection_end,
        collect_tracks,
        collect_face_quality,
        collect_glasses,
        collect_beard,
        collect_hair_color,
        collect_hair_type,
        collect_headwear
      `
      )
      .eq("client_id", client_id)
      .single();

    if (apiCfgErr || !apiCfg) {
      return bad(res, 400, { error: "Config da API não encontrada para este cliente", details: apiCfgErr });
    }

    const cfg = apiCfg as ClientApiConfig;
    const baseUrl = (cfg.api_endpoint || "https://api.displayforce.ai").replace(/\/$/, "");
    const analyticsPath = (cfg.analytics_endpoint || "/public/v1/stats/visitor/list").startsWith("/")
      ? cfg.analytics_endpoint || "/public/v1/stats/visitor/list"
      : `/${cfg.analytics_endpoint || "public/v1/stats/visitor/list"}`;
    const analyticsUrl = `${baseUrl}${analyticsPath}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    // Preferência: header custom -> X-API-Token
    if (cfg.custom_header_key && cfg.custom_header_value) {
      headers[cfg.custom_header_key] = cfg.custom_header_value;
    } else if (cfg.api_key) {
      headers["X-API-Token"] = String(cfg.api_key).trim();
    }

    const now = new Date();
    const defaultStart = cfg.collection_start || new Date("2024-01-01T00:00:00Z").toISOString();
    const defaultEnd = cfg.collection_end || now.toISOString();

    const rangeStart = String(start || defaultStart);
    const rangeEnd = String(end || defaultEnd);

    const baseBody: any = {
      start: rangeStart,
      end: rangeEnd,
      tracks: cfg.collect_tracks ?? true,
      face_quality: cfg.collect_face_quality ?? true,
      glasses: cfg.collect_glasses ?? true,
      facial_hair: cfg.collect_beard ?? true,
      hair_color: cfg.collect_hair_color ?? true,
      hair_type: cfg.collect_hair_type ?? true,
      headwear: cfg.collect_headwear ?? true,
      additional_attributes: ["smile", "pitch", "yaw", "x", "y", "height"],
    };

    if (Array.isArray(devices) && devices.length > 0) {
      baseBody.devices = devices;
    }

    // 2) Paginar na DisplayForce
    const limit = 1000;
    let offset = 0;
    let total = 0;
    const combined: any[] = [];

    while (true) {
      const bodyPayload = { ...baseBody, limit, offset };

      const resp = await fetch(analyticsUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(bodyPayload),
      });

      if (!resp.ok) {
        const txt = await resp.text();
        return bad(res, resp.status, { error: "Erro na API externa", details: txt });
      }

      const json = await resp.json();
      const pagePayload = json?.payload || [];
      const pageTotal = json?.pagination?.total ?? pagePayload.length;
      total = pageTotal;

      combined.push(...pagePayload);

      if (pagePayload.length < limit || combined.length >= total) break;
      offset += limit;

      // segurança para evitar loops infinitos
      if (offset > 2_000_000) break;
    }

    if (combined.length === 0) {
      return ok(res, {
        message: "Sem dados no período/filtro informado",
        start: rangeStart,
        end: rangeEnd,
        totalFetched: 0,
        raw_upserted_new: 0,
        dashboard: null,
        stored_rollup: false,
      });
    }

    // 3) Mapear e UPSERT no Supabase (RAW)
    const deviceCandidates = ["device", "device_id", "source_id", "camera_id"];

    const toUpsert = combined.map((visit: any) => {
      let deviceId: number | null = null;

      if (Array.isArray(visit.devices) && visit.devices.length > 0) {
        const n = Number(visit.devices[0]);
        deviceId = Number.isFinite(n) ? n : null;
      } else {
        for (const k of deviceCandidates) {
          if (k in visit) {
            const n = Number(visit[k]);
            if (Number.isFinite(n)) {
              deviceId = n;
              break;
            }
          }
        }
      }

      const { startTs, endTs, visitTimeSeconds, dwellTimeSeconds, contactTimeSeconds } = extractTimes(visit);

      const attrs: any = {
        face_quality: visit.face_quality ?? null,
        glasses: visit.glasses ?? null,
        facial_hair: visit.facial_hair ?? null,
        hair_color: visit.hair_color ?? null,
        hair_type: visit.hair_type ?? null,
        headwear: visit.headwear ?? null,
      };

      // UID para evitar duplicidade
      const uidPayload = {
        client_id,
        device_id: deviceId,
        session_id: visit.session_id ?? null,
        visitor_id: visit.visitor_id ?? null,
        start: startTs ?? null,
        end: endTs ?? null,
        age: visit.age ?? null,
        sex: visit.sex ?? null,
      };
      const visit_uid = sha256(JSON.stringify(uidPayload));

      return {
        visit_uid,
        client_id,
        device_id: deviceId,
        timestamp: startTs, // início
        end_timestamp: endTs,
        age: typeof visit.age === "number" ? Math.round(visit.age) : null,
        gender: normalizeGenderFromSex(visit),
        attributes: attrs,
        visit_time_seconds: visitTimeSeconds,
        dwell_time_seconds: dwellTimeSeconds,
        contact_time_seconds: contactTimeSeconds,
        raw_data: visit,
      };
    });

    let upserted = 0;
    const chunkSize = 500;

    for (let i = 0; i < toUpsert.length; i += chunkSize) {
      const chunk = toUpsert.slice(i, i + chunkSize);

      const { error, data } = await supabase
        .from("visitor_analytics")
        .upsert(chunk, { onConflict: "visit_uid", ignoreDuplicates: true })
        .select("visit_uid");

      if (error) {
        console.error("Erro ao upsert chunk:", error);
      } else {
        upserted += data?.length ?? 0;
      }
    }

    // 4) Agregados do dashboard (combinado = o que veio da API nessa execução)
    const totalVisitors = combined.length;

    const startMs = Date.parse(rangeStart);
    const endMs = Date.parse(rangeEnd);
    const daysInRange =
      Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs
        ? Math.max(1, Math.ceil((endMs - startMs + 1) / (24 * 60 * 60 * 1000)))
        : 1;

    const perDayCount: Record<string, number> = {};
    const perHourTotal: Record<string, number> = {};
    for (let h = 0; h < 24; h++) perHourTotal[String(h)] = 0;

    const ageCounts: Record<string, number> = {
      "0-9": 0,
      "10-17": 0,
      "18-24": 0,
      "25-34": 0,
      "35-44": 0,
      "45-54": 0,
      "55-64": 0,
      "65-74": 0,
      "75+": 0,
      unknown: 0,
    };

    const genderCounts: Record<string, number> = { male: 0, female: 0, unknown: 0 };

    const attrCounts: Record<string, Record<string, number>> = {
      glasses: { true: 0, false: 0, unknown: 0 },
      facial_hair: { true: 0, false: 0, unknown: 0 },
      headwear: { true: 0, false: 0, unknown: 0 },
      hair_color: {},
      hair_type: {},
    };

    let glassesKnown = 0;
    let facialHairKnown = 0;
    let headwearKnown = 0;
    let hairColorKnown = 0;
    let hairTypeKnown = 0;

    let sumVisitTime = 0;
    let cntVisitTime = 0;

    let sumDwellTime = 0;
    let cntDwellTime = 0;

    let sumContactTime = 0;
    let cntContactTime = 0;

    for (const visit of combined) {
      const { startTs, visitTimeSeconds, dwellTimeSeconds, contactTimeSeconds } = extractTimes(visit);

      if (startTs) {
        const d = new Date(startTs);
        if (!Number.isNaN(d.getTime())) {
          const dayKey = asISODateUTC(d);
          perDayCount[dayKey] = (perDayCount[dayKey] ?? 0) + 1;

          // UTC (pra não variar por fuso)
          const hour = d.getUTCHours();
          perHourTotal[String(hour)] = (perHourTotal[String(hour)] ?? 0) + 1;
        }
      }

      // idade
      if (typeof visit.age === "number" && Number.isFinite(visit.age)) {
        const b = bucketAge(Math.round(visit.age));
        ageCounts[b] = (ageCounts[b] ?? 0) + 1;
      } else {
        ageCounts.unknown += 1;
      }

      // gênero
      const g = normalizeGenderFromSex(visit);
      if (g === 1) genderCounts.male += 1;
      else if (g === 2) genderCounts.female += 1;
      else genderCounts.unknown += 1;

      // atributos normalizados
      const glb = toBool(visit.glasses);
      if (glb !== null) {
        attrCounts.glasses[String(glb)] += 1;
        glassesKnown += 1;
      } else {
        attrCounts.glasses.unknown += 1;
      }

      const fhb = facialHairToBool(visit.facial_hair);
      if (fhb !== null) {
        attrCounts.facial_hair[String(fhb)] += 1;
        facialHairKnown += 1;
      } else {
        attrCounts.facial_hair.unknown += 1;
      }

      const hwb = headwearToBool(visit.headwear);
      if (hwb !== null) {
        attrCounts.headwear[String(hwb)] += 1;
        headwearKnown += 1;
      } else {
        attrCounts.headwear.unknown += 1;
      }

      const hc = visit.hair_color;
      if (typeof hc === "string" && hc.trim()) {
        attrCounts.hair_color[hc] = (attrCounts.hair_color[hc] ?? 0) + 1;
        hairColorKnown += 1;
      }

      const ht = visit.hair_type;
      if (typeof ht === "string" && ht.trim()) {
        attrCounts.hair_type[ht] = (attrCounts.hair_type[ht] ?? 0) + 1;
        hairTypeKnown += 1;
      }

      // tempos
      if (typeof visitTimeSeconds === "number" && Number.isFinite(visitTimeSeconds)) {
        sumVisitTime += visitTimeSeconds;
        cntVisitTime += 1;
      }
      if (typeof dwellTimeSeconds === "number" && Number.isFinite(dwellTimeSeconds)) {
        sumDwellTime += dwellTimeSeconds;
        cntDwellTime += 1;
      }
      if (typeof contactTimeSeconds === "number" && Number.isFinite(contactTimeSeconds)) {
        sumContactTime += contactTimeSeconds;
        cntContactTime += 1;
      }
    }

    const avgVisitorsPerDay = Number((totalVisitors / daysInRange).toFixed(2));

    const perHourAvg: Record<string, number> = {};
    for (let h = 0; h < 24; h++) {
      const key = String(h);
      perHourAvg[key] = Number(((perHourTotal[key] ?? 0) / daysInRange).toFixed(2));
    }

    const agePercent = percentMap(ageCounts, totalVisitors);
    const genderPercent = percentMap(genderCounts, totalVisitors);

    const attributesPercent = {
      glasses: glassesKnown > 0 ? percentMap({ true: attrCounts.glasses.true, false: attrCounts.glasses.false }, glassesKnown) : {},
      facial_hair:
        facialHairKnown > 0
          ? percentMap({ true: attrCounts.facial_hair.true, false: attrCounts.facial_hair.false }, facialHairKnown)
          : {},
      headwear:
        headwearKnown > 0 ? percentMap({ true: attrCounts.headwear.true, false: attrCounts.headwear.false }, headwearKnown) : {},
      hair_color: hairColorKnown > 0 ? percentMap(attrCounts.hair_color, hairColorKnown) : {},
      hair_type: hairTypeKnown > 0 ? percentMap(attrCounts.hair_type, hairTypeKnown) : {},
    };

    const avgVisitTimeSeconds = cntVisitTime > 0 ? Number((sumVisitTime / cntVisitTime).toFixed(2)) : null;
    const avgDwellTimeSeconds = cntDwellTime > 0 ? Number((sumDwellTime / cntDwellTime).toFixed(2)) : null;
    const avgContactTimeSeconds = cntContactTime > 0 ? Number((sumContactTime / cntContactTime).toFixed(2)) : null;

    // 5) Salvar rollup
    const rollupRow = {
      client_id,
      start: rangeStart,
      end: rangeEnd,
      total_visitors: totalVisitors,
      avg_visitors_per_day: avgVisitorsPerDay,
      visitors_per_day: perDayCount,
      visitors_per_hour_avg: perHourAvg,
      age_pyramid_percent: agePercent,
      gender_percent: genderPercent,
      attributes_percent: attributesPercent,
      avg_visit_time_seconds: avgVisitTimeSeconds,
      avg_dwell_time_seconds: avgDwellTimeSeconds,
      avg_contact_time_seconds: avgContactTimeSeconds,
      updated_at: new Date().toISOString(),
    };

    const { error: rollupErr } = await supabase
      .from("visitor_analytics_rollups")
      .upsert(rollupRow, { onConflict: "client_id,start,end" });

    if (rollupErr) console.error("Erro ao salvar rollup:", rollupErr);

    return ok(res, {
      message: "Sincronização concluída",
      start: rangeStart,
      end: rangeEnd,
      externalFetched: combined.length,
      raw_upserted_new: upserted,
      dashboard: {
        total_visitors: totalVisitors,
        avg_visitors_per_day: avgVisitorsPerDay,
        visitors_per_day: perDayCount,
        visitors_per_hour_avg: perHourAvg,
        age_pyramid_percent: agePercent,
        gender_percent: genderPercent,
        attributes_percent: attributesPercent,
        avg_times_seconds: {
          avg_visit_time_seconds: avgVisitTimeSeconds,
          avg_dwell_time_seconds: avgDwellTimeSeconds,
          // avg_contact_time_seconds omitido aqui se você não quer mostrar
        },
      },
      stored_rollup: !rollupErr,
    });
  } catch (err: any) {
    console.error("Erro inesperado:", err);
    return bad(res, 500, { error: "Erro inesperado", details: err?.message || String(err) });
  }
}