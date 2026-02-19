# Level AI — Backend API Contract
## Phase 1: JSON Schema Specifications

This document is the contract between the FastAPI backend and the Next.js
frontend. Every response shape here is exactly what the frontend expects.
Any deviation will cause a runtime error or a silent data gap.

---

## Conventions

| Convention | Value |
|---|---|
| Base path | `/api/v1` |
| All monetary values | **cents (integer)** — `145000` = $1,450.00 |
| All dates | `"YYYY-MM-DD"` string |
| All times | `"H:MM AM"` string (12-hour, no leading zero) |
| Null vs. missing | Use `null` explicitly — never omit a key |

---

## 1. `GET /api/v1/patients/calendar?month=YYYY-MM`

Populates the **Office Calendar** grid. Returns one summary object per
working day in the requested month. The frontend does a date-keyed lookup
for each calendar cell — missing dates render as "0 Scheduled."

### Query Parameters
| Param | Type | Example | Required |
|---|---|---|---|
| `month` | string | `2026-02` | ✅ |

### Response — `CalendarDaySummary[]`

```json
[
  {
    "date": "2026-02-19",
    "appointment_count": 12,
    "available_slots": 4,
    "has_blocking_issue": true,
    "has_notification": false,
    "verified_count": 7,
    "action_required_count": 3,
    "inactive_count": 1,
    "pending_count": 1
  },
  {
    "date": "2026-02-20",
    "appointment_count": 9,
    "available_slots": 7,
    "has_blocking_issue": false,
    "has_notification": true,
    "verified_count": 6,
    "action_required_count": 0,
    "inactive_count": 0,
    "pending_count": 3
  }
]
```

### Field Reference

| Field | Type | Description |
|---|---|---|
| `date` | string | ISO date. **Primary key** used by the frontend lookup. |
| `appointment_count` | int | Total scheduled patients for the day. |
| `available_slots` | int | `total_capacity - appointment_count`. Total capacity is a practice setting (default 16). |
| `has_blocking_issue` | bool | `true` if any patient has a CRITICAL triage flag (inactive plan, missing tooth clause, etc.). Renders a **red dot** on the calendar cell. |
| `has_notification` | bool | `true` if any patient has a WARNING flag but no blocker. Renders an **amber dot**. |
| `verified_count` | int | Count of patients with `verification_status = "verified"`. |
| `action_required_count` | int | Count with `verification_status = "action_required"`. |
| `inactive_count` | int | Count with `verification_status = "inactive"`. |
| `pending_count` | int | Not yet verified. |

---

## 2. `GET /api/v1/patients/daily?date=YYYY-MM-DD`

Populates the **Daily Schedule Kanban** and the **DayCardPanel**.
Returns all appointments for a single date, sorted by `appointment_time`.

### Query Parameters
| Param | Type | Example | Required |
|---|---|---|---|
| `date` | string | `2026-02-19` | ✅ |

### Response — `Patient[]`

```json
[
  {
    "id": "appt_a1b2c3d4",
    "name": "Rachel Kim",
    "dob": "1988-06-11",
    "appointment_date": "2026-02-19",
    "appointment_time": "1:00 PM",
    "hours_until": 6,
    "provider": "Dr. Patel",
    "procedure": "Bridge #28-30",
    "fee_cents": 320000,
    "insurance": "Humana",
    "member_id": "HUM1234876",
    "group_id": "GRP9900123",
    "phone": "(512) 555-0744",
    "email": "rachel.kim@email.com",
    "pms_patient_id": "OD_00042",
    "notes": null
  },
  {
    "id": "appt_e5f6g7h8",
    "name": "Marcus Webb",
    "dob": "1975-02-14",
    "appointment_date": "2026-02-19",
    "appointment_time": "3:30 PM",
    "hours_until": 9,
    "provider": "Dr. Chen",
    "procedure": "Prophy + Exam",
    "fee_cents": 22000,
    "insurance": "UnitedHealth",
    "member_id": "UHC9988776",
    "group_id": "GRP1122334",
    "phone": "(512) 555-0856",
    "email": null,
    "pms_patient_id": "OD_00089",
    "notes": null
  }
]
```

### Field Reference

