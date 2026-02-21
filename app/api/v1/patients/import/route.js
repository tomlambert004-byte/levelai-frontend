/**
 * POST /api/v1/patients/import
 *
 * Accepts a JSON array of parsed CSV rows and bulk-upserts them into the
 * Patient table under the authenticated practice.
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
 */
import { auth } from "@clerk/nextjs/server";
import { prisma } from "../../../../../lib/prisma.js";
import { logAudit, getClientIp } from "../../../../../lib/audit.js";

export async function POST(request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get or create the practice record for this user
    const practice = await prisma.practice.upsert({
      where:  { clerkUserId: userId },
      update: {},
      create: { clerkUserId: userId, name: "My Practice" },
    });

    const body = await request.json();
    if (!Array.isArray(body.patients) || body.patients.length === 0) {
      return Response.json({ error: "No patients provided" }, { status: 400 });
    }

    const patients = body.patients.slice(0, 500); // hard cap — safety guard
    const errors  = [];
    let imported  = 0;
    let skipped   = 0;

    for (const row of patients) {
      const firstName = (row.firstName || "").trim();
      const lastName  = (row.lastName  || "").trim();

      if (!firstName || !lastName) {
        skipped++;
        errors.push(`Row ${patients.indexOf(row) + 1}: missing firstName or lastName`);
        continue;
      }

      try {
        await prisma.patient.create({
          data: {
            practiceId:      practice.id,
            firstName,
            lastName,
            dateOfBirth:     (row.dateOfBirth     || "").trim(),
            phone:           (row.phone           || "").trim() || null,
            email:           (row.email           || "").trim() || null,
            memberId:        (row.memberId        || "").trim() || null,
            groupNumber:     (row.groupNumber     || "").trim() || null,
            insuranceName:   (row.insuranceName   || "").trim() || null,
            payerId:         (row.payerId         || "").trim() || null,
            procedure:       (row.procedure       || "").trim() || null,
            provider:        (row.provider        || "").trim() || null,
            appointmentDate: (row.appointmentDate || "").trim() || null,
            appointmentTime: (row.appointmentTime || "").trim() || null,
          },
        });
        imported++;
      } catch (err) {
        skipped++;
        errors.push(`Row ${patients.indexOf(row) + 1}: import failed`);
      }
    }

    logAudit({
      practiceId: practice.id,
      userId,
      action: "patient.import",
      resourceType: "Patient",
      ipAddress: getClientIp(request),
      metadata: { imported, skipped, total: patients.length },
    });

    return Response.json({ imported, skipped, errors: errors.slice(0, 20) });
  } catch (err) {
    console.error("[patients/import] Error:", err.name);
    return Response.json({ error: "Import failed. Please try again." }, { status: 500 });
  }
}
