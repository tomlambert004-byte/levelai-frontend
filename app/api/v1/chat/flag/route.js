/**
 * POST /api/v1/chat/flag
 *
 * Flags a Payer Pal conversation issue for admin review.
 * Called when front-desk staff escalate a question they're not satisfied with.
 *
 * Body: { patient_id, question, ai_response, error_type }
 * Response: { flagged: true, id: string }
 */
import { auth } from "@clerk/nextjs/server";
import { prisma } from "../../../../../lib/prisma.js";
import { checkRateLimit, rateLimitResponse } from "../../../../../lib/rateLimit.js";

export async function POST(request) {
  try {
    // Auth — allow sandbox users (they can flag too, stored as demo data)
    let userId = null;
    try {
      const authResult = await auth();
      userId = authResult.userId;
    } catch { /* unauthenticated — sandbox */ }

    if (userId) {
      const rl = checkRateLimit(`chatflag:${userId}`, { maxRequests: 10, windowMs: 60_000 });
      const blocked = rateLimitResponse(rl);
      if (blocked) return blocked;
    }

    const body = await request.json().catch(() => ({}));
    const { patient_id, question, ai_response, error_type } = body;

    if (!question) {
      return Response.json({ error: "question is required" }, { status: 400 });
    }

    // Look up practice for this user
    let practiceId = null;
    if (userId) {
      try {
        const practice = await prisma.practice.findUnique({ where: { clerkUserId: userId } });
        if (practice) practiceId = practice.id;
      } catch { /* no practice — sandbox user */ }
    }

    const issue = await prisma.flaggedIssue.create({
      data: {
        practiceId,
        userId,
        patientId: patient_id || null,
        question: question.slice(0, 500), // Truncate long questions
        aiResponse: (ai_response || "").slice(0, 1000),
        errorType: error_type || null,
        status: "open",
      },
    });

    return Response.json({ flagged: true, id: issue.id });
  } catch (err) {
    console.error("[chat/flag] Error:", err.message);
    // Non-blocking — don't fail the UX if flagging fails
    return Response.json({ flagged: false, error: "Could not save flag — please try again." }, { status: 500 });
  }
}
