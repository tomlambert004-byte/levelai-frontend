/**
 * POST /api/v1/practice
 *
 * Called once on first login to bootstrap a Practice record in Postgres.
 * Idempotent — if the practice already exists for this Clerk user, returns it.
 *
 * Body: { name: "Georgetown Dental" }  (optional — defaults to user's name)
 */
import { auth, currentUser } from "@clerk/nextjs/server";
import { prisma } from "../../../../lib/prisma.js";

export async function POST(request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await currentUser();
    const body = await request.json().catch(() => ({}));

    const practiceName =
      body.name ||
      user?.organizationMemberships?.[0]?.organization?.name ||
      `${user?.firstName || ""} ${user?.lastName || ""}`.trim() ||
      "My Practice";

    // Upsert — create if not exists, update fields if provided
    const updateData = {};
    if (body.name)        updateData.name        = body.name;
    if (body.email)       updateData.email       = body.email;
    if (body.npi)         updateData.npi         = body.npi;
    if (body.taxId)       updateData.taxId       = body.taxId;
    if (body.accountMode) updateData.accountMode = body.accountMode;
    if (body.address)     updateData.address     = body.address;
    if (body.phone)       updateData.phone       = body.phone;
    if (body.pmsSystem)   updateData.pmsSystem   = body.pmsSystem;
    if (body.pmsSyncKey)  updateData.pmsSyncKey  = body.pmsSyncKey;
    if (body.faxNumber !== undefined) updateData.faxNumber = body.faxNumber || null;
    if (body.verificationDaysAhead !== undefined) updateData.verificationDaysAhead = Math.max(1, Math.min(25, parseInt(body.verificationDaysAhead) || 7));

    const practice = await prisma.practice.upsert({
      where:  { clerkUserId: userId },
      update: updateData,
      create: {
        clerkUserId: userId,
        name:        practiceName,
        email:       body.email       || null,
        npi:         body.npi         || null,
        taxId:       body.taxId       || null,
        accountMode: body.accountMode || "sandbox",
        address:     body.address     || null,
        phone:       body.phone       || null,
        pmsSystem:   body.pmsSystem   || null,
        pmsSyncKey:  body.pmsSyncKey  || null,
        faxNumber:   body.faxNumber   || null,
        verificationDaysAhead: body.verificationDaysAhead ? Math.max(1, Math.min(25, parseInt(body.verificationDaysAhead) || 7)) : 7,
      },
    });

    return Response.json({ practice });
  } catch (err) {
    console.error("[practice] Error:", err);
    return Response.json({ error: "An error occurred. Please try again." }, { status: 500 });
  }
}

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const practice = await prisma.practice.findUnique({
      where: { clerkUserId: userId },
    });

    if (!practice) {
      return Response.json({ practice: null }, { status: 404 });
    }

    return Response.json({ practice });
  } catch (err) {
    console.error("[practice] Error:", err);
    return Response.json({ error: "An error occurred. Please try again." }, { status: 500 });
  }
}
