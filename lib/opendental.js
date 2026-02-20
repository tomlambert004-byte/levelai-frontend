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
 */

const OD_BASE = process.env.OD_API_BASE_URL || "https://api.opendental.com/api/v1";

function odAuth() {
  const dev  = process.env.OD_DEV_KEY      || "NFF6i0KrXrxDkZHt";
  const cust = process.env.OD_CUSTOMER_KEY || "VzkmZEaUWOjnQX2z";
  return `ODFHIR ${dev}/${cust}`;
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
    throw new Error(`Open Dental API ${res.status}: ${text.slice(0, 200)}`);
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
  const appts = await getAppointments(dateStr);
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

    // Parse "2026-02-19 09:30:00" → "9:30 AM"
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
