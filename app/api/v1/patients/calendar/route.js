/**
 * GET /api/v1/patients/calendar?month=YYYY-MM
 *
 * Returns CalendarDaySummary[] for every weekday in the given month.
 * Counts are deterministic per date so the calendar always looks consistent.
 */
import { auth } from "@clerk/nextjs/server";

function hashStr(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export async function GET(request) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const month = searchParams.get("month") || new Date().toISOString().slice(0, 7);

  const [year, mon] = month.split("-").map(Number);
  const daysInMonth = new Date(year, mon, 0).getDate();

  const summaries = [];

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const dow = new Date(dateStr + "T12:00:00").getDay();

    // Skip weekends
    if (dow === 0 || dow === 6) continue;

    const seed = hashStr(dateStr);
    const count = 4 + (seed % 5); // 4–8 patients per day
    const hasAlert = seed % 5 === 0;   // ~20% of days have a critical alert
    const hasWarning = seed % 3 === 0; // ~33% of days have a warning

    summaries.push({
      date: dateStr,
      count,
      hasAlert,
      hasWarning,
      available: count < 8,
    });
  }

  return Response.json(summaries);
}
