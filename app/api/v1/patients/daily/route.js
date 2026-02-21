/**
 * GET /api/v1/patients/daily?date=YYYY-MM-DD
 *
 * Priority:
 *   1. In-memory cache — instant return for already-loaded schedules
 *   2. PMS API pull — lazy warm-up on cache miss, populates cache for subsequent requests
 *   3. Demo mode — fixture roster (sandbox only, available 24/7)
 *
 * Auth: Clerk userId → Practice.id lookup. Unauthenticated or practice-less → demo mode.
 *
 * ZERO PHI AT REST: No patient data is written to Postgres. All patient data
 * lives in the in-memory cache (lib/patientCache.js) with a daily expiry window.
 */

import { auth } from "@clerk/nextjs/server";
import { prisma } from "../../../../../lib/prisma.js";
import { syncDailySchedule } from "../../../../../lib/opendental.js";
import { getCachedSchedule, setCachedSchedule } from "../../../../../lib/patientCache.js";
import { checkPracticeActive } from "../../../../../lib/practiceGate.js";

// Ensure Next.js never caches this route — schedule data must be fresh every request
export const dynamic = "force-dynamic";

// ── Fixture data (sandbox/demo fallback — available 24/7) ────────────────────
const ALL_PATIENTS = [
  { id:"p1", name:"Sarah Mitchell",  gender:"F", dob:"1985-03-14", memberId:"UHC-884-221-09",  insurance:"UnitedHealthcare",       procedure:"Composite Restoration (D2391)",       provider:"Dr. Patel", fee:42000,  phone:"555-210-4832", email:"sarah.mitchell@email.com" },
  { id:"p2", name:"James Thornton",  gender:"M", dob:"1972-07-28", memberId:"DL-99032-TH",     insurance:"Delta Dental",           procedure:"Posterior Composite (D2392)",         provider:"Dr. Patel", fee:38000,  phone:"555-384-9201", email:"jthornton@email.com" },
  { id:"p3", name:"Maria Gonzalez",  gender:"F", dob:"1990-11-02", memberId:"BCBS-771-009-44", insurance:"Blue Cross Blue Shield", procedure:"Prophylaxis + Exam (D1110/D0120)",   provider:"Dr. Chen",  fee:22000,  phone:"555-601-7743", email:"mgonzalez@email.com" },
  { id:"p4", name:"Robert Kim",      gender:"M", dob:"1968-05-19", memberId:"CIG-44823-RK",    insurance:"Cigna",                  procedure:"Implant Crown (D6065)",               provider:"Dr. Patel", fee:185000, phone:"555-928-3310", email:"robert.kim@email.com" },
  { id:"p5", name:"Emily Watkins",   gender:"F", dob:"1995-09-30", memberId:"MET-229-884-EW",  insurance:"MetLife",                procedure:"Prophylaxis + X-rays (D1110/D0274)", provider:"Dr. Chen",  fee:28000,  phone:"555-473-6621", email:"ewatkins@email.com" },
  { id:"p6", name:"David Okafor",    gender:"M", dob:"1980-01-15", memberId:"AET-55901-DO",    insurance:"Aetna",                  procedure:"Scaling & Root Planing (D4341)",     provider:"Dr. Patel", fee:75000,  phone:"555-119-8847", email:"dokafor@email.com" },
  { id:"p7", name:"Lisa Chen",       gender:"F", dob:"1987-06-12", memberId:"HUM-334-227-LC",  insurance:"Humana Dental",          procedure:"Crown, Porcelain (D2750)",           provider:"Dr. Patel", fee:145000, phone:"555-302-8819", email:"lisa.chen@email.com", isOON:true },
  { id:"p8", name:"Marvin Medicaid", gender:"M", dob:"1978-08-22", memberId:"TMHP-990-221-08", insurance:"Texas Medicaid (TMHP)",  procedure:"Crown, PFM (D2750)",                 provider:"Dr. Patel", fee:75000,  phone:"555-888-4401", email:"marvin.m@email.com",   payerId:"77037" },
];

