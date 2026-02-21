/**
 * POST /api/v1/contact
 *
 * Receives contact form submissions and logs them.
 * In production, this would forward to an email service or CRM.
 * For now, logs to console and returns success.
 */

export async function POST(request) {
  try {
    const body = await request.json();
    const { name, email, phone, issue } = body;

    if (!name || !email || !issue) {
      return Response.json(
        { error: "Name, email, and message are required." },
        { status: 400 }
      );
    }

    // Log the contact form submission
    console.log("[contact] New submission:", {
      name,
      email,
      phone: phone || "Not provided",
      issue: issue.slice(0, 200),
      timestamp: new Date().toISOString(),
    });

    // TODO: In production, send an email notification to support@levelai.app
    // using a transactional email service (SendGrid, Resend, etc.)

    return Response.json({ success: true, message: "Message received. We'll get back to you within 24 hours." });
  } catch (err) {
    console.error("[contact] Error:", err);
    return Response.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
