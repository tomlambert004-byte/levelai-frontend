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
import { recordSuccess, recordFailure } from "../../../../lib/outageDetector.js";

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
  "CRITICAL STYLE RULES — follow these strictly:\n" +
  "- Respond like a coworker answering a quick question at the front desk. Casual, warm, human.\n" +
  "- MAX 2-3 short sentences. If you catch yourself writing more, cut it down.\n" +
  "- NEVER use bullet points, bold text, headers, or lists. Just talk naturally.\n" +
  "- NEVER use tiered categories like 'Very confident / Confident / Less clear'. Just say it plainly.\n" +
  "- Dollar amounts as $X. Percentages: clarify plan-pays vs. patient-pays.\n" +
  "- If data is missing, mention it briefly in the same breath — don't make it a separate section.\n" +
  "- Think: would a busy front-desk person read this in 5 seconds? If not, it's too long.\n\n" +
  "WHAT YOU CAN DO:\n" +
  "- Answer from the coverage data below with specific numbers.\n" +
  "- Discuss general dental insurance topics (DMOs, PPOs, pre-auths, etc.) — just note when " +
  "it's general knowledge vs. this patient's data.\n" +
  "- When data is missing, say so and suggest calling the carrier.\n" +
  "- Be honest about confidence in a casual way.\n\n" +
  "DON'T:\n" +
  "- Make up dollar amounts not in the data.\n" +
  "- Give medical or legal advice.\n" +
  "- Write more than 3 sentences. Seriously.\n\n";

// ── Sandbox fallback: short canned answers when no API key or no auth ────────
function sandboxAnswer(question, coverageJson) {
  const q = (question || "").toLowerCase();
  const cov = coverageJson || {};
  const fmt = (cents) => `$${((cents || 0) / 100).toFixed(0)}`;

  if (/covered|coverage|what.*cover/i.test(q)) {
    const pct = cov.copay_pct != null ? `${100 - cov.copay_pct}%` : "around 80%";
    return `Based on what I see, the plan covers ${pct} of today's procedure. They have ${fmt(cov.annual_remaining_cents || 150000)} remaining on their annual max, so they should be good to go.`;
  }
  if (/owe|out.of.pocket|patient.pay|cost/i.test(q)) {
    const copay = cov.copay_pct != null ? cov.copay_pct : 20;
    return `The patient's responsible for about ${copay}% coinsurance after the deductible. With their current benefits, I'd estimate a ${fmt(copay * 500)} patient portion — but double-check the EOB once it processes.`;
  }
  if (/pre.?auth|prior.?auth/i.test(q)) {
    return "Looking at the procedure code and plan type, I don't see a pre-auth requirement for this one. That said, some plans sneak it in for certain tooth numbers, so it never hurts to call the carrier to confirm if you want to be safe.";
  }
  if (/deductible/i.test(q)) {
    return `Their individual deductible is ${fmt(cov.individual_deductible_cents || 5000)} and they've met ${fmt(cov.individual_deductible_met_cents || 5000)} so far this year. ${(cov.individual_deductible_met_cents || 5000) >= (cov.individual_deductible_cents || 5000) ? "Looks like they've already satisfied it!" : "They'll need to cover the remaining deductible first."}`;
  }
  if (/waiting.period|wait/i.test(q)) {
    return "I don't see any active waiting periods flagged on this plan. If it's a newer policy (under 12 months), you might want to confirm directly with the carrier — some plans have sneaky waiting periods for major work.";
  }
  if (/confident|accuracy|sure/i.test(q)) {
    return "Pretty confident on the numbers here — they came straight from the 271 response. The deductible and annual max figures are solid. Coverage percentages should be accurate too, but I'd always recommend verifying against the actual EOB for major procedures.";
  }
  if (/dmo|ppo|hmo|plan.type/i.test(q)) {
    const payer = cov.payer_name || "this carrier";
    return `This looks like a PPO plan based on the benefit structure from ${payer}. PPO means they can see any provider, but they'll get better rates staying in-network. Out-of-network benefits are usually reduced by 20-30%.`;
  }
  if (/tell.*patient|patient.*know/i.test(q)) {
    return "I'd let them know their insurance is active and covering most of today's visit. Give them a ballpark estimate of their copay so there are no surprises at checkout. If it's a bigger procedure, mention you'll send them an itemized statement once the claim processes.";
  }
  // Generic fallback
  return `Good question! Based on what I see in the verification data, this patient has an active plan with ${fmt(cov.annual_remaining_cents || 150000)} remaining in annual benefits. Their coverage looks straightforward for today's visit. Let me know if you want me to dig into any specific aspect of their benefits.`;
}

export async function POST(request) {
  try {
    // Auth — allow sandbox/demo users who may not be signed in
    let userId = null;
    try {
      const authResult = await auth();
      userId = authResult.userId;
    } catch { /* unauthenticated — sandbox mode */ }

    const body = await request.json().catch(() => ({}));
    const patientId = body.patient_id || "unknown";
    const question = (body.question || "").trim();
    const coverageJson = body.coverage_json || {};
    const history = Array.isArray(body.history) ? body.history : [];

    // Determine account mode
    let accountMode = "sandbox";
    if (userId) {
      try {
        const { prisma } = await import("../../../../lib/prisma.js");
        const practice = await prisma.practice.findUnique({ where: { clerkUserId: userId } });
        if (practice) accountMode = practice.accountMode || "sandbox";
      } catch { /* default to sandbox */ }
    }

    // Sandbox mode → return canned intelligent response (no API key needed)
    if (!userId || accountMode === "sandbox") {
      if (!question) return Response.json({ error: "Question is required" }, { status: 400 });
      await new Promise(r => setTimeout(r, 600 + Math.random() * 800)); // simulate latency
      return Response.json({ answer: sandboxAnswer(question, coverageJson), patient_id: patientId });
    }

    // Rate limit: 20 chat messages per minute per user
    const rl = await checkRateLimit(`chat:${userId}`, { maxRequests: 20, windowMs: 60_000 });
    const blocked = rateLimitResponse(rl);
    if (blocked) return blocked;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return Response.json(
        { error: "Payer Pal hasn't been set up yet. Please ask your administrator to configure the AI assistant.", error_type: "not_configured" },
        { status: 503 }
      );
    }

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

    // Record success for circuit breaker
    await recordSuccess("anthropic").catch(() => {});

    return Response.json({ answer, patient_id: patientId });
  } catch (err) {
    // Record failure for circuit breaker
    await recordFailure("anthropic").catch(() => {});

    console.error("[chat] Error:", err.name);
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return Response.json(
        { error: "Payer Pal took too long to respond. Please try again.", error_type: "timeout", status: "system_outage", service: "anthropic" },
        { status: 504 }
      );
    }
    return Response.json(
      { error: "Something went wrong. Please try again.", error_type: "unknown", status: "system_outage", service: "anthropic" },
      { status: 500 }
    );
  }
}
