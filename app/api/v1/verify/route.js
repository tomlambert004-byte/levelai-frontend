/**
 * POST /api/v1/verify
 *
 * Next.js proxy → Python FastAPI POST /api/verify
 *
 * Body: { patient_id: string, trigger?: string }
 * Response: normalized 271 benefit data (VerificationResult)
 *
 * The Python service maps patient_id → fixture file and runs normalize_271().
 * We proxy here so the PYTHON_API_URL never leaks to the browser.
 */

const PYTHON_API_URL = process.env.PYTHON_API_URL || "http://127.0.0.1:8000";

export async function POST(request) {
  try {
    const body = await request.json();

    if (!body.patient_id) {
      return Response.json({ error: "patient_id is required." }, { status: 400 });
    }

    const apiRes = await fetch(`${PYTHON_API_URL}/api/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patient_id: body.patient_id }),
    });

    const data = await apiRes.json();
    return Response.json(data, { status: apiRes.status });

  } catch (err) {
    return Response.json(
      { error: "Could not reach the verification service.", detail: err.message },
      { status: 503 }
    );
  }
}
