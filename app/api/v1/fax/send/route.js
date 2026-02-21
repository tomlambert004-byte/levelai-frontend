/**
 * POST /api/v1/fax/send
 *
 * Queues a fax request for missing insurance information.
 * Currently logs the request + creates an AuditLog entry.
 * Future: integrates with Twilio Fax / SRFax / Phaxio for actual delivery.
 *
 * Body: {
 *   payerName, payerFaxNumber, patientName, memberId, patientDob,
 *   missingFields[], appointmentDate?, returnFax?, returnEmail?
 * }
 */
import { auth } from "@clerk/nextjs/server";
import { prisma } from "../../../../../lib/prisma.js";
import { generateFaxCoverSheet } from "../../../../../lib/fax-cover-sheet.js";

export async function POST(request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));

    // Validate required fields
    const { payerName, payerFaxNumber, patientName, memberId, missingFields } = body;
    if (!payerName || !patientName) {
      return Response.json(
        { error: "payerName and patientName are required" },
        { status: 400 }
      );
    }

    // Look up the practice for return fax/email
    const practice = await prisma.practice.findUnique({
      where: { clerkUserId: userId },
      select: { id: true, name: true, npi: true, faxNumber: true, email: true },
    });

    if (!practice) {
      return Response.json({ error: "Practice not found" }, { status: 404 });
    }

    const returnFax = body.returnFax || practice.faxNumber;
    const returnEmail = body.returnEmail || practice.email;

    // Generate the fax cover sheet HTML (for future integration)
    const coverSheetHtml = generateFaxCoverSheet({
      payerName,
      payerFaxNumber: payerFaxNumber || "N/A",
      practiceName: practice.name,
      practiceNpi: practice.npi,
      returnFax,
      returnEmail,
      patientName,
      memberId,
      patientDob: body.patientDob,
      missingFields: missingFields || [],
      appointmentDate: body.appointmentDate,
      isMedicaid: body.isMedicaid || false,
      medicaidState: body.medicaidState || null,
    });

    // Generate a fax ID for tracking
    const faxId = `fax_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Create audit log entry (zero PHI — metadata only)
    await prisma.auditLog.create({
      data: {
        practiceId: practice.id,
        userId,
        action: "fax.send_request",
        resourceType: "FaxRequest",
        resourceId: faxId,
        metadata: {
          payerName,
          payerFaxNumber: payerFaxNumber || null,
          missingFieldCount: (missingFields || []).length,
          hasReturnFax: !!returnFax,
          hasReturnEmail: !!returnEmail,
          appointmentDate: body.appointmentDate || null,
          // NOTE: No patient names, DOBs, or member IDs stored in audit log
        },
      },
    });

    console.log(
      `[fax] Request queued: ${faxId} | Payer: ${payerName} | Fields: ${(missingFields || []).length} | Practice: ${practice.id}`
    );

    return Response.json({
      success: true,
      status: "queued",
      faxId,
      message: `Information request will be faxed to ${payerName}`,
      // coverSheetHtml is available for future fax API integration
      _coverSheetLength: coverSheetHtml.length,
    });
  } catch (err) {
    console.error("[fax/send] Error:", err);
    return Response.json(
      { error: "Failed to queue fax request. Please try again." },
      { status: 500 }
    );
  }
}
