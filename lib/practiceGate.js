/**
 * Practice Suspension Gate
 *
 * Checks whether a practice is active. Returns a standardized 403 response
 * when the practice is suspended or cancelled.
 *
 * Usage in route handlers:
 *   const gate = await checkPracticeActive(practice);
 *   if (gate) return gate;  // 403 if suspended
 */

/**
 * Returns a 403 Response if the practice is not active, or null if OK.
 * Accepts the practice object (from prisma.practice.findUnique).
 *
 * - null practice → allow (new user, not yet onboarded)
 * - status "active" or missing → allow
 * - status "suspended" | "cancelled" → block with error_type
 */
export function checkPracticeActive(practice) {
  if (!practice) return null; // new user, not yet onboarded — allow
  const status = practice.status || "active";
  if (status === "active") return null;

  return Response.json({
    error: "Service paused",
    error_type: "practice_suspended",
    message: "Your LvlAI subscription is currently paused. Please contact support to resume service.",
  }, { status: 403 });
}
