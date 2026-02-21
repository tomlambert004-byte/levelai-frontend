/**
 * Open Dental REST API client
 *
 * Docs: https://www.opendental.com/site/apispecification.html
 *
 * Auth: Authorization: ODFHIR {developerKey}/{customerKey}
 * Remote base: https://api.opendental.com/api/v1
 *
 * Environment variables:
 *   OD_API_BASE_URL   — defaults to https://api.opendental.com/api/v1
 *   OD_DEV_KEY        — your developer key (NFF6i0KrXrxDkZHt for demo)
 *   OD_CUSTOMER_KEY   — the practice's customer key (VzkmZEaUWOjnQX2z for demo)
 *
 * For demo/testing, set:
 *   OD_DEV_KEY=NFF6i0KrXrxDkZHt
 *   OD_CUSTOMER_KEY=VzkmZEaUWOjnQX2z
 *
 * Demo mode: The OD demo database only has appointments in Sep-Oct 2020.
 * When using demo keys, if the requested date has no appointments, we pull
 * from the demo's populated dates and remap them to the current week so the
 * schedule looks realistic.
 */

const OD_BASE = process.env.OD_API_BASE_URL || "https://api.opendental.com/api/v1";

function odAuth() {
  const dev  = process.env.OD_DEV_KEY;
  const cust = process.env.OD_CUSTOMER_KEY;
  if (!dev || !cust) {
    throw new Error("Open Dental credentials not configured. Set OD_DEV_KEY and OD_CUSTOMER_KEY.");
  }
  return `ODFHIR ${dev}/${cust}`;
}

/** True when using the OD demo sandbox keys (set via env vars, not hardcoded) */
function isDemoMode() {
  const dev  = process.env.OD_DEV_KEY;
  const cust = process.env.OD_CUSTOMER_KEY;
  // Demo mode if keys match known demo values (now only sourced from env)
  return dev === "NFF6i0KrXrxDkZHt" && cust === "VzkmZEaUWOjnQX2z";
}

