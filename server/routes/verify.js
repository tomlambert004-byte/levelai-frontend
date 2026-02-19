/**
 * Pulp — Express Route: /api/verify
 *
 * Sits between your Next.js frontend and the Python microservice.
 * Add this file to your Express server's routes folder and register it:
 *
 *   // In your main server.js / app.js:
 *   const verifyRoute = require('./routes/verify');
 *   app.use('/api', verifyRoute);
 *
 * Then the frontend calls:  POST http://localhost:3001/api/verify
 */

const express = require('express');
const router = express.Router();

// Node 18+ has built-in fetch. For older versions: npm install node-fetch
// and add: const fetch = require('node-fetch');

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:8001';

// ── POST /api/verify ──────────────────────────────────────────────────────────
router.post('/verify', async (req, res) => {
  const { patient_id, carrier, member_id, scheduled_procedures, api_response } = req.body;

  // Basic validation
  if (!patient_id || !carrier || !member_id) {
    return res.status(400).json({ error: 'patient_id, carrier, and member_id are required.' });
  }

  try {
    const pyRes = await fetch(`${PYTHON_SERVICE_URL}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patient_id,
        carrier,
        member_id,
        scheduled_procedures: scheduled_procedures || [],
        api_response: api_response || {},   // pass empty dict if clearinghouse returned nothing
      }),
    });

    if (!pyRes.ok) {
      const errorText = await pyRes.text();
      console.error('[pulp] Python service error:', errorText);
      return res.status(502).json({ error: 'Fallback manager failed.', detail: errorText });
    }

    const breakdown = await pyRes.json();
    return res.json(breakdown);

  } catch (err) {
    console.error('[pulp] Could not reach Python service:', err.message);
    return res.status(503).json({
      error: 'Python service unavailable. Is it running on port 8001?',
      hint: 'Run: uvicorn api:app --port 8001 --reload  (in python_service/ folder)',
    });
  }
});

// ── GET /api/verify/health ────────────────────────────────────────────────────
router.get('/verify/health', async (req, res) => {
  try {
    const pyRes = await fetch(`${PYTHON_SERVICE_URL}/health`);
    const data = await pyRes.json();
    res.json({ express: 'ok', python: data });
  } catch {
    res.status(503).json({ express: 'ok', python: 'unreachable' });
  }
});

module.exports = router;
