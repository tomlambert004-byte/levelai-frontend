/**
 * GET /api/v1/audit/logs?range=7d|30d|90d
 *
 * Returns audit log entries for the authenticated practice.
 * Used by the Settings → Audit Log tab for HIPAA compliance review and CSV export.
 *
 * Query params:
 *   range — "7d" (default), "30d", or "90d"
 *
 * Response: { logs: AuditLog[] }
 */
import { auth } from "@clerk/nextjs/server";
import { prisma } from "../../../../../lib/prisma.js";

const RANGE_MAP = {
  "7d":  7,
  "30d": 30,
  "90d": 90,
};

export async function GET(request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Look up the practice for this user
    const practice = await prisma.practice.findUnique({
      where: { clerkUserId: userId },
    });

    // CRITICAL: Never return audit logs without a practice scope.
    // Without this check, a user with no practice record would see ALL logs.
    if (!practice) {
      return Response.json({ logs: [] });
    }

    const { searchParams } = new URL(request.url);
    const range = searchParams.get("range") || "7d";
    const days = RANGE_MAP[range] || 7;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const logs = await prisma.auditLog.findMany({
      where: {
        practiceId: practice.id,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
      take: 500, // cap at 500 rows for performance
    });

    return Response.json({ logs });
  } catch (err) {
    console.error("[audit/logs] Error:", err.name);
    return Response.json({ error: "Failed to load audit logs." }, { status: 500 });
  }
}
