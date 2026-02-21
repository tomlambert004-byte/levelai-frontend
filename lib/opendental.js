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
 *   OD_DEV_KEY        — your developer key (shared across all practices — Anthropic-issued)
 *
 * Per-practice:
 *   customerKey is the practice's own OD eKey, stored in Practice.pmsSyncKey
 *   Falls back to OD_CUSTOMER_KEY env var for demo/dev mode
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

/**
 * Build the ODFHIR auth header for a specific practice.
 * @param {string|null} practiceKey — the practice's OD customer key (from Practice.pmsSyncKey)
 */
function odAuth(practiceKey) {
  const dev  = process.env.OD_DEV_KEY;
  const cust = practiceKey || process.env.OD_CUSTOMER_KEY;
  if (!dev || !cust) {
    throw new Error("Open Dental credentials not configured. Set OD_DEV_KEY and the practice's eKey.");
  }
  return `ODFHIR ${dev}/${cust}`;
}

/** True when using the OD demo sandbox keys */
function isDemoMode(practiceKey) {
  const dev  = process.env.OD_DEV_KEY;
  const cust = practiceKey || process.env.OD_CUSTOMER_KEY;
  return dev === "NFF6i0KrXrxDkZHt" && cust === "VzkmZEaUWOjnQX2z";
}

async function odGet(path, params = {}, practiceKey = null) {
  const url = new URL(`${OD_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), {
    headers: {
      Authorization:  odAuth(practiceKey),
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
export async function getAppointments(dateStr, practiceKey = null) {
  return odGet("/appointments", { dateStart: dateStr, dateEnd: dateStr }, practiceKey);
}

/**
 * Get a single patient record by PatNum.
 */
export async function getPatient(patNum, practiceKey = null) {
  return odGet(`/patients/${patNum}`, {}, practiceKey);
}

/**
 * Get insurance plans for a patient (patplans + insplan lookups).
 * Returns { planName, memberId, groupNumber, payerId } or null if no insurance.
 */
export async function getPatientInsurance(patNum, practiceKey = null) {
  try {
    const patplans = await odGet("/patplans", { PatNum: patNum }, practiceKey);
    if (!patplans || patplans.length === 0) return null;

    const primary = patplans[0];
    const insSubNum = primary.InsSubNum;

    // Get subscriber info for member ID
    let memberId = "";
    let groupNumber = "";
    let planName = "";
    let payerId = "";

    try {
      const insSub = await odGet(`/inssubs/${insSubNum}`, {}, practiceKey);
      memberId    = insSub?.SubscriberID || "";
      groupNumber = insSub?.GroupNum     || "";
    } catch { /* subscriber lookup optional */ }

    try {
      const insPlan = await odGet(`/insplans/${primary.PlanNum}`, {}, practiceKey);
      planName = insPlan?.GroupName || insPlan?.CarrierName || "";
      payerId  = insPlan?.ElectID   || "";

      // Try to get carrier name if not on plan
      if (!planName && insPlan?.CarrierNum) {
        try {
          const carrier = await odGet(`/carriers/${insPlan.CarrierNum}`, {}, practiceKey);
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
const DEMO_SOURCE_DATE = "2020-10-27";
const DEMO_SOURCE_DATE_SAT = "2020-09-26";

async function getDemoAppointmentsForDate(requestedDate, practiceKey = null) {
  const dow = new Date(requestedDate + "T12:00:00").getDay();
  if (dow === 0 || dow === 6) return [];

  const [appts27, appts26] = await Promise.all([
    odGet("/appointments", { dateStart: DEMO_SOURCE_DATE, dateEnd: DEMO_SOURCE_DATE }, practiceKey),
    odGet("/appointments", { dateStart: DEMO_SOURCE_DATE_SAT, dateEnd: DEMO_SOURCE_DATE_SAT }, practiceKey),
  ]);

  const allAppts = [...(appts27 || []), ...(appts26 || [])];
  const withTimes = allAppts.filter(a => {
    if (a.AptStatus === "Broken" || a.AptStatus === "UnschedList") return false;
    if (a.AptStatus !== "Scheduled" && a.AptStatus !== "Complete") return false;
    const time = (a.AptDateTime || "").split(" ")[1] || "00:00:00";
    return time !== "00:00:00";
  });

  withTimes.sort((a, b) => {
    const tA = (a.AptDateTime || "").split(" ")[1] || "00:00:00";
    const tB = (b.AptDateTime || "").split(" ")[1] || "00:00:00";
    return tA.localeCompare(tB);
  });

  const seenPats = new Set();
  const unique = withTimes.filter(a => {
    if (seenPats.has(a.PatNum)) return false;
    seenPats.add(a.PatNum);
    return true;
  });

  const patientsPerDay = Math.ceil(unique.length / 5);
  const startIdx = (dow - 1) * patientsPerDay;
  const daySlice = unique.slice(startIdx, startIdx + patientsPerDay);

  if (daySlice.length === 0 && unique.length > 0) {
    const wrapIdx = ((dow - 1) * patientsPerDay) % unique.length;
    return unique.slice(wrapIdx, wrapIdx + Math.min(3, unique.length));
  }

  return daySlice;
}

/**
 * Sync today's appointments from Open Dental.
 * @param {string} dateStr — ISO date string (e.g. "2026-02-20")
 * @param {string|null} practiceKey — the practice's OD customer key (Practice.pmsSyncKey)
 * Returns array of normalized patient objects ready to upsert.
 */
export async function syncDailySchedule(dateStr, practiceKey = null) {
  let appts = await getAppointments(dateStr, practiceKey);

  if ((!appts || appts.length === 0) && isDemoMode(practiceKey)) {
    appts = await getDemoAppointmentsForDate(dateStr, practiceKey);
  }

  if (!appts || appts.length === 0) return [];

  const patCache = new Map();
  const insCache = new Map();

  async function fetchPatient(patNum) {
    if (!patCache.has(patNum)) {
      try { patCache.set(patNum, await getPatient(patNum, practiceKey)); }
      catch { patCache.set(patNum, null); }
    }
    return patCache.get(patNum);
  }

  async function fetchInsurance(patNum) {
    if (!insCache.has(patNum)) {
      insCache.set(patNum, await getPatientInsurance(patNum, practiceKey));
    }
    return insCache.get(patNum);
  }

  const results = [];

  for (const appt of appts) {
    if (appt.AptStatus === "Broken" || appt.AptStatus === "UnschedList") continue;

    const pat = await fetchPatient(appt.PatNum);
    if (!pat) continue;

    const ins = await fetchInsurance(appt.PatNum);
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
      appointmentDate: dateStr,
      appointmentTime: apptTime,
    });
  }

  return results;
}

function formatTime(dateTimeStr) {
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