async function odGet(path, params = {}) {
  const url = new URL(`${OD_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), {
    headers: {
      Authorization:  odAuth(),
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`[opendental] API error ${res.status}:`, text.slice(0, 200));
    throw new Error(`Open Dental API returned ${res.status}`);
  }

  return res.json();
}

/**
 * Get appointments for a single date.
 * Returns raw OD appointment objects.
 */
export async function getAppointments(dateStr) {
  return odGet("/appointments", { dateStart: dateStr, dateEnd: dateStr });
}

/**
 * Get a single patient record by PatNum.
 */
export async function getPatient(patNum) {
  return odGet(`/patients/${patNum}`);
}

/**
 * Get insurance plans for a patient (patplans + insplan lookups).
 * Returns { planName, memberId, groupNumber, payerId } or null if no insurance.
 */
export async function getPatientInsurance(patNum) {
  try {
    const patplans = await odGet("/patplans", { PatNum: patNum });
    if (!patplans || patplans.length === 0) return null;

    const primary = patplans[0];
    const insSubNum = primary.InsSubNum;

    // Get subscriber info for member ID
    let memberId = "";
    let groupNumber = "";
    let planName = "";
    let payerId = "";

    try {
      const insSub = await odGet(`/inssubs/${insSubNum}`);
      memberId    = insSub?.SubscriberID || "";
      groupNumber = insSub?.GroupNum     || "";
    } catch { /* subscriber lookup optional */ }

    try {
      const insPlan = await odGet(`/insplans/${primary.PlanNum}`);
      planName = insPlan?.GroupName || insPlan?.CarrierName || "";
      payerId  = insPlan?.ElectID   || "";

      // Try to get carrier name if not on plan
      if (!planName && insPlan?.CarrierNum) {
        try {
          const carrier = await odGet(`/carriers/${insPlan.CarrierNum}`);
          planName = carrier?.CarrierName || "";
          payerId  = carrier?.ElectID     || payerId;
        } catch { /* carrier lookup optional */ }
      }
    } catch { /* plan lookup optional */ }

    return { planName, memberId, groupNumber, payerId };
  } catch {
    return null;
  }
}

// ── Demo date-remapping ─────────────────────────────────────────────────────
// The OD demo database only has Scheduled/Complete appointments on these dates:
//   2020-09-26 (9 appointments — Sat but has data), 2020-09-28 (1), 2020-10-27 (29)
// We map the current weekdays to subsets of the demo's 2020-10-27 Scheduled appointments
// (the most realistic set — actual times, real procedures).

// Scheduled appointments from 2020-10-27 mapped to weekday slots.
// Each entry: [AptNum range start idx, count] into the sorted scheduled list.
// We distribute the 10 Scheduled + 2 Complete appointments across Mon-Fri.
const DEMO_SOURCE_DATE = "2020-10-27";
// Also pull from the 9-appointment Saturday to fill the week
const DEMO_SOURCE_DATE_SAT = "2020-09-26";

/**
 * For demo mode: fetch all appointments from demo source dates,
 * filter to Scheduled/Complete with actual times, and distribute
 * across the requested weekday.
 */
async function getDemoAppointmentsForDate(requestedDate) {
  // Determine which day-of-week was requested (1=Mon .. 5=Fri)
  const dow = new Date(requestedDate + "T12:00:00").getDay(); // 0=Sun
  if (dow === 0 || dow === 6) return []; // weekends — practice closed

  // Fetch from both demo source dates
  const [appts27, appts26] = await Promise.all([
    odGet("/appointments", { dateStart: DEMO_SOURCE_DATE, dateEnd: DEMO_SOURCE_DATE }),
    odGet("/appointments", { dateStart: DEMO_SOURCE_DATE_SAT, dateEnd: DEMO_SOURCE_DATE_SAT }),
  ]);

  // Combine and filter to only appointments with real times (not 00:00)
  const allAppts = [...(appts27 || []), ...(appts26 || [])];
  const withTimes = allAppts.filter(a => {
    if (a.AptStatus === "Broken" || a.AptStatus === "UnschedList") return false;
    // Only keep Scheduled and Complete with actual appointment times
    if (a.AptStatus !== "Scheduled" && a.AptStatus !== "Complete") return false;
    const time = (a.AptDateTime || "").split(" ")[1] || "00:00:00";
    return time !== "00:00:00"; // skip midnight placeholders (Planned appts)
  });

  // Sort by time
  withTimes.sort((a, b) => {
    const tA = (a.AptDateTime || "").split(" ")[1] || "00:00:00";
    const tB = (b.AptDateTime || "").split(" ")[1] || "00:00:00";
    return tA.localeCompare(tB);
  });

  // Deduplicate by PatNum — keep only one appointment per patient per day
  // to avoid showing the same person multiple times
  const seenPats = new Set();
  const unique = withTimes.filter(a => {
    if (seenPats.has(a.PatNum)) return false;
    seenPats.add(a.PatNum);
    return true;
  });

  // Distribute across weekdays: ~3-5 patients per day
  // Total unique patients ≈ 13, spread across 5 weekdays
  const patientsPerDay = Math.ceil(unique.length / 5);
  const startIdx = (dow - 1) * patientsPerDay;
  const daySlice = unique.slice(startIdx, startIdx + patientsPerDay);

  // If we've exhausted the pool (e.g., only 13 patients for 5 days),
  // wrap around for extra coverage
  if (daySlice.length === 0 && unique.length > 0) {
    const wrapIdx = ((dow - 1) * patientsPerDay) % unique.length;
    return unique.slice(wrapIdx, wrapIdx + Math.min(3, unique.length));
  }

  return daySlice;
}

/**
 * Sync today's appointments from Open Dental.
 * Returns array of normalized patient objects ready to upsert.
 *
 * Each item: {
 *   externalId, firstName, lastName, dateOfBirth, phone, email,
 *   insuranceName, memberId, groupNumber, payerId,
 *   procedure, provider,
 *   appointmentDate, appointmentTime,
 * }
 */
export async function syncDailySchedule(dateStr) {
  // First try fetching real appointments for the requested date
  let appts = await getAppointments(dateStr);

  // In demo mode, if no appointments found for this date, remap from demo dates
  if ((!appts || appts.length === 0) && isDemoMode()) {
    appts = await getDemoAppointmentsForDate(dateStr);
  }

  if (!appts || appts.length === 0) return [];

  // Fetch each unique patient (cache to avoid dupe fetches)
  const patCache = new Map();
  const insCache = new Map();

  async function fetchPatient(patNum) {
    if (!patCache.has(patNum)) {
      try { patCache.set(patNum, await getPatient(patNum)); }
      catch { patCache.set(patNum, null); }
    }
    return patCache.get(patNum);
  }

  async function fetchInsurance(patNum) {
    if (!insCache.has(patNum)) {
      insCache.set(patNum, await getPatientInsurance(patNum));
    }
    return insCache.get(patNum);
  }

  const results = [];

  for (const appt of appts) {
    if (appt.AptStatus === "Broken" || appt.AptStatus === "UnschedList") continue;

    const pat = await fetchPatient(appt.PatNum);
    if (!pat) continue;

    const ins = await fetchInsurance(appt.PatNum);

    // Parse "2020-10-27 09:00:00" → "9:00 AM"
    const apptTime = formatTime(appt.AptDateTime);

    results.push({
      externalId:      String(appt.AptNum),
      firstName:       pat.FName  || "",
      lastName:        pat.LName  || "",
      dateOfBirth:     pat.Birthdate || "",
      phone:           pat.WirelessPhone || pat.HmPhone || pat.WkPhone || "",
      email:           pat.Email  || "",
      insuranceName:   ins?.planName    || "",
      memberId:        ins?.memberId    || "",
      groupNumber:     ins?.groupNumber || "",
      payerId:         ins?.payerId     || "",
      procedure:       appt.ProcDescript || "",
      provider:        appt.provAbbr   || "",
      // Use the REQUESTED date, not the original demo date
      appointmentDate: dateStr,
      appointmentTime: apptTime,
    });
  }

  return results;
}

function formatTime(dateTimeStr) {
  // "2026-02-19 09:30:00" → "9:30 AM"
  if (!dateTimeStr) return "";
  const timePart = dateTimeStr.split(" ")[1] || "";
  const [hStr, mStr] = timePart.split(":");
  let h = parseInt(hStr, 10);
  const m = mStr || "00";
  if (isNaN(h)) return timePart;
  const meridiem = h >= 12 ? "PM" : "AM";
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${m} ${meridiem}`;
}
