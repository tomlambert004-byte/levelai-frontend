/**
 * /api/v1/sms — SMS Draft Queue (DEPRECATED — Stateless)
 *
 * ZERO PHI AT REST: SMS drafts now live exclusively in frontend React state.
 * This route is kept as a no-op stub for backward compatibility.
 *
 * GET  → Returns empty drafts array (no DB backing)
 * POST → Acknowledges but does not persist (draft lives in agentLog state)
 * PATCH → Acknowledges but does not persist (status lives in agentLog state)
 */
import { auth } from "@clerk/nextjs/server";

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
    // No DB backing — drafts live in frontend state only
    return Response.json({ drafts: [] });
  } catch {
    return Response.json({ error: "An error occurred." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { userId } = await auth();
    if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const body = await request.json();
    // Return a synthetic draft ID so existing frontend code doesn't break
    return Response.json({
      draft: {
        id: `sms_${Date.now()}`,
        recipientPhone: body.recipientPhone,
        recipientName: body.recipientName,
        draftMessage: body.draftMessage,
        status: "draft",
      },
    });
  } catch {
    return Response.json({ error: "An error occurred." }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const { userId } = await auth();
    if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const body = await request.json();
    // Acknowledge — no DB persistence
    return Response.json({
      draft: { id: body.id, status: body.status },
    });
  } catch {
    return Response.json({ error: "An error occurred." }, { status: 500 });
  }
}
