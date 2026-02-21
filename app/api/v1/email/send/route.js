/**
 * POST /api/v1/email/send — Stateless email send
 *
 * Accepts { to, subject, body, replyTo } directly from the frontend.
 * No database reads or writes — fully stateless.
 *
 * If RESEND_API_KEY is set, sends via Resend API.
 * Otherwise, returns a placeholder success (email queued but not sent).
 *
 * The "from" address uses the practice email stored in Postgres.
 *
 * ZERO PHI AT REST: No email content is stored in Postgres.
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

    // Rate limit: 5 emails per minute per user
    const rl = await checkRateLimit(`email:${userId}`, { maxRequests: 5, windowMs: 60_000 });
    const blocked = rateLimitResponse(rl);
    if (blocked) return blocked;

    // Verify practice exists
    const practice = await prisma.practice.findUnique({ where: { clerkUserId: userId } });
    if (!practice) return Response.json({ error: "Practice not found" }, { status: 404 });

    // Practice suspension gate
    const gate = checkPracticeActive(practice);
    if (gate) return gate;

    const body = await request.json();
    const { to, subject, emailBody, replyTo } = body;

    if (!to || !subject || !emailBody) {
      return Response.json({ error: "to, subject, and emailBody are required" }, { status: 400 });
    }

    // Use practice email as the from/reply-to address
    const fromEmail = practice.email || replyTo || "noreply@levelai.com";
    const fromName = practice.name || "Level AI";

    const resendKey = process.env.RESEND_API_KEY;

    if (resendKey) {
      // ── Real email send via Resend ───────────────────────────────────────
      try {
        const resendRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${resendKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: `${fromName} <${fromEmail}>`,
            to: [to],
            subject,
            text: emailBody,
            reply_to: fromEmail,
          }),
        });

        const resendData = await resendRes.json();

        if (resendRes.ok) {
          logAudit({
            practiceId: practice.id,
            userId,
            action: "email.send",
            ipAddress: getClientIp(request),
            metadata: { status: "sent", emailId: resendData.id, type: "benefits_inquiry" },
          });
          return Response.json({ sent: true, emailId: resendData.id });
        } else {
          console.error("[email/send] Resend error:", resendData);
          return Response.json({ sent: false, error: "Email delivery failed. Please try again." }, { status: 502 });
        }
      } catch (emailErr) {
        console.error("[email/send] Resend exception:", emailErr.name);
        return Response.json({ sent: false, error: "Email delivery failed. Please try again." }, { status: 502 });
      }
    } else {
      // ── Placeholder mode (no email provider configured) ─────────────────
      logAudit({
        practiceId: practice.id,
        userId,
        action: "email.send",
        ipAddress: getClientIp(request),
        metadata: { status: "queued", type: "benefits_inquiry" },
      });

      return Response.json({
        sent: false,
        queued: true,
        message: "Email approved but email provider not configured. Configure RESEND_API_KEY to enable delivery.",
      });
    }
  } catch (err) {
    console.error("[email/send] Error:", err.name);
    return Response.json({ error: "An error occurred. Please try again." }, { status: 500 });
  }
}
