/**
 * POST /api/v1/chat
 *
 * Payer Pal — AI assistant that answers front-desk staff questions about a
 * patient's insurance coverage, strictly grounded in the verification result.
 *
 * Uses the Anthropic Messages REST API directly (no SDK dependency).
 * Requires ANTHROPIC_API_KEY env var.
 *
 * Body: { patient_id: string, question: string, coverage_json: object }
 * Response: { answer: string, patient_id: string }
 */
import { auth } from "@clerk/nextjs/server";

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
  "You are Payer Pal, an AI assistant embedded in the Level AI dental insurance " +
  "verification dashboard.\n\n" +
  "STRICT RULES:\n" +
  "1. Answer ONLY based on the coverage data provided below. Do not invent or assume any values.\n" +
  "2. If the data does not contain the answer, say so clearly and suggest the staff call the carrier.\n" +
  "3. Be concise (2-4 sentences max). Write for busy front-desk staff, not engineers.\n" +
  "4. Format dollar amounts as $X (no cents unless relevant).\n" +
  "5. Never quote dollar amounts that are not explicitly in the data.\n" +
  "6. Never give medical or legal advice.\n" +
  "7. When referring to coverage percentages, clarify what the plan pays vs. what the patient pays.\n\n";

export async function POST(request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return Response.json(
        { error: "Payer Pal is not configured. ANTHROPIC_API_KEY is missing." },
        { status: 503 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const patientId = body.patient_id || "unknown";
    const question = (body.question || "").trim();
    const coverageJson = body.coverage_json || {};

    if (!question) {
      return Response.json({ error: "Question is required" }, { status: 400 });
    }

    const coverageSummary = buildCoverageSummary(patientId, coverageJson);
    const systemPrompt = SYSTEM_PROMPT_PREFIX + "COVERAGE DATA:\n" + coverageSummary;

    const anthropicRes = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 512,
        system: systemPrompt,
        messages: [{ role: "user", content: question }],
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text().catch(() => "");
      console.error("[chat] Anthropic API error:", anthropicRes.status, errText.slice(0, 300));
      return Response.json(
        { error: "Payer Pal service error", detail: `Claude API returned ${anthropicRes.status}` },
        { status: 502 }
      );
    }

    const data = await anthropicRes.json();
    const answer = data.content?.[0]?.text?.trim() || "I couldn't generate a response. Please try again.";

    return Response.json({ answer, patient_id: patientId });
  } catch (err) {
    console.error("[chat] Error:", err);
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return Response.json(
        { error: "Request timed out", detail: "Claude API did not respond in time." },
        { status: 504 }
      );
    }
    return Response.json({ error: "Chat failed", detail: err.message }, { status: 500 });
  }
}
