/**
 * POST /api/v1/pms/webhook
 *
 * Receives real-time PMS events (Kolla-pattern integration).
 * Event types: appointment.created, appointment.updated, appointment.cancelled
 *
 * In production, this would be called by a secure tunnel agent or
 * middleware (Kolla, Health Gorilla, etc.) when PMS data changes.
 *
 * Auth: HMAC-SHA256 webhook signature via X-Webhook-Signature header.
 * Replay prevention: X-Webhook-Timestamp header (must be within 5 minutes).
 *
 * Signature format: HMAC-SHA256(timestamp + "." + body, PMS_WEBHOOK_SECRET)
 * Sender must set:
 *   X-Webhook-Signature: <hex-encoded HMAC>
 *   X-Webhook-Timestamp: <unix epoch seconds>
 */
import { prisma } from "../../../../../lib/prisma.js";
import { logAudit, getClientIp } from "../../../../../lib/audit.js";
import { checkRateLimit, rateLimitResponse } from "../../../../../lib/rateLimit.js";

const MAX_TIMESTAMP_AGE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Timing-safe HMAC-SHA256 signature verification.
 * Uses Web Crypto API (available in Node 18+ and edge runtimes).
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

  // Timing-safe comparison
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

    // Validate webhook secret is configured
    const webhookSecret = process.env.PMS_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error("[pms/webhook] PMS_WEBHOOK_SECRET not configured — rejecting request");
      return Response.json({ error: "Webhook endpoint not configured" }, { status: 503 });
    }

    // Get signature and timestamp headers
    const signature = (request.headers.get("x-webhook-signature") || "").trim();
    const timestamp = (request.headers.get("x-webhook-timestamp") || "").trim();

    if (!signature) {
      return Response.json({ error: "Missing webhook signature" }, { status: 401 });
    }

    // Read raw body for signature verification
    const rawBody = await request.text();

    // Replay prevention — reject requests older than 5 minutes
    if (timestamp) {
      const ts = parseInt(timestamp, 10);
      const now = Math.floor(Date.now() / 1000);
      if (isNaN(ts) || Math.abs(now - ts) > MAX_TIMESTAMP_AGE_MS / 1000) {
        return Response.json({ error: "Webhook timestamp too old or invalid" }, { status: 401 });
      }

      // HMAC-SHA256 verification (preferred — new format)
      const valid = await verifyHmacSignature(webhookSecret, timestamp, rawBody, signature);
      if (!valid) {
        return Response.json({ error: "Invalid webhook signature" }, { status: 401 });
      }
    } else {
      // Legacy fallback — simple string comparison (will be removed in future)
      // This allows a migration period for existing webhook senders
      if (signature !== webhookSecret) {
        return Response.json({ error: "Invalid webhook signature" }, { status: 401 });
      }
      console.warn("[pms/webhook] Legacy signature format used — migrate to HMAC-SHA256 + timestamp");
    }

    const body = JSON.parse(rawBody);
    const { event_type, pms_source, practice_id, data } = body;

    if (!event_type || !data) {
      return Response.json({ error: "event_type and data are required" }, { status: 400 });
    }

    // Route by event type
    if (event_type === "appointment.cancelled") {
      return Response.json({ received: true, event_type });
    }

    // For created/updated events, upsert the patient record
    if (event_type === "appointment.created" || event_type === "appointment.updated") {
      const {
        external_id, first_name, last_name, date_of_birth,
        phone, email, member_id, group_number,
        insurance_name, payer_id, procedure, provider,
        appointment_date, appointment_time, is_oon,
      } = data;

      if (!practice_id) {
        return Response.json({ error: "practice_id is required" }, { status: 400 });
      }

      // Verify practice exists
      const practice = await prisma.practice.findUnique({ where: { id: practice_id } });
      if (!practice) {
        return Response.json({ error: "Practice not found" }, { status: 404 });
      }

      // Upsert patient by (practiceId + externalId) — prevent cross-practice pollution
      const patientData = {
        firstName: first_name || "Unknown",
        lastName: last_name || "Patient",
        dateOfBirth: date_of_birth || "",
        phone: phone || null,
        email: email || null,
        memberId: member_id || null,
        groupNumber: group_number || null,
        insuranceName: insurance_name || null,
        payerId: payer_id || null,
        procedure: procedure || null,
        provider: provider || null,
        appointmentDate: appointment_date || null,
        appointmentTime: appointment_time || null,
        isOON: is_oon || false,
      };

      let patient;
      if (external_id) {
        const existing = await prisma.patient.findFirst({
          where: { practiceId: practice_id, externalId: external_id },
        });
        if (existing) {
          patient = await prisma.patient.update({
            where: { id: existing.id },
            data: patientData,
          });
        } else {
          patient = await prisma.patient.create({
            data: { practiceId: practice_id, externalId: external_id, ...patientData },
          });
        }
      } else {
        patient = await prisma.patient.create({
          data: { practiceId: practice_id, ...patientData },
        });
      }

      logAudit({
        practiceId: practice_id,
        userId: "webhook",
        action: "pms.webhook.received",
        resourceType: "Patient",
        resourceId: patient.id,
        ipAddress: ip,
        metadata: { event_type, pms_source },
      });
      return Response.json({ received: true, event_type, patient_id: patient.id });
    }

    return Response.json({ received: true, event_type, note: "Unhandled event type" });
  } catch (err) {
    console.error("[pms/webhook] Error:", err.name);
    return Response.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
