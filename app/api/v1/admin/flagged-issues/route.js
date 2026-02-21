/**
 * GET  /api/v1/admin/flagged-issues          — list all flagged issues (admin only)
 * PATCH /api/v1/admin/flagged-issues         — update status / add admin notes
 *
 * Admin-only — checks ADMIN_USER_IDS env or Clerk publicMetadata.role.
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
    if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const user = await currentUser();
    if (!isAdmin(userId, user)) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const issues = await prisma.flaggedIssue.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        practice: { select: { name: true, email: true } },
      },
    });

    // Aggregate counts
    const openCount = issues.filter(i => i.status === "open").length;
    const reviewedCount = issues.filter(i => i.status === "reviewed").length;
    const resolvedCount = issues.filter(i => i.status === "resolved").length;

    return Response.json({ issues, counts: { open: openCount, reviewed: reviewedCount, resolved: resolvedCount } });
  } catch (err) {
    console.error("[admin/flagged-issues] GET error:", err.message);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const { userId } = await auth();
    if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const user = await currentUser();
    if (!isAdmin(userId, user)) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const { issueId, status, adminNotes } = body;

    if (!issueId) {
      return Response.json({ error: "issueId is required" }, { status: 400 });
    }

    const updateData = {};
    if (status) updateData.status = status;
    if (adminNotes !== undefined) updateData.adminNotes = adminNotes;
    if (status === "resolved") updateData.resolvedAt = new Date();

    const updated = await prisma.flaggedIssue.update({
      where: { id: issueId },
      data: updateData,
    });

    return Response.json({ issue: updated });
  } catch (err) {
    console.error("[admin/flagged-issues] PATCH error:", err.message);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
