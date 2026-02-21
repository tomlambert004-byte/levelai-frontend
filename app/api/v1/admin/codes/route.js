/**
 * GET /api/v1/admin/codes
 *
 * Lists all activation codes with their status.
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

    const codes = await prisma.activationCode.findMany({
      orderBy: { createdAt: "desc" },
    });

    // If a code was used, try to fetch the practice name
    const usedCodes = codes.filter((c) => c.usedBy);
    const practiceIds = [...new Set(usedCodes.map((c) => c.usedBy))];
    const practices =
      practiceIds.length > 0
        ? await prisma.practice.findMany({
            where: { id: { in: practiceIds } },
            select: { id: true, name: true },
          })
        : [];
    const practiceMap = Object.fromEntries(practices.map((p) => [p.id, p.name]));

    const enriched = codes.map((c) => ({
      id: c.id,
      code: c.code,
      label: c.label || null,
      customerEmail: c.customerEmail || null,
      used: c.used,
      usedBy: c.usedBy,
      usedByName: c.usedBy ? practiceMap[c.usedBy] || "Unknown" : null,
      createdAt: c.createdAt,
      usedAt: c.usedAt,
    }));

    return Response.json({ codes: enriched });
  } catch (err) {
    console.error("[admin/codes] Error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