| Field | Type | Description |
|---|---|---|
| `id` | string | **Stable appointment ID** — used as the React key and passed to `POST /verify`. Must be unique per appointment, not per patient (same patient can have multiple appointments). |
| `name` | string | Full legal name as it appears in the PMS. |
| `dob` | string | `YYYY-MM-DD`. Used for eligibility request construction. |
| `appointment_date` | string | `YYYY-MM-DD`. |
| `appointment_time` | string | `"H:MM AM"` — 12-hour, no leading zero. Matches how the frontend renders it. |
| `hours_until` | int | Hours from **now** until the appointment. Backend computes this at query time so the frontend doesn't need to recalculate. Negative = appointment is in the past. |
| `provider` | string | Rendering provider name. |
| `procedure` | string | Plain-text procedure name from PMS (not CDT code). Used by triage to detect cleaning/prosthetic types via regex. |
| `fee_cents` | int | Estimated fee in cents. |
| `insurance` | string | Payer name. Must match the payer names registered in the RPA vault for bot routing. |
| `member_id` | string | Subscriber ID for eligibility. |
| `group_id` | string \| null | Group number, if available. |
| `phone` | string \| null | Used for SMS outreach drafts. |
| `email` | string \| null | |
| `pms_patient_id` | string \| null | Source-of-truth ID in the PMS (e.g. Open Dental `PatNum`). Needed for Phase 3 write-back. |
| `notes` | string \| null | Free-text appointment notes from PMS. |

> ⚠️ **Frontend camelCase mapping**: The frontend accesses `patient.appointmentDate`,
> `patient.appointmentTime`, `patient.hoursUntil`, etc. (camelCase). The backend
> returns snake_case. You must either:
> - **Option A (recommended):** Add a FastAPI response model with `alias_generator = to_camel` and `populate_by_name = True`.
> - **Option B:** Add a thin camelCase transformer in `loadDailySchedule()` on the frontend.
>
> The frontend code currently contains this transformer:
> ```js
> const withHours = data.map(p => {
>   if (p.hoursUntil != null) return p;
>   const diff = new Date(`${p.appointment_date}T...`) - new Date();
>   return { ...p, hoursUntil: Math.floor(diff / (1000 * 60 * 60)) };
> });
> ```
> **Simplest path:** return camelCase from FastAPI and drop the transformer.

---

## 3. `POST /api/v1/verify`

Triggers the full **Stedi → thin-data-detect → RPA** pipeline for one patient.
Called both for manual verification and auto-verify triggers.

### Request Body

```json
{
  "patient_id": "appt_a1b2c3d4",
  "trigger": "manual"
}
```

| Field | Type | Values | Description |
|---|---|---|---|
| `patient_id` | string | — | The `id` from the `/daily` response. |
| `trigger` | string | `"manual"`, `"24h_auto"`, `"7d_auto"`, `"rpa_fallback"` | Source of the request. Used for audit logging. When `trigger = "rpa_fallback"`, the backend skips Stedi and routes directly to the RPA bot for this payer. |

### Response — `VerificationResult`

This is the **most critical schema** — every field feeds the triage engine and
the BenefitsPanel UI directly.

```json
{
  "verification_status": "action_required",
  "plan_status": "active",
  "payer_name": "Humana",
  "payer_id": "HUM00001",
  "subscriber_name": "Rachel Kim",
  "subscriber_dob": "1988-06-11",
  "group_name": "Tech Corp Benefits",
  "effective_date": "2026-01-01",
  "termination_date": null,

  "annual_maximum_cents": 200000,
  "annual_remaining_cents": 142000,
  "annual_used_cents": 58000,

  "individual_deductible_cents": 5000,
  "individual_deductible_met_cents": 5000,

  "preventive": {
    "coverage_pct": 100,
    "copay_cents": 0,
    "cleaning_frequency": {
      "times_per_period": 2,
      "used_this_period": 1
    }
  },

  "restorative": {
    "coverage_pct": 80,
    "copay_cents": null,
    "composite_posterior_downgrade": false,
    "crown_waiting_period_months": 0
  },

  "missing_tooth_clause": {
    "applies": true,
    "affected_teeth": ["28", "29", "30"],
    "clause_description": "Teeth extracted prior to coverage effective date are excluded."
  },

  "frequency_limits": {
    "exams_per_year": 2,
    "used_this_year": 1,
    "xrays_per_year": 1,
    "xrays_used": 0
  },

  "action_flags": ["missing_tooth_clause", "pre_auth_required"],

  "_source": "stedi",
  "_fetched_at": "2026-02-19T14:32:11Z",
  "_stedi_transaction_id": "txn_8f3a9b2c"
}
```

### Field Reference — `VerificationResult`

