/**
 * POST /api/v1/sms/draft
 *
 * Generates a patient-facing SMS message using the LLM (Claude).
 * Takes raw triage data (block reasons, notify reasons, patient context)
 * and produces warm, natural language that reads like a real person texting.
 *
 * Falls back to a template-based draft if ANTHROPIC_API_KEY is not set.
 *
 * Body: {
 *   patient_name: string,
 *   practice_name?: string,
 *   practice_phone?: string,
 *   procedure?: string,
 *   appointment_date?: string,
 *   block_reasons?: string[],
 *   notify_reasons?: string[],
 *   type: "reschedule" | "outreach"
 * }
 * Response: { draft: string }
 */
import { auth } from "@clerk/nextjs/server";
import { checkRateLimit, rateLimitResponse } from "../../../../../lib/rateLimit.js";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-20250514";

const SYSTEM_PROMPT =
  "You are a dental office assistant writing a single SMS text message to a patient.\n\n" +
  "CRITICAL RULES:\n" +
  "- Write EXACTLY like a real person texting — warm, casual, friendly.\n" +
  "- Keep it to 2-3 short sentences MAX. Under 300 characters is ideal.\n" +
  "- Use the patient's first name.\n" +
  "- NEVER use technical insurance jargon (no 'annual maximum', 'composite downgrade', 'assignment of benefits', CDT codes, etc.).\n" +
  "- NEVER include raw system data or internal triage language.\n" +
  "- Translate insurance issues into plain English the patient would understand.\n" +
  "- Always include a gentle call-to-action (call us, give us a ring, etc.).\n" +
  "- Match the tone of a friendly front-desk person — think 'helpful neighbor', not 'insurance robot'.\n" +
  "- Do NOT use emojis unless it's a simple smiley or wave.\n" +
  "- Do NOT start with 'Dear' — this is a text, not a letter.\n" +
  "- Include the practice name and phone number naturally.\n\n" +
  "EXAMPLES OF GOOD SMS:\n" +
  "\"Hi Sarah! This is Georgetown Dental. We were prepping for your visit and noticed a small hiccup with your insurance coverage. Could you give us a quick call at (512) 555-0987? We want to make sure everything's sorted before you come in!\"\n\n" +
  "\"Hey Mike, Georgetown Dental here! Quick heads up about your upcoming appointment — your insurance might not cover the full amount, so there could be a small out-of-pocket cost. Give us a ring at (512) 555-0987 if you have any questions!\"\n\n" +
  "EXAMPLES OF BAD SMS (never write like this):\n" +
  "\"oon: insurance reimburses patient, not office — collect full fee at time of service\"\n" +
  "\"Posterior composite will be downgraded to amalgam rate — patient may owe the difference\"\n" +
  "\"Medicaid PA required for D2750 — submit before appointment\"\n";

function buildFallbackDraft(body) {
  const firstName = (body.patient_name || "").split(" ")[0] || "there";
  const practice = body.practice_name || "your dental office";
  const phone = body.practice_phone || "";
  const phoneStr = phone ? ` at ${phone}` : "";

  if (body.type === "reschedule" || (body.block_reasons && body.block_reasons.length > 0)) {
    return `Hi ${firstName}! This is ${practice}. We were getting things ready for your upcoming visit and noticed a small issue with your insurance. Could you give us a quick call${phoneStr} when you get a chance? We want to make sure everything's squared away before your appointment!`;
  }
  return `Hi ${firstName}, ${practice} here! Quick heads up about your upcoming appointment — we checked your insurance and have a small update for you. Nothing to worry about, but give us a call${phoneStr} if you have any questions. See you soon!`;
}

export async function POST(request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rl = checkRateLimit(`smsdraft:${userId}`, { maxRequests: 30, windowMs: 60_000 });
    const blocked = rateLimitResponse(rl);
    if (blocked) return blocked;

    const body = await request.json().catch(() => ({}));
    const {
      patient_name, practice_name, practice_phone,
      procedure, appointment_date,
      block_reasons, notify_reasons, type,
    } = body;

    if (!patient_name) {
      return Response.json({ error: "patient_name is required" }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;

    // Fallback if no API key — use template
    if (!apiKey) {
      return Response.json({ draft: buildFallbackDraft(body) });
    }

    // Build the LLM prompt with context
    const context = [
      `Patient first name: ${(patient_name || "").split(" ")[0]}`,
      practice_name ? `Practice name: ${practice_name}` : null,
      practice_phone ? `Practice phone: ${practice_phone}` : null,
      procedure ? `Scheduled procedure: ${procedure}` : null,
      appointment_date ? `Appointment date: ${appointment_date}` : null,
      type === "reschedule" ? "MESSAGE TYPE: There is a BLOCKING insurance issue. We need the patient to call us before their visit." : null,
      type === "outreach" ? "MESSAGE TYPE: There is a heads-up / courtesy notification. Nothing blocks their visit, but they should know about a coverage detail." : null,
      block_reasons && block_reasons.length > 0 ? `Blocking issues (translate to plain English): ${block_reasons.join("; ")}` : null,
      notify_reasons && notify_reasons.length > 0 ? `Heads-up items (translate to plain English): ${notify_reasons.join("; ")}` : null,
    ].filter(Boolean).join("\n");

    const userMessage = `Write a single SMS text message for this situation:\n\n${context}\n\nRespond with ONLY the SMS text — no quotes, no explanation, nothing else.`;

    const anthropicRes = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 256,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!anthropicRes.ok) {
      console.error("[sms/draft] Anthropic API error:", anthropicRes.status);
      // Fallback to template on API error
      return Response.json({ draft: buildFallbackDraft(body) });
    }

    const data = await anthropicRes.json();
    let draft = data.content?.[0]?.text?.trim() || "";

    // Strip any wrapping quotes the model might add
    if ((draft.startsWith('"') && draft.endsWith('"')) || (draft.startsWith("'") && draft.endsWith("'"))) {
      draft = draft.slice(1, -1);
    }

    if (!draft) {
      return Response.json({ draft: buildFallbackDraft(body) });
    }

    return Response.json({ draft });
  } catch (err) {
    console.error("[sms/draft] Error:", err.name);
    // Always return a usable draft, even on error
    const body = await request.json().catch(() => ({}));
    return Response.json({ draft: buildFallbackDraft(body || {}) });
  }
}
