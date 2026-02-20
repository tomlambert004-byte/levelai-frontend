/**
 * POST /api/v1/preauth/generate
 *
 * Next.js proxy → Python FastAPI at PYTHON_API_URL/api/preauth/generate
 *
 * When PYTHON_API_URL is not set (e.g. no Python sidecar in production),
 * this route returns a realistic mock response so the UI always works.
 * The mock letter is clearly labelled as a demo and matches the p4/D6010 scenario.
 *
 * Request body:  { patient_id: string, procedure_code: string }
 * Response:      { letter, attached_files, clinical_summary, procedure_code, patient_id }
 */

const PYTHON_API_URL = process.env.PYTHON_API_URL; // e.g. "https://your-python-service.railway.app"

// ── Mock fallback ─────────────────────────────────────────────────────────────
const MOCK_RESPONSES = {
  p4: {
    patient_id: "p4",
    procedure_code: "D6010",
    clinical_summary: {
      patient_name: "James Whitfield",
      date_of_birth: "2002-01-30",
      member_id: "AET77700011",
      insurance_carrier: "Aetna DMO Essential",
      procedure_description: "Implant Body Placement — Tooth #14",
      tooth_numbers: ["#14"],
      treating_provider: "Dr. Sarah Patel, DDS",
      appointment_date: "2026-03-15",
      estimated_fee_cents: 350000,
      coverage_pct: 50,
    },
    attached_files: [
      { filename: "panorex_03_2024.jpg",     file_type: "xray",   description: "Panoramic radiograph at time of extraction (Mar 2024)" },
      { filename: "cbct_01_2026.dcm",         file_type: "xray",   description: "CBCT scan showing 13.2mm bone height at #14 (Jan 2026)" },
      { filename: "perio_chart_11_2025.pdf",  file_type: "chart",  description: "Full periodontal chart — all sites ≤3mm, no bone loss" },
      { filename: "surgical_consent.pdf",     file_type: "report", description: "Signed patient consent for implant surgery" },
      { filename: "extraction_op_note.pdf",   file_type: "report", description: "Original extraction operative note (Mar 2024)" },
    ],
    letter: `February 19, 2026

Aetna DMO Essential
Pre-Authorization Department
P.O. Box 14079
Lexington, KY 40512

RE: Pre-Authorization Request — Implant Body Placement (D6010)
    Patient: James Whitfield  |  DOB: January 30, 2002  |  Member ID: AET77700011
    Group: GRP-077700  |  Date of Service: March 15, 2026

To the Pre-Authorization Review Committee:

I am writing on behalf of my patient, James Whitfield, to formally request pre-authorization for the placement of a dental implant body (CDT Code D6010) at tooth site #14. This letter presents the clinical evidence supporting the medical necessity of this procedure.

CLINICAL FINDINGS AND DIAGNOSIS

Tooth #14 was extracted on March 10, 2024, following an irreparable crown-root fracture sustained from trauma. The extraction socket healed without complication. At the November 5, 2025 evaluation, clinical and radiographic assessment confirmed adequate osseous volume for implant placement. A cone beam computed tomography (CBCT) scan performed January 10, 2026, objectively documented 13.2mm of available bone height superior to the maxillary sinus floor and 7.8mm of buccolingual bone width at the proposed implant site. The opposing dentition (tooth #3) is fully erupted and functional. Mr. Whitfield is a non-smoker in excellent systemic health (ASA Class I), with no contraindications to surgical intervention. The selected implant, a Nobel Biocare NP 4.3 × 10mm fixture, is appropriate for the anatomical dimensions confirmed by CBCT.

MEDICAL NECESSITY

Implant-supported restoration represents the current standard of care for single-tooth replacement, as recognized by the American Dental Association and the Academy of Osseointegration. The absence of tooth #14 creates a functional deficit in the left maxillary posterior quadrant, disrupts the occlusal plane, and creates a documented risk of supraeruption of the opposing tooth #3. A fixed implant restoration is the minimally invasive option that preserves adjacent tooth structure, prevents alveolar bone resorption at the edentulous site, and restores full masticatory function. Removable partial dentures and conventional fixed bridges were considered and excluded due to the patient's age (24 years), the condition of adjacent teeth, and the evidence base supporting implants as the superior long-term solution in this clinical scenario.

RISK OF NON-TREATMENT

Should this request be denied without an approved alternative, the continued edentulous state at site #14 is clinically anticipated to result in: progressive alveolar bone resorption, supraeruption and potential periodontal compromise of tooth #3, mesial drift of adjacent teeth #15 and #13 leading to malocclusion, and diminished masticatory efficiency that may impact the patient's nutritional intake.

SUPPORTING DOCUMENTATION

The following clinical records are enclosed with this request to substantiate the diagnosis and treatment plan:
  • panorex_03_2024.jpg — Panoramic radiograph confirming extraction site at time of procedure (March 2024)
  • cbct_01_2026.dcm — CBCT scan with annotated measurements: 13.2mm bone height, 7.8mm bone width (January 2026)
  • perio_chart_11_2025.pdf — Full periodontal chart confirming periodontal health of remaining dentition
  • surgical_consent.pdf — Signed informed consent for implant surgery
  • extraction_op_note.pdf — Original operative report from extraction procedure (March 2024)

I respectfully request expedited review of this case given the documented progression of opposing tooth supraeruption. I am available to provide any additional clinical information required. Please contact our office at (555) 555-0100.

Sincerely,

Dr. Sarah Patel, DDS
Georgetown Dental Associates
1234 Dental Way, Suite 100
Georgetown, TX 78626
NPI: 1234567890
Tax ID: 74-1234567

[DEMO — Generated by Level AI Pre-Auth Engine using mock PMS data]`,
  },

  p5: {
    patient_id: "p5",
    procedure_code: "D3310",
    clinical_summary: {
      patient_name: "Susan Nakamura",
      date_of_birth: "1983-09-14",
      member_id: "GRD55566677",
      insurance_carrier: "Guardian DentalGuard Preferred",
      procedure_description: "Endodontic Therapy — Anterior Tooth (Root Canal)",
      tooth_numbers: ["#9"],
      treating_provider: "Dr. Maria Rodriguez, DDS, MS — Endodontist",
      appointment_date: "2026-03-22",
      estimated_fee_cents: 115000,
      coverage_pct: 80,
    },
    attached_files: [
      { filename: "pa_xray_tooth9_02_2026.jpg", file_type: "xray",   description: "Periapical radiograph showing widened PDL and periapical rarefaction (#9)" },
      { filename: "emergency_op_note.pdf",       file_type: "report", description: "Emergency access operative note (Feb 10, 2026)" },
      { filename: "rx_amoxicillin.pdf",          file_type: "report", description: "Prescription record — Amoxicillin 500mg" },
    ],
    letter: `February 19, 2026

Guardian Life Insurance Company
Pre-Authorization Department
P.O. Box 26000
Lehigh Valley, PA 18002

RE: Pre-Authorization Request — Endodontic Therapy, Anterior Tooth (D3310)
    Patient: Susan Nakamura  |  DOB: September 14, 1983  |  Member ID: GRD55566677
    Group: GRP-055566  |  Date of Service: March 22, 2026

To the Pre-Authorization Review Committee:

I am writing to request pre-authorization for endodontic therapy (CDT Code D3310) on tooth #9 for my patient, Susan Nakamura. The clinical findings documented herein confirm that this treatment is medically necessary and consistent with the current standard of care.

CLINICAL FINDINGS AND DIAGNOSIS

Ms. Nakamura presented on February 10, 2026, with a chief complaint of spontaneous, severe, continuous pain of five days' duration in the maxillary left anterior region. Clinical examination revealed tooth #9 to be positive to percussion (3/3) and palpation (2/3), with no response to cold testing, consistent with pulp necrosis. The periapical radiograph taken at the time of examination demonstrated a widened periodontal ligament space and early periapical rarefaction at the apex of tooth #9, radiographically confirming the clinical diagnosis. Emergency access opening was initiated on the same date, and copious exudate was encountered upon pulp chamber access, indicative of acute infection. The canals were instrumented to a confirmed working length of 22mm, irrigated with 5.25% sodium hypochlorite and 17% EDTA, and calcium hydroxide interappointment dressing was placed. The patient was prescribed amoxicillin 500mg three times daily for seven days, and pain was significantly diminished upon completion of the emergency procedure. Diagnosis: Pulp Necrosis with Symptomatic Apical Periodontitis.

MEDICAL NECESSITY

Endodontic therapy is the definitive, tooth-preserving treatment for pulp necrosis with apical periodontitis, as supported by the American Association of Endodontists' clinical guidelines. The confirmed acute infection and documented periapical pathology require endodontic intervention to eliminate the source of infection and prevent extension of the apical lesion. Extraction, the only alternative to root canal therapy, would result in unnecessary permanent loss of tooth #9 — a maxillary central incisor with significant functional and aesthetic consequence — and would necessitate a prosthetic replacement with substantially greater cost and complexity.

RISK OF NON-TREATMENT

If endodontic therapy is not authorized, the active periapical infection at tooth #9 is expected to progress, with documented risk of: enlargement of the periapical lesion and potential bone destruction, systemic spread of odontogenic infection (particularly given the proximity to fascial spaces), continued severe pain and functional impairment, and ultimate loss of the tooth with the associated prosthetic rehabilitation costs.

SUPPORTING DOCUMENTATION

The following records are enclosed in support of this request:
  • pa_xray_tooth9_02_2026.jpg — Periapical radiograph confirming widened PDL space and early periapical rarefaction
  • emergency_op_note.pdf — Operative note from emergency access procedure (February 10, 2026)
  • rx_amoxicillin.pdf — Antibiotic prescription corroborating documented acute infection

I respectfully request expedited processing of this pre-authorization request given the active infection and acute pain presentation. Please do not hesitate to contact our office with any questions.

Sincerely,

Dr. Maria Rodriguez, DDS, MS
Endodontics — Georgetown Dental Associates
1234 Dental Way, Suite 200
Georgetown, TX 78626
NPI: 9876543210
Tax ID: 74-1234567

[DEMO — Generated by Level AI Pre-Auth Engine using mock PMS data]`,
  },
};

// ── Route handler ──────────────────────────────────────────────────────────────
export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const { patient_id, procedure_code } = body;

  if (!patient_id || !procedure_code) {
    return Response.json(
      { error: "patient_id and procedure_code are required" },
      { status: 400 }
    );
  }

  // Try to proxy to live Python service first
  if (PYTHON_API_URL) {
    try {
      const upstream = await fetch(`${PYTHON_API_URL}/api/preauth/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patient_id, procedure_code }),
        signal: AbortSignal.timeout(30_000),
      });
      if (upstream.ok) {
        const data = await upstream.json();
        return Response.json(data);
      }
    } catch {
      // Fall through to mock
    }
  }

  // Mock fallback — pick best match or default to p4
  const mock =
    MOCK_RESPONSES[patient_id] ||
    MOCK_RESPONSES["p4"];

  // Slight delay to simulate real generation
  await new Promise(r => setTimeout(r, 1800));

  return Response.json({
    ...mock,
    patient_id,
    procedure_code,
  });
}
