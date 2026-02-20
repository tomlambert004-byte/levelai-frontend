/**
 * POST /api/v1/sms/send — Twilio SMS send (or placeholder)
 *
 * Called after a draft is approved. If TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN
 * + TWILIO_FROM_NUMBER are set, sends via Twilio REST API. Otherwise, marks
 * the draft as "approved" without sending (placeholder for demo).
 */
import { auth } from "@clerk/nextjs/server";
import { prisma } from "../../../../../lib/prisma.js";

export async function POST(request) {
  try {
    const { userId } = await auth();
    if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const practice = await prisma.practice.findUnique({ where: { clerkUserId: userId } });
    if (!practice) return Response.json({ error: "Practice not found" }, { status: 404 });

    const body = await request.json();
    const { smsQueueId } = body;

    if (!smsQueueId) {
      return Response.json({ error: "smsQueueId is required" }, { status: 400 });
    }

    // Verify ownership
    const draft = await prisma.smsQueue.findFirst({
      where: { id: smsQueueId, practiceId: practice.id },
    });
    if (!draft) return Response.json({ error: "Draft not found" }, { status: 404 });

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
            To:   draft.recipientPhone,
            From: twilioFrom,
            Body: draft.draftMessage,
          }),
        });

        const twilioData = await twilioRes.json();

        if (twilioRes.ok) {
          await prisma.smsQueue.update({
            where: { id: smsQueueId },
            data: {
              status:     "sent",
              sentAt:     new Date(),
              twilioSid:  twilioData.sid || null,
              approvedBy: userId,
              approvedAt: new Date(),
            },
          });
          return Response.json({ sent: true, twilioSid: twilioData.sid });
        } else {
          await prisma.smsQueue.update({
            where: { id: smsQueueId },
            data: {
              status:       "failed",
              errorMessage: twilioData.message || "Twilio send failed",
              approvedBy:   userId,
              approvedAt:   new Date(),
            },
          });
          return Response.json({ sent: false, error: twilioData.message }, { status: 502 });
        }
      } catch (twilioErr) {
        await prisma.smsQueue.update({
          where: { id: smsQueueId },
          data: { status: "failed", errorMessage: twilioErr.message },
        });
        return Response.json({ sent: false, error: twilioErr.message }, { status: 502 });
      }
    } else {
      // ── Placeholder mode (no Twilio configured) ───────────────────────
      await prisma.smsQueue.update({
        where: { id: smsQueueId },
        data: {
          status:     "approved",
          approvedBy: userId,
          approvedAt: new Date(),
        },
      });
      return Response.json({
        sent:    false,
        queued:  true,
        message: "SMS approved but Twilio not configured. Configure TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER to enable delivery.",
      });
    }
  } catch (err) {
    console.error("[sms/send] Error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
