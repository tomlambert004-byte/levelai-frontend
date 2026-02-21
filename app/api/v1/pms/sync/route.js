/**
 * POST /api/v1/pms/sync
 *
 * Pulls today's (or a specified date's) appointments from Open Dental,
 * upserts them into the Patient table under the authenticated practice,
 * and returns the count of synced patients.
 *
 * If DATABASE_URL is not configured, it still pulls from OD but skips the
 * DB upsert and returns the count with a note that DB persistence was skipped.
 *
 * Body (all optional): { date: "YYYY-MM-DD" }
 *
 * Response: { synced: N, skipped: N, date: "YYYY-MM-DD", source: "opendental" }
 */
import { auth } from "@clerk/nextjs/server";
import { prisma } from "../../../../../lib/prisma.js";
import { logAudit, getClientIp } from "../../../../../lib/audit.js";
import { syncDailySchedule } from "../../../../../lib/opendental.js";
import { syncDailySchedule as dentrixSync } from "../../../../../lib/dentrix.js";
import { syncDailySchedule as eaglesoftSync } from "../../../../../lib/eaglesoft.js";

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

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return Response.json({ error: "Invalid date format — use YYYY-MM-DD" }, { status: 400 });
    }

    // Try to persist to DB if DATABASE_URL is available
    let synced  = 0;
    let skipped = 0;
    let dbPersisted = false;
    let practice = null;

    if (process.env.DATABASE_URL) {
      try {
        // Get or create the practice record
        practice = await prisma.practice.upsert({
          where:  { clerkUserId: userId },
          update: {},
          create: { clerkUserId: userId, name: "My Practice" },
        });
      } catch (dbErr) {
        console.warn("[pms/sync] DB practice lookup failed:", dbErr.message);
      }
    }

    // Determine the adapter based on practice PMS system
    const adapter = PMS_ADAPTERS[practice?.pmsSystem] || syncDailySchedule;

    // Pull from the selected PMS adapter
    const patients = await adapter(date);

    if (patients.length === 0) {
      return Response.json({
        synced:  0,
        skipped: 0,
        date,
        source:  "opendental",
        pms_source: practice?.pmsSystem || "Open Dental",
        message: "No scheduled appointments found for this date",
      });
    }

    if (process.env.DATABASE_URL && practice) {
      try {
        for (const p of patients) {
          if (!p.firstName || !p.lastName) { skipped++; continue; }

          try {
            const patientData = {
              firstName:       p.firstName,
              lastName:        p.lastName,
              dateOfBirth:     p.dateOfBirth     || "",
              phone:           p.phone           || null,
              email:           p.email           || null,
              insuranceName:   p.insuranceName   || null,
              memberId:        p.memberId        || null,
              groupNumber:     p.groupNumber     || null,
              payerId:         p.payerId         || null,
              procedure:       p.procedure       || null,
              provider:        p.provider        || null,
              appointmentDate: p.appointmentDate || null,
              appointmentTime: p.appointmentTime || null,
            };

            // Find-then-update pattern (idempotent re-sync by externalId)
            if (p.externalId) {
              const existing = await prisma.patient.findFirst({
                where: { practiceId: practice.id, externalId: p.externalId },
              });
              if (existing) {
                await prisma.patient.update({ where: { id: existing.id }, data: patientData });
              } else {
                await prisma.patient.create({
                  data: { practiceId: practice.id, externalId: p.externalId, ...patientData },
                });
              }
            } else {
              await prisma.patient.create({
                data: { practiceId: practice.id, ...patientData },
              });
            }
            synced++;
          } catch (err) {
            console.error(`[pms/sync] Patient upsert failed (externalId: ${p.externalId || "none"}):`, err.message);
            skipped++;
          }
        }
        dbPersisted = true;
      } catch (dbErr) {
        console.warn("[pms/sync] DB upsert failed, returning data without persistence:", dbErr.message);
        // Count all valid patients as synced even without DB
        synced = patients.filter(p => p.firstName && p.lastName).length;
        skipped = patients.length - synced;
      }
    } else {
      // No DB — just count the patients
      synced = patients.filter(p => p.firstName && p.lastName).length;
      skipped = patients.length - synced;
    }

    logAudit({
      practiceId: practice?.id,
      userId,
      action: "pms.sync",
      resourceType: "Patient",
      ipAddress: getClientIp(request),
      metadata: { synced, skipped, date, pms_source: practice?.pmsSystem || "Open Dental" },
    });

    return Response.json({
      synced,
      skipped,
      date,
      source: "opendental",
      pms_source: practice?.pmsSystem || "Open Dental",
      persisted: dbPersisted,
      message: dbPersisted
        ? undefined
        : "Patients pulled from PMS (DB persistence skipped — DATABASE_URL not configured)",
    });

  } catch (err) {
    console.error("[pms/sync] Error:", err.name, err.message?.slice(0, 80));
    if (err.message?.includes("Open Dental")) {
      return Response.json({ error: "Could not connect to PMS. Please check your credentials and try again." }, { status: 502 });
    }
    return Response.json({ error: "Sync failed. Please try again." }, { status: 500 });
  }
}
