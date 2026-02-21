/**
 * POST /api/v1/pms/webhook
 *
 * Receives real-time PMS events (Kolla-pattern integration).
 * Event types: appointment.created, appointment.updated, appointment.cancelled
 *
 * In production, this would be called by a secure tunnel agent or
 * middleware (Kolla, Health Gorilla, etc.) when PMS data changes.
 *
 * Auth: Webhook signature validation via X-Webhook-Signature header.
 */
import { prisma } from "../../../../../lib/prisma.js";
import { logAudit, getClientIp } from "../../../../../lib/audit.js";
import { checkRateLimit, rateLimitResponse } from "../../../../../lib/rateLimit.js";

export async function POST(request) {
  try {
    const ip = getClientIp(request);
    const rl = checkRateLimit(`webhook:${ip}`, { maxRequests: 60, windowMs: 60_000 });
    const blocked = rateLimitResponse(rl);
    if (blocked) return blocked;

    // Validate webhook signature — REQUIRED in production
    const signature = request.headers.get("x-webhook-signature");
    const webhookSecret = process.env.PMS_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error("[pms/webhook] PMS_WEBHOOK_SECRET not configured — rejecting request");
      return Response.json({ error: "Webhook endpoint not configured" }, { status: 503 });
    }
    if (signature !== webhookSecret) {
      return Response.json({ error: "Invalid webhook signature" }, { status: 401 });
    }

    const body = await request.json();
    const { event_type, pms_source, practice_id, data } = body;

    if (!event_type || !data) {
      return Response.json({ error: "event_type and data are required" }, { status: 400 });
    }

    // Route by event type
    if (event_type === "appointment.cancelled") {
      // For cancellations, we could mark the patient's appointment as cancelled
      // For now, just acknowledge
      console.log(`[pms/webhook] ${event_type} for practice ${practice_id}`);
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
        // Find by practiceId + externalId (the safe composite key)
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

      console.log(`[pms/webhook] ${event_type} processed for practice ${practice_id}`);
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
    console.error("[pms/webhook] Error:", err);
    return Response.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
