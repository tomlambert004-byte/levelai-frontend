/**
 * POST /api/v1/patients/import
 *
 * Accepts a JSON array of parsed CSV rows and bulk-loads them into the
 * in-memory patient cache under the authenticated practice.
 * NO data is written to Postgres.
 *
 * Each row shape (all strings, all optional except firstName + lastName):
 * {
 *   firstName, lastName, dateOfBirth,
 *   phone, email,
 *   memberId, groupNumber, insuranceName, payerId,
 *   procedure, provider,
 *   appointmentDate, appointmentTime,
 * }
 *
 * Returns: { imported: N, skipped: N, errors: [...] }
 *
 * ZERO PHI AT REST: Patient data goes to lib/patientCache.js only.
 */
import { auth } from "@clerk/nextjs/server";
import { prisma } from "../../../../../lib/prisma.js";
import { logAudit, getClientIp } from "../../../../../lib/audit.js";
import { getCachedSchedule, setCachedSchedule } from "../../../../../lib/patientCache.js";

export async function POST(request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Look up practice (business config stays in Postgres)
    const practice = await prisma.practice.findUnique({ where: { clerkUserId: userId } });
    if (!practice) {
      return Response.json({ error: "Practice not found" }, { status: 404 });
    }

    const body = await request.json();
    if (!Array.isArray(body.patients) || body.patients.length === 0) {
      return Response.json({ error: "No patients provided" }, { status: 400 });
    }

    const patients = body.patients.slice(0, 500); // hard cap — safety guard
    const errors  = [];
    let imported  = 0;
    let skipped   = 0;

    // Group patients by appointment date for cache storage
    const byDate = {};

    for (const row of patients) {
      const firstName = (row.firstName || "").trim();
      const lastName  = (row.lastName  || "").trim();

      if (!firstName || !lastName) {
        skipped++;
        errors.push(`Row ${patients.indexOf(row) + 1}: missing firstName or lastName`);
        continue;
      }

      const dateKey = (row.appointmentDate || "").trim() || new Date().toISOString().split("T")[0];

      if (!byDate[dateKey]) byDate[dateKey] = [];
      byDate[dateKey].push({
        id:              `csv_${imported}`,
        externalId:      null,
        name:            `${firstName} ${lastName}`,
        dob:             (row.dateOfBirth     || "").trim(),
        memberId:        (row.memberId        || "").trim() || "",
        insurance:       (row.insuranceName   || "").trim() || "",
        procedure:       (row.procedure       || "").trim() || "",
        provider:        (row.provider        || "").trim() || "",
        phone:           (row.phone           || "").trim() || "",
        email:           (row.email           || "").trim() || "",
        fee:             null,
        isOON:           false,
        payerId:         (row.payerId         || "").trim() || null,
        groupNumber:     (row.groupNumber     || "").trim() || "",
        appointmentDate: dateKey,
        appointmentTime: (row.appointmentTime || "").trim() || "",
        _source:         "csv_import",
      });
      imported++;
    }

    // Merge into cache per date
    for (const [dateStr, newPatients] of Object.entries(byDate)) {
      const existing = getCachedSchedule(practice.id, dateStr) || [];
      // Deduplicate by lowercase name
      const seen = new Set(existing.map(p => p.name.toLowerCase()));
      const merged = [...existing];
      for (const p of newPatients) {
        const key = p.name.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(p);
        }
      }
      setCachedSchedule(practice.id, dateStr, merged);
    }

    // Audit log — no PHI, just counts
    logAudit({
      practiceId: practice.id,
      userId,
      action: "patient.import",
      resourceType: "Schedule",
      ipAddress: getClientIp(request),
      metadata: { imported, skipped, total: patients.length },
    });

    return Response.json({ imported, skipped, errors: errors.slice(0, 20) });
  } catch (err) {
    console.error("[patients/import] Error:", err.name);
    return Response.json({ error: "Import failed. Please try again." }, { status: 500 });
  }
}
