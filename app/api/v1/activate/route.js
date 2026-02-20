/**
 * POST /api/v1/activate
 *
 * Validates and redeems a single-use activation code.
 * Called during onboarding to gate access after payment.
 */
import { auth } from "@clerk/nextjs/server";
import { prisma } from "../../../../lib/prisma.js";

export async function POST(request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const code = (body.code || "").trim().toUpperCase();

    if (!code) {
      return Response.json({ error: "Code is required" }, { status: 400 });
    }

    // Look up the code
    const activation = await prisma.activationCode.findUnique({
      where: { code },
    });

    if (!activation) {
      return Response.json({ error: "Invalid activation code" }, { status: 404 });
    }

    if (activation.used) {
      return Response.json({ error: "This code has already been used" }, { status: 409 });
    }

    // Find or create the practice for this user
    const practice = await prisma.practice.upsert({
      where: { clerkUserId: userId },
      update: { activatedAt: new Date() },
      create: { clerkUserId: userId, name: "", activatedAt: new Date() },
    });

    // Mark the code as used (atomic update with where guard against race conditions)
    const updated = await prisma.activationCode.updateMany({
      where: { id: activation.id, used: false },
      data: { used: true, usedBy: practice.id, usedAt: new Date() },
    });

    if (updated.count === 0) {
      return Response.json({ error: "This code has already been used" }, { status: 409 });
    }

    return Response.json({ valid: true, code });
  } catch (err) {
    console.error("[activate] Error:", err);
    return Response.json({ error: "Activation failed", detail: err.message }, { status: 500 });
  }
}
