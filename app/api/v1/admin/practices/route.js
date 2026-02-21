/**
 * GET /api/v1/admin/practices
 *
 * Lists all practices (onboarded users).
 * Admin-only — checks ADMIN_USER_IDS env var or Clerk publicMetadata.role.
 */
import { auth, currentUser } from "@clerk/nextjs/server";
import { prisma } from "../../../../../lib/prisma.js";

const ADMIN_IDS = new Set(
  (process.env.ADMIN_USER_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

function isAdmin(userId, user) {
  if (ADMIN_IDS.has(userId)) return true;
  const role = user?.publicMetadata?.role;
  return role === "admin" || role === "owner";
}

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await currentUser();
    if (!isAdmin(userId, user)) {
      return Response.json(
        { error: "Forbidden — admin access required" },
        { status: 403 }
      );
    }

    const practices = await prisma.practice.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        clerkUserId: true,
        activatedAt: true,
        createdAt: true,
        accountMode: true,
        npi: true,
        email: true,
        phone: true,
        pmsSystem: true,
        planTier: true,
        stripeSubscriptionStatus: true,
        status: true,
      },
    });

    return Response.json({ practices });
  } catch (err) {
    console.error("[admin/practices] Error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
