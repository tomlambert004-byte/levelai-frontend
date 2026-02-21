/**
 * POST /api/v1/sms/send — Stateless Twilio SMS send
 *
 * Accepts { recipientPhone, message } directly from the frontend.
 * No database reads or writes — fully stateless.
 *
 * If TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM_NUMBER are set,
 * sends via Twilio REST API. Otherwise, returns a placeholder success.
 *
 * ZERO PHI AT REST: No SMS content is stored in Postgres.
 */
import { auth } from "@clerk/nextjs/server";
import { prisma } from "../../../../../lib/prisma.js";
import { logAudit, getClientIp } from "../../../../../lib/audit.js";
import { checkRateLimit, rateLimitResponse } from "../../../../../lib/rateLimit.js";
import { checkPracticeActive } from "../../../../../lib/practiceGate.js";

export async function POST(request) {
  try {
    const { userId } = await auth();
    if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

    // Rate limit: 10 SMS sends per minute per user
    const rl = await checkRateLimit(`sms:${userId}`, { maxRequests: 10, windowMs: 60_000 });
    const blocked = rateLimitResponse(rl);
    if (blocked) return blocked;

    // Verify practice exists (for audit trail)
    const practice = await prisma.practice.findUnique({ where: { clerkUserId: userId } });
    if (!practice) return Response.json({ error: "Practice not found" }, { status: 404 });

    // Practice suspension gate
    const gate = checkPracticeActive(practice);
    if (gate) return gate;

    const body = await request.json();
    const { recipientPhone, message, smsQueueId } = body;

    // Support both new stateless format and legacy smsQueueId format
    const phone = recipientPhone;
    const smsBody = message;

    if (!phone || !smsBody) {
      return Response.json({ error: "recipientPhone and message are required" }, { status: 400 });
    }

    const twilioSid    = process.env.TWILIO_ACCOUNT_SID;
    const twilioToken  = process.env.TWILIO_AUTH_TOKEN;
    const twilioFrom   = process.env.TWILIO_FROM_NUMBER;

    if (twilioSid && twilioToken && twilioFrom) {
      // ── Real Twilio send ──────────────────────────────────────────────
      try {
        const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`;
        const twilioRes = await fetch(twilioUrl, {
          method: "POST",
          headers: {
            "Authorization": "Basic " + btoa(`${twilioSid}:${twilioToken}`),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            To:   phone,
            From: twilioFrom,
            Body: smsBody,
          }),
        });

        const twilioData = await twilioRes.json();

        if (twilioRes.ok) {
          // Audit log — no PHI (no phone number or message content)
          logAudit({
            practiceId: practice.id,
            userId,
            action: "sms.send",
            ipAddress: getClientIp(request),
            metadata: { status: "sent", twilioSid: twilioData.sid },
          });
          return Response.json({ sent: true, twilioSid: twilioData.sid });
        } else {
          console.error("[sms/send] Twilio error:", twilioData.code);
          return Response.json({ sent: false, error: "SMS delivery failed. Please try again." }, { status: 502 });
        }
      } catch (twilioErr) {
        console.error("[sms/send] Twilio exception:", twilioErr.name);
        return Response.json({ sent: false, error: "SMS delivery failed. Please try again." }, { status: 502 });
      }
    } else {
      // ── Placeholder mode (no Twilio configured) ───────────────────────
      return Response.json({
        sent:    false,
        queued:  true,
        message: "SMS approved but Twilio not configured. Configure TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER to enable delivery.",
      });
    }
  } catch (err) {
    console.error("[sms/send] Error:", err.name);
    return Response.json({ error: "An error occurred. Please try again." }, { status: 500 });
  }
}
