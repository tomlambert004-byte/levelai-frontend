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

export async function POST(request) {
  try {
    // Validate webhook signature
    const signature = request.headers.get("x-webhook-signature");
    const webhookSecret = process.env.PMS_WEBHOOK_SECRET;
    if (webhookSecret && signature !== webhookSecret) {
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

      // Upsert patient by externalId or create new
      let patient;
      if (external_id) {
        patient = await prisma.patient.upsert({
          where: { id: external_id },
          update: {
            firstName: first_name || undefined,
            lastName: last_name || undefined,
            dateOfBirth: date_of_birth || undefined,
            phone: phone || undefined,
            email: email || undefined,
            memberId: member_id || undefined,
            groupNumber: group_number || undefined,
            insuranceName: insurance_name || undefined,
            payerId: payer_id || undefined,
            procedure: procedure || undefined,
            provider: provider || undefined,
            appointmentDate: appointment_date || undefined,
            appointmentTime: appointment_time || undefined,
            isOON: is_oon || false,
          },
          create: {
            id: external_id,
            practiceId: practice_id,
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
          },
        });
      } else {
        patient = await prisma.patient.create({
          data: {
            practiceId: practice_id,
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
          },
        });
      }

      console.log(`[pms/webhook] ${event_type}: ${first_name} ${last_name} → practice ${practice_id}`);
      return Response.json({ received: true, event_type, patient_id: patient.id });
    }

    return Response.json({ received: true, event_type, note: "Unhandled event type" });
  } catch (err) {
    console.error("[pms/webhook] Error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