| Field | Type | Description |
|---|---|---|
| `verification_status` | enum | `"verified"` \| `"action_required"` \| `"inactive"` \| `"error"`. **Drives Kanban column placement.** |
| `plan_status` | string | `"active"` \| `"inactive"` \| `"terminated"`. Any value other than `"active"` triggers the "inactive plan" blocker in triage. |
| `payer_name` | string | Full payer name for display. |
| `payer_id` | string | Payer EDI ID. Retained for audit. |
| `annual_maximum_cents` | int \| null | `null` = Stedi returned thin data → triggers RPA fallback. |
| `annual_remaining_cents` | int \| null | Must be present to avoid thin-data escalation. |
| `annual_used_cents` | int \| null | `annual_maximum - annual_remaining`. Computed or returned. |
| `individual_deductible_cents` | int \| null | Individual deductible amount. |
| `individual_deductible_met_cents` | int \| null | Amount applied toward deductible. |
| `preventive` | object \| null | `null` = thin data → RPA fallback. |
| `preventive.coverage_pct` | int | 0–100. |
| `preventive.cleaning_frequency` | object \| null | Used by triage to detect frequency-limit blockers. |
| `restorative` | object \| null | |
| `restorative.composite_posterior_downgrade` | bool | `true` triggers the "downgrade to amalgam" notify flag. |
| `missing_tooth_clause` | object \| null | `null` = thin data. Must be explicitly `{"applies": false}` for no clause. |
| `missing_tooth_clause.applies` | bool | `true` + prosthetic procedure = CRITICAL blocker. |
| `missing_tooth_clause.affected_teeth` | string[] | Tooth numbers in US Universal notation. |
| `frequency_limits` | object \| null | `null` = thin data. |
| `action_flags` | string[] | Machine-readable flag codes. Values: `"missing_tooth_clause"`, `"pre_auth_required"`, `"frequency_limit"`, `"plan_inactive"`, `"composite_downgrade"`, `"annual_max_low"`, `"thin_data"`. |
| `_source` | string | `"stedi"` \| `"rpa"` \| `"hybrid"`. The frontend sets `"hybrid"` on the client after merging. Backend should return `"stedi"` or `"rpa"`. |
| `_fetched_at` | string | ISO 8601 timestamp. |
| `_stedi_transaction_id` | string \| null | For audit trail (Phase 4). |

### Thin-Data Detection Logic

The frontend will auto-escalate to `rpa_fallback` if any of these fields are `null`:

```
missing_tooth_clause
frequency_limits
annual_maximum_cents
preventive
```

**If all four are populated**, no RPA call is made regardless of other fields.

---

## 4. `GET /api/v1/patients/directory?q=<search>`

Powers the **DirectorySearchModal** (Add Patient flow). Search is against
name and DOB in the PMS patient directory.

### Response — `Patient[]`

Same shape as `/daily`, but without `appointment_date`, `appointment_time`,
and `hours_until` (those are set by the booking modal):

```json
[
  {
    "id": "dir_pat_00042",
    "name": "Rachel Kim",
    "dob": "1988-06-11",
    "insurance": "Humana",
    "member_id": "HUM1234876",
    "phone": "(512) 555-0744",
    "email": "rachel.kim@email.com",
    "pms_patient_id": "OD_00042",
    "provider": "Dr. Patel",
    "procedure": null,
    "fee_cents": null
  }
]
```

---

## 5. Error Response Shape

All error responses use this envelope so the frontend can display them:

```json
{
  "detail": "Stedi returned HTTP 503 — payer unavailable",
  "code": "STEDI_UNAVAILABLE",
  "retryable": true
}
```

| Field | Type | Description |
|---|---|---|
| `detail` | string | Human-readable message shown in the error banner. |
| `code` | string \| null | Machine-readable code for frontend retry logic (Phase 2). |
| `retryable` | bool | If `true`, the frontend "Retry" button is shown. |

---

## Phase 1 Checklist

- [ ] `GET /api/v1/patients/calendar?month=` returns `CalendarDaySummary[]`
- [ ] `GET /api/v1/patients/daily?date=` returns `Patient[]` sorted by `appointment_time`
- [ ] `POST /api/v1/verify` accepts `{ patient_id, trigger }` and returns `VerificationResult`
- [ ] `trigger = "rpa_fallback"` routes to RPA bot, bypasses Stedi
- [ ] All monetary values are in **cents**
- [ ] `null` fields are returned explicitly (never omitted)
- [ ] `missing_tooth_clause: { applies: false }` when no clause (not `null`)
- [ ] Response is camelCase **or** snake_case transformer is in place on frontend
- [ ] Error responses use `{ detail, code, retryable }` envelope
