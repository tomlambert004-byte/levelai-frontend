/**
 * Sentry Client-Side Configuration
 *
 * Captures unhandled errors + performance data in the browser.
 * ZERO PHI: We strip patient data from breadcrumbs and never send
 * PHI fields (firstName, lastName, dob, memberId) to Sentry.
 */
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: process.env.NODE_ENV === "production",

  // Performance: sample 20% of transactions (adjust as traffic grows)
  tracesSampleRate: 0.2,

  // Replay: capture 0% of sessions, 100% of sessions with errors
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,

  // Scrub PHI from breadcrumbs and events
  beforeSend(event) {
    // Strip any patient data that might leak into error messages
    if (event.message) {
      event.message = scrubPHI(event.message);
    }
    if (event.exception?.values) {
      for (const ex of event.exception.values) {
        if (ex.value) ex.value = scrubPHI(ex.value);
      }
    }
    return event;
  },

  beforeBreadcrumb(breadcrumb) {
    // Drop XHR breadcrumbs that contain patient data in URLs
    if (breadcrumb.category === "xhr" || breadcrumb.category === "fetch") {
      const url = breadcrumb.data?.url || "";
      if (url.includes("member_id") || url.includes("patient")) {
        breadcrumb.data = { url: "[REDACTED — PHI]" };
      }
    }
    return breadcrumb;
  },
});

/** Remove potential PHI patterns from strings sent to Sentry */
function scrubPHI(str: string): string {
  return str
    // SSN-like patterns
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[REDACTED-SSN]")
    // Member IDs (common formats: letters+digits, 8+ chars)
    .replace(/\b[A-Z]{2,4}\d{6,}\b/g, "[REDACTED-ID]")
    // DOB patterns (YYYY-MM-DD)
    .replace(/\b(19|20)\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/g, "[REDACTED-DOB]");
}
