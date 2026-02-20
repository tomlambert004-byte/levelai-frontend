/**
 * GET /api/v1/patients/daily?date=YYYY-MM-DD
 *
 * Returns a realistic daily schedule for a dental office.
 * Each weekday has a curated, fixed patient list (3-6 patients) with
 * real appointment times. The same date always returns the same list.
 *
 * All 7 patients map to p1-p7 so the verify endpoint can look them up.
 * p7 (Lisa Chen) is an OON patient — triggers the OON Estimator widget.
 *
 * hoursUntil is computed relative to NOW so the auto-verify
 * (24h and 7d windows) triggers correctly in the UI.
 */

const ALL_PATIENTS = [
  {
    id: "p1",
    name: "Sarah Mitchell",
    dob: "1985-03-14",
    memberId: "UHC-884-221-09",
    insurance: "UnitedHealthcare",
    procedure: "Composite Restoration (D2391)",
    provider: "Dr. Patel",
    fee: 42000,
    phone: "555-210-4832",
    email: "sarah.mitchell@email.com",
  },
  {
    id: "p2",
    name: "James Thornton",
    dob: "1972-07-28",
    memberId: "DL-99032-TH",
    insurance: "Delta Dental",
    procedure: "Posterior Composite (D2392)",
    provider: "Dr. Patel",
    fee: 38000,
    phone: "555-384-9201",
    email: "jthornton@email.com",
  },
  {
    id: "p3",
    name: "Maria Gonzalez",
    dob: "1990-11-02",
    memberId: "BCBS-771-009-44",
    insurance: "Blue Cross Blue Shield",
    procedure: "Prophylaxis + Exam (D1110/D0120)",
    provider: "Dr. Chen",
    fee: 22000,
    phone: "555-601-7743",
    email: "mgonzalez@email.com",
  },
  {
    id: "p4",
    name: "Robert Kim",
    dob: "1968-05-19",
    memberId: "CIG-44823-RK",
    insurance: "Cigna",
    procedure: "Implant Crown (D6065)",
    provider: "Dr. Patel",
    fee: 185000,
    phone: "555-928-3310",
    email: "robert.kim@email.com",
  },
  {
    id: "p5",
    name: "Emily Watkins",
    dob: "1995-09-30",
    memberId: "MET-229-884-EW",
    insurance: "MetLife",
    procedure: "Prophylaxis + X-rays (D1110/D0274)",
    provider: "Dr. Chen",
    fee: 28000,
    phone: "555-473-6621",
    email: "ewatkins@email.com",
  },
  {
    id: "p6",
    name: "David Okafor",
    dob: "1980-01-15",
    memberId: "AET-55901-DO",
    insurance: "Aetna",
    procedure: "Scaling & Root Planing (D4341)",
    provider: "Dr. Patel",
    fee: 75000,
    phone: "555-119-8847",
    email: "dokafor@email.com",
  },
  {
    id: "p7",
    name: "Lisa Chen",
    dob: "1987-06-12",
    memberId: "HUM-334-227-LC",
    insurance: "Humana Dental",
    procedure: "Crown, Porcelain (D2750)",
    provider: "Dr. Patel",
    fee: 145000,
    phone: "555-302-8819",
    email: "lisa.chen@email.com",
    isOON: true,                   // flag so UI can badge this patient
  },
];

// Curated weekly schedule by day-of-week (0=Sun,1=Mon,…,5=Fri,6=Sat).
// Each entry: [patientId, "H:MM AM/PM"]
// Weekends are empty — the calendar route skips them too.
const WEEKLY_SCHEDULE = {
  1: [ // Monday — light day: 4 patients
    ["p3", "8:30 AM"],
    ["p1", "10:00 AM"],
    ["p5", "1:00 PM"],
    ["p6", "3:00 PM"],
  ],
  2: [ // Tuesday — busy day: 6 patients (p7 = OON)
    ["p2", "8:00 AM"],
    ["p4", "9:30 AM"],
    ["p1", "11:00 AM"],
    ["p3", "1:30 PM"],
    ["p7", "2:30 PM"],
    ["p5", "3:30 PM"],
  ],
  3: [ // Wednesday — medium: 5 patients (p7 = OON)
    ["p6", "8:30 AM"],
    ["p2", "10:00 AM"],
    ["p7", "11:30 AM"],
    ["p4", "1:00 PM"],
    ["p1", "3:00 PM"],
  ],
  4: [ // Thursday — busy day: 6 patients (p7 = OON)
    ["p5", "8:00 AM"],
    ["p7", "9:00 AM"],
    ["p3", "10:30 AM"],
    ["p6", "12:00 PM"],
    ["p2", "1:30 PM"],
    ["p4", "3:30 PM"],
  ],
  5: [ // Friday — short day: 3 patients
    ["p1", "8:30 AM"],
    ["p3", "10:00 AM"],
    ["p5", "11:30 AM"],
  ],
};

// Parse "H:MM AM/PM" → { hours, minutes } in 24h
function parseTime(timeStr) {
  const [time, meridiem] = timeStr.split(" ");
  let [hours, minutes] = time.split(":").map(Number);
  if (meridiem === "PM" && hours !== 12) hours += 12;
  if (meridiem === "AM" && hours === 12) hours = 0;
  return { hours, minutes };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") || new Date().toISOString().split("T")[0];

  // Day of week for the requested date (use noon to avoid DST edge cases)
  const dow = new Date(date + "T12:00:00").getDay();
  const slots = WEEKLY_SCHEDULE[dow] || [];

  const patientMap = Object.fromEntries(ALL_PATIENTS.map(p => [p.id, p]));
  const nowMs = Date.now();

  const patients = slots.map(([id, timeStr]) => {
    const base = patientMap[id];
    const { hours, minutes } = parseTime(timeStr);

    // Build appointment datetime in local time
    const apptDate = new Date(`${date}T${String(hours).padStart(2,"0")}:${String(minutes).padStart(2,"0")}:00`);
    const hoursUntil = (apptDate.getTime() - nowMs) / (1000 * 60 * 60);

    return {
      ...base,
      appointmentDate: date,
      appointmentTime: timeStr,
      hoursUntil: Math.round(hoursUntil * 10) / 10, // one decimal, keeps auto-verify logic accurate
    };
  });

  return Response.json(patients);
}
