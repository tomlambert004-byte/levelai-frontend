/**
 * POST /api/v1/pms/validate
 *
 * Lightweight credential check for the PMS eKey / sync token.
 * Attempts a single, small API call against the PMS (e.g., fetching today's
 * appointments with a short timeout) to verify the credentials are valid.
 *
 * Body: { pmsSystem: "Open Dental", pmsSyncKey: "..." }
 *
 * Response:
 *   200 — { valid: true, pms: "Open Dental" }
 *   401 — not logged in
 *   422 — { valid: false, error: "..." }
 */
import { auth } from "@clerk/nextjs/server";

const OD_BASE = process.env.OD_API_BASE_URL || "https://api.opendental.com/api/v1";

async function validateOpenDental(customerKey) {
  const devKey  = process.env.OD_DEV_KEY;
  const custKey = customerKey || process.env.OD_CUSTOMER_KEY;
  if (!devKey) {
    return { valid: false, error: "Open Dental developer key not configured. Contact your administrator." };
  }
  if (!custKey) {
    return { valid: false, error: "No customer key provided." };
  }

  const today = new Date().toISOString().split("T")[0];
  const url = `${OD_BASE}/appointments?dateStart=${today}&dateEnd=${today}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `ODFHIR ${devKey}/${custKey}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 401 || res.status === 403) {
      return { valid: false, error: "Invalid eKey — authentication failed. Please double-check the key and try again." };
    }
    console.error("[pms/validate] OD error:", res.status, text.slice(0, 120));
    return { valid: false, error: `Open Dental returned an error (${res.status}). Please try again.` };
  }

  return { valid: true };
}

async function validateDentrix(/* token */) {
  // Dentrix and Eaglesoft don't have public cloud APIs for validation yet.
  // Accept any non-empty token as "provisionally valid" — real validation
  // happens on first sync. In the future, add actual handshake calls here.
  return { valid: true };
}

async function validateEaglesoft(/* token */) {
  return { valid: true };
}

const VALIDATORS = {
  "Open Dental": validateOpenDental,
  "Dentrix":     validateDentrix,
  "Eaglesoft":   validateEaglesoft,
};

export async function POST(request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const pmsSystem  = (body.pmsSystem || "").trim();
    const pmsSyncKey = (body.pmsSyncKey || "").trim();

    if (!pmsSystem || !pmsSyncKey) {
      return Response.json({ valid: false, error: "PMS system and key are required" }, { status: 400 });
    }

    const validator = VALIDATORS[pmsSystem] || validateDentrix; // default: accept
    const result = await validator(pmsSyncKey);

    if (!result.valid) {
      return Response.json({ valid: false, error: result.error, pms: pmsSystem }, { status: 422 });
    }

    return Response.json({ valid: true, pms: pmsSystem });
  } catch (err) {
    console.error("[pms/validate] Error:", err.name);
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return Response.json({ valid: false, error: "Connection timed out — could not reach PMS server." }, { status: 422 });
    }
    return Response.json({ valid: false, error: "Validation failed. Please try again." }, { status: 500 });
  }
}
