/**
 * Dentrix PMS Adapter (Stub)
 *
 * In production, this would connect to the Dentrix API (Henry Schein).
 * Dentrix uses a local SQL Server database with API access via
 * the Dentrix Developer API (DDX API).
 *
 * Required credentials: API Key from Office Manager → Tools → API Keys
 */

export async function syncDailySchedule(dateStr) {
  console.warn("[Dentrix] Adapter not yet implemented — returning empty schedule. Configure Dentrix API credentials in Settings.");
  return [];
}

export async function getPatient(patNum) {
  console.warn("[Dentrix] getPatient not yet implemented");
  return null;
}

export async function getPatientInsurance(patNum) {
  console.warn("[Dentrix] getPatientInsurance not yet implemented");
  return null;
}
