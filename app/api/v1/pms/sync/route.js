/**
 * POST /api/v1/pms/sync
 *
 * Pulls today's (or a specified date's) appointments from the PMS and
 * stores them in the in-memory patient cache. NO data is written to Postgres.
 *
 * Body (all optional): { date: "YYYY-MM-DD" }
 * Response: { synced: N, skipped: N, date, source, pms_source }
 *
 * ZERO PHI AT REST: Patient data goes to lib/patientCache.js only.
 */
import { auth } from "@clerk/nextjs/server";
import { prisma } from "../../../../../lib/prisma.js";
import { logAudit, getClientIp } from "../../../../../lib/audit.js";
import { syncDailySchedule } from "../../../../../lib/opendental.js";
import { syncDailySchedule as dentrixSync } from "../../../../../lib/dentrix.js";
import { syncDailySchedule as eaglesoftSync } from "../../../../../lib/eaglesoft.js";
import { setCachedSchedule } from "../../../../../lib/patientCache.js";
import { checkPracticeActive } from "../../../../../lib/practiceGate.js";
import { recordSuccess, recordFailure } from "../../../../../lib/outageDetector.js";

const PMS_ADAPTERS = {
  "Open Dental": syncDailySchedule,
  "Dentrix": dentrixSync,
  "Eaglesoft": eaglesoftSync,
};

export async function POST(request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const date = body.date || new Date().toISOString().split("T")[0];

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return Response.json({ error: "Invalid date format — use YYYY-MM-DD" }, { status: 400 });
    }

    // Look up practice (stays in Postgres — business config, not PHI)
    let practice = null;
    try {
      practice = await prisma.practice.findUnique({ where: { clerkUserId: userId } });
    } catch (dbErr) {
      console.warn("[pms/sync] Practice lookup failed:", dbErr.message);
    }

    // Practice suspension gate
    const gate = checkPracticeActive(practice);
    if (gate) return gate;

    const adapter = PMS_ADAPTERS[practice?.pmsSystem] || syncDailySchedule;
    const practiceKey = practice?.pmsSyncKey || null;

    // Pull from the PMS
    let patients;
    try {
      patients = await adapter(date, practiceKey);
      await recordSuccess("opendental").catch(() => {});
    } catch (pmsErr) {
      await recordFailure("opendental").catch(() => {});
      console.error("[pms/sync] PMS adapter failed:", pmsErr.message);
      return Response.json({
        status: "system_outage",
        service: "opendental",
        message: "Practice management system is temporarily unavailable. Please try again later.",
        error: pmsErr.message,
      }, { status: 502 });
    }

    if (patients.length === 0) {
      return Response.json({
        synced: 0, skipped: 0, date,
        source: "opendental",
        pms_source: practice?.pmsSystem || "Open Dental",
        message: "No scheduled appointments found for this date",
      });
    }

    // Normalize PMS patients to our UI shape
    let synced = 0;
    let skipped = 0;
    const normalized = [];

    for (const p of patients) {
      if (!p.firstName || !p.lastName) { skipped++; continue; }
      normalized.push({
        id:              p.externalId || `pms_${synced}`,
        externalId:      p.externalId || null,
        name:            `${p.firstName} ${p.lastName}`.trim(),
        dob:             p.dateOfBirth     || "",
        memberId:        p.memberId        || "",
        insurance:       p.insuranceName   || "",
        procedure:       p.procedure       || "",
        provider:        p.provider        || "",
        phone:           p.phone           || "",
        email:           p.email           || "",
        fee:             null,
        isOON:           false,
        payerId:         p.payerId         || null,
        groupNumber:     p.groupNumber     || "",
        appointmentDate: p.appointmentDate || date,
        appointmentTime: p.appointmentTime || "",
        _source:         "pms_sync",
      });
      synced++;
    }

    // Store in cache (NOT Postgres)
    if (practice && normalized.length > 0) {
      await setCachedSchedule(practice.id, date, normalized);
    }

    // Audit log — no PHI, just counts
    logAudit({
      practiceId: practice?.id || null,
      userId,
      action: "pms.sync",
      resourceType: "Schedule",
      ipAddress: getClientIp(request),
      metadata: { synced, skipped, date, pms_source: practice?.pmsSystem || "Open Dental" },
    });

    return Response.json({
      synced, skipped, date,
      source: "opendental",
      pms_source: practice?.pmsSystem || "Open Dental",
    });

  } catch (err) {
    console.error("[pms/sync] Error:", err.name, err.message?.slice(0, 80));
    if (err.message?.includes("Open Dental")) {
      return Response.json({ error: "Could not connect to PMS. Please check your credentials and try again." }, { status: 502 });
    }
    return Response.json({ error: "Sync failed. Please try again." }, { status: 500 });
  }
}