const WEEKLY_SCHEDULE = {
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
  let dow = new Date(date + "T12:00:00").getDay();
  if (dow === 0) dow = 1;
  if (dow === 6) dow = 5;
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
 * Normalize PMS patients to our standard UI shape.
 */
function normalizePmsPatients(pmsPatients, date) {
  const nowMs = Date.now();
  return pmsPatients.map((p, idx) => {
    let hoursUntil = 0;
    try {
      const { hours, minutes } = parseTime(p.appointmentTime || "12:00 PM");
      const apptDate = new Date(`${date}T${String(hours).padStart(2,"0")}:${String(minutes).padStart(2,"0")}:00`);
      hoursUntil = Math.round(((apptDate.getTime() - nowMs) / 3600000) * 10) / 10;
    } catch { /* leave 0 */ }

    return {
      id:              p.externalId || `od_${idx}`,
      externalId:      p.externalId || null,
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
      _source:         "pms",
    };
  });
}

/** Recompute volatile hoursUntil for cached patients */
function recomputeHoursUntil(patients, date) {
  const nowMs = Date.now();
  return patients.map(p => {
    let hoursUntil = 0;
    try {
      const { hours, minutes } = parseTime(p.appointmentTime || "12:00 PM");
      const apptDate = new Date(`${date}T${String(hours).padStart(2,"0")}:${String(minutes).padStart(2,"0")}:00`);
      hoursUntil = Math.round(((apptDate.getTime() - nowMs) / 3600000) * 10) / 10;
    } catch { /* leave 0 */ }
    return { ...p, hoursUntil };
  });
}

function sortByTime(patients) {
  return patients.sort((a, b) => {
    const ta = parseTime(a.appointmentTime || "12:00 PM");
    const tb = parseTime(b.appointmentTime || "12:00 PM");
    return (ta.hours * 60 + ta.minutes) - (tb.hours * 60 + tb.minutes);
  });
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") || new Date().toISOString().split("T")[0];

  // ── Resolve practice + account mode ─────────────────────────────────────────
  let practice = null;
  let accountMode = "sandbox";
  let practiceKey = null;

  try {
    const { userId } = await auth();
    if (userId) {
      practice = await prisma.practice.findUnique({ where: { clerkUserId: userId } });
      if (practice) {
        accountMode = practice.accountMode || "sandbox";
        practiceKey = practice.pmsSyncKey || null;
      }
    }
  } catch { /* unauthenticated → sandbox */ }

  // ── Practice suspension gate ──────────────────────────────────────────────
  const gate = checkPracticeActive(practice);
  if (gate) return gate;

  // ── Sandbox mode: fixtures (available 24/7) ─────────────────────────────────
  if (accountMode === "sandbox" || !practice) {
    const fixtures = fixtureForDate(date);

    // In sandbox mode, also layer in OD API results for a rich demo
    let odResults = [];
    try {
      odResults = normalizePmsPatients(await syncDailySchedule(date, practiceKey), date);
    } catch { /* OD not available — fixtures only */ }

    // Merge: OD first (higher priority), fixtures fill gaps, deduplicate by name
    const seen = new Set();
    const merged = [];
    for (const p of [...odResults, ...fixtures]) {
      const key = p.name.toLowerCase();
      if (!seen.has(key)) { seen.add(key); merged.push(p); }
    }
    return Response.json(sortByTime(merged));
  }

  // ── Live mode: cache-first, PMS fallback ────────────────────────────────────

  // 1. Check cache
  const cached = getCachedSchedule(practice.id, date);
  if (cached && cached.length > 0) {
    return Response.json(sortByTime(recomputeHoursUntil(cached, date)));
  }

  // 2. Cache miss → pull from PMS directly, populate cache, return
  try {
    const pmsPatients = await syncDailySchedule(date, practiceKey);
    if (pmsPatients && pmsPatients.length > 0) {
      const normalized = normalizePmsPatients(pmsPatients, date);
      setCachedSchedule(practice.id, date, normalized);
      return Response.json(sortByTime(normalized));
    }
  } catch (pmsErr) {
    console.warn("[daily] PMS pull failed on cache miss:", pmsErr.message);
  }

  // 3. No cache, no PMS data → empty schedule
  return Response.json([]);
}
