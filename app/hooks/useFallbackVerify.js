/**
 * Pulp — useFallbackVerify hook
 *
 * Drop-in replacement for the mockVerify function in your dashboard.
 * Call verifyPatient(patient) and it will hit the real pipeline:
 *   Browser → Next.js API → Express → Python → Smart Breakdown
 *
 * Usage in PulpDashboard.jsx:
 *
 *   import { useFallbackVerify } from '@/hooks/useFallbackVerify';
 *
 *   // Replace:  const r = await mockVerify(patient);
 *   // With:     const r = await verifyPatient(patient);
 */

import { useCallback } from 'react';

/**
 * Maps a SmartBreakdown from the Python service back into the shape
 * your existing dashboard components already understand.
 * This means zero changes needed in BenefitsPanel, CleaningTracker, etc.
 */
function mapBreakdownToDashboardResult(breakdown, patient) {
  const f = breakdown.fields || {};
  const cleanFreq = f['frequency_limits.D1110'];
  const bwFreq    = f['frequency_limits.D0274'];
  const crownFreq = f['frequency_limits.D2740'];
  const srpFreq   = f['frequency_limits.D4341'];
  const mtc       = f['missing_tooth_clause'];

  // Derive a verification_status from completeness + warnings
  let verificationStatus = 'verified';
  if (breakdown.completeness_grade === 'F' || breakdown.completeness_grade === 'D') {
    verificationStatus = 'action_required';
  } else if (breakdown.warnings?.length > 0) {
    verificationStatus = 'action_required';
  }

  // Build action_flags from warnings so existing ActionFlag UI renders them
  const actionFlags = breakdown.warnings.map((_, i) => `warning_${i}`);
  const actionDescriptions = {};
  breakdown.warnings.forEach((w, i) => { actionDescriptions[`warning_${i}`] = w; });

  return {
    // Core status
    verification_status:  verificationStatus,
    plan_status:          f['plan_status'] ?? 'active',
    payer_name:           breakdown.carrier,

    // Financials
    annual_maximum_cents:       (f['annual_maximum'] ?? null),
    annual_remaining_cents:     (f['annual_maximum_remaining'] ?? null),
    individual_deductible_cents:(f['individual_deductible'] ?? null),
    individual_deductible_met_cents: (f['deductible_met'] ?? null),

    // Action flags
    action_flags:        actionFlags,
    action_descriptions: actionDescriptions,

    // Preventive block
    preventive: {
      coverage_pct: 100,
      copay_cents:  null,
      cleaning_frequency: cleanFreq ? {
        times_per_period:   cleanFreq.times_per_period,
        period:             cleanFreq.period ?? 'calendar_year',
        used_this_period:   cleanFreq.used_this_period ?? 0,
        last_service_date:  cleanFreq.last_service_date ?? null,
        next_eligible_date: cleanFreq.next_eligible_date ?? null,
        covered_codes:      ['D1110', 'D1120'],
        perio_maintenance_covered: !!(f['frequency_limits.D4910']),
        perio_maintenance_frequency: f['frequency_limits.D4910']
          ? { times_per_period: f['frequency_limits.D4910'].times_per_period }
          : null,
        notes: null,
      } : null,
      bitewing_frequency: bwFreq ? {
        times_per_period:   bwFreq.times_per_period,
        period:             bwFreq.period ?? 'calendar_year',
        last_service_date:  bwFreq.last_service_date ?? null,
        next_eligible_date: bwFreq.next_eligible_date ?? null,
      } : null,
      sealant_coverage_pct: null,
      sealant_age_limit:    null,
    },

    // Restorative block
    restorative: {
      coverage_pct:                f['coverage_pct.basic'] ?? null,
      copay_cents:                 null,
      composite_posterior_downgrade: f['composite_posterior_downgrade'] ?? false,
      crown_waiting_period_months: f['waiting_period.major']?.months ?? 0,
      crown_frequency: crownFreq ? {
        times_per_period: crownFreq.times_per_period,
        period:           crownFreq.period ?? '5_years',
      } : null,
    },

    // Missing tooth clause
    missing_tooth_clause: mtc ? {
      applies:            mtc.applies ?? false,
      notes:              mtc.notes ?? '',
      affected_teeth:     mtc.affected_teeth ?? [],
      excluded_services:  mtc.excluded_services ?? [],
      exception_pathway:  mtc.exception_pathway ?? null,
      policy_effective_date: mtc.policy_effective_date ?? null,
    } : { applies: false, notes: 'Not retrieved', affected_teeth: [], excluded_services: [] },

    // Metadata
    verified_at:  breakdown.completed_at,
    expires_at:   new Date(Date.now() + 172800000).toISOString(),  // 48h TTL

    // Extras surfaced in the UI
    completeness_score: breakdown.completeness_score,
    completeness_grade: breakdown.completeness_grade,
    human_note:         breakdown.human_note,
    sources:            breakdown.sources,
  };
}


export function useFallbackVerify() {
  const verifyPatient = useCallback(async (patient) => {
    const response = await fetch('/api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patient_id:            patient.id,
        carrier:               patient.insurance,
        member_id:             patient.memberId,
        scheduled_procedures:  [patient.procedure],
        // In production: pass the real Vyne/Onederful response here.
        // For now, passing empty dict triggers full fallback pipeline.
        api_response: patient._rawApiResponse ?? {},
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `Verify failed: ${response.status}`);
    }

    const breakdown = await response.json();
    return mapBreakdownToDashboardResult(breakdown, patient);
  }, []);

  return { verifyPatient };
}
