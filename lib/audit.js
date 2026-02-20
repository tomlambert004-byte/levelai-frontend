/**
 * Audit Logging Service
 *
 * Records PHI access and sensitive operations to the AuditLog table.
 * All calls are fire-and-forget — they never block the request.
 */
import { prisma } from "./prisma.js";

export function getClientIp(request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "unknown";
}

export function logAudit({ practiceId, userId, action, resourceType, resourceId, ipAddress, metadata }) {
  if (!action) return;
  prisma.auditLog
    .create({
      data: {
        practiceId: practiceId || null,
        userId: userId || null,
        action,
        resourceType: resourceType || null,
        resourceId: resourceId || null,
        ipAddress: ipAddress || null,
        metadata: metadata || undefined,
      },
    })
    .catch((err) => {
      console.error("[audit] Failed to write audit log:", err.message);
    });
}
