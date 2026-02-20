/**
 * GET /api/v1/patients/daily?date=YYYY-MM-DD
 *
 * Priority:
 *   1. Postgres — query Patient rows for this practice + date (from OD sync or CSV import)
 *   2. Open Dental API — pull directly from OD demo if DB is empty / unavailable
 *   3. Fixture fallback — hardcoded demo schedule (last resort if OD API also fails)
 *
 * Auth: Clerk userId → Practice.id lookup. Unauthenticated or practice-less → OD / fixture.
 */

import { auth } from "@clerk/nextjs/server";
import { prisma } from "../../../../../lib/prisma.js";
import { syncDailySchedule } from "../../../../../lib/opendental.js";

// ── Fixture data (last-resort fallback) ──────────────────────────────────────
const ALL_PATIENTS = [
  { id:"p1", name:"Sarah Mitchell",  dob:"1985-03-14", memberId:"UHC-884-221-09",  insurance:"UnitedHealthcare",       procedure:"Composite Restoration (D2391)",       provider:"Dr. Patel", fee:42000,  phone:"555-210-4832", email:"sarah.mitchell@email.com" },
  { id:"p2", name:"James Thornton",  dob:"1972-07-28", memberId:"DL-99032-TH",     insurance:"Delta Dental",           procedure:"Posterior Composite (D2392)",         provider:"Dr. Patel", fee:38000,  phone:"555-384-9201", email:"jthornton@email.com" },
  { id:"p3", name:"Maria Gonzalez",  dob:"1990-11-02", memberId:"BCBS-771-009-44", insurance:"Blue Cross Blue Shield", procedure:"Prophylaxis + Exam (D1110/D0120)",   provider:"Dr. Chen",  fee:22000,  phone:"555-601-7743", email:"mgonzalez@email.com" },
  { id:"p4", name:"Robert Kim",      dob:"1968-05-19", memberId:"CIG-44823-RK",    insurance:"Cigna",                  procedure:"Implant Crown (D6065)",               provider:"Dr. Patel", fee:185000, phone:"555-928-3310", email:"robert.kim@email.com" },
  { id:"p5", name:"Emily Watkins",   dob:"1995-09-30", memberId:"MET-229-884-EW",  insurance:"MetLife",                procedure:"Prophylaxis + X-rays (D1110/D0274)", provider:"Dr. Chen",  fee:28000,  phone:"555-473-6621", email:"ewatkins@email.com" },
  { id:"p6", name:"David Okafor",    dob:"1980-01-15", memberId:"AET-55901-DO",    insurance:"Aetna",                  procedure:"Scaling & Root Planing (D4341)",     provider:"Dr. Patel", fee:75000,  phone:"555-119-8847", email:"dokafor@email.com" },
  { id:"p7", name:"Lisa Chen",       dob:"1987-06-12", memberId:"HUM-334-227-LC",  insurance:"Humana Dental",          procedure:"Crown, Porcelain (D2750)",           provider:"Dr. Patel", fee:145000, phone:"555-302-8819", email:"lisa.chen@email.com", isOON:true },
  { id:"p8", name:"Marvin Medicaid",  dob:"1978-08-22", memberId:"TMHP-990-221-08", insurance:"Texas Medicaid (TMHP)",  procedure:"Crown, PFM (D2750)",                 provider:"Dr. Patel", fee:75000,  phone:"555-888-4401", email:"marvin.m@email.com",   payerId:"77037" },
];

const WEEKLY_SCHEDULE = {
  // Every day showcases: clear✅, OON⚠️, Medicaid💜, pre-auth/MTC🔴, warning⚠️, and more
  1: [["p1","8:00 AM"],["p8","9:00 AM"],["p7","10:00 AM"],["p4","11:00 AM"],["p5","1:00 PM"],["p6","2:30 PM"]],
  2: [["p2","8:00 AM"],["p4","9:00 AM"],["p8","10:00 AM"],["p1","11:00 AM"],["p7","1:00 PM"],["p3","2:00 PM"],["p5","3:30 PM"]],
  3: [["p6","8:00 AM"],["p8","9:00 AM"],["p2","10:00 AM"],["p7","11:00 AM"],["p4","1:00 PM"],["p1","2:30 PM"]],
  4: [["p5","8:00 AM"],["p7","9:00 AM"],["p8","10:00 AM"],["p3","11:00 AM"],["p6","12:30 PM"],["p2","2:00 PM"],["p4","3:30 PM"]],
  5: [["p1","8:00 AM"],["p8","9:00 AM"],["p4","10:00 AM"],["p7","11:00 AM"],["p5","1:00 PM"],["p6","2:30 PM"]],
};

