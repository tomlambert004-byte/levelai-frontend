/**
 * Eaglesoft PMS Adapter (Stub)
 *
 * In production, this would connect to the Patterson Eaglesoft system.
 * Eaglesoft uses a local Firebird database with API access via
 * the Integration Hub API.
 *
 * Required credentials: Token from Setup → Connections → Integration Hub
 */

export async function syncDailySchedule(dateStr) {
  console.warn("[Eaglesoft] Adapter not yet implemented — returning empty schedule. Configure Eaglesoft token in Settings.");
  return [];
}

export async function getPatient(patNum) {
  console.warn("[Eaglesoft] getPatient not yet implemented");
  return null;
}

export async function getPatientInsurance(patNum) {
  console.warn("[Eaglesoft] getPatientInsurance not yet implemented");
  return null;
}
