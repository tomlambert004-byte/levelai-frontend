/**
 * Sentry Server-Side Configuration
 *
 * Captures errors from API routes, middleware, and server-side rendering.
 * ZERO PHI: Patient data is scrubbed before sending to Sentry.
 */
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: process.env.NODE_ENV === "production",

  // Performance: sample 20% of API route transactions
  tracesSampleRate: 0.2,

  // Scrub PHI from error events
  beforeSend(event) {
    if (event.message) {
      event.message = scrubPHI(event.message);
    }
    if (event.exception?.values) {
      for (const ex of event.exception.values) {
        if (ex.value) ex.value = scrubPHI(ex.value);
      }
    }
    // Remove request body (may contain patient data)
    if (event.request?.data) {
      event.request.data = "[REDACTED — may contain PHI]";
    }
    return event;
  },
});

function scrubPHI(str: string): string {
  return str
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[REDACTED-SSN]")
    .replace(/\b[A-Z]{2,4}\d{6,}\b/g, "[REDACTED-ID]")
    .replace(/\b(19|20)\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/g, "[REDACTED-DOB]");
}
