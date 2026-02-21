/**
 * POST /api/v1/pms/webhook
 *
 * Receives real-time PMS events (Kolla-pattern integration).
 * Event types: appointment.created, appointment.updated, appointment.cancelled
 *
 * Auth: Two-layer verification:
 *   1. Global PMS_WEBHOOK_SECRET — gates all inbound webhooks
 *   2. Per-practice webhookSecret — verifies the sender is authorized for the claimed practice_id
 *
 * ZERO PHI AT REST: Patient data is merged into the in-memory cache only.
 * No patient records are written to Postgres.
 */
import { prisma } from "../../../../../lib/prisma.js";
import { logAudit, getClientIp } from "../../../../../lib/audit.js";
import { checkRateLimit, rateLimitResponse } from "../../../../../lib/rateLimit.js";
import { getCachedSchedule, setCachedSchedule, mergeCachePatient, removeCachePatient } from "../../../../../lib/patientCache.js";

const MAX_TIMESTAMP_AGE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Timing-safe HMAC-SHA256 signature verification.
 */
async function verifyHmacSignature(secret, timestamp, rawBody, providedSignature) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const data = encoder.encode(`${timestamp}.${rawBody}`);
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, data);
  const expectedHex = Array.from(new Uint8Array(signatureBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  if (expectedHex.length !== providedSignature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expectedHex.length; i++) {
    mismatch |= expectedHex.charCodeAt(i) ^ providedSignature.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function POST(request) {
  try {
    const ip = getClientIp(request);
    const rl = checkRateLimit(`webhook:${ip}`, { maxRequests: 60, windowMs: 60_000 });
    const blocked = rateLimitResponse(rl);
    if (blocked) return blocked;

    const signature = (request.headers.get("x-webhook-signature") || "").trim();
    const timestamp = (request.headers.get("x-webhook-timestamp") || "").trim();

    if (!signature) {
      return Response.json({ error: "Missing webhook signature" }, { status: 401 });
    }

    const rawBody = await request.text();
    const body = JSON.parse(rawBody);
    const { event_type, pms_source, practice_id, data } = body;

    if (!practice_id) {
      return Response.json({ error: "practice_id is required" }, { status: 400 });
    }

    // Look up practice and its webhook secret
    const practice = await prisma.practice.findUnique({ where: { id: practice_id } });
    if (!practice) {
      return Response.json({ error: "Practice not found" }, { status: 404 });
    }

    const practiceSecret = practice.webhookSecret;
    const globalSecret = process.env.PMS_WEBHOOK_SECRET;
    const secret = practiceSecret || globalSecret;

    if (!secret) {
      console.error("[pms/webhook] No webhook secret configured for practice", practice_id);
      return Response.json({ error: "Webhook endpoint not configured for this practice" }, { status: 503 });
    }

    // Replay prevention + HMAC verification
    if (timestamp) {
      const ts = parseInt(timestamp, 10);
      const now = Math.floor(Date.now() / 1000);
      if (isNaN(ts) || Math.abs(now - ts) > MAX_TIMESTAMP_AGE_MS / 1000) {
        return Response.json({ error: "Webhook timestamp too old or invalid" }, { status: 401 });
      }
      const valid = await verifyHmacSignature(secret, timestamp, rawBody, signature);
      if (!valid) {
        return Response.json({ error: "Invalid webhook signature" }, { status: 401 });
      }
    } else {
      if (signature !== secret) {
        return Response.json({ error: "Invalid webhook signature" }, { status: 401 });
      }
      console.warn("[pms/webhook] Legacy signature format used — migrate to HMAC-SHA256 + timestamp");
    }

    if (!event_type || !data) {
      return Response.json({ error: "event_type and data are required" }, { status: 400 });
    }

    // ── Route by event type — update CACHE, not DB ──────────────────────────

    if (event_type === "appointment.cancelled") {
      // Remove from cache if it exists
      if (data.external_id && data.appointment_date) {
        removeCachePatient(practice_id, data.appointment_date, data.external_id);
      }
      logAudit({
        practiceId: practice_id,
        userId: "webhook",
        action: "pms.webhook.cancelled",
        ipAddress: ip,
        metadata: { event_type, pms_source },
      });
      return Response.json({ received: true, event_type });
    }

    if (event_type === "appointment.created" || event_type === "appointment.updated") {
      const {
        external_id, first_name, last_name, date_of_birth,
        phone, email, member_id, group_number,
        insurance_name, payer_id, procedure, provider,
        appointment_date, appointment_time, is_oon,
      } = data;

      // Build normalized patient for cache
      const patient = {
        id:              external_id || `wh_${Date.now()}`,
        externalId:      external_id || null,
        name:            `${first_name || "Unknown"} ${last_name || "Patient"}`.trim(),
        dob:             date_of_birth || "",
        memberId:        member_id || "",
        insurance:       insurance_name || "",
        procedure:       procedure || "",
        provider:        provider || "",
        phone:           phone || "",
        email:           email || "",
        fee:             null,
        isOON:           is_oon || false,
        payerId:         payer_id || null,
        groupNumber:     group_number || "",
        appointmentDate: appointment_date || null,
        appointmentTime: appointment_time || "",
        _source:         "webhook",
      };

      // Merge into cache if it exists for this date
      if (appointment_date) {
        mergeCachePatient(practice_id, appointment_date, patient);
      }

      logAudit({
        practiceId: practice_id,
        userId: "webhook",
        action: "pms.webhook.received",
        ipAddress: ip,
        metadata: { event_type, pms_source },
      });
      return Response.json({ received: true, event_type });
    }

    return Response.json({ received: true, event_type, note: "Unhandled event type" });
  } catch (err) {
    console.error("[pms/webhook] Error:", err.name);
    return Response.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