function parseTime(timeStr) {
  const [time, meridiem] = (timeStr || "12:00 PM").split(" ");
  let [hours, minutes] = time.split(":").map(Number);
  if (meridiem === "PM" && hours !== 12) hours += 12;
  if (meridiem === "AM" && hours === 12) hours = 0;
  return { hours: hours || 12, minutes: minutes || 0 };
}

function fixtureForDate(date) {
  const dow = new Date(date + "T12:00:00").getDay();
  const slots = WEEKLY_SCHEDULE[dow] || [];
  const patientMap = Object.fromEntries(ALL_PATIENTS.map(p => [p.id, p]));
  const nowMs = Date.now();

  return slots.map(([id, timeStr]) => {
    const base = patientMap[id];
    const { hours, minutes } = parseTime(timeStr);
    const apptDate = new Date(`${date}T${String(hours).padStart(2,"0")}:${String(minutes).padStart(2,"0")}:00`);
    const hoursUntil = Math.round(((apptDate.getTime() - nowMs) / 3600000) * 10) / 10;
    return { ...base, appointmentDate: date, appointmentTime: timeStr, hoursUntil, payerId: base.payerId || null, _source: "fixture" };
  });
}

/**
 * Pull from Open Dental API directly and normalize to our patient shape.
 * This uses the same syncDailySchedule function but skips the DB entirely.
 */
async function odDirectForDate(date) {
  const odPatients = await syncDailySchedule(date);
  if (!odPatients || odPatients.length === 0) return [];

  const nowMs = Date.now();
  return odPatients.map((p, idx) => {
    let hoursUntil = 0;
    try {
      const { hours, minutes } = parseTime(p.appointmentTime || "12:00 PM");
      const apptDate = new Date(`${date}T${String(hours).padStart(2,"0")}:${String(minutes).padStart(2,"0")}:00`);
      hoursUntil = Math.round(((apptDate.getTime() - nowMs) / 3600000) * 10) / 10;
    } catch { /* leave 0 */ }

    return {
      id:              p.externalId || `od_${idx}`,
      name:            `${p.firstName} ${p.lastName}`.trim(),
      dob:             p.dateOfBirth   || "",
      memberId:        p.memberId      || "",
      insurance:       p.insuranceName || "",
      procedure:       p.procedure     || "",
      provider:        p.provider      || "",
      phone:           p.phone         || "",
      email:           p.email         || "",
      fee:             null,
      isOON:           false,
      payerId:         p.payerId       || null,
      appointmentDate: p.appointmentDate || date,
      appointmentTime: p.appointmentTime || "",
      hoursUntil,
      _source:         "opendental",
    };
  });
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") || new Date().toISOString().split("T")[0];

  // ── 1. Try Postgres first — requires auth + a practice record + DATABASE_URL ──
  if (process.env.DATABASE_URL) {
    try {
      const { userId } = await auth();

      if (userId) {
        const practice = await prisma.practice.findUnique({ where: { clerkUserId: userId } });

        if (practice) {
          const dbPatients = await prisma.patient.findMany({
            where:   { practiceId: practice.id, appointmentDate: date },
            orderBy: { appointmentTime: "asc" },
          });

          if (dbPatients.length > 0) {
            const nowMs = Date.now();
            const mapped = dbPatients.map(p => {
              let hoursUntil = 0;
              try {
                const { hours, minutes } = parseTime(p.appointmentTime || "12:00 PM");
                const apptDate = new Date(`${date}T${String(hours).padStart(2,"0")}:${String(minutes).padStart(2,"0")}:00`);
                hoursUntil = Math.round(((apptDate.getTime() - nowMs) / 3600000) * 10) / 10;
              } catch { /* leave 0 */ }

              return {
                id:              p.id,
                name:            `${p.firstName} ${p.lastName}`,
                dob:             p.dateOfBirth   || "",
                memberId:        p.memberId      || "",
                insurance:       p.insuranceName || "",
                procedure:       p.procedure     || "",
                provider:        p.provider      || "",
                phone:           p.phone         || "",
                email:           p.email         || "",
                fee:             null,
                isOON:           p.isOON         || false,
                payerId:         p.payerId       || null,
                appointmentDate: p.appointmentDate || date,
                appointmentTime: p.appointmentTime || "",
                hoursUntil,
                _source:         "postgres",
              };
            });
            return Response.json(mapped);
          }
        }
      }
    } catch (_err) {
      console.warn("[daily] DB lookup failed, falling through to OD API:", _err.message);
    }
  }

  // ── 2. Try Open Dental API directly — no DB required ──
  try {
    const odResults = await odDirectForDate(date);
    if (odResults.length > 0) {
      return Response.json(odResults);
    }
    // OD returned 0 patients for this date — fall through to fixture
  } catch (odErr) {
    console.warn("[daily] OD API direct call failed, falling to fixture:", odErr.message);
  }

  // ── 3. Fixture fallback — demo mode, always works ──
  return Response.json(fixtureForDate(date));
}
