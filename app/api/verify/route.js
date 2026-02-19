/**
 * Pulp — Next.js API Route: /api/chat
 * File location: app/api/chat/route.js  (Next.js 13+ App Router)
 *
 * Forwards Payer Pal chat requests to the FastAPI backend.
 * The browser calls /api/chat, this calls http://127.0.0.1:8000/api/chat.
 * The ANTHROPIC_API_KEY never leaves the server.
 *
 * Request body expected by the browser:
 *   { patient_id: string, question: string, coverage_json: object }
 *
 * Response:
 *   { answer: string, patient_id: string }
 */

const PYTHON_API_URL = process.env.PYTHON_API_URL || 'http://127.0.0.1:8000';

export async function POST(request) {
  try {
    const body = await request.json();

    // Basic validation — never forward an empty question
    if (!body.question?.trim()) {
      return Response.json({ error: 'Question is required.' }, { status: 400 });
    }

    const apiRes = await fetch(`${PYTHON_API_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patient_id:    body.patient_id   || 'unknown',
        question:      body.question.trim(),
        coverage_json: body.coverage_json || {},
      }),
    });

    const data = await apiRes.json();

    return Response.json(data, { status: apiRes.status });

  } catch (err) {
    return Response.json(
      { error: 'Could not reach the Payer Pal service.', detail: err.message },
      { status: 503 }
    );
  }
}