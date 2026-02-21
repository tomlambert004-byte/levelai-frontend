/**
 * GET /api/v1/patients/calendar?month=YYYY-MM
 *
 * Returns CalendarDaySummary[] for every weekday in the given month.
 *
 * Priority:
 *   1. In-memory cache — count cached patients per day (live mode)
 *   2. Sandbox fallback — deterministic synthetic counts (demo mode, 24/7)
 *
 * ZERO PHI AT REST: Reads from cache only, never Postgres.
 * Auth: Clerk userId → Practice.id lookup.
 */
import { auth } from "@clerk/nextjs/server";
import { getCachedSchedule } from "../../../../../lib/patientCache.js";

// ── Synthetic data (sandbox fallback) ────────────────────────────────────────
function hashStr(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function syntheticSummaries(month) {
  const [year, mon] = month.split("-").map(Number);
  const daysInMonth = new Date(year, mon, 0).getDate();
  const summaries = [];

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const dow = new Date(dateStr + "T12:00:00").getDay();
    if (dow === 0 || dow === 6) continue;

    const seed = hashStr(dateStr);
    const count = 4 + (seed % 5);
    const hasAlert = seed % 5 === 0;
    const hasWarning = seed % 3 === 0;

    summaries.push({ date: dateStr, count, hasAlert, hasWarning, available: count < 8 });
  }
  return summaries;
}

export async function GET(request) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const month = searchParams.get("month") || new Date().toISOString().slice(0, 7);
  const [year, mon] = month.split("-").map(Number);

  // ── Look up practice + accountMode ──────────────────────────────────────────
  let practice = null;
  let accountMode = "sandbox";
  try {
    const { prisma } = await import("../../../../../lib/prisma.js");
    practice = await prisma.practice.findUnique({ where: { clerkUserId: userId } });
    if (practice) accountMode = practice.accountMode || "sandbox";
  } catch { /* DB not available — fall through to sandbox */ }

  // ── Live mode: read counts from in-memory cache ─────────────────────────────
  if (practice && accountMode !== "sandbox") {
    const daysInMonth = new Date(year, mon, 0).getDate();
    const summaries = [];

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const dow = new Date(dateStr + "T12:00:00").getDay();
      if (dow === 0 || dow === 6) continue;

      // Read from patient cache (null if not loaded for this date)
      const cached = getCachedSchedule(practice.id, dateStr);
      const count = cached ? cached.length : 0;

      summaries.push({
        date: dateStr,
        count,
        hasAlert: false,   // Alerts live in frontend state (verification results)
        hasWarning: false,  // Warnings live in frontend state (verification results)
        available: count < 8,
      });
    }

    return Response.json(summaries);
  }

  // ── Sandbox mode: return synthetic data (works 24/7) ───────────────────────
  return Response.json(syntheticSummaries(month));
}
