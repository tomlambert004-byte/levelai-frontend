/**
 * POST /api/v1/email/draft
 *
 * Generates a professional benefits inquiry email to a payer using the LLM.
 * The email requests eligibility/benefits information for a patient whose
 * electronic verification failed.
 *
 * Falls back to a template if ANTHROPIC_API_KEY is not set.
 *
 * Body: {
 *   patient_name, member_id, date_of_birth, insurance_name, payer_id,
 *   procedure, appointment_date,
 *   practice_name, practice_npi, practice_phone, practice_email, practice_address,
 *   fail_reason, fail_category
 * }
 * Response: { draft: { subject, body, to_label } }
 */
import { auth } from "@clerk/nextjs/server";
import { checkRateLimit, rateLimitResponse } from "../../../../../lib/rateLimit.js";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-20250514";

const SYSTEM_PROMPT =
  "You are drafting a professional benefits inquiry email from a dental practice to an insurance company.\n\n" +
  "RULES:\n" +
  "- Write in a formal but warm professional tone — as if the office manager is emailing the payer's provider services department.\n" +
  "- Include all patient identifying information (name, member ID, DOB, group number) clearly.\n" +
  "- State the specific procedure code and description.\n" +
  "- Request: eligibility status, benefits summary, annual maximum remaining, deductible status, coverage percentages, frequency limitations, and any waiting periods.\n" +
  "- Mention the appointment date and that timely response is appreciated.\n" +
  "- Include the practice contact info (name, NPI, phone, email, address) in a professional signature block.\n" +
  "- Keep the email concise — under 250 words.\n" +
  "- Do NOT include any HIPAA disclaimers — the practice's email system handles that.\n" +
  "- Do NOT make up information. Only use the data provided.\n";

function buildFallbackDraft(body) {
  const patientName = body.patient_name || "the patient";
  const memberId = body.member_id || "[Member ID]";
  const dob = body.date_of_birth || "[DOB]";
  const insurance = body.insurance_name || "your organization";
  const procedure = body.procedure || "the scheduled procedure";
  const apptDate = body.appointment_date || "[appointment date]";
  const pracName = body.practice_name || "our practice";
  const pracNpi = body.practice_npi || "[NPI]";
  const pracPhone = body.practice_phone || "[phone]";
  const pracEmail = body.practice_email || "[email]";
  const pracAddress = body.practice_address || "[address]";

  const subject = `Benefits Inquiry — ${patientName}, Member ID: ${memberId}`;

  const emailBody = `Dear Provider Services,

I am writing to request benefits and eligibility information for a patient scheduled at our practice.

Patient Information:
• Name: ${patientName}
• Member ID: ${memberId}
• Date of Birth: ${dob}
• Scheduled Procedure: ${procedure}
• Appointment Date: ${apptDate}

We attempted electronic verification but were unable to obtain complete benefits information. We would appreciate the following details:

1. Current eligibility and plan status
2. Annual maximum and remaining benefits
3. Deductible amount and amount met to date
4. Coverage percentages for the scheduled procedure
5. Any frequency limitations or waiting periods
6. Prior authorization requirements, if applicable

We would appreciate a response at your earliest convenience, as the patient's appointment is approaching.

Thank you for your prompt attention to this request.

Sincerely,

${pracName}
NPI: ${pracNpi}
${pracAddress}
Phone: ${pracPhone}
Email: ${pracEmail}`;

  return { subject, body: emailBody, to_label: `${insurance} Provider Services` };
}

export async function POST(request) {
  try {
    // Auth — allow sandbox/demo users who may not be signed in
    let userId = null;
    try {
      const authResult = await auth();
      userId = authResult.userId;
    } catch { /* unauthenticated — sandbox mode */ }

    if (userId) {
      const rl = checkRateLimit(`emaildraft:${userId}`, { maxRequests: 20, windowMs: 60_000 });
      const blocked = rateLimitResponse(rl);
      if (blocked) return blocked;
    }

    const body = await request.json().catch(() => ({}));
    const {
      patient_name, member_id, date_of_birth, insurance_name,
      procedure, appointment_date,
      practice_name, practice_npi, practice_phone, practice_email, practice_address,
      fail_reason, fail_category,
    } = body;

    if (!patient_name) {
      return Response.json({ error: "patient_name is required" }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;

    // Fallback if no API key (also covers sandbox mode)
    if (!apiKey || !userId) {
      return Response.json({ draft: buildFallbackDraft(body) });
    }

    // Build LLM prompt
    const context = [
      `Patient name: ${patient_name}`,
      member_id ? `Member ID: ${member_id}` : "Member ID: not on file",
      date_of_birth ? `Date of birth: ${date_of_birth}` : null,
      insurance_name ? `Insurance: ${insurance_name}` : null,
      procedure ? `Scheduled procedure: ${procedure}` : null,
      appointment_date ? `Appointment date: ${appointment_date}` : null,
      practice_name ? `Practice name: ${practice_name}` : null,
      practice_npi ? `Practice NPI: ${practice_npi}` : null,
      practice_phone ? `Practice phone: ${practice_phone}` : null,
      practice_email ? `Practice email: ${practice_email}` : null,
      practice_address ? `Practice address: ${practice_address}` : null,
      fail_reason ? `Reason electronic verification failed: ${fail_reason}` : null,
    ].filter(Boolean).join("\n");

    const userMessage = `Draft a professional benefits inquiry email for this situation:\n\n${context}\n\nRespond with a JSON object: { "subject": "...", "body": "...", "to_label": "..." }\nThe to_label should be the payer department this should be sent to (e.g. "Delta Dental Provider Services").`;

    const anthropicRes = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!anthropicRes.ok) {
      console.error("[email/draft] Anthropic API error:", anthropicRes.status);
      return Response.json({ draft: buildFallbackDraft(body) });
    }

    const data = await anthropicRes.json();
    let raw = data.content?.[0]?.text?.trim() || "";

    // Try to parse as JSON
    try {
      // Strip markdown fences if model wrapped in ```json ... ```
      if (raw.startsWith("```")) {
        raw = raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
      }
      const parsed = JSON.parse(raw);
      if (parsed.subject && parsed.body) {
        return Response.json({ draft: parsed });
      }
    } catch {
      // Not JSON — use raw text as body
    }

    // Fallback: use raw text as email body
    return Response.json({
      draft: {
        subject: `Benefits Inquiry — ${patient_name}${member_id ? `, Member ID: ${member_id}` : ""}`,
        body: raw,
        to_label: `${insurance_name || "Payer"} Provider Services`,
      },
    });
  } catch (err) {
    console.error("[email/draft] Error:", err.name);
    const body = await request.json().catch(() => ({}));
    return Response.json({ draft: buildFallbackDraft(body || {}) });
  }
}
