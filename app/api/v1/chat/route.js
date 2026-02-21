/**
 * POST /api/v1/chat
 *
 * Payer Pal — AI assistant that answers front-desk staff questions about a
 * patient's insurance coverage, strictly grounded in the verification result.
 *
 * Uses the Anthropic Messages REST API directly (no SDK dependency).
 * Requires ANTHROPIC_API_KEY env var.
 *
 * Body: { patient_id: string, question: string, coverage_json: object, history?: Array<{role, text}> }
 * Response: { answer: string, patient_id: string }
 */
import { auth } from "@clerk/nextjs/server";
import { checkRateLimit, rateLimitResponse } from "../../../../lib/rateLimit.js";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-20250514";

function buildCoverageSummary(patientId, cov) {
  const fmt = (cents) => `$${((cents || 0) / 100).toFixed(0)}`;
  return [
    "PATIENT COVERAGE SNAPSHOT (source: eligibility verification)",
    `Patient ID : ${patientId}`,
    `Payer      : ${cov.payer_name || "Unknown"}`,
    `Plan status: ${cov.plan_status || "unknown"}`,
    `Verify status: ${cov.verification_status || "unknown"}`,
    `Annual max : ${fmt(cov.annual_maximum_cents)}`,
    `Remaining  : ${fmt(cov.annual_remaining_cents)}`,
    `Deductible : ${fmt(cov.individual_deductible_cents)}`,
    `Ded. met   : ${fmt(cov.individual_deductible_met_cents)}`,
    `Copay pct  : ${cov.copay_pct != null ? cov.copay_pct + "%" : "unknown"}`,
    `Preventive : ${JSON.stringify(cov.preventive || {})}`,
    `Restorative: ${JSON.stringify(cov.restorative || {})}`,
    `Basic      : ${JSON.stringify(cov.basic || {})}`,
    `Major      : ${JSON.stringify(cov.major || {})}`,
    `Orthodontics: ${JSON.stringify(cov.ortho || {})}`,
    `Missing tooth clause: ${JSON.stringify(cov.missing_tooth_clause || {})}`,
    `OON estimate: ${JSON.stringify(cov.oon_estimate || {})}`,
    `Action flags: ${JSON.stringify(cov.action_flags || [])}`,
    `Warnings   : ${JSON.stringify(cov.warnings || [])}`,
    cov.ai_summary ? `AI summary : ${cov.ai_summary}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const SYSTEM_PROMPT_PREFIX =
  "You are Payer Pal, a friendly AI assistant for dental front-desk staff.\n\n" +
  "YOUR STYLE:\n" +
  "- Short, clear, and friendly — like a helpful coworker. No paragraphs.\n" +
  "- 1-3 sentences is ideal. Use bullet points if listing multiple items.\n" +
  "- Dollar amounts as $X. Percentages: say what the plan pays vs. what the patient pays.\n" +
  "- Be warm but get to the point. Great customer service = fast, accurate answers.\n\n" +
  "WHAT YOU CAN DO:\n" +
  "- Answer from the coverage data below — cite specific numbers when available.\n" +
  "- Discuss general dental insurance topics (DMOs, PPOs, pre-auths, waiting periods, " +
  "UCR fees, coordination of benefits, etc.) — just note when it's general knowledge vs. this patient's data.\n" +
  "- When data is missing, say so plainly and suggest calling the carrier. Don't just refuse — " +
  "give them what you CAN tell them.\n" +
  "- Be honest about confidence. If the data source has limitations, say so.\n\n" +
  "DON'T:\n" +
  "- Make up dollar amounts not in the data.\n" +
  "- Give medical or legal advice.\n" +
  "- Write long paragraphs — keep it snappy.\n\n";

export async function POST(request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Rate limit: 20 chat messages per minute per user
    const rl = checkRateLimit(`chat:${userId}`, { maxRequests: 20, windowMs: 60_000 });
    const blocked = rateLimitResponse(rl);
    if (blocked) return blocked;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return Response.json(
        { error: "Payer Pal hasn't been set up yet. Please ask your administrator to configure the AI assistant.", error_type: "not_configured" },
        { status: 503 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const patientId = body.patient_id || "unknown";
    const question = (body.question || "").trim();
    const coverageJson = body.coverage_json || {};
    const history = Array.isArray(body.history) ? body.history : [];

    if (!question) {
      return Response.json({ error: "Question is required" }, { status: 400 });
    }

    const coverageSummary = buildCoverageSummary(patientId, coverageJson);
    const systemPrompt = SYSTEM_PROMPT_PREFIX + "COVERAGE DATA:\n" + coverageSummary;

    // Build conversation messages — include recent history for context (max 10 turns)
    const conversationMessages = [];
    const recentHistory = history.slice(-10);
    for (const msg of recentHistory) {
      if (msg.role === "user") {
        conversationMessages.push({ role: "user", content: msg.text });
      } else if (msg.role === "assistant" && !msg.isError) {
        conversationMessages.push({ role: "assistant", content: msg.text });
      }
    }
    conversationMessages.push({ role: "user", content: question });

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
        system: systemPrompt,
        messages: conversationMessages,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text().catch(() => "");
      console.error("[chat] Anthropic API error:", anthropicRes.status, errText.slice(0, 300));
      const isAuthError = anthropicRes.status === 401 || anthropicRes.status === 403;
      return Response.json(
        {
          error: isAuthError
            ? "Payer Pal's API key is invalid or expired. Please contact your administrator."
            : "Payer Pal is temporarily unavailable. Please try again in a moment.",
          error_type: isAuthError ? "config_error" : "service_error",
        },
        { status: 502 }
      );
    }

    const data = await anthropicRes.json();
    const answer = data.content?.[0]?.text?.trim() || "I couldn't generate a response. Please try again.";

    return Response.json({ answer, patient_id: patientId });
  } catch (err) {
    console.error("[chat] Error:", err.name);
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return Response.json(
        { error: "Payer Pal took too long to respond. Please try again.", error_type: "timeout" },
        { status: 504 }
      );
    }
    return Response.json(
      { error: "Something went wrong. Please try again.", error_type: "unknown" },
      { status: 500 }
    );
  }
}
