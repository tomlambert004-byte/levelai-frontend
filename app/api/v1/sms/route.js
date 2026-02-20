/**
 * /api/v1/sms — SMS Draft Queue CRUD
 *
 * GET  ?status=draft  → Returns SmsQueue records for the practice
 * POST               → Creates a new SMS draft
 * PATCH              → Updates a draft (approve, dismiss, mark sent)
 */
import { auth } from "@clerk/nextjs/server";
import { prisma } from "../../../../lib/prisma.js";

export async function GET(request) {
  try {
    const { userId } = await auth();
    if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const practice = await prisma.practice.findUnique({ where: { clerkUserId: userId } });
    if (!practice) return Response.json({ error: "Practice not found" }, { status: 404 });

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "draft";

    const drafts = await prisma.smsQueue.findMany({
      where: { practiceId: practice.id, status },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return Response.json({ drafts });
  } catch (err) {
    console.error("[sms] GET error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { userId } = await auth();
    if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const practice = await prisma.practice.findUnique({ where: { clerkUserId: userId } });
    if (!practice) return Response.json({ error: "Practice not found" }, { status: 404 });

    const body = await request.json();
    const { patientId, recipientPhone, recipientName, draftMessage, triggerType } = body;

    if (!recipientPhone || !draftMessage) {
      return Response.json({ error: "recipientPhone and draftMessage are required" }, { status: 400 });
    }

    const draft = await prisma.smsQueue.create({
      data: {
        practiceId: practice.id,
        patientId:  patientId || null,
        recipientPhone,
        recipientName: recipientName || null,
        draftMessage,
        triggerType: triggerType || "outreach_queued",
        status: "draft",
      },
    });

    return Response.json({ draft });
  } catch (err) {
    console.error("[sms] POST error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const { userId } = await auth();
    if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const practice = await prisma.practice.findUnique({ where: { clerkUserId: userId } });
    if (!practice) return Response.json({ error: "Practice not found" }, { status: 404 });

    const body = await request.json();
    const { id, status } = body;

    if (!id || !status) {
      return Response.json({ error: "id and status are required" }, { status: 400 });
    }

    // Verify the draft belongs to this practice
    const existing = await prisma.smsQueue.findFirst({
      where: { id, practiceId: practice.id },
    });
    if (!existing) return Response.json({ error: "Draft not found" }, { status: 404 });

    const updateData = { status };
    if (status === "approved") {
      updateData.approvedBy = userId;
      updateData.approvedAt = new Date();
    }

    const updated = await prisma.smsQueue.update({
      where: { id },
      data: updateData,
    });

    return Response.json({ draft: updated });
  } catch (err) {
    console.error("[sms] PATCH error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
