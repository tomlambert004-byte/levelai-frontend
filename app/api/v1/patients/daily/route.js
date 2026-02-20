/**
 * GET /api/v1/patients/daily?date=YYYY-MM-DD
 *
 * Returns a realistic daily schedule: 5-8 patients per day, different
 * subsets on different days, with real appointment times spread across
 * the workday. Uses the date to deterministically pick which patients
 * are scheduled so the same date always returns the same list.
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
];

// Appointment time slots across a typical dental workday
const TIME_SLOTS = [
  "8:00 AM", "8:30 AM", "9:00 AM", "9:30 AM",
  "10:00 AM", "10:30 AM", "11:00 AM", "11:30 AM",
  "1:00 PM", "1:30 PM", "2:00 PM", "2:30 PM",
  "3:00 PM", "3:30 PM", "4:00 PM",
];

// Simple deterministic hash of a string → integer
function hashStr(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") || new Date().toISOString().split("T")[0];

  // Use the date as a seed so the same date always returns the same patients
  const seed = hashStr(date);

  // Pick 5–7 patients for this day (deterministic)
  const count = 5 + (seed % 3); // 5, 6, or 7
  const shuffled = [...ALL_PATIENTS].sort((a, b) => {
    return hashStr(date + a.id) - hashStr(date + b.id);
  });
  const todaysPatients = shuffled.slice(0, count);

  // Assign appointment times in order
  const timeOffset = seed % 3; // shifts which slots we start from
  const patients = todaysPatients.map((p, i) => {
    const timeSlot = TIME_SLOTS[(i * 2 + timeOffset) % TIME_SLOTS.length];
    const apptMs = new Date(`${date}T09:00:00`).getTime();
    const nowMs = Date.now();
    const hoursUntil = Math.round((apptMs - nowMs) / (1000 * 60 * 60)) + i * 0.5;

    return {
      ...p,
      appointmentDate: date,
      appointmentTime: timeSlot,
      hoursUntil: Math.round(hoursUntil),
    };
  });

  return Response.json(patients);
}
