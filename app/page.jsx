"use client";
export const dynamic = "force-dynamic";
import { SignedIn, SignedOut, useAuth, useClerk, useSignIn, useSignUp } from "@clerk/nextjs";
import { useState, useCallback, useEffect, useRef } from "react";
// Theme
const T = {
  bg:"#F5F5F0", bgCard:"#FFFFFF", border:"#E2E2DC", borderStrong:"#C8C8C0",
  lime:"#84CC16", limeLight:"#F0FDF0", limeBorder:"#BBF7B0", limeDark:"#3F6212",
  text:"#1A1A18", textMid:"#52525A", textSoft:"#A0A09A",
  amber:"#D97706", amberLight:"#FFFBEB", amberBorder:"#FCD34D", amberDark:"#B45309",
  red:"#DC2626", redLight:"#FEF2F2", redBorder:"#FECACA",
  slate:"#64748B", slateLight:"#F8FAFC",
  indigo:"#6366F1", indigoLight:"#EEF2FF", indigoBorder:"#C7D2FE",
  indigoDark:"#4F46E5",
  rpa:"#0EA5E9", rpaLight:"#F0F9FF", rpaBorder:"#BAE6FD", rpaDark:"#0369A1",
};

const dollars = (c) => c != null ? "$" + (Number(c)/100).toLocaleString("en-US",{minimumFractionDigits:0}) : "--";
const wholeDollars = (c) => c != null ? "$" + Math.round(Number(c)).toLocaleString("en-US") : "--";
const pct = (n) => n != null ? n + "%" : "--";

const STATUS = { VERIFIED:"verified", ACTION_REQUIRED:"action_required", INACTIVE:"inactive", ERROR:"error" };
const TRIAGE = { CLEAR:"CLEAR", NOTICE:"NOTICE", WARNING:"WARNING", CRITICAL:"CRITICAL" };
const ACTION = { VERIFIED:"insurance_verified", RESCHEDULE:"reschedule_proposed", APPROVED:"reschedule_approved", DISMISSED:"reschedule_dismissed", OUTREACH:"outreach_queued" };

// ── Helper: Date Generation ───────────────────────────────────────────
function getDaysInMonth(year, month) { return new Date(year, month + 1, 0).getDate(); }
function getFirstDayOfMonth(year, month) { return new Date(year, month, 1).getDay(); }
function generateCalendarGrid(year, month) {
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const grid = [];
  const prevMonthDays = getDaysInMonth(year, month - 1);
  for (let i = 0; i < firstDay; i++) {
    grid.push({ date: new Date(year, month - 1, prevMonthDays - firstDay + i + 1), isCurrentMonth: false });
  }
  for (let i = 1; i <= daysInMonth; i++) {
    grid.push({ date: new Date(year, month, i), isCurrentMonth: true });
  }
  const remainder = grid.length % 7;
  if (remainder !== 0) {
    for (let i = 1; i <= 7 - remainder; i++) {
      grid.push({ date: new Date(year, month + 1, i), isCurrentMonth: false });
    }
  }
  return grid;
}

function getNextWeekdays(baseDate, count) {
  const days = [];
  let d = new Date(baseDate);
  while(days.length < count) {
    if(d.getDay() !== 0 && d.getDay() !== 6) days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

// ── Triage Engine ─────────────────────────────────────────────────────────────
function triagePatient(patient, result) {
  if (!result) return { level:TRIAGE.CRITICAL, block:["Verification not yet run"], notify:[], notices:[], reasons:[], warnings:[] };
  const block = [], notify = [], notices = [];

  if (result.plan_status !== "active") block.push("Insurance plan is inactive or terminated");

  const rem = result.annual_remaining_cents ?? 0;
  if (rem === 0) block.push("Annual maximum fully exhausted -- patient responsible for 100% of fee");

  const isProsthetic = /implant|bridge|denture|partial/i.test(patient?.procedure || "");
  if (result.missing_tooth_clause?.applies && isProsthetic) block.push("Missing Tooth Clause will deny coverage for today's procedure. Pre-auth required.");

  const cleanFreq = result.preventive?.cleaning_frequency;
  const isCleaning = /prophy|cleaning|prophylaxis/i.test(patient?.procedure || "");
  if (cleanFreq && isCleaning) {
    const used = cleanFreq.used_this_period ?? 0, total = cleanFreq.times_per_period ?? 2;
    if (used >= total) block.push("Cleaning frequency limit reached (" + used + "/" + total + ") -- today's prophy will not be covered");
    else if (used > 0) notices.push((total - used) + " cleaning(s) remaining this period");
  }

  if (rem > 0 && rem < 30000 && result.plan_status === "active") notify.push("Low annual max remaining (" + dollars(rem) + ") -- patient may owe more than expected at checkout");
  if (result.restorative?.composite_posterior_downgrade) notify.push("Posterior composite will be downgraded to amalgam rate -- patient may owe the difference");
  if (result.missing_tooth_clause?.applies && !isProsthetic) notify.push("Missing Tooth Clause on file -- will affect future implant/bridge coverage");

  const level = block.length > 0 ? TRIAGE.CRITICAL : notify.length > 0 ? TRIAGE.WARNING : notices.length > 0 ? TRIAGE.NOTICE : TRIAGE.CLEAR;
  return { level, block, notify, notices, reasons: block, warnings: notify };
}


// ─────────────────────────────────────────────────────────────────────────────
// API CLIENT  ·  Phase 1: Data Bridge
// All network calls live here. Every function returns the raw JSON the
// FastAPI backend will send. Mock functions have been deleted.
// Base URL: NEXT_PUBLIC_API_URL env var → falls back to localhost:8000 for dev.
// ─────────────────────────────────────────────────────────────────────────────

const PYTHON_BASE =
  (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_API_URL)
    ? process.env.NEXT_PUBLIC_API_URL
    : "http://localhost:8000";

// Routes under /api/v1/* are Next.js routes (same origin).
// Routes under /api/verify and /api/chat go to the Python service.
async function apiFetch(path, options = {}) {
  const isNextRoute = path.startsWith("/api/v1/");
  const url = isNextRoute ? path : `${PYTHON_BASE}${path}`;
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail ?? detail; } catch {}
    throw new Error(detail);
  }
  return res.json();
}

// GET /api/v1/patients/calendar?month=YYYY-MM
// Returns: CalendarDaySummary[]  (used by CalendarView)
async function apiGetCalendar(monthStr) {
  return apiFetch(`/api/v1/patients/calendar?month=${encodeURIComponent(monthStr)}`);
}

// GET /api/v1/patients/daily?date=YYYY-MM-DD
// Returns: Patient[]  (used by the Kanban / Daily Schedule)
async function apiGetDailySchedule(dateStr) {
  return apiFetch(`/api/v1/patients/daily?date=${encodeURIComponent(dateStr)}`);
}

// GET /api/v1/patients/directory?q=<search>
// Returns: Patient[]  (used by DirectorySearchModal)
async function apiSearchDirectory(query) {
  return apiFetch(`/api/v1/patients/directory?q=${encodeURIComponent(query)}`);
}

// POST /api/v1/verify  { patient_id, member_id, first_name, last_name, date_of_birth, insurance_name, payer_id, trigger }
// Sends full patient data so the route can attempt a real Stedi call before falling back to fixtures.
// Returns: NormalizedVerificationResult
async function apiPostVerify(patientId, trigger, patientData = {}) {
  const [firstName, ...rest] = (patientData.name || "").split(" ");
  const lastName = rest.join(" ");
  return apiFetch("/api/v1/verify", {
    method: "POST",
    body: JSON.stringify({
      patient_id:     patientId,
      trigger,
      member_id:      patientData.memberId      || null,
      first_name:     patientData.firstName     || firstName || null,
      last_name:      patientData.lastName      || lastName  || null,
      date_of_birth:  patientData.dob           || patientData.dateOfBirth || null,
      insurance_name: patientData.insurance     || patientData.insuranceName || null,
      payer_id:       patientData.payerId       || null,
    }),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// THIN-DATA DETECTION & MERGE  (pure functions — no backend dependency)
// These run on whatever VerificationResult the API returns.
// ─────────────────────────────────────────────────────────────────────────────

const CRITICAL_FIELDS = ["missing_tooth_clause","frequency_limits","annual_maximum_cents","preventive"];

function detectThinData(r) {
  if (!r) return { thin:true, reason:"No API response", missingFields:[] };
  const status = (r.verification_status || "").toLowerCase();
  if (status === "inactive") return { thin:false, reason:null, missingFields:[] };
  if (["error","unknown",""].includes(status))
    return { thin:true, reason:`API returned ambiguous status: "${r.verification_status}"`, missingFields:[] };
  const missing = CRITICAL_FIELDS.filter(k => r[k] == null);
  if (missing.length > 0)
    return { thin:true, reason:`Incomplete clearinghouse data -- missing: ${missing.join(", ")}`, missingFields:missing };
  return { thin:false, reason:null, missingFields:[] };
}

function mergeResults(api, rpa) {
  const merged = { ...api };
  const apiWasThin = CRITICAL_FIELDS.some(k => api[k] == null);
  const allFields = [...CRITICAL_FIELDS,
    "annual_remaining_cents","individual_deductible_cents",
    "individual_deductible_met_cents","plan_status","payer_name"];
  for (const k of allFields) {
    if (api[k] == null && rpa[k] != null) merged[k] = rpa[k];
  }
  merged.action_flags = [
    ...new Set([...(api.action_flags||[]).filter(f=>f!=="thin_data"), ...(rpa.action_flags||[])])
  ];
  if (["error","unknown",""].includes((api.verification_status||"").toLowerCase()) || apiWasThin)
    merged.verification_status = rpa.verification_status;
  merged._source = "hybrid";
  return merged;
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT LOG ENTRY BUILDERS  (pure — no network calls)
// These produce frontend-only log entries that are displayed locally.
// In Phase 4 they will be replaced by entries returned from the audit-log API.
// ─────────────────────────────────────────────────────────────────────────────

function buildVerifyEntry(p, r, t, ph) {
  const triage = triagePatient(p, r);
  return {
    id: `log_${Date.now()}_${p.id}`,
    time: new Date().toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"}),
    patient: p.name, patientId: p.id, action: ACTION.VERIFIED,
    trigger: t, status: r.verification_status, triage: triage.level,
    reason: r.verification_status===STATUS.VERIFIED?"Plan active"
           :r.verification_status===STATUS.ACTION_REQUIRED?"Flags detected":"Plan inactive",
    flags: r.action_flags||[], payer: r.payer_name,
    phases: ph, rpaEscalated: ph.includes("rpa"), awaitingApproval: false,
  };
}

function buildRescheduleDraft(patient, blockReasons) {
  const reason = (blockReasons[0] || "a coverage issue").toLowerCase();
  return `Hi ${patient.name.split(" ")[0]}! This is the team at Georgetown Dental. We were getting everything ready for your upcoming visit and noticed a quick hiccup with your insurance (${reason}). Could you give us a quick call at (512) 555-0987 when you have a second? We want to get it sorted out so you don't have any surprises!`;
}

function buildNotifyDraft(patient, notifyReasons) {
  const items = notifyReasons.map(r => r.toLowerCase()).join(" and ");
  return `Hi ${patient.name.split(" ")[0]}, Georgetown Dental here! We are so excited to see you soon. We did a quick check on your benefits and noticed ${items}. No need to worry, we just wanted to give you a heads-up before you come in! Feel free to text or call us if you have any questions.`;
}

function buildRescheduleEntry(p, t, tr) {
  return {
    id: `rsc_${Date.now()}_${p.id}`,
    time: new Date().toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"}),
    patient: p.name, patientId: p.id, action: ACTION.RESCHEDULE, trigger: tr,
    status: "reschedule_proposed", triage: t.level, reason: t.block[0]||"Coverage issue",
    blockReasons: t.block, appointmentDate: p.appointmentDate, appointmentTime: p.appointmentTime,
    procedure: p.procedure, payer: p.insurance, awaitingApproval: true,
    draftMessage: buildRescheduleDraft(p, t.block),
  };
}

function buildOutreachEntry(p, t) {
  return {
    id: `out_${Date.now()}_${p.id}`,
    time: new Date().toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"}),
    patient: p.name, patientId: p.id, action: ACTION.OUTREACH, trigger: "auto",
    status: "outreach_queued", triage: t.level, reason: "Courtesy call",
    notifyReasons: t.notify||[], appointmentDate: p.appointmentDate,
    payer: p.insurance, awaitingApproval: true,
    draftMessage: buildNotifyDraft(p, t.notify||[]),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SKELETON LOADER  — shared primitive used by kanban, calendar, nav
// ─────────────────────────────────────────────────────────────────────────────

function Skeleton({ w = "100%", h = 14, r = 6, style: extra = {} }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: r, flexShrink: 0,
      background: "linear-gradient(90deg,#EAEAE6 25%,#F4F4F0 50%,#EAEAE6 75%)",
      backgroundSize: "400% 100%", animation: "skshimmer 1.5s ease infinite",
      ...extra,
    }} />
  );
}

// ── Shared UI Components ──────────────────────────────────────────────────────
function Badge({ label, color, bg, border, icon }) {
  return <span style={{ fontSize:10, fontWeight:800, padding:"2px 8px", borderRadius:20, background:bg, color, border:"1px solid " + border, display:"inline-flex", alignItems:"center", gap:4, whiteSpace:"nowrap" }}>{icon && <span>{icon}</span>}{label}</span>;
}

function SectionLabel({ children }) {
  return <div style={{ color:T.textSoft, fontSize:10, fontWeight:800, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:6, marginTop:14 }}>{children}</div>;
}

function PhaseIndicator({ phase, reason, compact }) {
  // Simplified — show a single clean "Verifying..." status, no technical pipeline detail
  const isRPA = phase === "rpa";
  const color  = isRPA ? T.rpaDark  : T.indigoDark;
  const bg     = isRPA ? T.rpaLight : T.indigoLight;
  const border = isRPA ? T.rpaBorder : T.indigoBorder;
  const label  = isRPA ? "Checking payer portal…" : "Verifying insurance…";

  if (compact) return (
    <div style={{ display:"flex", alignItems:"center", gap:6, padding:"4px 8px", borderRadius:6, background:bg }}>
      <span style={{ width:6, height:6, borderRadius:"50%", background:color, animation:"pulse 1.5s infinite", flexShrink:0 }} />
      <span style={{ color, fontSize:10, fontWeight:700 }}>{label}</span>
    </div>
  );

  return (
    <div style={{ padding:"12px 16px", background:bg, borderRadius:8, border:"1px solid "+border, display:"flex", alignItems:"center", gap:10 }}>
      <span style={{ width:8, height:8, borderRadius:"50%", background:color, animation:"pulse 1.5s infinite", flexShrink:0 }} />
      <span style={{ color, fontSize:12, fontWeight:800 }}>{label}</span>
    </div>
  );
}

// ── Auth & Onboarding Flow ───────────────────────────────────────────────────
// steps: login → mfa → profile → pms → rpa → team
const ONBOARDING_STEPS = [
  { id: "profile", label: "Practice Profile" },
  { id: "pms",     label: "Connect PMS" },
  { id: "rpa",     label: "RPA Vault" },
  { id: "team",    label: "Invite Team" },
];

const PMS_OPTIONS = ["Open Dental", "Dentrix", "Eaglesoft", "Curve Dental", "Carestream Dental"];
const RPA_PAYERS  = [
  { id: "delta",   name: "Delta Dental",   logo: "🔵" },
  { id: "metlife", name: "MetLife",        logo: "🟣" },
  { id: "cigna",   name: "Cigna",          logo: "🟠" },
  { id: "aetna",   name: "Aetna DMO",      logo: "🔴" },
  { id: "guardian",name: "Guardian",       logo: "🟢" },
  { id: "united",  name: "UnitedHealthcare", logo: "🔷" },
];

function WizardProgress({ currentStep }) {
  const idx = ONBOARDING_STEPS.findIndex(s => s.id === currentStep);
  return (
    <div style={{ marginBottom: 36 }}>
      <div style={{ display: "flex", gap: 0, marginBottom: 10 }}>
        {ONBOARDING_STEPS.map((s, i) => {
          const done    = i < idx;
          const active  = i === idx;
          const isLast  = i === ONBOARDING_STEPS.length - 1;
          return (
            <div key={s.id} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", position: "relative" }}>
              {/* connector line */}
              {!isLast && (
                <div style={{ position: "absolute", top: 11, left: "50%", width: "100%", height: 3,
                  background: done ? T.indigoDark : T.borderStrong, borderRadius: 2, zIndex: 0 }} />
              )}
              {/* dot */}
              <div style={{ width: 24, height: 24, borderRadius: "50%", zIndex: 1, display: "flex", alignItems: "center", justifyContent: "center",
                background: done ? T.indigoDark : active ? T.indigoDark : T.borderStrong,
                border: active ? "3px solid " + T.indigoLight : "none",
                boxShadow: active ? "0 0 0 3px " + T.indigoBorder : "none",
                fontSize: 11, fontWeight: 900, color: "white", flexShrink: 0 }}>
                {done ? "✓" : i + 1}
              </div>
              <div style={{ fontSize: 10, fontWeight: 700, color: active ? T.indigoDark : done ? T.textMid : T.textSoft,
                marginTop: 6, textAlign: "center", whiteSpace: "nowrap" }}>
                {s.label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
// ── Shared Onboarding Helpers (hoisted outside AuthFlow to fix focus loss) ──

// Built-in validators — pass one of these (or a custom fn) as the `validate` prop.
const VALIDATORS = {
  email:    v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? null : "Enter a valid email address",
  password: v => v.length >= 8 ? null : "Password must be at least 8 characters",
  npi:      v => /^\d{10}$/.test(v.replace(/\D/g, "")) ? null : "NPI must be exactly 10 digits",
  taxId:    v => /^\d{2}-\d{7}$/.test(v.trim()) ? null : "Tax ID must be in XX-XXXXXXX format",
  phone:    v => /^\+?[\d\s\-().]{10,}$/.test(v.trim()) ? null : "Enter a valid phone number (10+ digits)",
  apiKey:   v => v.trim().length >= 8 ? null : "API key must be at least 8 characters",
  required: v => v.trim() ? null : "This field is required",
};

// OInput — onboarding form input with inline validation
// validate: fn(value) → string|null  OR  one of the VALIDATORS keys
// error: externally-controlled error string (e.g. from auth errors)
const OInput = ({ label, type = "text", placeholder, value, onChange, required, validate, error: extError }) => {
  const [touched, setTouched] = useState(false);
  const validatorFn = typeof validate === "string" ? VALIDATORS[validate] : validate;
  const inlineErr = touched && validatorFn ? validatorFn(value || "") : null;
  const showErr = inlineErr || (touched && required && !value?.trim() ? "This field is required" : null) || extError;
  const borderColor = showErr ? "#ef4444" : touched && !showErr && value ? "#16a34a" : T.borderStrong;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <label style={{ fontSize: 11, fontWeight: 800, color: T.textMid, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}{required && <span style={{ color: "#ef4444", marginLeft: 3 }}>*</span>}
      </label>
      <input type={type} placeholder={placeholder} value={value} onChange={e => { onChange(e); }}
        style={{ width: "100%", padding: "13px 16px", border: "1.5px solid " + borderColor, borderRadius: 10,
          fontSize: 14, outline: "none", transition: "border-color 0.2s, box-shadow 0.2s", fontFamily: "inherit",
          color: T.text, background: showErr ? "#fef2f2" : "white",
          boxShadow: showErr ? "0 0 0 3px rgba(239,68,68,0.12)" : touched && !showErr && value ? "0 0 0 3px rgba(22,163,74,0.10)" : "none" }}
        onFocus={e => e.target.style.borderColor = showErr ? "#ef4444" : T.indigoDark}
        onBlur={e => { setTouched(true); e.target.style.borderColor = borderColor; }} />
      {showErr && (
        <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: -2 }}>
          <span style={{ fontSize: 14, lineHeight: 1 }}>⚠️</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#dc2626" }}>{showErr}</span>
        </div>
      )}
    </div>
  );
};

const NextBtn = ({ label = "Continue →", onClick, type = "button", disabled = false }) => (
  <button type={type} disabled={disabled} onClick={onClick}
    style={{ width: "100%", padding: "15px", background: disabled ? T.slate : T.indigoDark, color: "white",
      borderRadius: 10, border: "none", fontSize: 15, fontWeight: 800, cursor: disabled ? "not-allowed" : "pointer",
      marginTop: 8, transition: "0.2s", boxShadow: disabled ? "none" : "0 4px 14px rgba(79,70,229,0.35)" }}
    onMouseEnter={e => { if (!disabled) e.currentTarget.style.transform = "translateY(-1px)"; }}
    onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; }}>
    {label}
  </button>
);
function AuthFlow({ onComplete, showToast }) {
  const { signIn, setActive: setSignInActive, isLoaded: signInLoaded } = useSignIn();
  const { signUp, setActive: setSignUpActive, isLoaded: signUpLoaded } = useSignUp();

  const [step, setStep] = useState("login");
  const [authErr, setAuthErr] = useState("");

  // Login
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");

  // Email verify (signup)
  const [verifyCode, setVerifyCode] = useState(["","","","","",""]);


  // ── handlers ───────────────────────────────────────────────────────────────
  const handleSignIn = async (e) => {
    e.preventDefault();
    setAuthErr("");
    if (!signInLoaded) return;
    try {
      const res = await signIn.create({ identifier: email, password });
      if (res.status === "complete") {
        await setSignInActive({ session: res.createdSessionId });
        // isSignedIn in LevelAI will flip → dashboard renders automatically
      } else {
        setAuthErr("Sign-in incomplete. Please try again.");
      }
    } catch (err) {
      setAuthErr(err.errors?.[0]?.message || "Sign-in failed. Check your credentials.");
    }
  };

  const handleSignUp = async (e) => {
    e.preventDefault();
    setAuthErr("");
    if (!signUpLoaded) return;
    try {
      await signUp.create({ emailAddress: email, password });
      await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
      setStep("verify");
      showToast("Verification code sent to your email!");
    } catch (err) {
      setAuthErr(err.errors?.[0]?.message || "Could not create account. Try again.");
    }
  };

  const handleVerifyChange = (index, val) => {
    if (val.length > 1) return;
    const nc = [...verifyCode]; nc[index] = val; setVerifyCode(nc);
    if (val && index < 5) document.getElementById(`vc-${index + 1}`)?.focus();
  };

  const handleVerifySubmit = async (e) => {
    e.preventDefault();
    setAuthErr("");
    const code = verifyCode.join("");
    if (code.length !== 6) return;
    try {
      const res = await signUp.attemptEmailAddressVerification({ code });
      if (res.status === "complete") {
        // Flag that this is a new user who needs onboarding
        if (typeof window !== "undefined") localStorage.setItem("pulp_needs_onboarding", "1");
        await setSignUpActive({ session: res.createdSessionId });
        // isSignedIn flips → LevelAI renders → OnboardingWizard overlay shows
      } else {
        setAuthErr("Verification incomplete. Please try again.");
      }
    } catch (err) {
      setAuthErr(err.errors?.[0]?.message || "Invalid code. Please try again.");
    }
  };

  // ── layout shell ───────────────────────────────────────────────────────────
  return (
    <div style={{ height: "100vh", display: "flex", background: T.bg, fontFamily: "'Nunito', sans-serif" }}>

      {/* ── Left brand panel ── */}
      <div style={{ width: 420, flexShrink: 0, background: T.indigoDark, color: "white", padding: "56px 48px",
        display: "flex", flexDirection: "column", justifyContent: "space-between", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: -80, right: -80, width: 360, height: 360, background: T.indigo,
          opacity: 0.3, borderRadius: "50%", filter: "blur(60px)" }} />
        <div style={{ position: "absolute", bottom: -60, left: -60, width: 280, height: 280, background: T.rpaDark,
          opacity: 0.4, borderRadius: "50%", filter: "blur(60px)" }} />

        <div style={{ position: "relative", zIndex: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 52 }}>
            <div style={{ fontSize: 30 }}>&#x1F9B7;</div>
            <div style={{ color: T.limeLight, fontSize: 26, fontWeight: 900, letterSpacing: "-0.02em" }}>
              level<span style={{ color: "rgba(255,255,255,0.65)" }}>ai</span>
            </div>
          </div>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase",
            color: T.lime, marginBottom: 16 }}>White-Glove SaaS</div>
          <h1 style={{ fontSize: 38, fontWeight: 900, lineHeight: 1.15, marginBottom: 20, maxWidth: 340 }}>
            The zero-touch dental billing engine.
          </h1>
          <p style={{ fontSize: 15, lineHeight: 1.65, opacity: 0.8, maxWidth: 340 }}>
            We manage Stedi, Twilio, and the clearinghouse infrastructure. You just connect your PMS and payer portals — we do the rest.
          </p>
        </div>

        {/* stat cards */}
        <div style={{ position: "relative", zIndex: 10, display: "flex", flexDirection: "column", gap: 12 }}>
          {[
            { emoji: "⚡", label: "Stedi Clearinghouse", sub: "Managed by Level AI" },
            { emoji: "💬", label: "Twilio SMS",          sub: "Managed by Level AI" },
            { emoji: "🤖", label: "RPA Bot Engine",      sub: "Your payer credentials, our automation" },
          ].map(c => (
            <div key={c.label} style={{ display: "flex", alignItems: "center", gap: 14, background: "rgba(0,0,0,0.2)",
              padding: "14px 18px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)" }}>
              <span style={{ fontSize: 22 }}>{c.emoji}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 800 }}>{c.label}</div>
                <div style={{ fontSize: 11, opacity: 0.7, marginTop: 1 }}>{c.sub}</div>
              </div>
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: T.lime }} />
                <span style={{ fontSize: 11, color: T.lime, fontWeight: 700 }}>Live</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Right panel ── */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
        padding: "40px 60px", overflowY: "auto" }}>
        <div style={{ width: "100%", maxWidth: 460 }}>

          {/* ───────── LOGIN ───────── */}
          {step === "login" && (
            <div style={{ animation: "fadeIn 0.4s ease-out" }}>
              <div style={{ fontSize: 30, fontWeight: 900, color: T.text, marginBottom: 6 }}>Welcome back</div>
              <div style={{ fontSize: 14, color: T.textSoft, marginBottom: 32, lineHeight: 1.5 }}>
                Sign in to your Level AI practice dashboard.
              </div>
              <form onSubmit={handleSignIn} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <OInput label="Email" type="email" placeholder="you@practice.com" value={email} onChange={e => { setEmail(e.target.value); setAuthErr(""); }} required validate="email" />
                <OInput label="Password" type="password" placeholder="••••••••" value={password} onChange={e => { setPassword(e.target.value); setAuthErr(""); }} required />
                {authErr && <div style={{ color: T.red, fontSize: 13, fontWeight: 700, padding: "10px 14px", background: T.redLight, borderRadius: 8, border: "1px solid " + T.redBorder }}>{authErr}</div>}
                <NextBtn type="submit" label="Sign In →" />
              </form>
              <div style={{ marginTop: 20, borderTop: "1px solid " + T.border, paddingTop: 20 }}>
                <div style={{ fontSize: 13, color: T.textSoft, marginBottom: 12 }}>New to Level AI?</div>
                <button onClick={() => { setStep("signup"); setAuthErr(""); setEmail(""); setPassword(""); }}
                  style={{ width: "100%", padding: "14px", background: "transparent", color: T.indigoDark,
                    border: "2px solid " + T.indigoDark, borderRadius: 10, fontSize: 15, fontWeight: 800, cursor: "pointer" }}>
                  New Practice — Create Account
                </button>
              </div>
            </div>
          )}

          {/* ───────── SIGN UP ───────── */}
          {step === "signup" && (
            <div style={{ animation: "fadeIn 0.4s ease-out" }}>
              <div style={{ fontSize: 30, fontWeight: 900, color: T.text, marginBottom: 6 }}>Create your account</div>
              <div style={{ fontSize: 14, color: T.textSoft, marginBottom: 32, lineHeight: 1.5 }}>
                We&apos;ll send a verification code to confirm your email.
              </div>
              <form onSubmit={handleSignUp} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <OInput label="Work Email" type="email" placeholder="you@practice.com" value={email} onChange={e => { setEmail(e.target.value); setAuthErr(""); }} required validate="email" />
                <OInput label="Password" type="password" placeholder="8+ characters" value={password} onChange={e => { setPassword(e.target.value); setAuthErr(""); }} required validate="password" />
                {authErr && <div style={{ color: T.red, fontSize: 13, fontWeight: 700, padding: "10px 14px", background: T.redLight, borderRadius: 8, border: "1px solid " + T.redBorder }}>{authErr}</div>}
                <NextBtn type="submit" label="Create Account →" />
              </form>
              <button onClick={() => { setStep("login"); setAuthErr(""); }}
                style={{ marginTop: 16, background: "none", border: "none", color: T.textSoft, fontSize: 13, cursor: "pointer", textDecoration: "underline" }}>
                ← Back to Sign In
              </button>
            </div>
          )}

          {/* ───────── EMAIL VERIFY ───────── */}
          {step === "verify" && (
            <div style={{ animation: "fadeIn 0.4s ease-out" }}>
              <div style={{ display: "inline-flex", background: T.indigoLight, color: T.indigoDark,
                padding: "7px 12px", borderRadius: 8, fontWeight: 800, fontSize: 12, marginBottom: 20, gap: 6 }}>
                🔒 HIPAA Secure Verification
              </div>
              <div style={{ fontSize: 28, fontWeight: 900, color: T.text, marginBottom: 8 }}>Check your email</div>
              <div style={{ fontSize: 14, color: T.textSoft, marginBottom: 32, lineHeight: 1.5 }}>
                We sent a 6-digit code to <strong>{email}</strong>. Enter it below to continue.
              </div>
              <form onSubmit={handleVerifySubmit} style={{ display: "flex", flexDirection: "column", gap: 32 }}>
                <div style={{ display: "flex", gap: 10, justifyContent: "space-between" }}>
                  {verifyCode.map((digit, idx) => (
                    <input key={idx} id={`vc-${idx}`} type="text" inputMode="numeric" maxLength={1} value={digit}
                      onChange={e => handleVerifyChange(idx, e.target.value)}
                      onKeyDown={e => { if (e.key === "Backspace" && !digit && idx > 0) document.getElementById(`vc-${idx-1}`)?.focus(); }}
                      style={{ width: 52, height: 62, textAlign: "center", fontSize: 26, fontWeight: 900,
                        border: "2px solid " + (digit ? T.indigoDark : T.borderStrong),
                        borderRadius: 10, outline: "none", background: T.bgCard, color: T.text, transition: "0.2s" }}
                      onFocus={e => e.target.style.borderColor = T.indigoDark}
                      onBlur={e => { if (!digit) e.target.style.borderColor = T.borderStrong; }} />
                  ))}
                </div>
                {authErr && <div style={{ color: T.red, fontSize: 13, fontWeight: 700, padding: "10px 14px", background: T.redLight, borderRadius: 8, border: "1px solid " + T.redBorder }}>{authErr}</div>}
                <NextBtn type="submit" label="Verify Email →" disabled={verifyCode.join("").length !== 6} />
              </form>
            </div>
          )}

        </div>
      </div>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}

// ── Premium Onboarding Wizard ─────────────────────────────────────────────────
// Shown as a full-screen overlay after new-practice signup.
// Driven by localStorage flag "pulp_needs_onboarding" = "1".

const WIZARD_STEPS = [
  { id: "profile", label: "Practice Identity",  icon: "🏥" },
  { id: "pms",     label: "Connect PMS",        icon: "🔌" },
  { id: "rpa",     label: "RPA Vault",          icon: "🤖" },
  { id: "team",    label: "Invite & Launch",    icon: "🚀" },
];

// Top 3 payers "discovered" from the PMS sync
const DISCOVERED_PAYERS = [
  { id: "delta",   name: "Delta Dental",  logo: "🔵", patients: 1247 },
  { id: "metlife", name: "MetLife",       logo: "🟣", patients: 1089 },
  { id: "cigna",   name: "Cigna",         logo: "🟠", patients: 1084 },
];

const PMS_SYNC_PHASES = [
  "Authenticating token…",
  "Syncing appointment book…",
  "Analyzing payer mix…",
  "Connection Successful! ✅",
];

function WizardProgressBar({ currentStep }) {
  const idx = WIZARD_STEPS.findIndex(s => s.id === currentStep);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 48 }}>
      {WIZARD_STEPS.map((s, i) => {
        const done   = i < idx;
        const active = i === idx;
        const last   = i === WIZARD_STEPS.length - 1;
        return (
          <div key={s.id} style={{ display: "flex", alignItems: "center", flex: last ? "0 0 auto" : 1 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{
                width: 36, height: 36, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                background: done ? "#22c55e" : active ? "white" : "rgba(255,255,255,0.15)",
                border: active ? "3px solid white" : "none",
                boxShadow: active ? "0 0 0 4px rgba(255,255,255,0.25)" : "none",
                fontSize: done ? 16 : 13, fontWeight: 900,
                color: done ? "white" : active ? "#4f46e5" : "rgba(255,255,255,0.45)",
                transition: "all 0.3s",
              }}>
                {done ? "✓" : s.icon}
              </div>
              <div style={{
                fontSize: 10, fontWeight: 800, marginTop: 6, whiteSpace: "nowrap",
                color: active ? "white" : done ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.35)",
                letterSpacing: "0.03em", textAlign: "center",
              }}>
                {s.label}
              </div>
            </div>
            {!last && (
              <div style={{
                flex: 1, height: 2, margin: "0 8px", marginBottom: 20,
                background: done ? "#22c55e" : "rgba(255,255,255,0.15)",
                transition: "background 0.4s",
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function OnboardingWizard({ onComplete, showToast }) {
  const [step, setStep]         = useState("profile");
  const [animating, setAnimating] = useState(false);

  // Step 1 – Practice Identity
  const [pracName, setPracName] = useState("");
  const [npi, setNpi]           = useState("");
  const [taxId, setTaxId]       = useState("");

  // Step 2 – PMS Connection
  const [pmsSystem, setPmsSystem]   = useState("");
  const [pmsSyncKey, setPmsSyncKey] = useState("");
  const [syncPhase, setSyncPhase]   = useState(-1); // -1 = not started, 0-3 = phases
  const syncTimer = useRef(null);

  // Step 3 – RPA Vault (only top 3 discovered payers)
  const [rpaVault, setRpaVault] = useState(
    Object.fromEntries(DISCOVERED_PAYERS.map(p => [p.id, { user: "", pass: "" }]))
  );
  const [rpaExpanded, setRpaExpanded] = useState("delta");

  // Step 4 – Team
  const [invites, setInvites] = useState([
    { email: "", role: "Front Desk" },
  ]);

  const advance = (toStep) => {
    setAnimating(true);
    setTimeout(() => {
      setStep(toStep);
      setAnimating(false);
    }, 200);
  };

  const startPmsSync = () => {
    if (!pmsSystem || !pmsSyncKey) return;
    setSyncPhase(0);
    let i = 0;
    syncTimer.current = setInterval(() => {
      i += 1;
      setSyncPhase(i);
      if (i >= PMS_SYNC_PHASES.length - 1) {
        clearInterval(syncTimer.current);
        // auto-advance after a moment
        setTimeout(() => advance("rpa"), 1200);
      }
    }, 900);
  };

  useEffect(() => () => clearInterval(syncTimer.current), []);

  const contentStyle = {
    opacity: animating ? 0 : 1,
    transform: animating ? "translateY(12px)" : "translateY(0)",
    transition: "opacity 0.2s, transform 0.2s",
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 10000,
      display: "flex", fontFamily: "'Nunito', sans-serif",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap');
        @keyframes wizFadeIn { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
        @keyframes wizPulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
        @keyframes wizSpin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes wizGrow { from{width:0%} to{width:100%} }
        .wiz-animate { animation: wizFadeIn 0.4s ease-out both; }
      `}</style>

      {/* ── Left dark panel ── */}
      <div style={{
        width: 380, flexShrink: 0,
        background: "linear-gradient(160deg, #312e81 0%, #1e1b4b 50%, #0f172a 100%)",
        padding: "52px 40px", display: "flex", flexDirection: "column",
        position: "relative", overflow: "hidden",
      }}>
        {/* Ambient blobs */}
        <div style={{ position:"absolute", top:-100, right:-80, width:360, height:360, borderRadius:"50%",
          background:"#6366f1", opacity:0.15, filter:"blur(80px)", pointerEvents:"none" }} />
        <div style={{ position:"absolute", bottom:-80, left:-60, width:300, height:300, borderRadius:"50%",
          background:"#0ea5e9", opacity:0.12, filter:"blur(80px)", pointerEvents:"none" }} />

        {/* Logo */}
        <div style={{ position:"relative", zIndex:1, marginBottom:52 }}>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <span style={{ fontSize:28 }}>🦷</span>
            <span style={{ fontSize:24, fontWeight:900, color:"#a5f3fc", letterSpacing:"-0.02em" }}>
              level<span style={{ color:"rgba(255,255,255,0.45)" }}>ai</span>
            </span>
          </div>
          <div style={{ fontSize:11, fontWeight:800, color:"#84cc16", letterSpacing:"0.12em", textTransform:"uppercase", marginTop:8 }}>
            Practice Setup
          </div>
        </div>

        {/* Progress dots */}
        <div style={{ position:"relative", zIndex:1, flex:1 }}>
          <WizardProgressBar currentStep={step} />

          {/* Left panel contextual copy */}
          {step === "profile" && (
            <div className="wiz-animate" style={{ color:"rgba(255,255,255,0.7)", fontSize:14, lineHeight:1.7 }}>
              <div style={{ fontSize:28, marginBottom:16 }}>👋</div>
              <div style={{ fontSize:18, fontWeight:900, color:"white", marginBottom:12 }}>
                Welcome to Level AI.
              </div>
              <div>
                Let&apos;s get your practice credentialed with Stedi&apos;s clearinghouse in under 5 minutes.
                We&apos;ll handle everything else.
              </div>
            </div>
          )}
          {step === "pms" && (
            <div className="wiz-animate" style={{ color:"rgba(255,255,255,0.7)", fontSize:14, lineHeight:1.7 }}>
              <div style={{ fontSize:28, marginBottom:16 }}>🔌</div>
              <div style={{ fontSize:18, fontWeight:900, color:"white", marginBottom:12 }}>
                One connection. Everything syncs.
              </div>
              <div>
                Connect your PMS and we&apos;ll automatically pull your daily schedule, appointment types, and patient list — no manual imports.
              </div>
            </div>
          )}
          {step === "rpa" && (
            <div className="wiz-animate" style={{ color:"rgba(255,255,255,0.7)", fontSize:14, lineHeight:1.7 }}>
              <div style={{ fontSize:28, marginBottom:16 }}>🤖</div>
              <div style={{ fontSize:18, fontWeight:900, color:"white", marginBottom:12 }}>
                Your top payers, fully automated.
              </div>
              <div>
                We found your top 3 insurance networks from the PMS sync. Add your portal credentials and our RPA bots handle verification automatically.
              </div>
            </div>
          )}
          {step === "team" && (
            <div className="wiz-animate" style={{ color:"rgba(255,255,255,0.7)", fontSize:14, lineHeight:1.7 }}>
              <div style={{ fontSize:28, marginBottom:16 }}>🎉</div>
              <div style={{ fontSize:18, fontWeight:900, color:"white", marginBottom:12 }}>
                Almost there!
              </div>
              <div>
                Invite your front desk and billing staff. They&apos;ll get immediate access to the verification dashboard — no extra setup needed.
              </div>
            </div>
          )}
        </div>

        {/* Bottom stat */}
        <div style={{ position:"relative", zIndex:1, background:"rgba(255,255,255,0.06)", borderRadius:12,
          padding:"14px 18px", border:"1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.5)", fontWeight:700, marginBottom:4 }}>
            AVERAGE SETUP TIME
          </div>
          <div style={{ fontSize:24, fontWeight:900, color:"#a5f3fc" }}>4 min 12 sec</div>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.5)", marginTop:2 }}>
            Most practices go live before their next patient.
          </div>
        </div>
      </div>

      {/* ── Right white panel ── */}
      <div style={{
        flex: 1, background: "white", overflowY: "auto",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "48px 64px",
      }}>
        <div style={{ width: "100%", maxWidth: 500, ...contentStyle }}>

          {/* ═══ STEP 1: Practice Identity ═══ */}
          {step === "profile" && (
            <div className="wiz-animate">
              <div style={{ display:"inline-flex", background:"#eef2ff", color:"#4f46e5", padding:"6px 12px",
                borderRadius:8, fontSize:11, fontWeight:800, letterSpacing:"0.05em", marginBottom:20 }}>
                STEP 1 OF 4
              </div>
              <h2 style={{ fontSize:28, fontWeight:900, color:"#1a1a18", marginBottom:8, lineHeight:1.2 }}>
                Practice Identity
              </h2>
              <p style={{ fontSize:14, color:"#a0a09a", marginBottom:32, lineHeight:1.6 }}>
                Your legal details for clearinghouse credentialing. This is submitted once — we handle all renewals.
              </p>

              <div style={{ display:"flex", flexDirection:"column", gap:18 }}>
                <OInput label="Legal Practice Name" placeholder="e.g. Georgetown Dental Associates"
                  value={pracName} onChange={e => setPracName(e.target.value)} required validate="required" />
                <div style={{ display:"flex", gap:14 }}>
                  <div style={{ flex:1 }}>
                    <OInput label="NPI Number" placeholder="1234567890"
                      value={npi} onChange={e => setNpi(e.target.value.replace(/\D/g, "").slice(0,10))} required validate="npi" />
                  </div>
                  <div style={{ flex:1 }}>
                    <OInput label="Tax ID (TIN)" placeholder="XX-XXXXXXX"
                      value={taxId} onChange={e => {
                        // Auto-format: insert hyphen after 2 digits
                        const raw = e.target.value.replace(/[^\d]/g, "").slice(0, 9);
                        setTaxId(raw.length > 2 ? raw.slice(0,2) + "-" + raw.slice(2) : raw);
                      }} required validate="taxId" />
                  </div>
                </div>

                {/* Reassurance */}
                <div style={{ display:"flex", gap:10, alignItems:"center", background:"#f0f9ff",
                  border:"1px solid #bae6fd", borderRadius:10, padding:"12px 16px" }}>
                  <span style={{ fontSize:18 }}>🔒</span>
                  <span style={{ fontSize:12, color:"#0369a1", fontWeight:700 }}>
                    HIPAA-compliant. Your data is encrypted at rest and in transit.
                  </span>
                </div>

                <NextBtn label="Next: Connect PMS →"
                  disabled={!pracName || !npi || !taxId}
                  onClick={() => advance("pms")} />
              </div>
            </div>
          )}

          {/* ═══ STEP 2: Connect PMS ═══ */}
          {step === "pms" && (
            <div className="wiz-animate">
              <div style={{ display:"inline-flex", background:"#eef2ff", color:"#4f46e5", padding:"6px 12px",
                borderRadius:8, fontSize:11, fontWeight:800, letterSpacing:"0.05em", marginBottom:20 }}>
                STEP 2 OF 4
              </div>
              <h2 style={{ fontSize:28, fontWeight:900, color:"#1a1a18", marginBottom:8, lineHeight:1.2 }}>
                Connect Your PMS
              </h2>
              <p style={{ fontSize:14, color:"#a0a09a", marginBottom:32, lineHeight:1.6 }}>
                We&apos;ll sync your schedule directly — no manual entry, ever.
              </p>

              {syncPhase === -1 ? (
                <div style={{ display:"flex", flexDirection:"column", gap:18 }}>
                  {/* PMS Selector */}
                  <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
                    <label style={{ fontSize:11, fontWeight:800, color:"#52525a", textTransform:"uppercase", letterSpacing:"0.05em" }}>
                      Practice Management System
                    </label>
                    <select value={pmsSystem} onChange={e => setPmsSystem(e.target.value)}
                      style={{ padding:"13px 16px", border:"1px solid #c8c8c0", borderRadius:10, fontSize:14,
                        outline:"none", cursor:"pointer", background:"white",
                        color: pmsSystem ? "#1a1a18" : "#a0a09a", fontFamily:"inherit" }}>
                      <option value="">Select your PMS…</option>
                      {PMS_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>

                  {pmsSystem && (
                    <div style={{ animation:"wizFadeIn 0.3s ease-out" }}>
                      <OInput
                        label={pmsSystem === "Open Dental" ? "eKey" : "Sync Token"}
                        type="password"
                        placeholder={pmsSystem === "Open Dental" ? "Paste your Open Dental eKey" : "Paste your API / Sync Token"}
                        value={pmsSyncKey} onChange={e => setPmsSyncKey(e.target.value)} required validate="apiKey" />
                    </div>
                  )}

                  {pmsSystem && (
                    <div style={{ background:"#f0fdf0", border:"1px solid #bbf7b0", borderRadius:10, padding:"12px 16px", display:"flex", gap:10, alignItems:"flex-start" }}>
                      <span style={{ fontSize:16 }}>ℹ️</span>
                      <div style={{ fontSize:12, color:"#3f6212", lineHeight:1.5 }}>
                        <strong>Where to find it: </strong>
                        {pmsSystem === "Open Dental" && "Open Dental → Setup → Advanced → HL7/API → eKey tab."}
                        {pmsSystem === "Dentrix" && "Dentrix → Office Manager → Tools → API Keys."}
                        {pmsSystem === "Eaglesoft" && "Eaglesoft → Setup → Connections → Integration Hub → Token."}
                        {!["Open Dental","Dentrix","Eaglesoft"].includes(pmsSystem) && "Contact your PMS support team for your integration token."}
                      </div>
                    </div>
                  )}

                  <div style={{ display:"flex", gap:10 }}>
                    <button onClick={() => advance("profile")}
                      style={{ flex:"0 0 auto", padding:"15px 20px", borderRadius:10, border:"1px solid #e2e2dc",
                        background:"white", color:"#52525a", fontWeight:700, cursor:"pointer", fontSize:14 }}>
                      ← Back
                    </button>
                    <div style={{ flex:1 }}>
                      <NextBtn label="Sync PMS →" disabled={!pmsSystem || !pmsSyncKey} onClick={startPmsSync} />
                    </div>
                  </div>
                </div>
              ) : (
                /* ── Syncing animation ── */
                <div style={{ animation:"wizFadeIn 0.3s ease-out" }}>
                  <div style={{ background:"#f8fafc", border:"1px solid #e2e2dc", borderRadius:16, padding:"32px 28px" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:28 }}>
                      <div style={{ width:48, height:48, borderRadius:12, background:"#eef2ff",
                        display:"flex", alignItems:"center", justifyContent:"center", fontSize:24 }}>
                        🔌
                      </div>
                      <div>
                        <div style={{ fontSize:15, fontWeight:900, color:"#1a1a18" }}>{pmsSystem}</div>
                        <div style={{ fontSize:12, color:"#a0a09a", marginTop:2 }}>Establishing connection…</div>
                      </div>
                    </div>

                    {/* Phase list */}
                    <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
                      {PMS_SYNC_PHASES.map((phase, i) => {
                        const done    = i < syncPhase;
                        const active  = i === syncPhase;
                        const pending = i > syncPhase;
                        return (
                          <div key={i} style={{ display:"flex", alignItems:"center", gap:12 }}>
                            <div style={{
                              width:22, height:22, borderRadius:"50%", flexShrink:0,
                              display:"flex", alignItems:"center", justifyContent:"center",
                              background: done ? "#22c55e" : active ? "#6366f1" : "#e2e2dc",
                              fontSize:11, fontWeight:900, color:"white",
                              animation: active ? "wizPulse 1s ease-in-out infinite" : "none",
                            }}>
                              {done ? "✓" : active ? "…" : "○"}
                            </div>
                            <div style={{
                              fontSize:14, fontWeight: active ? 800 : done ? 700 : 400,
                              color: done ? "#1a1a18" : active ? "#4f46e5" : "#a0a09a",
                            }}>
                              {phase}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Progress bar */}
                    <div style={{ marginTop:24, background:"#e2e2dc", borderRadius:4, height:6, overflow:"hidden" }}>
                      <div style={{
                        height:"100%", borderRadius:4, background:"linear-gradient(90deg,#6366f1,#0ea5e9)",
                        width: `${Math.min(100, (syncPhase / (PMS_SYNC_PHASES.length - 1)) * 100)}%`,
                        transition:"width 0.9s ease-out",
                      }} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ═══ STEP 3: RPA Vault — Smart (only shows discovered payers) ═══ */}
          {step === "rpa" && (
            <div className="wiz-animate">
              <div style={{ display:"inline-flex", background:"#eef2ff", color:"#4f46e5", padding:"6px 12px",
                borderRadius:8, fontSize:11, fontWeight:800, letterSpacing:"0.05em", marginBottom:20 }}>
                STEP 3 OF 4
              </div>
              <h2 style={{ fontSize:28, fontWeight:900, color:"#1a1a18", marginBottom:8, lineHeight:1.2 }}>
                RPA Credential Vault
              </h2>

              {/* Smart discovery callout */}
              <div style={{ background:"linear-gradient(135deg,#eef2ff,#f0f9ff)", border:"1px solid #c7d2fe",
                borderRadius:12, padding:"16px 18px", marginBottom:24 }}>
                <div style={{ fontSize:12, fontWeight:900, color:"#4f46e5", marginBottom:6 }}>
                  🤖 PMS SYNC COMPLETE — INTELLIGENCE REPORT
                </div>
                <div style={{ fontSize:13, color:"#1e1b4b", lineHeight:1.6 }}>
                  Based on your {pmsSystem || "PMS"} sync, we found{" "}
                  <strong>3,420 active patients</strong>. Your top 3 insurance networks are:{" "}
                  <strong>Delta Dental</strong>, <strong>MetLife</strong>, and{" "}
                  <strong>Cigna</strong>.
                </div>
                <div style={{ fontSize:11, color:"#6366f1", marginTop:8, fontWeight:700 }}>
                  Add credentials below to enable zero-touch RPA verification for these payers.
                </div>
              </div>

              <div style={{ background:"#f0f9ff", border:"1px solid #bae6fd", borderRadius:10,
                padding:"10px 14px", marginBottom:20, display:"flex", gap:10, alignItems:"center" }}>
                <span style={{ fontSize:15 }}>🔐</span>
                <span style={{ fontSize:12, color:"#0369a1", fontWeight:700 }}>
                  AES-256 encrypted. Never stored in plaintext. HIPAA-compliant vault.
                </span>
              </div>

              <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:20 }}>
                {DISCOVERED_PAYERS.map(payer => {
                  const isOpen = rpaExpanded === payer.id;
                  const creds  = rpaVault[payer.id];
                  const filled = creds.user && creds.pass;
                  return (
                    <div key={payer.id} style={{ border:"1px solid " + (filled ? "#bbf7b0" : "#e2e2dc"),
                      borderRadius:12, overflow:"hidden", transition:"border-color 0.2s",
                      boxShadow: filled ? "0 0 0 2px rgba(132,204,22,0.15)" : "none" }}>
                      <div onClick={() => setRpaExpanded(isOpen ? null : payer.id)}
                        style={{ padding:"14px 18px", display:"flex", alignItems:"center", gap:12,
                          cursor:"pointer", background: isOpen ? "#eef2ff" : "white" }}>
                        <span style={{ fontSize:22 }}>{payer.logo}</span>
                        <div style={{ flex:1 }}>
                          <div style={{ fontSize:14, fontWeight:900, color:"#1a1a18" }}>{payer.name}</div>
                          <div style={{ fontSize:11, color:"#a0a09a", marginTop:1 }}>
                            ~{payer.patients.toLocaleString()} patients
                          </div>
                        </div>
                        {filled
                          ? <span style={{ fontSize:10, fontWeight:800, color:"#3f6212", background:"#f0fdf0",
                              border:"1px solid #bbf7b0", padding:"3px 10px", borderRadius:20 }}>✓ Saved</span>
                          : <span style={{ fontSize:10, fontWeight:800, color:"#a0a09a", background:"#f5f5f0",
                              padding:"3px 10px", borderRadius:20 }}>Pending</span>
                        }
                        <span style={{ color:"#a0a09a", fontSize:18, transform: isOpen ? "rotate(180deg)" : "none", transition:"0.2s" }}>⌄</span>
                      </div>
                      {isOpen && (
                        <div style={{ padding:"14px 18px", borderTop:"1px solid #e2e2dc", background:"#f8fafc", display:"flex", gap:12 }}>
                          <div style={{ flex:1 }}>
                            <OInput label="Portal Username" placeholder="provider@practice.com"
                              value={creds.user} validate="email" required
                              onChange={e => setRpaVault(v => ({ ...v, [payer.id]: { ...v[payer.id], user: e.target.value } }))} />
                          </div>
                          <div style={{ flex:1 }}>
                            <OInput label="Portal Password" type="password" placeholder="••••••••"
                              value={creds.pass} validate="password" required
                              onChange={e => setRpaVault(v => ({ ...v, [payer.id]: { ...v[payer.id], pass: e.target.value } }))} />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div style={{ fontSize:12, color:"#a0a09a", marginBottom:20 }}>
                💡 Tip: Adding credentials for all 3 payers typically saves 45+ minutes of manual verification calls per day.
              </div>

              <div style={{ display:"flex", gap:10 }}>
                <button onClick={() => advance("pms")}
                  style={{ flex:"0 0 auto", padding:"15px 20px", borderRadius:10, border:"1px solid #e2e2dc",
                    background:"white", color:"#52525a", fontWeight:700, cursor:"pointer", fontSize:14 }}>
                  ← Back
                </button>
                <div style={{ flex:1 }}>
                  <NextBtn label="Next: Invite Team →" onClick={() => advance("team")} />
                </div>
              </div>
            </div>
          )}

          {/* ═══ STEP 4: Invite Team + Launch ═══ */}
          {step === "team" && (
            <div className="wiz-animate">
              <div style={{ display:"inline-flex", background:"#eef2ff", color:"#4f46e5", padding:"6px 12px",
                borderRadius:8, fontSize:11, fontWeight:800, letterSpacing:"0.05em", marginBottom:20 }}>
                STEP 4 OF 4 — FINAL STEP
              </div>
              <h2 style={{ fontSize:28, fontWeight:900, color:"#1a1a18", marginBottom:8, lineHeight:1.2 }}>
                Invite Your Team
              </h2>
              <p style={{ fontSize:14, color:"#a0a09a", marginBottom:28, lineHeight:1.6 }}>
                Add your front desk or billing staff — they&apos;ll get immediate access. You can always add more later in Settings.
              </p>

              <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:16 }}>
                {invites.map((inv, i) => (
                  <div key={i} style={{ display:"flex", gap:10, alignItems:"flex-end" }}>
                    <div style={{ flex:2 }}>
                      <OInput label={i === 0 ? "Email Address" : ""}
                        type="email" placeholder="colleague@practice.com"
                        value={inv.email} validate={inv.email ? "email" : undefined}
                        onChange={e => {
                          const next = [...invites];
                          next[i] = { ...next[i], email: e.target.value };
                          setInvites(next);
                        }} />
                    </div>
                    <div style={{ flex:1 }}>
                      {i === 0 && (
                        <label style={{ display:"block", fontSize:11, fontWeight:800, color:"#52525a",
                          textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:7 }}>
                          Role
                        </label>
                      )}
                      <select value={inv.role}
                        onChange={e => {
                          const next = [...invites];
                          next[i] = { ...next[i], role: e.target.value };
                          setInvites(next);
                        }}
                        style={{ padding:"13px 12px", border:"1px solid #c8c8c0", borderRadius:10,
                          fontSize:13, outline:"none", background:"white", fontFamily:"inherit",
                          color:"#1a1a18", width:"100%", cursor:"pointer" }}>
                        <option>Front Desk</option>
                        <option>Biller</option>
                        <option>Admin</option>
                        <option>Doctor</option>
                      </select>
                    </div>
                    {invites.length > 1 && (
                      <button onClick={() => setInvites(invites.filter((_,j) => j !== i))}
                        style={{ background:"none", border:"none", color:"#a0a09a", fontSize:18,
                          cursor:"pointer", padding:"13px 6px", flexShrink:0 }}>
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <button onClick={() => setInvites([...invites, { email:"", role:"Front Desk" }])}
                style={{ background:"none", border:"1px dashed #c8c8c0", borderRadius:10, color:"#6366f1",
                  fontWeight:800, fontSize:13, cursor:"pointer", padding:"10px 16px",
                  width:"100%", marginBottom:28, transition:"0.2s" }}
                onMouseEnter={e => e.currentTarget.style.borderColor="#6366f1"}
                onMouseLeave={e => e.currentTarget.style.borderColor="#c8c8c0"}>
                + Add another team member
              </button>

              {/* What's next summary */}
              <div style={{ background:"#f8fafc", border:"1px solid #e2e2dc", borderRadius:12, padding:"18px 20px", marginBottom:24 }}>
                <div style={{ fontSize:12, fontWeight:900, color:"#52525a", marginBottom:12, textTransform:"uppercase", letterSpacing:"0.05em" }}>
                  🎯 You&apos;re about to unlock:
                </div>
                {[
                  "✅  Real-time eligibility verification via Stedi clearinghouse",
                  "🤖  Automated RPA for Delta Dental, MetLife & Cigna portals",
                  "📅  Daily schedule sync from " + (pmsSystem || "your PMS"),
                  "💬  Patient outreach via Twilio SMS",
                ].map(item => (
                  <div key={item} style={{ fontSize:13, color:"#52525a", marginBottom:6, lineHeight:1.5 }}>{item}</div>
                ))}
              </div>

              <div style={{ display:"flex", gap:10 }}>
                <button onClick={() => advance("rpa")}
                  style={{ flex:"0 0 auto", padding:"15px 20px", borderRadius:10, border:"1px solid #e2e2dc",
                    background:"white", color:"#52525a", fontWeight:700, cursor:"pointer", fontSize:14 }}>
                  ← Back
                </button>
                <button
                  onClick={() => {
                    const hasEmails = invites.some(i => i.email.trim());
                    if (hasEmails) showToast("Invites sent! Your team will receive an email shortly. 🎉");
                    onComplete();
                  }}
                  style={{
                    flex:1, padding:"17px", background:"linear-gradient(135deg,#4f46e5,#7c3aed)",
                    color:"white", border:"none", borderRadius:12, fontSize:16, fontWeight:900,
                    cursor:"pointer", letterSpacing:"0.01em",
                    boxShadow:"0 8px 24px rgba(79,70,229,0.4)",
                    transition:"transform 0.2s, box-shadow 0.2s",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.transform="translateY(-2px)"; e.currentTarget.style.boxShadow="0 12px 32px rgba(79,70,229,0.5)"; }}
                  onMouseLeave={e => { e.currentTarget.style.transform="translateY(0)"; e.currentTarget.style.boxShadow="0 8px 24px rgba(79,70,229,0.4)"; }}>
                  🚀 Launch My Dashboard
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

// ── Preauth Widget ────────────────────────────────────────────────────────────
// LLM-powered Letter of Medical Necessity generator.
// Calls /api/v1/preauth/generate → Next.js proxy → Python FastAPI + Anthropic Claude.
// Falls back to a realistic mock when the Python service is unavailable.
function PreauthWidget({ patient, result, triage, showToast }) {
  const [status, setStatus]         = useState("idle");    // idle|loading|done|error
  const [loadStage, setLoadStage]   = useState(0);         // 0–3 progressive steps
  const [letter, setLetter]         = useState("");         // editable letter text
  const [attachments, setAttachments] = useState([]);
  const [summary, setSummary]       = useState(null);
  const [errorMsg, setErrorMsg]     = useState(null);
  const stageTimer = useRef(null);

  useEffect(() => () => clearInterval(stageTimer.current), []);

  // Derive the procedure code from the patient's procedure string (e.g. "Crown, Porcelain (D2750)" → "D2750")
  const deriveProcedureCode = () => {
    const match = (patient.procedure || "").match(/\b(D\d{4})\b/);
    if (match) return match[1];
    // Fallback mapping by procedure keyword
    if (/implant/i.test(patient.procedure))  return "D6010";
    if (/root canal|endodontic/i.test(patient.procedure)) return "D3310";
    if (/scaling|perio|srp/i.test(patient.procedure))    return "D4342";
    return "D6010"; // default to implant demo
  };

  const LOAD_STAGES = [
    "Fetching clinical notes from PMS…",
    "Reviewing coverage rules & triage flags…",
    "AI drafting medical necessity narrative…",
    "Formatting pre-authorization letter…",
  ];

  const handleGenerate = async () => {
    setStatus("loading");
    setLoadStage(0);
    setErrorMsg(null);
    setLetter("");
    setAttachments([]);
    setSummary(null);

    // Advance loading stages every ~1.5s for UX
    let stage = 0;
    stageTimer.current = setInterval(() => {
      stage = Math.min(stage + 1, LOAD_STAGES.length - 1);
      setLoadStage(stage);
    }, 1500);

    try {
      const res = await fetch("/api/v1/preauth/generate", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          patient_id:     patient.id,
          procedure_code: deriveProcedureCode(),
        }),
      });

      clearInterval(stageTimer.current);

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Server error ${res.status}`);
      }

      const data = await res.json();
      setLetter(data.letter || "");
      setAttachments(data.attached_files || []);
      setSummary(data.clinical_summary || null);
      setStatus("done");
      showToast("Pre-auth letter generated by Claude ✓");

    } catch (e) {
      clearInterval(stageTimer.current);
      setErrorMsg(e.message || "Generation failed — please try again.");
      setStatus("error");
    }
  };

  const handleReset = () => {
    clearInterval(stageTimer.current);
    setStatus("idle");
    setLetter("");
    setAttachments([]);
    setSummary(null);
    setErrorMsg(null);
    setLoadStage(0);
  };

  const handleDownloadPDF = () => {
    const safeName = (patient.name || "Patient").replace(/\s+/g, "_");
    const date     = patient.appointmentDate || new Date().toISOString().split("T")[0];
    const filename = `PreAuth_${safeName}_${date}.pdf`;

    const attachList = attachments.map(f => `  • ${f.filename} — ${f.description}`).join("\n");

    const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Pre-Authorization Letter — ${patient.name}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Georgia, "Times New Roman", serif; font-size: 12pt; line-height: 1.7; color: #1a1a18; padding: 0; }
    @page { margin: 1in; }
    @media print { body { padding: 0; } }
    .header { border-bottom: 2px solid #1a1a18; padding-bottom: 12px; margin-bottom: 24px; }
    .header h1 { font-size: 10pt; letter-spacing: 0.1em; text-transform: uppercase; color: #555; font-family: Arial, sans-serif; }
    .header h2 { font-size: 18pt; font-weight: bold; margin-top: 4px; }
    .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; margin-bottom: 20px; font-size: 10pt; font-family: Arial, sans-serif; }
    .meta-grid .label { font-weight: bold; color: #555; text-transform: uppercase; letter-spacing: 0.05em; }
    .letter-body { white-space: pre-wrap; font-size: 11pt; line-height: 1.75; }
    .attachments { margin-top: 24px; padding: 16px; background: #f8f8f6; border: 1px solid #ddd; border-radius: 4px; }
    .attachments h3 { font-size: 10pt; font-family: Arial, sans-serif; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 10px; }
    .attachments ul { list-style: none; padding: 0; }
    .attachments li { font-size: 10pt; padding: 3px 0; font-family: Arial, sans-serif; }
    .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #ccc; font-size: 9pt; color: #888; font-family: Arial, sans-serif; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Georgetown Dental Associates — Pre-Authorization Request</h1>
    <h2>Letter of Medical Necessity</h2>
  </div>
  <div class="meta-grid">
    <div><span class="label">Patient:</span> ${patient.name}</div>
    <div><span class="label">DOB:</span> ${patient.dob || "—"}</div>
    <div><span class="label">Member ID:</span> ${patient.memberId || "—"}</div>
    <div><span class="label">Insurance:</span> ${patient.insurance || "—"}</div>
    <div><span class="label">Procedure:</span> ${patient.procedure || "—"}</div>
    <div><span class="label">Date of Service:</span> ${patient.appointmentDate || "—"}</div>
  </div>
  <div class="letter-body">${letter.replace(/</g,"&lt;").replace(/>/g,"&gt;")}</div>
  ${attachments.length > 0 ? `
  <div class="attachments">
    <h3>Supporting Documents</h3>
    <ul>${attachments.map(f => `<li>• <strong>${f.filename}</strong> — ${f.description}</li>`).join("")}</ul>
  </div>` : ""}
  <div class="footer">Generated by Level AI · ${new Date().toLocaleDateString("en-US", { year:"numeric", month:"long", day:"numeric" })} · Confidential — for insurance submission only</div>
</body>
</html>`;

    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;width:0;height:0;border:0;opacity:0;";
    document.body.appendChild(iframe);
    iframe.contentDocument.write(htmlContent);
    iframe.contentDocument.close();
    iframe.contentWindow.document.title = filename;
    setTimeout(() => {
      iframe.contentWindow.print();
      setTimeout(() => document.body.removeChild(iframe), 1000);
    }, 300);
    showToast("Print dialog opened — choose 'Save as PDF' ↓");
  };

  // ── IDLE ──────────────────────────────────────────────────────────────────
  if (status === "idle") return (
    <button onClick={handleGenerate}
      style={{ marginTop:12, background:T.indigoDark, color:"white", padding:"10px 16px", borderRadius:8,
        fontWeight:800, cursor:"pointer", border:"none", width:"100%", display:"flex",
        justifyContent:"center", alignItems:"center", gap:8, transition:"0.2s" }}
      onMouseEnter={e => e.currentTarget.style.opacity = "0.9"}
      onMouseLeave={e => e.currentTarget.style.opacity = "1"}>
      <span style={{ fontSize:16 }}>⚡</span> Generate Pre-Authorization Letter
    </button>
  );

  // ── LOADING ───────────────────────────────────────────────────────────────
  if (status === "loading") return (
    <div style={{ marginTop:12, background:T.indigoLight, border:"1px solid "+T.indigoBorder,
      borderRadius:10, padding:"16px 18px" }}>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
        <span style={{ width:10, height:10, borderRadius:"50%", background:T.indigo,
          animation:"pulse 1.2s ease-in-out infinite", flexShrink:0 }} />
        <span style={{ color:T.indigoDark, fontSize:13, fontWeight:800 }}>
          Generating Letter of Medical Necessity…
        </span>
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {LOAD_STAGES.map((label, i) => {
          const done    = i < loadStage;
          const active  = i === loadStage;
          return (
            <div key={label} style={{ display:"flex", alignItems:"center", gap:10 }}>
              <div style={{ width:22, height:22, borderRadius:"50%", flexShrink:0,
                display:"flex", alignItems:"center", justifyContent:"center", fontSize:10,
                fontWeight:900, transition:"0.3s",
                background: done ? T.limeDark : active ? T.indigo : T.borderStrong,
                color: done || active ? "white" : T.textSoft }}>
                {done ? "✓" : active ? "…" : i + 1}
              </div>
              <span style={{ fontSize:12, fontWeight:700,
                color: done ? T.limeDark : active ? T.indigoDark : T.textSoft }}>
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );

  // ── ERROR ─────────────────────────────────────────────────────────────────
  if (status === "error") return (
    <div style={{ marginTop:12, background:T.redLight, border:"1px solid "+T.redBorder,
      borderRadius:8, padding:"12px 14px" }}>
      <div style={{ color:T.red, fontSize:13, fontWeight:800, marginBottom:6 }}>Pre-Auth Generation Failed</div>
      <div style={{ color:T.red, fontSize:12, marginBottom:12, lineHeight:1.5 }}>{errorMsg}</div>
      <button onClick={handleReset} style={{ background:T.red, color:"white", border:"none",
        borderRadius:6, padding:"8px 16px", fontWeight:800, cursor:"pointer", fontSize:12 }}>
        Try Again
      </button>
    </div>
  );

  // ── DONE ──────────────────────────────────────────────────────────────────
  if (status === "done") return (
    <div style={{ marginTop:12, border:"1px solid "+T.limeBorder, borderRadius:10, overflow:"hidden" }}>

      {/* Header bar */}
      <div style={{ padding:"10px 16px", background:T.limeDark, display:"flex",
        justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <button onClick={handleReset}
            style={{ display:"flex", alignItems:"center", gap:5, background:"rgba(255,255,255,0.15)", color:"white", border:"none",
              borderRadius:5, padding:"4px 10px", fontWeight:800, cursor:"pointer", fontSize:11 }}
            onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.25)"}
            onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,0.15)"}>
            ← Back
          </button>
          <span style={{ color:"white", fontSize:12, fontWeight:900 }}>
            ✓ Letter of Medical Necessity — Ready
          </span>
        </div>
        <button onClick={() => { navigator.clipboard.writeText(letter); showToast("Copied to clipboard!"); }}
          style={{ background:"rgba(255,255,255,0.2)", color:"white", border:"none",
            borderRadius:5, padding:"4px 10px", fontWeight:800, cursor:"pointer", fontSize:11 }}>
          Copy
        </button>
      </div>

      {/* Attached files list */}
      {attachments.length > 0 && (
        <div style={{ padding:"10px 16px", background:"#f0fdf4", borderBottom:"1px solid "+T.limeBorder }}>
          <div style={{ fontSize:10, fontWeight:900, color:T.limeDark, textTransform:"uppercase",
            letterSpacing:"0.06em", marginBottom:6 }}>
            Supporting Documents ({attachments.length})
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
            {attachments.map((f, i) => (
              <div key={i} style={{ display:"flex", alignItems:"center", gap:8, fontSize:11, color:T.textMid }}>
                <span style={{ fontSize:13 }}>
                  {f.file_type === "xray" ? "🦷" : f.file_type === "chart" ? "📋" : "📄"}
                </span>
                <span style={{ fontWeight:700, color:T.text }}>{f.filename}</span>
                <span style={{ color:T.textSoft }}>— {f.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Editable letter textarea */}
      <div style={{ padding:"12px 16px", background:T.bgCard }}>
        <div style={{ fontSize:10, fontWeight:900, color:T.textMid, textTransform:"uppercase",
          letterSpacing:"0.06em", marginBottom:6 }}>
          Letter — Edit before downloading
        </div>
        <textarea
          value={letter}
          onChange={e => setLetter(e.target.value)}
          rows={14}
          style={{ width:"100%", padding:"10px 12px", border:"1px solid "+T.border, borderRadius:7,
            fontSize:11, lineHeight:1.7, color:T.text, fontFamily:"Georgia, serif",
            background:"white", outline:"none", resize:"vertical", whiteSpace:"pre-wrap" }}
        />
      </div>

      {/* Action buttons */}
      <div style={{ padding:"10px 16px", borderTop:"1px solid "+T.limeBorder,
        display:"flex", gap:8, background:"#f0fdf4" }}>
        <button onClick={handleDownloadPDF}
          style={{ flex:2, background:T.indigoDark, color:"white", border:"none", borderRadius:7,
            padding:"10px", fontWeight:800, cursor:"pointer", fontSize:12, display:"flex",
            alignItems:"center", justifyContent:"center", gap:6 }}>
          📄 Download Pre-Auth PDF
        </button>
        <button onClick={() => { navigator.clipboard.writeText(letter); showToast("Letter copied!"); }}
          style={{ flex:1, background:T.bgCard, color:T.indigoDark, border:"1px solid "+T.indigoBorder,
            borderRadius:7, padding:"10px", fontWeight:800, cursor:"pointer", fontSize:12 }}>
          Copy Text
        </button>
        <button onClick={() => showToast("Fax queued to " + patient.insurance + "!")}
          style={{ flex:1, background:T.bgCard, color:T.textMid, border:"1px solid "+T.border,
            borderRadius:7, padding:"10px", fontWeight:800, cursor:"pointer", fontSize:12 }}>
          📠 Fax
        </button>
      </div>
    </div>
  );

  return null;
}

// ── OON Estimator Widget ──────────────────────────────────────────────────────
// Renders the Out-of-Network financial breakdown inside BenefitsPanel.
// Props: oon (OONEstimateResult object), patient, showToast
function OONEstimatorWidget({ oon, patient, showToast }) {
  const [expanded, setExpanded] = useState(false);
  const [sending, setSending]   = useState(false);

  if (!oon) return null;

  const fmt = (cents) => "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtD = (dollars) => "$" + Number(dollars).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const handleSuperbill = () => {
    setSending(true);
    setTimeout(() => {
      setSending(false);
      showToast("📄 Secure Superbill emailed to patient for direct reimbursement!");
    }, 1400);
  };

  const isOON   = oon.network_status === "out_of_network";
  const officeFee   = oon.office_fee_cents       != null ? fmt(oon.office_fee_cents)        : fmtD(oon.office_fee);
  const allowable   = oon.allowable_amount_cents  != null ? fmt(oon.allowable_amount_cents)  : fmtD(oon.allowable_amount);
  const estIns      = oon.estimated_insurance_payment_cents != null ? fmt(oon.estimated_insurance_payment_cents) : fmtD(oon.estimated_insurance_payment);
  const patientOwes = oon.patient_responsibility_cents      != null ? fmt(oon.patient_responsibility_cents)      : fmtD(oon.patient_responsibility);
  const dedRemaining = oon.remaining_deductible_cents != null ? fmt(oon.remaining_deductible_cents) : fmtD(oon.remaining_deductible);
  const covPct  = oon.oon_coverage_pct ?? 50;

  const stepStatusIcon = (s) => s === "complete" ? "✅" : s === "skipped" ? "⏭️" : "❌";

  return (
    <div style={{ borderRadius: 12, overflow: "hidden", border: "2px solid #f97316", marginBottom: 16,
      boxShadow: "0 0 0 4px rgba(249,115,22,0.08)" }}>

      {/* ── Header badge ── */}
      <div style={{ background: "linear-gradient(135deg, #ea580c 0%, #9a3412 100%)", padding: "12px 16px",
        display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 20 }}>🌐</span>
          <div>
            <div style={{ color: "white", fontWeight: 900, fontSize: 13, letterSpacing: "0.03em" }}>
              OUT-OF-NETWORK
            </div>
            <div style={{ color: "rgba(255,255,255,0.75)", fontSize: 11, marginTop: 1 }}>
              {oon.data_source_label || "Allowable sourced via waterfall"}
            </div>
          </div>
        </div>
        <div style={{ background: "rgba(255,255,255,0.15)", borderRadius: 8, padding: "4px 10px",
          color: "white", fontWeight: 800, fontSize: 11 }}>
          {oon.procedure_code || patient?.procedure?.match(/D\d{4}/)?.[0] || "OON"}
        </div>
      </div>

      <div style={{ background: "#fff7ed", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>

        {/* ── Fee comparison row ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div style={{ background: "white", border: "1px solid #fed7aa", borderRadius: 8, padding: "10px 12px" }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: "#9a3412", textTransform: "uppercase",
              letterSpacing: "0.05em", marginBottom: 3 }}>Office Fee</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: "#1c1917" }}>{officeFee}</div>
            <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 2 }}>Billed charge</div>
          </div>
          <div style={{ background: "white", border: "1px solid #fed7aa", borderRadius: 8, padding: "10px 12px" }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: "#9a3412", textTransform: "uppercase",
              letterSpacing: "0.05em", marginBottom: 3 }}>OON Allowable</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: "#ea580c" }}>{allowable}</div>
            <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 2 }}>Payer recognizes</div>
          </div>
        </div>

        {/* ── Math breakdown ── */}
        <div style={{ background: "white", border: "1px solid #fed7aa", borderRadius: 10, padding: "12px 14px" }}>
          <div style={{ fontSize: 11, fontWeight: 900, color: "#9a3412", marginBottom: 10,
            textTransform: "uppercase", letterSpacing: "0.05em" }}>
            📐 Financial Breakdown
          </div>
          {[
            { label: `OON Allowable Amount`,             value: allowable,    muted: false },
            { label: `− Remaining OON Deductible`,        value: `(${dedRemaining})`, muted: true },
            { label: `× Payer Covers OON`,                value: `${covPct}%`, muted: true },
            { label: null },  // divider
            { label: `= Est. Insurance Payment`,          value: estIns,       muted: false, highlight: true },
          ].map((row, i) => {
            if (row.label === null) return (
              <div key={i} style={{ borderTop: "1px solid #fed7aa", margin: "8px 0" }} />
            );
            return (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                marginBottom: 5, padding: row.highlight ? "5px 8px" : "1px 0",
                background: row.highlight ? "#fff7ed" : "transparent",
                borderRadius: row.highlight ? 6 : 0 }}>
                <span style={{ fontSize: 12, color: row.muted ? "#9ca3af" : "#374151",
                  fontWeight: row.highlight ? 800 : 500 }}>
                  {row.label}
                </span>
                <span style={{ fontSize: 13, fontWeight: row.highlight ? 900 : 600,
                  color: row.highlight ? "#16a34a" : row.muted ? "#9ca3af" : "#111827" }}>
                  {row.value}
                </span>
              </div>
            );
          })}
        </div>

        {/* ── Patient responsibility — big number ── */}
        <div style={{ background: "linear-gradient(135deg, #1c1917, #292524)", borderRadius: 10,
          padding: "16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: "#f97316", textTransform: "uppercase",
              letterSpacing: "0.06em", marginBottom: 4 }}>
              Total Est. Patient Out-of-Pocket
            </div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)" }}>
              Office fee minus est. insurance payment
            </div>
          </div>
          <div style={{ fontSize: 28, fontWeight: 900, color: "#f97316" }}>
            {patientOwes}
          </div>
        </div>

        {/* ── Waterfall steps (collapsible) ── */}
        <button onClick={() => setExpanded(e => !e)}
          style={{ background: "none", border: "1px dashed #fed7aa", borderRadius: 8, color: "#9a3412",
            fontSize: 11, fontWeight: 800, cursor: "pointer", padding: "7px 12px", width: "100%",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          {expanded ? "▲" : "▼"} {expanded ? "Hide" : "Show"} Data Sourcing Waterfall
        </button>

        {expanded && (
          <div style={{ background: "white", border: "1px solid #fed7aa", borderRadius: 10,
            overflow: "hidden", animation: "fadeIn 0.2s ease-out" }}>
            {(oon.waterfall_steps || []).map((s, i) => (
              <div key={i} style={{ display: "flex", gap: 12, padding: "10px 14px",
                borderBottom: i < (oon.waterfall_steps.length - 1) ? "1px solid #fff7ed" : "none",
                background: i % 2 === 0 ? "white" : "#fffbf7" }}>
                <div style={{ flexShrink: 0, width: 28, height: 28, borderRadius: "50%",
                  background: s.status === "complete" ? "#dcfce7" : s.status === "skipped" ? "#f3f4f6" : "#fee2e2",
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>
                  {stepStatusIcon(s.status)}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 900, color: "#374151", marginBottom: 2 }}>
                    Step {s.step}: {s.name}
                  </div>
                  <div style={{ fontSize: 11, color: "#6b7280", lineHeight: 1.4 }}>
                    {s.result}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Superbill CTA ── */}
        <button onClick={handleSuperbill} disabled={sending}
          style={{ background: sending ? "#9ca3af" : "linear-gradient(135deg, #ea580c, #dc2626)",
            color: "white", border: "none", borderRadius: 10, padding: "13px",
            fontWeight: 900, fontSize: 13, cursor: sending ? "not-allowed" : "pointer",
            width: "100%", transition: "0.2s", letterSpacing: "0.02em",
            boxShadow: sending ? "none" : "0 4px 14px rgba(234,88,12,0.4)" }}
          onMouseEnter={e => { if (!sending) e.currentTarget.style.transform = "translateY(-1px)"; }}
          onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; }}>
          {sending ? "⏳ Generating Superbill…" : "📄 Generate Digital Superbill"}
        </button>
        <div style={{ fontSize: 10, color: "#9a3412", textAlign: "center", marginTop: -4 }}>
          Sends secure PDF to patient for direct insurance reimbursement
        </div>
      </div>
    </div>
  );
}

// ── Benefits Panel ────────────────────────────────────────────────────────────
function BenefitsPanel({ patient, result, phaseInfo, onVerify, triage, showToast, onBack, backLabel }) {
  if (!patient) return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:"100%", color:T.textSoft, gap:8 }}>
      <div style={{ fontSize:32 }}>👈</div>
      <div style={{ fontSize:13, fontWeight:700 }}>Select a patient to review</div>
    </div>
  );

  const loading = phaseInfo && phaseInfo.phase !== "complete" && phaseInfo.phase !== "error";
  const isRPA = result?._source === "hybrid";
  const isOON = result?.in_network === false || result?.oon_estimate != null;

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", overflow:"hidden" }}>
      {/* Back button row — shown when navigated from a list */}
      {onBack && (
        <div style={{ padding:"8px 16px", borderBottom:"1px solid " + T.border, flexShrink:0, background:T.bg }}>
          <button onClick={onBack}
                  style={{ display:"flex", alignItems:"center", gap:6, background:"transparent", border:"none", color:T.textMid, fontWeight:700, fontSize:12, cursor:"pointer", padding:"2px 0" }}
                  onMouseEnter={e=>e.currentTarget.style.color=T.text}
                  onMouseLeave={e=>e.currentTarget.style.color=T.textMid}>
            ← {backLabel || "Back to list"}
          </button>
        </div>
      )}
      <div style={{ padding:"16px 20px", borderBottom:"1px solid " + T.border, flexShrink:0 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
          <div>
            <div style={{ color:T.text, fontSize:16, fontWeight:900 }}>{patient.name}</div>
            <div style={{ color:T.textSoft, fontSize:11, marginTop:2 }}>{patient.insurance} · {patient.appointmentTime}</div>
          </div>
          {!loading && (
            <button onClick={()=>onVerify(patient,"manual")} style={{ padding:"7px 14px", borderRadius:8, border:"1px solid " + T.border, background:T.bg, color:T.textMid, fontWeight:700, cursor:"pointer", fontSize:11 }}>
              ↻ Re-verify
            </button>
          )}
        </div>
        <div style={{ marginTop:8, display:"flex", gap:6, flexWrap:"wrap" }}>
          {isRPA && <Badge label="RPA Verified" color={T.rpaDark} bg={T.rpaLight} border={T.rpaBorder} icon="🤖" />}
          {isOON && <Badge label="Out-of-Network" color="#9a3412" bg="#fff7ed" border="#fed7aa" icon="⚠" />}
        </div>
      </div>

      <div style={{ flex:1, overflowY:"auto", padding:"16px 20px", minHeight: 0 }}>
        {loading && phaseInfo && <PhaseIndicator phase={phaseInfo.phase} reason={phaseInfo.reason} />}

        {!loading && !result && (
          <div style={{ textAlign:"center", color:T.textSoft, marginTop:40 }}>
            <div style={{ fontSize:11, fontWeight:700 }}>Not yet verified</div>
          </div>
        )}

        {!loading && result && (
          <>
            {/* OON Estimator — shown when result carries oon_estimate block */}
            {result.oon_estimate && (
              <OONEstimatorWidget
                oon={result.oon_estimate}
                patient={patient}
                showToast={showToast}
              />
            )}

            {triage && (triage.block.length>0 || triage.notify.length>0) && (
              <div>
                {triage.block.length > 0 && (
                  <div style={{ background:T.redLight, border:"1px solid " + T.redBorder, borderRadius:10, padding:"16px", marginBottom:16 }}>
                    <div style={{ color:T.red, fontSize:12, fontWeight:900, marginBottom:8, textTransform:"uppercase", letterSpacing:"0.05em" }}>Block Issues Detected</div>
                    {triage.block.map((r,i)=><div key={i} style={{ color:T.red, fontSize:13, fontWeight:600, marginBottom:i<triage.block.length-1?4:0, lineHeight: "1.4" }}>{"- " + r}</div>)}

                    <PreauthWidget patient={patient} result={result} triage={triage} showToast={showToast} />
                  </div>
                )}
                {triage.notify.length > 0 && (
                  <div style={{ background:T.amberLight, border:"1px solid " + T.amberBorder, borderRadius:10, padding:"12px 14px", marginBottom:10 }}>
                    <div style={{ color:T.amberDark, fontSize:11, fontWeight:900, marginBottom:6 }}>PATIENT NOTIFICATION ADVISED</div>
                    {triage.notify.map((r,i)=><div key={i} style={{ color:T.amberDark, fontSize:12, fontWeight:600, marginBottom:i<triage.notify.length-1?4:0 }}>{"- " + r}</div>)}
                  </div>
                )}
              </div>
            )}

            {result.ai_summary && (
              <div style={{ background:"#1e2a1e", border:"1px solid " + T.limeBorder, borderRadius:10, padding:"12px 14px", marginBottom:14 }}>
                <div style={{ color:T.lime, fontSize:10, fontWeight:900, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:6 }}>&#x1F916; AI Benefits Summary</div>
                <div style={{ color:"#c8f0c8", fontSize:12, lineHeight:"1.6", fontWeight:500 }}>{result.ai_summary}</div>
              </div>
            )}

            {result.estimated_patient_responsibility_cents != null && (
              <div style={{ background:T.amberLight, border:"1px solid " + T.amberBorder, borderRadius:10, padding:"10px 14px", marginBottom:14, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <span style={{ color:T.amberDark, fontSize:12, fontWeight:700 }}>Est. Patient Responsibility</span>
                <span style={{ color:T.amberDark, fontSize:18, fontWeight:900 }}>{dollars(result.estimated_patient_responsibility_cents)}</span>
              </div>
            )}

            <SectionLabel>Plan Status</SectionLabel>
            <div style={{ background:T.bg, borderRadius:10, border:"1px solid " + T.border }}>
              {[
                { label:"Status", value:result.plan_status === "terminated" ? "Inactive / Terminated" : result.verification_status?.replace(/_/g," "), warn: result.plan_status === "terminated" },
                { label:"Payer", value:result.payer_name },
                { label:"Annual Max", value:dollars(result.annual_maximum_cents) },
                { label:"Remaining", value:dollars(result.annual_remaining_cents), warn:(result.annual_remaining_cents||0)<30000 },
                { label:"Deductible", value:dollars(result.individual_deductible_cents) },
                { label:"Deductible Met", value:(result.individual_deductible_met_cents||0)>=(result.individual_deductible_cents||1)?"Yes ✓":"No — $" + (((result.individual_deductible_cents||0)-(result.individual_deductible_met_cents||0))/100).toFixed(0) + " gap", warn:(result.individual_deductible_met_cents||0)<(result.individual_deductible_cents||1) },
                result.copay_pct ? { label:"Insurance Pays", value: result.copay_pct + "%" } : null,
              ].filter(Boolean).map((row,i,arr)=>(
                <div key={row.label} style={{ display:"flex", justifyContent:"space-between", padding:"9px 14px", borderBottom:i<arr.length-1?"1px solid "+T.border:"none" }}>
                  <span style={{ color:T.textMid, fontSize:12, fontWeight:600 }}>{row.label}</span>
                  <span style={{ color:row.warn?T.amber:T.text, fontSize:13, fontWeight:700 }}>{row.value}</span>
                </div>
              ))}
            </div>

            {result.preventive && (
              <>
                <SectionLabel>Preventive</SectionLabel>
                <div style={{ background:T.bg, borderRadius:10, border:"1px solid " + T.border }}>
                  {[
                    { label:"Coverage", value:pct(result.preventive.coverage_pct) },
                    result.preventive.cleaning_frequency ? { label:"Cleanings Used", value:(result.preventive.cleaning_frequency.used_this_period||0) + "/" + (result.preventive.cleaning_frequency.times_per_period||2), warn:(result.preventive.cleaning_frequency.used_this_period||0)>=(result.preventive.cleaning_frequency.times_per_period||2) } : null,
                  ].filter(Boolean).map((row,i,arr)=>(
                    <div key={row.label} style={{ display:"flex", justifyContent:"space-between", padding:"9px 14px", borderBottom:i<arr.length-1?"1px solid "+T.border:"none" }}>
                      <span style={{ color:T.textMid, fontSize:12, fontWeight:600 }}>{row.label}</span>
                      <span style={{ color:row.warn?T.red:T.text, fontSize:13, fontWeight:700 }}>{row.value}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {result.restorative && (
              <>
                <SectionLabel>Restorative</SectionLabel>
                <div style={{ background:T.bg, borderRadius:10, border:"1px solid " + T.border }}>
                  {[
                    { label:"Coverage", value:pct(result.restorative.coverage_pct) },
                    { label:"Composite Downgrade", value:result.restorative.composite_posterior_downgrade?"Yes -- amalgam rate":"No", warn:result.restorative.composite_posterior_downgrade },
                    (result.restorative.crown_waiting_period_months||0)>0 ? { label:"Crown Wait", value:result.restorative.crown_waiting_period_months + " months", warn:true } : null,
                  ].filter(Boolean).map((row,i,arr)=>(
                    <div key={row.label} style={{ display:"flex", justifyContent:"space-between", padding:"9px 14px", borderBottom:i<arr.length-1?"1px solid "+T.border:"none" }}>
                      <span style={{ color:T.textMid, fontSize:12, fontWeight:600 }}>{row.label}</span>
                      <span style={{ color:row.warn?T.amber:T.text, fontSize:13, fontWeight:700 }}>{row.value}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {result.basic && (
              <>
                <SectionLabel>Basic Services</SectionLabel>
                <div style={{ background:T.bg, borderRadius:10, border:"1px solid " + T.border }}>
                  {[
                    { label:"Coverage", value:pct(result.basic.coverage_pct) },
                  ].map((row,i,arr)=>(
                    <div key={row.label} style={{ display:"flex", justifyContent:"space-between", padding:"9px 14px", borderBottom:i<arr.length-1?"1px solid "+T.border:"none" }}>
                      <span style={{ color:T.textMid, fontSize:12, fontWeight:600 }}>{row.label}</span>
                      <span style={{ color:T.text, fontSize:13, fontWeight:700 }}>{row.value}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {result.major && (
              <>
                <SectionLabel>Major Services</SectionLabel>
                <div style={{ background:T.bg, borderRadius:10, border:"1px solid " + T.border }}>
                  {[
                    { label:"Coverage", value:pct(result.major.coverage_pct) },
                  ].map((row,i,arr)=>(
                    <div key={row.label} style={{ display:"flex", justifyContent:"space-between", padding:"9px 14px", borderBottom:i<arr.length-1?"1px solid "+T.border:"none" }}>
                      <span style={{ color:T.textMid, fontSize:12, fontWeight:600 }}>{row.label}</span>
                      <span style={{ color:T.text, fontSize:13, fontWeight:700 }}>{row.value}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {result.ortho?.covered && (
              <>
                <SectionLabel>Orthodontics</SectionLabel>
                <div style={{ background:T.bg, borderRadius:10, border:"1px solid " + T.border }}>
                  {[
                    { label:"Lifetime Max", value:dollars(result.ortho.lifetime_maximum_cents) },
                    { label:"Used", value:dollars(result.ortho.used_cents) },
                    { label:"Remaining", value:dollars((result.ortho.lifetime_maximum_cents||0)-(result.ortho.used_cents||0)) },
                  ].map((row,i,arr)=>(
                    <div key={row.label} style={{ display:"flex", justifyContent:"space-between", padding:"9px 14px", borderBottom:i<arr.length-1?"1px solid "+T.border:"none" }}>
                      <span style={{ color:T.textMid, fontSize:12, fontWeight:600 }}>{row.label}</span>
                      <span style={{ color:T.text, fontSize:13, fontWeight:700 }}>{row.value}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {result.missing_tooth_clause?.applies && (
              <>
                <SectionLabel>Missing Tooth Clause</SectionLabel>
                <div style={{ background:T.redLight, border:"1px solid " + T.redBorder, borderRadius:10, padding:"10px 14px" }}>
                  <div style={{ color:T.red, fontSize:12, fontWeight:700 }}>Applies to teeth: {(result.missing_tooth_clause.affected_teeth||[]).join(", ")}</div>
                </div>
              </>
            )}

            {(result.action_flags||[]).filter(f=>f!=="thin_data").length > 0 && (
              <>
                <SectionLabel>Flags</SectionLabel>
                <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                  {result.action_flags.filter(f=>f!=="thin_data").map((f,i)=>(
                    <Badge key={i} label={f.replace(/_/g," ")} color={T.amber} bg={T.amberLight} border={T.amberBorder} />
                  ))}
                </div>
              </>
            )}

            {/* Download Benefit PDF */}
            <div style={{ marginTop:20, paddingTop:16, borderTop:"1px solid " + T.border }}>
              <button
                onClick={() => {
                  const lines = [];
                  lines.push(`BENEFIT VERIFICATION REPORT`);
                  lines.push(`Generated: ${new Date().toLocaleString()}`);
                  lines.push(`${"─".repeat(48)}`);
                  lines.push(`Patient:      ${patient.name}`);
                  lines.push(`DOB:          ${patient.dob}`);
                  lines.push(`Member ID:    ${patient.memberId}`);
                  lines.push(`Insurance:    ${result.payer_name}`);
                  lines.push(`Appointment:  ${patient.appointmentDate} ${patient.appointmentTime}`);
                  lines.push(`Procedure:    ${patient.procedure}`);
                  lines.push(`Fee:          $${(patient.fee/100).toLocaleString()}`);
                  lines.push(``);
                  lines.push(`PLAN STATUS`);
                  lines.push(`${"─".repeat(48)}`);
                  lines.push(`Status:             ${result.plan_status === "terminated" ? "INACTIVE / TERMINATED" : "Active"}`);
                  lines.push(`Annual Maximum:     $${(result.annual_maximum_cents/100).toLocaleString()}`);
                  lines.push(`Remaining:          $${(result.annual_remaining_cents/100).toLocaleString()}`);
                  lines.push(`Deductible:         $${(result.individual_deductible_cents/100).toLocaleString()}`);
                  const dedMet = (result.individual_deductible_met_cents||0) >= (result.individual_deductible_cents||1);
                  lines.push(`Deductible Met:     ${dedMet ? "Yes" : "No — $" + (((result.individual_deductible_cents||0)-(result.individual_deductible_met_cents||0))/100).toFixed(0) + " gap"}`);
                  if (result.copay_pct) lines.push(`Insurance Pays:     ${result.copay_pct}%`);
                  lines.push(``);
                  if (result.preventive) { lines.push(`COVERAGE BREAKDOWN`); lines.push(`${"─".repeat(48)}`); }
                  if (result.preventive) lines.push(`Preventive:         ${result.preventive.coverage_pct}%`);
                  if (result.basic) lines.push(`Basic:              ${result.basic.coverage_pct}%`);
                  if (result.restorative) lines.push(`Major/Restorative:  ${result.restorative.coverage_pct}%`);
                  if (result.restorative?.crown_waiting_period_months > 0) lines.push(`Crown Wait Period:  ${result.restorative.crown_waiting_period_months} months`);
                  if (result.restorative?.composite_posterior_downgrade) lines.push(`Composite Downgrade: Yes — amalgam rate`);
                  if (result.ortho?.covered) {
                    lines.push(`Orthodontics:       Covered`);
                    lines.push(`Ortho Lifetime Max: $${(result.ortho.lifetime_maximum_cents/100).toLocaleString()}`);
                    lines.push(`Ortho Used:         $${(result.ortho.used_cents/100).toLocaleString()}`);
                  }
                  if (result.missing_tooth_clause?.applies) lines.push(`Missing Tooth Clause: Applies to ${(result.missing_tooth_clause.affected_teeth||[]).join(", ")}`);
                  lines.push(``);
                  if (result.estimated_patient_responsibility_cents != null) {
                    lines.push(`EST. PATIENT RESPONSIBILITY`);
                    lines.push(`${"─".repeat(48)}`);
                    lines.push(`$${(result.estimated_patient_responsibility_cents/100).toLocaleString()}`);
                    lines.push(``);
                  }
                  if (result.ai_summary) {
                    lines.push(`AI SUMMARY`);
                    lines.push(`${"─".repeat(48)}`);
                    lines.push(result.ai_summary);
                    lines.push(``);
                  }
                  lines.push(`Source: ${result._source || "verified"} · Level AI Demo Sandbox`);
                  const content = lines.join("\n");
                  const win = window.open("", "_blank");
                  win.document.write(`<html><head><title>Benefit Report — ${patient.name}</title><style>body{font-family:monospace;white-space:pre;padding:32px;font-size:13px;line-height:1.6;color:#111;}@media print{body{padding:16px}}</style></head><body>${content.replace(/</g,"&lt;").replace(/>/g,"&gt;")}</body></html>`);
                  win.document.close();
                  win.print();
                }}
                style={{ width:"100%", padding:"11px 16px", borderRadius:8, border:"1px solid " + T.border, background:T.bgCard, color:T.textMid, fontWeight:800, cursor:"pointer", fontSize:12, display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
                ⬇ Download Benefit Report PDF
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Auto-Verified Panel ───────────────────────────────────────────────────────
function AutoVerifiedPanel({ list, onClose, onSelect }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", overflow:"hidden" }}>
      <div style={{ padding:"16px 20px", borderBottom:"1px solid "+T.border, display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 }}>
        <div>
          <div style={{ fontSize:18, fontWeight:900, color:T.rpaDark }}>🤖 Auto-Verified Today</div>
          <div style={{ fontSize:12, color:T.textSoft, marginTop:2 }}>These patients were verified automatically — no action needed.</div>
        </div>
        <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", fontSize:24, color:T.textSoft }}>&times;</button>
      </div>
      <div style={{ flex:1, overflowY:"auto", padding:"16px 20px", display:"flex", flexDirection:"column", gap:10, minHeight:0 }}>
        {list.length === 0 ? (
          <div style={{ textAlign:"center", color:T.textSoft, fontSize:13, marginTop:40 }}>No auto-verified patients yet today.</div>
        ) : list.map(p => (
          <div key={p.id} onClick={() => onSelect(p)}
            style={{ border:"1px solid "+T.rpaBorder, background:T.rpaLight, borderRadius:10, padding:14, cursor:"pointer", transition:"0.15s", display:"flex", justifyContent:"space-between", alignItems:"center" }}
            onMouseEnter={e => e.currentTarget.style.borderColor=T.rpaDark}
            onMouseLeave={e => e.currentTarget.style.borderColor=T.rpaBorder}>
            <div>
              <div style={{ fontWeight:800, fontSize:14, color:T.text }}>{p.name}</div>
              <div style={{ fontSize:11, color:T.textMid, marginTop:3 }}>{p.appointmentTime} · {p.procedure}</div>
            </div>
            <div style={{ textAlign:"right" }}>
              <div style={{ fontSize:11, fontWeight:800, color:T.rpaDark }}>✓ Verified</div>
              <div style={{ fontSize:10, color:T.textSoft, marginTop:2 }}>{p.insurance}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Schedule Side Panels (Alerts, Outreach) ───────────────────────────────────
function AlertsPanel({ list, agentLog, onApprove, onDismiss, onClose, onSelect, showToast }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", overflow:"hidden" }}>
       <div style={{ padding:"16px 20px", borderBottom:"1px solid "+T.border, display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 }}>
           <div>
               <div style={{fontSize:18, fontWeight:900, color:T.red}}>Action Required</div>
               <div style={{fontSize:12, color:T.textSoft, marginTop:2}}>Review blocks and send proactive outreach.</div>
           </div>
           <button onClick={onClose} style={{background:"none", border:"none", cursor:"pointer", fontSize:24, color:T.textSoft}}>&times;</button>
       </div>
       <div style={{ flex:1, overflowY:"auto", padding:"16px 20px", display:"flex", flexDirection:"column", gap:12, minHeight: 0 }}>
           {list.map(({p, t}) => {
               const entry = agentLog.find(e => e.patientId === p.id && e.awaitingApproval && e.action === ACTION.RESCHEDULE);
               return (
                 <div key={p.id} onClick={()=>onSelect(p)} style={{border:"1px solid "+T.redBorder, background:T.redLight, borderRadius:10, padding:14, cursor:"pointer", transition:"0.15s", boxShadow:"0 1px 3px rgba(0,0,0,0.02)", display:"flex", flexDirection:"column", flexShrink: 0}}
                      onMouseEnter={e=>e.currentTarget.style.borderColor=T.red} onMouseLeave={e=>e.currentTarget.style.borderColor=T.redBorder}>
                     <div style={{display:"flex", justifyContent:"space-between", marginBottom:4}}>
                         <span style={{fontWeight:800, fontSize:14, color:T.text}}>{p.name}</span>
                         <span style={{fontSize:11, color:T.red, fontWeight:800}}>{new Date(p.appointmentDate).toLocaleDateString("en-US",{month:"short",day:"numeric"})}</span>
                     </div>
                     <div style={{fontSize:11, color:T.textMid, marginBottom:8}}>{p.appointmentTime} &middot; {p.procedure}</div>
                     {t.block.map((m, i) => <div key={i} style={{fontSize:11, color:T.red, fontWeight:700, lineHeight:"1.4", marginTop:4}}>• {m}</div>)}

                     {entry && (
                       <div style={{ marginTop: 12, display:"flex", flexDirection:"column" }}>
                         <div style={{ background:T.bgCard, border:"1px solid " + T.border, borderRadius:8, padding:"10px 12px", marginBottom: 12 }}>
                           <div style={{ color:T.textSoft, fontSize:10, fontWeight:900, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>AI SMS Draft</div>
                           <div style={{ color:T.textMid, fontSize:12, lineHeight:"1.5", fontStyle:"italic" }}>"{entry.draftMessage}"</div>
                         </div>
                         <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
                           <button onClick={(e)=>{ e.stopPropagation(); onApprove(entry); showToast("Draft sent successfully!"); }} style={{ flex: "1 1 120px", padding:"10px 12px", borderRadius:8, border:"none", background:T.indigoDark, color:"#fff", fontWeight:800, cursor:"pointer", fontSize:11 }}>Approve & Send Draft</button>
                           <button onClick={(e)=>{ e.stopPropagation(); onDismiss(entry); showToast("Removed from AI Queue."); }} style={{ flex: "1 1 120px", padding:"10px 12px", borderRadius:8, border:"1px solid "+T.borderStrong, background:T.bgCard, color:T.textMid, fontWeight:800, cursor:"pointer", fontSize:11 }}>I'll Handle It</button>
                         </div>
                       </div>
                     )}
                 </div>
               )
           })}
       </div>
    </div>
  )
}

function OutreachPanel({ list, agentLog, onApprove, onDismiss, onClose, onSelect, showToast }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", overflow:"hidden" }}>
       <div style={{ padding:"16px 20px", borderBottom:"1px solid "+T.border, display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 }}>
           <div>
               <div style={{fontSize:18, fontWeight:900, color:T.amberDark}}>Patient Outreach</div>
               <div style={{fontSize:12, color:T.textSoft, marginTop:2}}>Courtesy calls to prevent surprises.</div>
           </div>
           <button onClick={onClose} style={{background:"none", border:"none", cursor:"pointer", fontSize:24, color:T.textSoft}}>&times;</button>
       </div>
       <div style={{ flex:1, overflowY:"auto", padding:"16px 20px", display:"flex", flexDirection:"column", gap:12, minHeight: 0 }}>
           {list.map(({p, t}) => {
               const entry = agentLog.find(e => e.patientId === p.id && e.awaitingApproval && e.action === ACTION.OUTREACH);
               return (
                 <div key={p.id} onClick={()=>onSelect(p)} style={{border:"1px solid "+T.amberBorder, background:T.amberLight, borderRadius:10, padding:14, cursor:"pointer", transition:"0.15s", boxShadow:"0 1px 3px rgba(0,0,0,0.02)", display:"flex", flexDirection:"column", flexShrink: 0}}
                      onMouseEnter={e=>e.currentTarget.style.borderColor=T.amberDark} onMouseLeave={e=>e.currentTarget.style.borderColor=T.amberBorder}>
                     <div style={{display:"flex", justifyContent:"space-between", marginBottom:4}}>
                         <span style={{fontWeight:800, fontSize:14, color:T.text}}>{p.name}</span>
                         <span style={{fontSize:11, color:T.amberDark, fontWeight:800}}>{new Date(p.appointmentDate).toLocaleDateString("en-US",{month:"short",day:"numeric"})}</span>
                     </div>
                     <div style={{fontSize:11, color:T.textMid, marginBottom:8}}>{p.appointmentTime} &middot; {p.procedure}</div>
                     {t.notify.map((m, i) => <div key={i} style={{fontSize:11, color:T.amberDark, fontWeight:700, lineHeight:"1.4", marginTop:4}}>• {m}</div>)}

                     {entry && (
                       <div style={{ marginTop: 12, display:"flex", flexDirection:"column" }}>
                         <div style={{ background:T.bgCard, border:"1px solid " + T.border, borderRadius:8, padding:"10px 12px", marginBottom: 12 }}>
                           <div style={{ color:T.textSoft, fontSize:10, fontWeight:900, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>AI SMS Draft</div>
                           <div style={{ color:T.textMid, fontSize:12, lineHeight:"1.5", fontStyle:"italic" }}>"{entry.draftMessage}"</div>
                         </div>
                         <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
                           <button onClick={(e)=>{ e.stopPropagation(); onApprove(entry); showToast("Message sent to patient!"); }} style={{ flex: "1 1 120px", padding:"10px 12px", borderRadius:8, border:"none", background:T.indigoDark, color:"#fff", fontWeight:800, cursor:"pointer", fontSize:11 }}>Send Outreach</button>
                           <button onClick={(e)=>{ e.stopPropagation(); onDismiss(entry); showToast("Removed from AI Queue."); }} style={{ flex: "1 1 120px", padding:"10px 12px", borderRadius:8, border:"1px solid "+T.borderStrong, background:T.bgCard, color:T.textMid, fontWeight:800, cursor:"pointer", fontSize:11 }}>I'll Handle It</button>
                         </div>
                       </div>
                     )}
                 </div>
               )
           })}
       </div>
    </div>
  )
}

function MorningBanner({ blockedCount, notifyCount, botCount, rpaCount, onOpenAlerts, onOpenNotify, onOpenAutoVerified }) {
  if (blockedCount === 0 && notifyCount === 0 && botCount === 0) return null;
  return (
    <div style={{ display:"flex", gap:12, marginBottom:20, flexWrap:"wrap" }}>
      {blockedCount > 0 && (
         <div onClick={onOpenAlerts} style={{ flex:"1 1 180px", cursor:"pointer", background:T.redLight, border:"1px solid "+T.redBorder, padding:"14px 18px", borderRadius:12, display:"flex", alignItems:"center", gap:12, transition:"all 0.2s", boxShadow:"0 2px 4px rgba(0,0,0,0.04)" }}
              onMouseEnter={e=>{ e.currentTarget.style.transform="translateY(-4px)"; e.currentTarget.style.boxShadow="0 12px 24px rgba(220,38,38,0.15)"; e.currentTarget.style.borderColor=T.red; }}
              onMouseLeave={e=>{ e.currentTarget.style.transform="translateY(0)"; e.currentTarget.style.boxShadow="0 2px 4px rgba(0,0,0,0.04)"; e.currentTarget.style.borderColor=T.redBorder; }}>
             <span style={{fontSize:24}}>🚨</span>
             <div>
                 <div style={{fontSize:15, fontWeight:900, color:T.red}}>{blockedCount} Action{blockedCount!==1?"s":""} Needed</div>
                 <div style={{fontSize:12, color:T.red, opacity:0.8, fontWeight:600, marginTop:2}}>View flagged appts &rarr;</div>
             </div>
         </div>
      )}
      {notifyCount > 0 && (
         <div onClick={onOpenNotify} style={{ flex:"1 1 180px", cursor:"pointer", background:T.amberLight, border:"1px solid "+T.amberBorder, padding:"14px 18px", borderRadius:12, display:"flex", alignItems:"center", gap:12, transition:"all 0.2s", boxShadow:"0 2px 4px rgba(0,0,0,0.04)" }}
              onMouseEnter={e=>{ e.currentTarget.style.transform="translateY(-4px)"; e.currentTarget.style.boxShadow="0 12px 24px rgba(180,83,9,0.15)"; e.currentTarget.style.borderColor=T.amberDark; }}
              onMouseLeave={e=>{ e.currentTarget.style.transform="translateY(0)"; e.currentTarget.style.boxShadow="0 2px 4px rgba(0,0,0,0.04)"; e.currentTarget.style.borderColor=T.amberBorder; }}>
             <span style={{fontSize:24}}>📞</span>
             <div>
                 <div style={{fontSize:15, fontWeight:900, color:T.amberDark}}>{notifyCount} Call{notifyCount!==1?"s":""} Queued</div>
                 <div style={{fontSize:12, color:T.amberDark, opacity:0.8, fontWeight:600, marginTop:2}}>View outreach list &rarr;</div>
             </div>
         </div>
      )}
      {botCount > 0 && (
         <div onClick={onOpenAutoVerified} style={{ flex:"1 1 200px", cursor:"pointer", background:T.rpaLight, border:"1px solid "+T.rpaBorder, padding:"14px 18px", borderRadius:12, display:"flex", alignItems:"center", gap:12, transition:"all 0.2s", boxShadow:"0 2px 4px rgba(0,0,0,0.04)" }}
              onMouseEnter={e=>{ e.currentTarget.style.transform="translateY(-4px)"; e.currentTarget.style.boxShadow="0 12px 24px rgba(3,105,161,0.12)"; e.currentTarget.style.borderColor=T.rpaDark; }}
              onMouseLeave={e=>{ e.currentTarget.style.transform="translateY(0)"; e.currentTarget.style.boxShadow="0 2px 4px rgba(0,0,0,0.04)"; e.currentTarget.style.borderColor=T.rpaBorder; }}>
             <span style={{fontSize:24}}>🤖</span>
             <div>
                 <div style={{fontSize:15, fontWeight:900, color:T.rpaDark}}>{botCount} Auto-Verified</div>
                 <div style={{fontSize:12, color:T.rpaDark, opacity:0.8, fontWeight:600, marginTop:2}}>{rpaCount > 0 ? `${rpaCount} via RPA` : `View details &rarr;`}</div>
             </div>
         </div>
      )}
    </div>
  )
}

function PatientCard({ patient, result, phaseInfo, isSelected, triage, isAuto, isRPA, onSelect, colColor }) {
  const loading = phaseInfo && phaseInfo.phase !== "complete" && phaseInfo.phase !== "error";
  const isOON = patient.isOON || result?.in_network === false || result?.oon_estimate != null;
  return (
    <div onClick={onSelect}
      style={{ background:T.bgCard, borderRadius:10, padding:"12px 13px", cursor:"pointer", border:"1.5px solid " + (isSelected?colColor:T.border), boxShadow:isSelected?"0 0 0 3px "+colColor+"22":"0 1px 3px rgba(0,0,0,0.04)", transition:"all 0.15s", display: "flex", flexDirection: "column" }}
      onMouseEnter={e=>{ if(!isSelected){ e.currentTarget.style.borderColor=colColor; e.currentTarget.style.boxShadow="0 0 0 3px "+colColor+"15"; }}}
      onMouseLeave={e=>{ if(!isSelected){ e.currentTarget.style.borderColor=T.border; e.currentTarget.style.boxShadow="0 1px 3px rgba(0,0,0,0.04)"; }}}>
      <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:5, flexWrap:"wrap" }}>
        <span style={{ color:T.text, fontSize:13, fontWeight:800, flex:1 }}>{patient.name}</span>
        {isOON  && <Badge label="OON"  color="#9a3412" bg="#fff7ed" border="#fed7aa" />}
        {isAuto && <Badge label="AUTO" color={T.indigo} bg={T.indigoLight} border={T.indigoBorder} icon="Bot" />}
        {isRPA  && <Badge label="RPA"  color={T.rpaDark} bg={T.rpaLight}   border={T.rpaBorder}   icon="Bot" />}
      </div>
      <div style={{ color:T.textSoft, fontSize:10, marginBottom:2 }}>DOB {patient.dob} · {patient.memberId}</div>
      <div style={{ color:T.textMid, fontSize:11, fontWeight:700, marginBottom:2 }}>{patient.appointmentTime} · {patient.procedure}</div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:2 }}>
        <span style={{ color:T.textSoft, fontSize:10 }}>{patient.provider}</span>
        <span style={{ color:T.textSoft, fontSize:10 }}>{patient.insurance}</span>
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <span style={{ color:T.textSoft, fontSize:10 }}>{patient.phone}</span>
        <span style={{ color:colColor, fontSize:11, fontWeight:800 }}>${(patient.fee/100).toLocaleString()}</span>
      </div>
      {loading && phaseInfo && <div style={{ marginTop:8 }}><PhaseIndicator phase={phaseInfo.phase} reason={phaseInfo.reason} compact /></div>}
      {!loading && (triage?.notify||[]).length > 0 && (
        <div style={{ marginTop:6, display:"flex", gap:4, flexWrap:"wrap" }}>
          <Badge label="Notify Patient" color={T.amberDark} bg={T.amberLight} border={T.amberBorder} icon="Phone" />
        </div>
      )}
    </div>
  );
}

// ── Directory Modal — Schedule + Pre-Verify ───────────────────────────────────
const MOCK_DIRECTORY = [
  { id: "dir_1", name: "Amanda Lewis",   dob: "1985-04-12", procedure: "Implant Consult",  insurance: "MetLife",       phone: "(512) 555-1111", provider: "Dr. Patel",     fee: 25000,  memberId: "MET88899", fixtureId: "p1" },
  { id: "dir_2", name: "David Chen",     dob: "1992-10-30", procedure: "Prophy + BWX",     insurance: "Delta Dental",  phone: "(512) 555-2222", provider: "Dr. Chen",      fee: 18500,  memberId: "DD77733",  fixtureId: "p2" },
  { id: "dir_3", name: "Sarah Jenkins",  dob: "1970-02-14", procedure: "Crown Prep #18",   insurance: "Cigna",         phone: "(512) 555-3333", provider: "Dr. Kim",       fee: 145000, memberId: "CIG44422", fixtureId: "p3" },
  { id: "dir_4", name: "Michael Vance",  dob: "2001-08-05", procedure: "Root Canal",       insurance: "Guardian",      phone: "(512) 555-4444", provider: "Dr. Rodriguez", fee: 115000, memberId: "GRD11100", fixtureId: "p5" },
  { id: "dir_5", name: "Jessica Taylor", dob: "1998-12-22", procedure: "Composite Fill",   insurance: "Aetna DMO",     phone: "(512) 555-5555", provider: "Dr. Patel",     fee: 25000,  memberId: "AET9900",  fixtureId: "p1" },
];

const TIME_SLOTS = ["8:00 AM","8:30 AM","9:00 AM","9:30 AM","10:00 AM","10:30 AM","11:00 AM","11:30 AM","1:00 PM","1:30 PM","2:00 PM","2:30 PM","3:00 PM","3:30 PM","4:00 PM","4:30 PM"];

function DirectorySearchModal({ onSelect, onClose }) {
  const [mode, setMode]           = useState("schedule"); // "schedule" | "preverify"
  const [step, setStep]           = useState(1);          // 1=date/time, 2=patient search
  const [selDate, setSelDate]     = useState("");
  const [selTime, setSelTime]     = useState("9:00 AM");
  const [query, setQuery]         = useState("");
  const [verifying, setVerifying] = useState(null);       // patient id being verified
  const [verifyRes, setVerifyRes] = useState({});         // map id -> result|error

  // Build next 7 weekdays from today
  const weekdays = (() => {
    const days = [];
    const d = new Date();
    while (days.length < 7) {
      if (d.getDay() !== 0 && d.getDay() !== 6) {
        days.push({
          dateStr: d.toISOString().split("T")[0],
          label: d.toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric" }),
        });
      }
      d.setDate(d.getDate() + 1);
    }
    return days;
  })();

  const filtered = MOCK_DIRECTORY.filter(p =>
    p.name.toLowerCase().includes(query.toLowerCase()) ||
    p.dob.includes(query) ||
    p.insurance.toLowerCase().includes(query.toLowerCase())
  );

  const handlePreVerify = async (p) => {
    setVerifying(p.id);
    try {
      const res = await apiPostVerify(p.fixtureId || "p1", "manual");
      setVerifyRes(prev => ({ ...prev, [p.id]: { ok: true, data: res } }));
    } catch (e) {
      setVerifyRes(prev => ({ ...prev, [p.id]: { ok: false, error: e.message } }));
    } finally {
      setVerifying(null);
    }
  };

  const tabBtn = (id, label) => (
    <button onClick={() => { setMode(id); setStep(1); setQuery(""); setVerifyRes({}); }}
            style={{ flex:1, padding:"10px 0", fontWeight:800, fontSize:13, cursor:"pointer", border:"none",
                     borderBottom: mode===id ? "3px solid white" : "3px solid transparent",
                     background:"transparent", color: mode===id ? "white" : "rgba(255,255,255,0.6)",
                     transition:"all 0.15s" }}>
      {label}
    </button>
  );

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", zIndex:5000, display:"flex", alignItems:"center", justifyContent:"center" }}
         onClick={e => { if (e.target===e.currentTarget) onClose(); }}>
      <div style={{ background:T.bgCard, width:500, borderRadius:14, overflow:"hidden", display:"flex", flexDirection:"column", maxHeight:"88vh", boxShadow:"0 24px 64px rgba(0,0,0,0.22)" }}>

        {/* ── Header ── */}
        <div style={{ background:T.indigoDark, color:"white" }}>
          <div style={{ padding:"16px 20px 0", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <div style={{ fontSize:16, fontWeight:900 }}>Patient Lookup</div>
            <button onClick={onClose} style={{ background:"transparent", border:"none", color:"white", fontSize:24, cursor:"pointer", lineHeight:1 }}>&times;</button>
          </div>
          {/* Mode tabs */}
          <div style={{ display:"flex", marginTop:10 }}>
            {tabBtn("schedule", "📅 Schedule Appointment")}
            {tabBtn("preverify", "🔍 Pre-Verify Only")}
          </div>
        </div>

        {/* ── SCHEDULE MODE ── */}
        {mode === "schedule" && (
          <>
            {/* Step indicator */}
            <div style={{ padding:"10px 20px", borderBottom:"1px solid "+T.border, background:T.bg, display:"flex", alignItems:"center", gap:8 }}>
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                <div style={{ width:22, height:22, borderRadius:"50%", background: step>=1 ? T.indigoDark : T.border, color:"white", display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:900 }}>1</div>
                <span style={{ fontSize:12, fontWeight:700, color: step>=1 ? T.indigoDark : T.textSoft }}>Date & Time</span>
              </div>
              <div style={{ flex:1, height:2, background: step>=2 ? T.indigoDark : T.border, borderRadius:2 }} />
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                <div style={{ width:22, height:22, borderRadius:"50%", background: step>=2 ? T.indigoDark : T.border, color:"white", display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:900 }}>2</div>
                <span style={{ fontSize:12, fontWeight:700, color: step>=2 ? T.indigoDark : T.textSoft }}>Select Patient</span>
              </div>
            </div>

            {step === 1 && (
              <div style={{ padding:20, display:"flex", flexDirection:"column", gap:16 }}>
                <div>
                  <div style={{ fontSize:12, fontWeight:800, color:T.textMid, marginBottom:10, textTransform:"uppercase", letterSpacing:"0.05em" }}>Select Appointment Date</div>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                    {weekdays.map(d => (
                      <button key={d.dateStr} onClick={() => setSelDate(d.dateStr)}
                              style={{ padding:"8px 14px", borderRadius:8, border:"2px solid", cursor:"pointer", fontSize:12, fontWeight:700, transition:"all 0.15s",
                                       borderColor: selDate===d.dateStr ? T.indigoDark : T.border,
                                       background:  selDate===d.dateStr ? T.indigoLight : T.bgCard,
                                       color:       selDate===d.dateStr ? T.indigoDark  : T.textMid }}>
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize:12, fontWeight:800, color:T.textMid, marginBottom:10, textTransform:"uppercase", letterSpacing:"0.05em" }}>Select Time Slot</div>
                  <select value={selTime} onChange={e=>setSelTime(e.target.value)}
                          style={{ width:"100%", padding:"10px 14px", border:"1px solid "+T.border, borderRadius:8, fontSize:14, fontFamily:"inherit", outline:"none", background:T.bgCard, color:T.text }}>
                    {TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <button onClick={() => { if (selDate) setStep(2); }}
                        style={{ marginTop:4, padding:"12px 0", borderRadius:9, border:"none", fontWeight:900, fontSize:14, cursor: selDate ? "pointer" : "not-allowed",
                                 background: selDate ? T.indigoDark : T.border, color: selDate ? "white" : T.textSoft, transition:"all 0.15s" }}>
                  {selDate ? `Continue — ${weekdays.find(d=>d.dateStr===selDate)?.label} at ${selTime}` : "Select a date to continue →"}
                </button>
              </div>
            )}

            {step === 2 && (
              <>
                <div style={{ padding:"10px 16px", borderBottom:"1px solid "+T.border, background:T.indigoLight, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                  <span style={{ fontSize:12, fontWeight:800, color:T.indigoDark }}>
                    📅 {weekdays.find(d=>d.dateStr===selDate)?.label} &nbsp;·&nbsp; 🕐 {selTime}
                  </span>
                  <button onClick={()=>setStep(1)} style={{ fontSize:11, fontWeight:800, color:T.indigoDark, background:"transparent", border:"none", cursor:"pointer", textDecoration:"underline" }}>Change</button>
                </div>
                <div style={{ padding:"12px 16px", borderBottom:"1px solid "+T.border }}>
                  <input type="text" placeholder="Search by name, DOB, or insurance..." value={query} onChange={e=>setQuery(e.target.value)} autoFocus
                         style={{ width:"100%", padding:"10px 14px", border:"1px solid "+T.border, borderRadius:8, fontSize:14, outline:"none", fontFamily:"inherit", boxSizing:"border-box" }} />
                </div>
                <div style={{ flex:1, overflowY:"auto", padding:12, display:"flex", flexDirection:"column", gap:8 }}>
                  {filtered.length === 0
                    ? <div style={{ textAlign:"center", padding:20, color:T.textSoft, fontSize:13 }}>No patients found.</div>
                    : filtered.map(p => (
                        <div key={p.id} onClick={() => onSelect({ ...p, appointmentTime:selTime, appointmentDate:selDate, id:"p_dir_"+Date.now() })}
                             style={{ border:"1px solid "+T.border, borderRadius:9, padding:"12px 16px", cursor:"pointer", display:"flex", justifyContent:"space-between", alignItems:"center", transition:"all 0.15s" }}
                             onMouseEnter={e => { e.currentTarget.style.borderColor=T.indigoDark; e.currentTarget.style.background=T.indigoLight; }}
                             onMouseLeave={e => { e.currentTarget.style.borderColor=T.border; e.currentTarget.style.background=T.bgCard; }}>
                          <div>
                            <div style={{ fontSize:14, fontWeight:900, color:T.text }}>{p.name}</div>
                            <div style={{ fontSize:11, color:T.textSoft, marginTop:3 }}>DOB {p.dob} &middot; {p.procedure}</div>
                          </div>
                          <div style={{ textAlign:"right" }}>
                            <div style={{ fontSize:12, fontWeight:800, color:T.textMid }}>{p.insurance}</div>
                            <div style={{ fontSize:11, color:T.textSoft, marginTop:3 }}>{p.provider}</div>
                          </div>
                        </div>
                      ))
                  }
                </div>
              </>
            )}
          </>
        )}

        {/* ── PRE-VERIFY MODE ── */}
        {mode === "preverify" && (
          <>
            <div style={{ padding:"10px 16px", borderBottom:"1px solid "+T.border, background:T.rpaLight }}>
              <div style={{ fontSize:12, color:T.rpaDark, fontWeight:700 }}>
                🔒 Verify a patient&apos;s insurance without adding them to the schedule queue.
              </div>
            </div>
            <div style={{ padding:"12px 16px", borderBottom:"1px solid "+T.border }}>
              <input type="text" placeholder="Search by name, DOB, or insurance..." value={query} onChange={e=>setQuery(e.target.value)} autoFocus
                     style={{ width:"100%", padding:"10px 14px", border:"1px solid "+T.border, borderRadius:8, fontSize:14, outline:"none", fontFamily:"inherit", boxSizing:"border-box" }} />
            </div>
            <div style={{ flex:1, overflowY:"auto", padding:12, display:"flex", flexDirection:"column", gap:10 }}>
              {filtered.length === 0
                ? <div style={{ textAlign:"center", padding:20, color:T.textSoft, fontSize:13 }}>No patients found.</div>
                : filtered.map(p => {
                    const vr = verifyRes[p.id];
                    const isVerifying = verifying === p.id;
                    return (
                      <div key={p.id} style={{ border:"1px solid "+T.border, borderRadius:10, overflow:"hidden" }}>
                        <div style={{ padding:"12px 16px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                          <div>
                            <div style={{ fontSize:14, fontWeight:900, color:T.text }}>{p.name}</div>
                            <div style={{ fontSize:11, color:T.textSoft, marginTop:3 }}>DOB {p.dob} &middot; {p.insurance} &middot; {p.procedure}</div>
                          </div>
                          {!vr && (
                            <button onClick={() => handlePreVerify(p)} disabled={isVerifying}
                                    style={{ padding:"7px 14px", borderRadius:7, border:"none", fontWeight:800, fontSize:12, cursor: isVerifying ? "default" : "pointer",
                                             background: isVerifying ? T.rpaLight : T.rpaDark, color:"white", transition:"all 0.15s", whiteSpace:"nowrap", flexShrink:0, marginLeft:12 }}>
                              {isVerifying ? "Verifying…" : "Verify Insurance"}
                            </button>
                          )}
                          {vr && (
                            <button onClick={() => setVerifyRes(prev => { const n={...prev}; delete n[p.id]; return n; })}
                                    style={{ padding:"5px 10px", borderRadius:6, border:"1px solid "+T.border, background:T.bgCard, color:T.textSoft, fontSize:11, cursor:"pointer", flexShrink:0, marginLeft:12 }}>
                              Clear
                            </button>
                          )}
                        </div>

                        {/* Inline result */}
                        {vr && vr.ok && (
                          <div style={{ padding:"12px 16px", borderTop:"1px solid "+T.border, background:T.limeLight }}>
                            <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:8 }}>
                              <span style={{ fontSize:14 }}>✅</span>
                              <span style={{ fontSize:13, fontWeight:900, color:T.limeDark }}>
                                {vr.data.plan_status === "active" ? "Active Coverage" : vr.data.plan_status}
                              </span>
                            </div>
                            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"6px 16px" }}>
                              {[
                                ["Plan",         vr.data.plan_name || p.insurance],
                                ["Member ID",    vr.data.member_id || p.memberId],
                                ["Deductible",   vr.data.deductible_remaining != null ? `$${(vr.data.deductible_remaining/100).toFixed(0)} remaining` : "--"],
                                ["Max Benefit",  vr.data.annual_max_remaining  != null ? `$${(vr.data.annual_max_remaining/100).toFixed(0)} left`      : "--"],
                                ["Preventive",   vr.data.preventive_coverage   != null ? vr.data.preventive_coverage + "%"  : "--"],
                                ["Basic",        vr.data.basic_coverage        != null ? vr.data.basic_coverage + "%"       : "--"],
                              ].map(([label, val]) => (
                                <div key={label}>
                                  <div style={{ fontSize:10, fontWeight:700, color:T.limeDark, opacity:0.7, textTransform:"uppercase" }}>{label}</div>
                                  <div style={{ fontSize:12, fontWeight:800, color:T.text }}>{val}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {vr && !vr.ok && (
                          <div style={{ padding:"10px 16px", borderTop:"1px solid "+T.redBorder, background:T.redLight }}>
                            <span style={{ fontSize:12, color:T.red, fontWeight:700 }}>⚠ {vr.error || "Verification failed"}</span>
                          </div>
                        )}
                      </div>
                    );
                  })
              }
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Calendar Overview & Day Panels ────────────────────────────────────────────
function CalendarMonthSummaryPanel({ patients, showToast }) {
  const currentMonthStr = new Date().toLocaleDateString("en-US", { month: "long" });

  const totalSlots = 20 * 16;
  const totalScheduled = patients.length;
  const openSlots = totalSlots - totalScheduled;
  const avgRevPerSlot = 200;
  const lostRev = openSlots * avgRevPerSlot;

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", overflow:"hidden", background:T.bgCard }}>
      <div style={{ padding:"16px 20px", borderBottom:"1px solid " + T.border, flexShrink:0 }}>
        <div style={{ color:T.text, fontSize:18, fontWeight:900 }}>{currentMonthStr} Overview</div>
        <div style={{ color:T.textSoft, fontSize:12, marginTop:2 }}>Production Forecast & Opportunities</div>
      </div>

      <div style={{ flex: 1, padding: "20px", overflowY: "auto", minHeight: 0 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 24 }}>
          <div style={{ background: T.bg, border: "1px solid " + T.border, borderRadius: 10, padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ color: T.textMid, fontSize: 12, fontWeight: 800, textTransform: "uppercase" }}>Total Scheduled</div>
            <div style={{ color: T.text, fontSize: 18, fontWeight: 900 }}>{totalScheduled}</div>
          </div>
          <div style={{ background: T.redLight, border: "1px solid " + T.redBorder, borderRadius: 10, padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ color: T.red, fontSize: 12, fontWeight: 800, textTransform: "uppercase" }}>Open Slots</div>
            <div style={{ color: T.red, fontSize: 18, fontWeight: 900 }}>{openSlots}</div>
          </div>
          <div style={{ background: T.amberLight, border: "1px solid " + T.amberBorder, borderRadius: 10, padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ color: T.amberDark, fontSize: 12, fontWeight: 800, textTransform: "uppercase" }}>Risk / Lost Revenue</div>
            <div style={{ color: T.amberDark, fontSize: 18, fontWeight: 900 }}>${lostRev.toLocaleString()}</div>
          </div>
        </div>

        <div>
          <div style={{ color:T.text, fontSize:14, fontWeight:900, marginBottom:12 }}>Waitlist / Quick Fill</div>
          <div style={{ fontSize: 12, color: T.textSoft, marginBottom: 16 }}>Patients requesting earlier appointments.</div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {["Emily Rogers", "Marcus Chen", "Sarah Williams"].map((name, i) => (
              <div key={i} style={{ padding: "12px", border: "1px solid " + T.border, borderRadius: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: T.text }}>{name}</span>
                <span style={{ fontSize: 11, color: T.textSoft }}>Prophy</span>
              </div>
            ))}
          </div>

          <button onClick={() => showToast("SMS Blast Sent to Waitlist! 🚀")}
                  style={{ width: "100%", marginTop: 16, padding: "12px", background: T.indigoDark, color: "white", borderRadius: 8, border: "none", fontWeight: 800, cursor: "pointer", display: "flex", justifyContent: "center", alignItems: "center", gap: 8, transition: "0.2s" }}
                  onMouseEnter={e=>e.currentTarget.style.opacity=0.9} onMouseLeave={e=>e.currentTarget.style.opacity=1}>
            <span style={{ fontSize: 16 }}>💬</span> Blast SMS to Waitlist
          </button>
        </div>
      </div>
    </div>
  );
}

function DayCardPanel({ date, patientsOnDay, results, triageMap, onClose, onAddPatientClick, onPatientClick, onRemovePatient }) {
  const dateStr = date.toLocaleDateString("en-US", { weekday:"long", month:"long", day:"numeric" });
  const slots = ["8:00 AM", "9:00 AM", "10:00 AM", "11:00 AM", "1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM"];

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", overflow:"hidden", background:T.bgCard }}>
      <div style={{ padding:"16px 20px", borderBottom:"1px solid " + T.border, display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 }}>
        <div>
          <div style={{ color:T.text, fontSize:18, fontWeight:900 }}>Daily Schedule</div>
          <div style={{ color:T.indigo, fontSize:12, fontWeight:700, marginTop:2 }}>{dateStr}</div>
        </div>
        <button onClick={onClose} style={{ background:"transparent", border:"none", fontSize:24, cursor:"pointer", color:T.textSoft }}>&times;</button>
      </div>

      <div style={{ flex:1, overflowY:"auto", minHeight: 0, padding:"16px 20px", display:"flex", flexDirection:"column", gap:12 }}>
        {slots.map(time => {
          const scheduled = patientsOnDay.filter(p => p.appointmentTime.includes(time.split(":")[0]));
          return (
            <div key={time} style={{ display:"flex", gap:16, borderBottom:"1px solid " + T.bg, paddingBottom:12 }}>
              <div style={{ width: 60, color:T.textSoft, fontSize:11, fontWeight:800, textAlign:"right", paddingTop:8, flexShrink: 0 }}>{time}</div>
              <div style={{ flex:1, display:"flex", flexDirection:"column", gap:8, minWidth: 0 }}>
                {scheduled.length > 0 ? (
                  scheduled.map(p => {
                    const res = results[p.id];
                    const t = triageMap[p.id];
                    const isAlert = t && t.block.length > 0;
                    return (
                      <div key={p.id} onClick={() => onPatientClick(p)} style={{ background:isAlert ? T.redLight : T.bg, border:"1px solid " + (isAlert ? T.redBorder : T.border), borderRadius:8, padding:"10px 12px", cursor:"pointer", transition:"0.15s", flexShrink: 0 }}
                           onMouseEnter={e => e.currentTarget.style.borderColor = isAlert ? T.red : T.indigo}
                           onMouseLeave={e => e.currentTarget.style.borderColor = isAlert ? T.redBorder : T.border}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:4 }}>
                          <span style={{ fontSize:13, fontWeight:800, color:T.text }}>{p.name}</span>
                          <button onClick={(e) => { e.stopPropagation(); onRemovePatient(p.id); }} style={{ background:"none", border:"none", color:T.textSoft, cursor:"pointer", fontSize:18, padding: "0 4px", lineHeight: 0.5 }} title="Remove Patient">&times;</button>
                        </div>
                        <div style={{ fontSize:11, color:T.textSoft, marginBottom:6 }}>{p.procedure} &middot; {p.insurance}</div>
                        {isAlert && <div style={{ fontSize:11, color:T.red, fontWeight:700 }}>&#x26A0; Needs attention</div>}
                        {!res && <div style={{ fontSize:11, color:T.slate, fontWeight:700 }}>Verification Pending</div>}
                      </div>
                    )
                  })
                ) : (
                  <div onClick={() => onAddPatientClick(time, date.toISOString().split("T")[0])} style={{ border:"1px dashed " + T.borderStrong, borderRadius:8, padding:"10px", textAlign:"center", color:T.indigo, fontSize:11, fontWeight:800, cursor:"pointer", background:T.indigoLight, opacity:0.8, flexShrink: 0 }}>
                    + Fill Slot
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  );
}

function CalendarView({ patients, results, triageMap, onSelectDay, currentDayLocal }) {
  const [currentDate, setCurrentDate] = useState(new Date());

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const monthName = currentDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const grid = generateCalendarGrid(year, month);

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));

  return (
    <div style={{ padding:24, height:"100%", display:"flex", flexDirection:"column", overflow:"hidden" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20, flexShrink:0 }}>
        <div>
          <div style={{ color:T.text, fontSize:22, fontWeight:900 }}>Office Calendar</div>
          <div style={{ color:T.textSoft, fontSize:13, marginTop:2 }}>Manage upcoming schedules and proactive verifications.</div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:16 }}>
          <button onClick={prevMonth} style={{ background:T.bgCard, border:"1px solid " + T.border, borderRadius:8, padding:"6px 12px", cursor:"pointer", fontWeight:800 }}>&larr;</button>
          <span style={{ fontSize:16, fontWeight:900, minWidth:150, textAlign:"center" }}>{monthName}</span>
          <button onClick={nextMonth} style={{ background:T.bgCard, border:"1px solid " + T.border, borderRadius:8, padding:"6px 12px", cursor:"pointer", fontWeight:800 }}>&rarr;</button>
        </div>
      </div>

      <div style={{ display:"flex", flexDirection:"column", flex:1, minHeight: 0, overflow:"hidden" }}>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(7, 1fr)", gap:8, flexShrink:0 }}>
          {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(day => (
            <div key={day} style={{ textAlign:"center", fontSize:11, fontWeight:900, color:T.textSoft, textTransform:"uppercase", letterSpacing:"0.05em", paddingBottom:8 }}>{day}</div>
          ))}
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"repeat(7, 1fr)", gridAutoRows:"1fr", gap:8, overflowY:"auto", minHeight: 0, paddingRight:8, paddingBottom:24, flex: 1 }}>
          {grid.map((cell, idx) => {
            const dateStr = cell.date.toISOString().split("T")[0];
            const pts = patients.filter(p => p.appointmentDate === dateStr);

            let hasAlert = false;
            let hasWarning = false;
            pts.forEach(p => {
              const t = triageMap[p.id];
              if (t && t.block.length > 0) hasAlert = true;
              else if (t && t.notify.length > 0) hasWarning = true;
            });

            const totalSlots = 16;
            const available = totalSlots - pts.length;
            const isWeekend = cell.date.getDay() === 0 || cell.date.getDay() === 6;
            const isToday = currentDayLocal && cell.date.toDateString() === currentDayLocal.toDateString();

            return (
              <div key={idx} onClick={() => cell.isCurrentMonth && !isWeekend && onSelectDay(cell.date)}
                   style={{
                     background: isWeekend ? T.slateLight : cell.isCurrentMonth ? T.bgCard : "transparent",
                     border: "1px solid " + (cell.isCurrentMonth && !isWeekend ? T.border : "transparent"),
                     borderRadius: 12, padding: 10, display: "flex", flexDirection: "column", minHeight: 100,
                     opacity: cell.isCurrentMonth ? 1 : 0.4,
                     cursor: cell.isCurrentMonth && !isWeekend ? "pointer" : "default",
                     transition: "all 0.15s",
                     boxShadow: cell.isCurrentMonth && !isWeekend ? "0 1px 3px rgba(0,0,0,0.02)" : "none"
                   }}
                   onMouseEnter={e => { if(cell.isCurrentMonth && !isWeekend) e.currentTarget.style.borderColor = T.indigo; }}
                   onMouseLeave={e => { if(cell.isCurrentMonth && !isWeekend) e.currentTarget.style.borderColor = T.border; }}>

                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8 }}>
                  <span style={{ fontSize:14, fontWeight:900, color: isToday ? T.indigo : isWeekend ? T.textSoft : T.text }}>
                    {cell.date.getDate()}
                  </span>
                  {hasAlert && !isWeekend ? (
                    <span style={{ width:10, height:10, borderRadius:"50%", background:T.red, boxShadow:"0 0 0 3px " + T.redLight }} title="Issues Require Attention" />
                  ) : hasWarning && !isWeekend ? (
                    <span style={{ width:10, height:10, borderRadius:"50%", background:T.amber }} title="Patient Notifications Queued" />
                  ) : null}
                </div>

                {cell.isCurrentMonth && isWeekend && (
                   <div style={{ marginTop:"auto", fontSize:11, fontWeight:800, color:T.textSoft, textAlign:"center" }}>Closed</div>
                )}

                {cell.isCurrentMonth && !isWeekend && (
                  <div style={{ marginTop:"auto", display:"flex", flexDirection:"column", gap:4 }}>
                    <div style={{ fontSize:11, fontWeight:800, color: pts.length > 0 ? T.indigo : T.textSoft }}>
                      {pts.length} Scheduled
                    </div>
                    <div style={{ fontSize:10, fontWeight:700, color:T.limeDark, background:T.limeLight, padding:"2px 6px", borderRadius:4, alignSelf:"flex-start" }}>
                      {available} Open Slots
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  );
}

// ── Week Ahead ────────────────────────────────────────────────────────────────
function WeekAhead({ patients, results, triageMap, agentLog, showToast, onSelectPatient, onVerify }) {
  const [modalCategory, setModalCategory] = useState(null);
  const [focusedPatient, setFocusedPatient] = useState(null);

  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];

  const allUpcoming = patients.filter(p => p.appointmentDate >= todayStr);

  const isVerified = (id) => results[id]?.verification_status === "active";
  const isPending  = (id) => !results[id];

  const critical = allUpcoming.filter(p => { const t = triageMap[p.id]; return t && t.block.length > 0; });
  const headsUp  = allUpcoming.filter(p => { const t = triageMap[p.id]; return t && t.block.length === 0 && t.notify.length > 0; });
  const clear    = allUpcoming.filter(p => { const t = triageMap[p.id]; return !t || (t.block.length === 0 && t.notify.length === 0); });

  const categoryPatients = { critical, headsUp, clear };
  const categoryConfig = {
    critical: { label: "Critical",  color: T.red,      bg: T.redLight,   border: T.redBorder,   count: critical.length },
    headsUp:  { label: "Heads Up",  color: T.amberDark,bg: T.amberLight, border: T.amberBorder, count: headsUp.length  },
    clear:    { label: "Clear",     color: T.limeDark, bg: T.limeLight,  border: T.limeBorder,  count: clear.length    },
  };

  const closeModal = () => { setModalCategory(null); setFocusedPatient(null); };

  return (
    <div style={{ padding: 24, height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* Header */}
      <div style={{ marginBottom: 16, flexShrink: 0 }}>
        <div style={{ fontSize: 22, fontWeight: 900 }}>Week Ahead</div>
        <div style={{ fontSize: 13, color: T.textSoft, marginTop: 2 }}>
          {allUpcoming.length} upcoming appointment{allUpcoming.length !== 1 ? "s" : ""} · next 7 days
        </div>
      </div>

      {/* Summary pills — text only, no icons */}
      {allUpcoming.length > 0 && (
        <div style={{ display: "flex", gap: 10, marginBottom: 20, flexShrink: 0, flexWrap: "wrap" }}>
          {critical.length > 0 && (
            <div style={{ padding:"5px 14px", borderRadius:20, background:T.redLight,
              border:"1px solid "+T.redBorder, fontSize:12, fontWeight:800, color:T.red }}>
              {critical.length} Critical
            </div>
          )}
          {headsUp.length > 0 && (
            <div style={{ padding:"5px 14px", borderRadius:20, background:T.amberLight,
              border:"1px solid "+T.amberBorder, fontSize:12, fontWeight:800, color:T.amberDark }}>
              {headsUp.length} Heads Up
            </div>
          )}
          <div style={{ padding:"5px 14px", borderRadius:20, background:T.limeLight,
            border:"1px solid "+T.limeBorder, fontSize:12, fontWeight:800, color:T.limeDark }}>
            {allUpcoming.filter(p => isVerified(p.id) && !triageMap[p.id]?.block.length).length} Verified
          </div>
          <div style={{ padding:"5px 14px", borderRadius:20, background:T.slateLight,
            border:"1px solid "+T.border, fontSize:12, fontWeight:800, color:T.slate }}>
            {allUpcoming.filter(p => isPending(p.id)).length} Pending
          </div>
        </div>
      )}

      {/* 3 Dynamic Category Boxes */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, flex: 1, minHeight: 0 }}>
        {["critical", "headsUp", "clear"].map(cat => {
          const cfg = categoryConfig[cat];
          return (
            <div key={cat} onClick={() => setModalCategory(cat)}
              style={{ background: cfg.bg, border: `2px solid ${cfg.border}`, borderRadius: 16,
                padding: 24, cursor: "pointer", display: "flex", flexDirection: "column",
                justifyContent: "center", alignItems: "center", transition: "all 0.2s",
                boxShadow: "0 4px 12px rgba(0,0,0,0.04)" }}
              onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-4px)"; e.currentTarget.style.boxShadow = "0 12px 24px rgba(0,0,0,0.08)"; }}
              onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.04)"; }}>
              <div style={{ fontSize: 48, fontWeight: 900, color: cfg.color, marginBottom: 8 }}>
                {cfg.count}
              </div>
              <div style={{ fontSize: 17, fontWeight: 800, color: cfg.color }}>
                {cfg.label}
              </div>
              <div style={{ fontSize: 12, color: T.textSoft, marginTop: 8 }}>
                {cfg.count} patient{cfg.count !== 1 ? "s" : ""}
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal */}
      {modalCategory && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 9999,
          display: "flex", alignItems: "center", justifyContent: "center" }} onClick={closeModal}>
          <div style={{ background: T.bgCard, width: "90%", maxWidth: 620, borderRadius: 16,
            overflow: "hidden", maxHeight: "88vh", display: "flex", flexDirection: "column" }}
            onClick={e => e.stopPropagation()}>

            <div style={{ padding: "20px 24px", borderBottom: "1px solid " + T.border,
              display: "flex", justifyContent: "space-between", alignItems: "center",
              background: categoryConfig[modalCategory].bg }}>
              <div style={{ fontSize: 20, fontWeight: 900, color: categoryConfig[modalCategory].color }}>
                {categoryConfig[modalCategory].label} Patients
              </div>
              <button onClick={closeModal}
                style={{ fontSize: 24, color: T.textSoft, background: "none", border: "none", cursor: "pointer" }}>✕</button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
              {categoryPatients[modalCategory].length === 0 ? (
                <div style={{ textAlign: "center", color: T.textSoft, padding: 40 }}>No patients in this category.</div>
              ) : (
                categoryPatients[modalCategory].map(p => {
                  const t = triageMap[p.id];
                  const reasons = t ? (t.block.length > 0 ? t.block : t.notify) : [];
                  const isOpen = focusedPatient?.id === p.id;
                  return (
                    <div key={p.id}
                      style={{ border: "1px solid " + (isOpen ? T.indigo : T.border), borderRadius: 12,
                        padding: 16, cursor: "pointer", background: isOpen ? T.indigoLight : T.bg, transition: "0.15s" }}
                      onClick={() => setFocusedPatient(isOpen ? null : p)}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <div style={{ fontWeight: 800, fontSize: 16 }}>{p.name}</div>
                          <div style={{ fontSize: 12, color: T.textMid, marginTop: 2 }}>
                            {p.appointmentDate} · {p.appointmentTime} · {p.procedure}
                          </div>
                        </div>
                        <div style={{ textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                          <div style={{ fontSize: 11, color: T.textSoft }}>{p.insurance}</div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: T.indigoDark }}>
                            {isOpen ? "▲ Hide details" : "▼ View details"}
                          </div>
                        </div>
                      </div>

                      {reasons.length > 0 && (
                        <div style={{ marginTop: 12 }}>
                          <div style={{ fontSize: 10, fontWeight: 800, color: T.textSoft, marginBottom: 6 }}>WHY THEY ARE HERE</div>
                          {reasons.map((r, i) => (
                            <div key={i} style={{ fontSize: 12, color: T.textMid, padding: "4px 0" }}>• {r}</div>
                          ))}
                        </div>
                      )}

                      {isOpen && (
                        <div style={{ marginTop: 14, borderTop: "1px solid " + T.indigoBorder, paddingTop: 14 }}
                          onClick={e => e.stopPropagation()}>
                          {/* Back to list button */}
                          <button
                            onClick={() => setFocusedPatient(null)}
                            style={{ display:"flex", alignItems:"center", gap:6, background:"transparent", border:"none",
                              color:T.textMid, fontWeight:700, fontSize:12, cursor:"pointer", padding:"2px 0", marginBottom:10 }}
                            onMouseEnter={e=>e.currentTarget.style.color=T.text}
                            onMouseLeave={e=>e.currentTarget.style.color=T.textMid}>
                            ← Back to patient list
                          </button>
                          <BenefitsPanel
                            patient={p}
                            result={results?.[p.id] || null}
                            phaseInfo={null}
                            onVerify={onVerify}
                            triage={triageMap?.[p.id] || null}
                            showToast={showToast}
                          />
                          <button onClick={() => { onSelectPatient(p); closeModal(); }}
                            style={{ marginTop: 12, width: "100%", padding: "10px", borderRadius: 8,
                              border: "1px solid " + T.indigoBorder, background: T.indigoLight,
                              color: T.indigoDark, fontWeight: 800, fontSize: 13, cursor: "pointer" }}>
                            Open in Daily Schedule →
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
// ── AI Workflow ───────────────────────────────────────────────────────────────
function AIWorkflow({ log, onSelectPatient, onApprove, onDismiss, showToast, results, triageMap }) {
  const [showAttentionPanel, setShowAttentionPanel] = useState(true);
  const [focusedPatientId, setFocusedPatientId] = useState(null);

  const pending = log.filter(e => e.awaitingApproval);
  const outreach = log.filter(e => e.action === ACTION.OUTREACH);
  const reschedules = log.filter(e => [ACTION.RESCHEDULE,ACTION.APPROVED,ACTION.DISMISSED].includes(e.action));
  const verifications = log.filter(e => e.action === ACTION.VERIFIED);

  const attentionLog = log.filter(e => e.awaitingApproval || e.action === ACTION.OUTREACH);
  const displayLog = !showAttentionPanel ? log : attentionLog;

  const ACfg = {
    [ACTION.VERIFIED]:   { icon:"Check", label:"Verified",            color:T.limeDark, bg:T.limeLight,   border:T.limeBorder  },
    [ACTION.RESCHEDULE]: { icon:"Cal",   label:"Reschedule Proposed", color:T.red,      bg:T.redLight,    border:T.redBorder   },
    [ACTION.APPROVED]:   { icon:"Check", label:"Reschedule Approved", color:T.limeDark, bg:T.limeLight,   border:T.limeBorder  },
    [ACTION.DISMISSED]:  { icon:"Back",  label:"Handled Manually",    color:T.slate,    bg:T.slateLight,  border:T.border      },
    [ACTION.OUTREACH]:   { icon:"Phone", label:"Outreach Queued",     color:T.amberDark, bg:T.amberLight, border:T.amberBorder },
  };

  return (
    <div style={{ padding:24, height:"100%", display:"flex", flexDirection:"column", overflow:"hidden" }}>

      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16, flexShrink:0 }}>
        <div>
          <div style={{ color:T.text, fontSize:20, fontWeight:900 }}>&#x1F916; AI Workflow Log</div>
          <div style={{ color:T.textSoft, fontSize:11, marginTop:2 }}>{verifications.length} verified &middot; {reschedules.length} reschedule actions &middot; {outreach.length} outreach queued</div>
        </div>
        <div style={{ display:"flex", gap:6 }}>
          <button onClick={()=>setShowAttentionPanel(true)} style={{ padding:"8px 16px", borderRadius:8, border:"1px solid " + (showAttentionPanel?T.indigoDark:T.border), background:showAttentionPanel?T.indigoLight:"transparent", color:showAttentionPanel?T.indigoDark:T.textMid, fontWeight:700, cursor:"pointer", fontSize:12 }}>
            Needs Attention ({pending.length})
          </button>
          <button onClick={()=>setShowAttentionPanel(false)} style={{ padding:"8px 16px", borderRadius:8, border:"1px solid " + (!showAttentionPanel?T.indigoDark:T.border), background:!showAttentionPanel?T.indigoLight:"transparent", color:!showAttentionPanel?T.indigoDark:T.textMid, fontWeight:700, cursor:"pointer", fontSize:12 }}>
            Full Log
          </button>
        </div>
      </div>

      <div style={{ display:"flex", gap:24, flex:1, minHeight: 0, overflow:"hidden" }}>

        <div style={{ flex: 1, display:"flex", flexDirection:"column", minHeight: 0, overflow:"hidden" }}>
           <div style={{ display:"flex", flexWrap:"wrap", gap:12, marginBottom:16, flexShrink:0, justifyContent:"center" }}>
            {[
              { label:"Auto-Verified",  value:verifications.filter(e=>e.trigger!=="manual").length, color:T.limeDark, bg:T.limeLight,   border:T.limeBorder  },
              { label:"Reschedules",    value:reschedules.length,                                   color:T.red,      bg:T.redLight,    border:T.redBorder   },
              { label:"Outreach",       value:outreach.length,                                      color:T.amberDark,bg:T.amberLight,  border:T.amberBorder },
              { label:"Zero-Touch",     value:verifications.filter(e=>e.trigger!=="manual").length, color:T.rpaDark,  bg:T.rpaLight,    border:T.rpaBorder   },
            ].map(s=>(
              <div key={s.label} style={{ flex:"1 1 140px", maxWidth:200, background:s.bg, border:"1px solid " + s.border, borderRadius:10, padding:"12px 14px", transition:"all 0.2s", cursor:"default", boxShadow:"0 2px 4px rgba(0,0,0,0.04)", overflow:"visible" }}
                onMouseEnter={e=>{ e.currentTarget.style.transform="translateY(-4px)"; e.currentTarget.style.boxShadow="0 12px 24px rgba(0,0,0,0.12)"; e.currentTarget.style.borderColor=s.color; }}
                onMouseLeave={e=>{ e.currentTarget.style.transform="translateY(0)"; e.currentTarget.style.boxShadow="0 2px 4px rgba(0,0,0,0.04)"; e.currentTarget.style.borderColor=s.border; }}>
                <div style={{ color:s.color, fontSize:22, fontWeight:900, lineHeight:1 }}>{s.value}</div>
                <div style={{ color:s.color, fontSize:10, fontWeight:700, marginTop:4, opacity:0.75, whiteSpace:"nowrap" }}>{s.label}</div>
              </div>
            ))}
          </div>

          <div style={{ flex: 1, overflowY: "auto", minHeight: 0, paddingRight: 8, display:"flex", flexDirection:"column", gap:8 }}>
            {displayLog.length===0 && (
              <div style={{ textAlign:"center", color:T.textSoft, fontSize:13, marginTop:60 }}>No activity yet.</div>
            )}
            {displayLog.map(entry=>{
              const cfg = ACfg[entry.action] || ACfg[ACTION.VERIFIED];
              const apptD = entry.appointmentDate ? new Date(entry.appointmentDate+"T12:00:00").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"}) : null;

              return (
                <div key={entry.id} onClick={()=>setFocusedPatientId(entry.patientId)}
                     style={{ background:T.bgCard, border:"1px solid " + (focusedPatientId===entry.patientId ? T.indigo : T.border), borderRadius:12, padding:"12px 16px", display:"flex", alignItems:"center", gap:10, cursor:"pointer", transition:"0.15s", flexShrink: 0 }}
                     onMouseEnter={e=>e.currentTarget.style.borderColor=T.indigo} onMouseLeave={e=>{ if(focusedPatientId!==entry.patientId) e.currentTarget.style.borderColor=T.border; }}>
                  <div style={{ flex:1, minWidth:0, display:"flex", flexDirection:"column" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                      <span style={{ color:T.text, fontSize:13, fontWeight:800 }}>{entry.patient}</span>
                      <Badge label={cfg.label} color={cfg.color} bg={cfg.bg} border={cfg.border} />
                      {entry.rpaEscalated && <Badge label="RPA" color={T.rpaDark} bg={T.rpaLight} border={T.rpaBorder} />}
                      {apptD && <span style={{ color:T.textSoft, fontSize:11 }}>Appt {apptD}</span>}
                    </div>
                    <div style={{ color:T.textMid, fontSize:11, fontWeight:600, marginTop:6, lineHeight:"1.4", wordBreak: "break-word" }}>{entry.reason}</div>
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:6, flexShrink:0 }}>
                    <div style={{ color:T.textSoft, fontSize:10, fontWeight:600 }}>{entry.time}</div>
                    {entry.awaitingApproval && <span style={{ fontSize:10, fontWeight:800, color:T.amberDark }}>In Action Queue &rarr;</span>}
                    {(entry.action===ACTION.APPROVED||entry.action===ACTION.DISMISSED) && <span style={{ fontSize:10, fontWeight:800, color:T.slate }}>{entry.action===ACTION.APPROVED?"Sent":"Dismissed"}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {showAttentionPanel && pending.length > 0 && (
          <div style={{ width: 440, flexShrink: 0, display:"flex", flexDirection:"column", background:T.bgCard, border:"1px solid " + T.border, borderRadius: 12, overflow:"hidden" }}>
             <div style={{ padding:"16px 20px", borderBottom:"1px solid " + T.border, background: T.bg, flexShrink:0 }}>
               <div style={{ fontSize: 16, fontWeight: 900, color: T.text }}>Action Queue</div>
               <div style={{ fontSize: 11, color: T.textSoft, marginTop: 2 }}>Review and approve AI workflows.</div>
             </div>

             <div style={{ flex:1, overflowY:"auto", minHeight: 0, padding:"16px", display:"flex", flexDirection:"column", gap:16 }}>
               {pending.map(entry => {
                  const isReschedule = entry.action === ACTION.RESCHEDULE;
                  return (
                     <div key={entry.id} style={{ border:"1.5px solid " + (isReschedule ? T.redBorder : T.amberBorder), borderRadius: 12, overflow:"hidden", boxShadow: "0 2px 8px rgba(0,0,0,0.04)", display:"flex", flexDirection:"column", flexShrink: 0 }}>
                        <div style={{ background: isReschedule ? T.redLight : T.amberLight, padding:"12px 14px", borderBottom:"1px solid " + (isReschedule ? T.redBorder : T.amberBorder), flexShrink:0 }}>
                          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
                             <span style={{ fontSize:14, fontWeight:900, color:T.text }}>{entry.patient}</span>
                             <span style={{ fontSize:11, fontWeight:800, color: isReschedule ? T.red : T.amberDark }}>{isReschedule ? "Reschedule Proposal" : "Courtesy Call"}</span>
                          </div>
                          <div style={{ fontSize:11, color:T.textMid }}>Appt: {new Date(entry.appointmentDate+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})} &middot; {entry.procedure}</div>
                        </div>

                        <div style={{ padding:"14px", display:"flex", flexDirection:"column" }}>
                           {(entry.blockReasons || entry.notifyReasons || []).map((r,i) => (
                             <div key={i} style={{ display:"flex", gap:8, marginBottom:8 }}>
                               <span style={{ color: isReschedule ? T.red : T.amberDark, fontSize:14 }}>•</span>
                               <span style={{ color:T.textMid, fontSize:12, fontWeight:600, lineHeight:"1.4" }}>{r}</span>
                             </div>
                           ))}

                           <div style={{ background:T.bg, border:"1px solid " + T.border, borderRadius:8, padding:"12px", margin:"8px 0" }}>
                             <div style={{ color:T.textSoft, fontSize:10, fontWeight:900, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>AI SMS Draft</div>
                             <div style={{ color:T.textMid, fontSize:13, lineHeight:"1.5", whiteSpace: "normal" }}>"{entry.draftMessage}"</div>
                           </div>

                           <div style={{ display:"flex", gap:10, marginTop: 8, flexWrap:"wrap" }}>
                             <button onClick={()=>{ onApprove(entry); showToast("Message Sent!"); }} style={{ flex: "1 1 140px", padding:"12px 10px", borderRadius:8, border:"none", background:T.indigoDark, color:"#fff", fontWeight:800, cursor:"pointer", fontSize:12 }}>
                               {isReschedule ? "Approve & Send" : "Send Outreach"}
                             </button>
                             <button onClick={()=>{ onDismiss(entry); showToast("Removed from queue."); }} style={{ flex: "1 1 140px", padding:"12px 10px", borderRadius:8, border:"1px solid " + T.borderStrong, background:T.bgCard, color:T.textMid, fontWeight:800, cursor:"pointer", fontSize:12 }}>
                               I'll Handle It
                             </button>
                           </div>
                        </div>
                     </div>
                  )
               })}
             </div>
          </div>
        )}

        {/* ── Patient detail panel ── */}
        {focusedPatientId && (
          <div style={{ width: 400, flexShrink: 0, display:"flex", flexDirection:"column", background:T.bgCard, border:"1px solid " + T.border, borderRadius:12, overflow:"hidden" }}>
            <div style={{ padding:"14px 18px", borderBottom:"1px solid " + T.border, display:"flex", justifyContent:"space-between", alignItems:"center", background:T.bg, flexShrink:0 }}>
              <div style={{ fontSize:14, fontWeight:900, color:T.text }}>Patient Details</div>
              <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                <button onClick={()=>{ onSelectPatient({id:focusedPatientId}); }} style={{ fontSize:11, fontWeight:800, color:T.indigoDark, background:T.indigoLight, border:"1px solid " + T.indigoBorder, borderRadius:6, padding:"4px 10px", cursor:"pointer" }}>
                  Go to Schedule →
                </button>
                <button onClick={()=>setFocusedPatientId(null)} style={{ background:"none", border:"none", fontSize:20, color:T.textSoft, cursor:"pointer", lineHeight:1 }}>&times;</button>
              </div>
            </div>
            <div style={{ flex:1, overflowY:"auto" }}>
              <BenefitsPanel
                patient={{ id: focusedPatientId, name: log.find(e=>e.patientId===focusedPatientId)?.patient || focusedPatientId }}
                result={results?.[focusedPatientId] || null}
                phaseInfo={null}
                onVerify={()=>{}}
                triage={triageMap?.[focusedPatientId] || null}
                showToast={showToast}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Analytics({ patients, results, agentLog }) {
  const [selectedMonthIdx, setSelectedMonthIdx] = useState(5);
  const [hoveredBarIdx, setHoveredBarIdx]       = useState(null);
  const [showRevenueModal, setShowRevenueModal] = useState(false);
  const [showClaimModal,   setShowClaimModal]   = useState(false);

  const verifiedIds = Object.keys(results);
  const totalVerified = verifiedIds.length;
  // Deduplicate by patient ID — agentLog can have multiple entries per patient
  const autoVerifiedPatientIds = new Set(
    agentLog
      .filter(e => e.action === ACTION.VERIFIED && e.trigger !== "manual")
      .map(e => e.patientId)
      .filter(Boolean)
  );
  const autoVerifiedCount = autoVerifiedPatientIds.size;
  const autoRate = totalVerified > 0 ? Math.round((autoVerifiedCount / totalVerified) * 100) : 0;
  const timeSavedHours = ((autoVerifiedCount * 12) / 60).toFixed(1);

  let totalRevenue = 0, revenueProtected = 0, revenueAtRisk = 0;
  patients.forEach(p => {
    const fee = p.fee || 0;
    totalRevenue += fee;
    const res = results[p.id];
    if (!res || res.verification_status !== STATUS.VERIFIED) revenueAtRisk += fee;
    else revenueProtected += fee;
  });
  const protectedPct = totalRevenue > 0 ? Math.round((revenueProtected / totalRevenue) * 100) : 0;

  const HISTORICAL_REV = [
    { month:"Sep", ins:38000, cash:12000, verifs:290,
      procedures:[{name:"Crown",rev:14000},{name:"Implant",rev:11000},{name:"Prophy",rev:8000},{name:"Root Canal",rev:5000}],
      byInsurance:[{name:"Delta Dental",rev:22000},{name:"Cigna",rev:11000},{name:"Aetna",rev:9000},{name:"Cash",rev:8000}],
      kpis:[{n:"Delta Dental PPO",r:91},{n:"Aetna DMO",r:88},{n:"Cigna Dental",r:82},{n:"UnitedHealthcare",r:78},{n:"MetLife",r:74}] },
    { month:"Oct", ins:42000, cash:13500, verifs:310,
      procedures:[{name:"Crown",rev:16000},{name:"Implant",rev:12000},{name:"Prophy",rev:9000},{name:"Root Canal",rev:6000}],
      byInsurance:[{name:"Delta Dental",rev:24000},{name:"Cigna",rev:12000},{name:"Aetna",rev:9000},{name:"Cash",rev:10000}],
      kpis:[{n:"Delta Dental PPO",r:92},{n:"Aetna DMO",r:89},{n:"Cigna Dental",r:83},{n:"UnitedHealthcare",r:79},{n:"MetLife",r:75}] },
    { month:"Nov", ins:45000, cash:12800, verifs:315,
      procedures:[{name:"Crown",rev:17000},{name:"Implant",rev:14000},{name:"Prophy",rev:9500},{name:"Root Canal",rev:7000}],
      byInsurance:[{name:"Delta Dental",rev:26000},{name:"Cigna",rev:12000},{name:"Aetna",rev:10000},{name:"Cash",rev:9800}],
      kpis:[{n:"Delta Dental PPO",r:93},{n:"Aetna DMO",r:90},{n:"Cigna Dental",r:84},{n:"UnitedHealthcare",r:80},{n:"MetLife",r:75}] },
    { month:"Dec", ins:41000, cash:16000, verifs:285,
      procedures:[{name:"Implant",rev:15000},{name:"Crown",rev:14000},{name:"Prophy",rev:8000},{name:"Composite",rev:5000}],
      byInsurance:[{name:"Delta Dental",rev:22000},{name:"Cigna",rev:11000},{name:"Cash",rev:14000},{name:"Aetna",rev:9000}],
      kpis:[{n:"Delta Dental PPO",r:93},{n:"Aetna DMO",r:88},{n:"Cigna Dental",r:84},{n:"UnitedHealthcare",r:81},{n:"MetLife",r:77}] },
    { month:"Jan", ins:51000, cash:14000, verifs:350,
      procedures:[{name:"Implant",rev:18000},{name:"Crown",rev:16000},{name:"Prophy",rev:10000},{name:"Root Canal",rev:8000}],
      byInsurance:[{name:"Delta Dental",rev:28000},{name:"Cigna",rev:14000},{name:"Aetna",rev:11000},{name:"Cash",rev:12000}],
      kpis:[{n:"Delta Dental PPO",r:94},{n:"Aetna DMO",r:90},{n:"Cigna Dental",r:85},{n:"UnitedHealthcare",r:82},{n:"MetLife",r:76}] },
    { month:"Feb", ins:Math.round(revenueProtected/100)+48000, cash:Math.round(revenueAtRisk/100)+12000, verifs:342,
      procedures:[{name:"Implant",rev:19000},{name:"Crown",rev:17000},{name:"Perio SRP",rev:11000},{name:"Root Canal",rev:9000}],
      byInsurance:[{name:"Delta Dental",rev:30000},{name:"Cigna",rev:14000},{name:"Aetna",rev:11000},{name:"Cash",rev:Math.round(revenueAtRisk/100)+6000}],
      kpis:[{n:"Delta Dental PPO",r:96},{n:"Aetna DMO",r:92},{n:"Cigna Dental",r:87},{n:"UnitedHealthcare",r:85},{n:"MetLife",r:81}] },
  ];

  const currentMonthData = HISTORICAL_REV[selectedMonthIdx];
  const monthlyTotalRev  = currentMonthData.ins + currentMonthData.cash;
  const CARRIER_KPIS     = currentMonthData.kpis;

  const getRating = (r) => r >= 90
    ? { l:"Excellent",     c:T.limeDark, bg:T.limeLight,   border:T.limeBorder   }
    : r >= 80
    ? { l:"Good",          c:T.indigo,   bg:T.indigoLight, border:T.indigoBorder }
    : { l:"Review Needed", c:T.red,      bg:T.redLight,    border:T.redBorder    };

  const flagsCount = {};
  Object.values(results).forEach(r => {
    if (!r) return;
    (r.action_flags || []).forEach(f => {
      if (f === "thin_data") return;
      const cleanName = f.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
      flagsCount[cleanName] = (flagsCount[cleanName] || 0) + 1;
    });
  });
  const sortedFlags = Object.entries(flagsCount).sort((a,b) => b[1] - a[1]);

  // ── CSV Export ────────────────────────────────────────────────────────────────
  const handleExport = () => {
    const rows = [
      ["Month","Insurance Revenue","Cash Revenue","Total Revenue","Verifications"],
      ...HISTORICAL_REV.map(d => [d.month, d.ins, d.cash, d.ins+d.cash, d.verifs]),
      [],
      [`${currentMonthData.month} — Revenue by Procedure`],
      ["Procedure","Revenue"],
      ...currentMonthData.procedures.map(p => [p.name, p.rev]),
      [],
      [`${currentMonthData.month} — Revenue by Insurance`],
      ["Insurance / Payer","Revenue"],
      ...currentMonthData.byInsurance.map(b => [b.name, b.rev]),
    ];
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type:"text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = `levelai_revenue_${currentMonthData.month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Stat card hover style helper ─────────────────────────────────────────────
  const statCardHover = {
    onMouseEnter: e => { e.currentTarget.style.transform="translateY(-3px)"; e.currentTarget.style.boxShadow="0 10px 24px rgba(0,0,0,0.1)"; },
    onMouseLeave: e => { e.currentTarget.style.transform="translateY(0)";    e.currentTarget.style.boxShadow="0 2px 4px rgba(0,0,0,0.04)"; },
  };

  return (
    <div style={{ padding:24, height:"100%", overflowY:"auto", display:"flex", flexDirection:"column", gap:20 }}>

      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
        <div>
          <div style={{ color:T.text, fontSize:20, fontWeight:900 }}>Analytics Overview</div>
          <div style={{ color:T.textSoft, fontSize:12, marginTop:2 }}>Click a bar to select a month · Click Total Revenue for breakdown</div>
        </div>
        <button onClick={handleExport}
                style={{ padding:"9px 18px", borderRadius:8, border:"1px solid "+T.border, background:T.bgCard, color:T.text, fontWeight:800, fontSize:12, cursor:"pointer", display:"flex", alignItems:"center", gap:6, transition:"all 0.15s" }}
                onMouseEnter={e=>{ e.currentTarget.style.background=T.indigoDark; e.currentTarget.style.color="white"; e.currentTarget.style.borderColor=T.indigoDark; }}
                onMouseLeave={e=>{ e.currentTarget.style.background=T.bgCard; e.currentTarget.style.color=T.text; e.currentTarget.style.borderColor=T.border; }}>
          ⬇ Export CSV
        </button>
      </div>

      {/* Stat cards — top row */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(220px, 1fr))", gap:16 }}>
        {/* Total Revenue — clickable, opens breakdown modal */}
        <div onClick={() => setShowRevenueModal(true)}
             style={{ background:T.indigoDark, color:"white", borderRadius:12, padding:"16px 20px", display:"flex", flexDirection:"column", gap:4, boxShadow:"0 4px 12px rgba(49,46,129,0.2)", cursor:"pointer", transition:"all 0.2s" }}
             onMouseEnter={e=>{ e.currentTarget.style.transform="translateY(-3px)"; e.currentTarget.style.boxShadow="0 12px 28px rgba(49,46,129,0.35)"; }}
             onMouseLeave={e=>{ e.currentTarget.style.transform="translateY(0)";    e.currentTarget.style.boxShadow="0 4px 12px rgba(49,46,129,0.2)"; }}>
          <div style={{ fontSize:11, fontWeight:800, textTransform:"uppercase", letterSpacing:"0.05em", opacity:0.8 }}>Total Revenue ({currentMonthData.month}) ↗</div>
          <div style={{ fontSize:28, fontWeight:900 }}>{wholeDollars(monthlyTotalRev)}</div>
          <div style={{ fontSize:11, fontWeight:600, opacity:0.75 }}>Click to see breakdown</div>
        </div>
        <div style={{ background:T.bgCard, border:"1px solid "+T.border, borderRadius:12, padding:"16px 20px", display:"flex", flexDirection:"column", gap:4, transition:"all 0.2s", boxShadow:"0 2px 4px rgba(0,0,0,0.04)" }} {...statCardHover}>
          <div style={{ fontSize:11, fontWeight:800, textTransform:"uppercase", letterSpacing:"0.05em", color:T.textSoft }}>Insurance Payouts</div>
          <div style={{ fontSize:28, fontWeight:900, color:T.indigo }}>{wholeDollars(currentMonthData.ins)}</div>
          <div style={{ fontSize:11, fontWeight:700, color:T.textMid }}>{Math.round((currentMonthData.ins/monthlyTotalRev)*100)}% of monthly revenue</div>
        </div>
        <div style={{ background:T.bgCard, border:"1px solid "+T.border, borderRadius:12, padding:"16px 20px", display:"flex", flexDirection:"column", gap:4, transition:"all 0.2s", boxShadow:"0 2px 4px rgba(0,0,0,0.04)" }} {...statCardHover}>
          <div style={{ fontSize:11, fontWeight:800, textTransform:"uppercase", letterSpacing:"0.05em", color:T.textSoft }}>Cash / Out-of-Pocket</div>
          <div style={{ fontSize:28, fontWeight:900, color:T.limeDark }}>{wholeDollars(currentMonthData.cash)}</div>
          <div style={{ fontSize:11, fontWeight:700, color:T.textMid }}>{Math.round((currentMonthData.cash/monthlyTotalRev)*100)}% of monthly revenue</div>
        </div>
        <div style={{ background:T.bgCard, border:"1px solid "+T.border, borderRadius:12, padding:"16px 20px", display:"flex", flexDirection:"column", gap:4, transition:"all 0.2s", boxShadow:"0 2px 4px rgba(0,0,0,0.04)" }} {...statCardHover}>
          <div style={{ fontSize:11, fontWeight:800, textTransform:"uppercase", letterSpacing:"0.05em", color:T.textSoft }}>Verifications in {currentMonthData.month}</div>
          <div style={{ fontSize:28, fontWeight:900, color:T.text }}>{currentMonthData.verifs}</div>
          <div style={{ fontSize:11, fontWeight:700, color:T.textMid }}>Volume across all providers</div>
        </div>
      </div>

      {/* KPI cards */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(300px, 1fr))", gap:16 }}>
        <div onClick={() => setShowClaimModal(true)}
             style={{ background:T.bgCard, border:"1px solid "+T.border, borderRadius:12, padding:"16px 20px", display:"flex", flexDirection:"column", gap:8, transition:"all 0.2s", boxShadow:"0 2px 4px rgba(0,0,0,0.04)", cursor:"pointer" }}
             onMouseEnter={e=>{ e.currentTarget.style.transform="translateY(-3px)"; e.currentTarget.style.boxShadow="0 10px 24px rgba(0,0,0,0.1)"; e.currentTarget.style.borderColor=T.limeBorder; }}
             onMouseLeave={e=>{ e.currentTarget.style.transform="translateY(0)"; e.currentTarget.style.boxShadow="0 2px 4px rgba(0,0,0,0.04)"; e.currentTarget.style.borderColor=T.border; }}>
          <div style={{ color:T.textSoft, fontSize:11, fontWeight:800, textTransform:"uppercase", letterSpacing:"0.05em" }}>Clean Claim Rate — Today&apos;s Roster ↗</div>
          <div style={{ display:"flex", alignItems:"baseline", gap:8 }}>
            <span style={{ fontSize:32, fontWeight:900, color:T.limeDark, lineHeight:1 }}>{protectedPct}%</span>
            <span style={{ fontSize:13, fontWeight:700, color:T.textMid }}>Protected</span>
          </div>
          <div style={{ height:6, width:"100%", background:T.redLight, borderRadius:3, overflow:"hidden" }}>
            <div style={{ height:"100%", width:`${protectedPct}%`, background:T.lime }} />
          </div>
          <div style={{ fontSize:11, color:T.textSoft, fontWeight:600, marginTop:4 }}>
            {dollars(revenueProtected)} cleared · {dollars(revenueAtRisk)} at risk
          </div>
        </div>
        <div style={{ background:T.bgCard, border:"1px solid "+T.border, borderRadius:12, padding:"16px 20px", display:"flex", flexDirection:"column", gap:8, transition:"all 0.2s", boxShadow:"0 2px 4px rgba(0,0,0,0.04)" }} {...statCardHover}>
          <div style={{ color:T.textSoft, fontSize:11, fontWeight:800, textTransform:"uppercase", letterSpacing:"0.05em" }}>Automation Rate</div>
          <div style={{ display:"flex", alignItems:"baseline", gap:8 }}>
            <span style={{ fontSize:32, fontWeight:900, color:T.indigo, lineHeight:1 }}>{autoRate}%</span>
            <span style={{ fontSize:13, fontWeight:700, color:T.textMid }}>Zero-touch</span>
          </div>
          <div style={{ fontSize:12, color:T.text, fontWeight:700, marginTop:4 }}>
            {autoVerifiedCount} of {totalVerified} verified automatically
          </div>
        </div>
        <div style={{ background:T.bgCard, border:"1px solid "+T.border, borderRadius:12, padding:"16px 20px", display:"flex", flexDirection:"column", gap:8, transition:"all 0.2s", boxShadow:"0 2px 4px rgba(0,0,0,0.04)" }} {...statCardHover}>
          <div style={{ color:T.textSoft, fontSize:11, fontWeight:800, textTransform:"uppercase", letterSpacing:"0.05em" }}>Staff Time Saved</div>
          <div style={{ display:"flex", alignItems:"baseline", gap:8 }}>
            <span style={{ fontSize:32, fontWeight:900, color:T.rpaDark, lineHeight:1 }}>{timeSavedHours}h</span>
            <span style={{ fontSize:13, fontWeight:700, color:T.textMid }}>Recovered</span>
          </div>
          <div style={{ fontSize:12, color:T.text, fontWeight:700, marginTop:4 }}>
            ~12 min saved per auto-verification
          </div>
        </div>
      </div>

      {/* Revenue chart */}
      <div style={{ background:T.bgCard, border:"1px solid "+T.border, borderRadius:12, padding:"16px 20px" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end", marginBottom:16 }}>
          <div style={{ color:T.text, fontSize:14, fontWeight:900 }}>Revenue Generation — Cash vs. Insurance</div>
          <div style={{ display:"flex", gap:12 }}>
            <div style={{ display:"flex", alignItems:"center", gap:6, fontSize:11, fontWeight:700, color:T.textMid }}>
              <span style={{ width:10, height:10, borderRadius:2, background:T.indigo }} /> Insurance
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:6, fontSize:11, fontWeight:700, color:T.textMid }}>
              <span style={{ width:10, height:10, borderRadius:2, background:T.lime }} /> Cash / OOP
            </div>
          </div>
        </div>

        <div style={{ display:"flex", alignItems:"flex-end", height:200, gap:12, paddingTop:10, borderBottom:"1px solid "+T.borderStrong }}>
          {HISTORICAL_REV.map((d, i) => {
            const maxH = 80000;
            const insPct  = (d.ins  / maxH) * 100;
            const cashPct = (d.cash / maxH) * 100;
            const isSelected = selectedMonthIdx === i;
            const isHovered  = hoveredBarIdx === i;
            return (
              <div key={i}
                onClick={() => setSelectedMonthIdx(i)}
                onMouseEnter={() => setHoveredBarIdx(i)}
                onMouseLeave={() => setHoveredBarIdx(null)}
                style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center",
                  justifyContent:"flex-end", height:"100%", gap:6, cursor:"pointer",
                  transition:"all 0.2s",
                  transform: isSelected ? "translateY(-6px) scale(1.04)" : isHovered ? "translateY(-3px)" : "none",
                  opacity: isSelected ? 1 : isHovered ? 0.85 : 0.55 }}>
                <div style={{ color: isSelected ? T.text : T.textSoft, fontSize:10, fontWeight:800, transition:"0.2s" }}>
                  ${((d.ins+d.cash)/1000).toFixed(1)}k
                </div>
                <div style={{ width:"100%", maxWidth:52, display:"flex", flexDirection:"column", justifyContent:"flex-end", height:"100%",
                  borderRadius: isSelected||isHovered ? "6px 6px 0 0" : "4px 4px 0 0",
                  overflow:"hidden", boxShadow: isSelected ? "0 -4px 12px rgba(99,102,241,0.3)" : "none", transition:"all 0.2s" }}>
                  <div style={{ height:`${cashPct}%`, background:T.lime, borderBottom:"2px solid white" }} />
                  <div style={{ height:`${insPct}%`, background:T.indigo }} />
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ display:"flex", alignItems:"flex-start", gap:12, marginTop:8 }}>
          {HISTORICAL_REV.map((d, i) => (
            <div key={i} style={{ flex:1, textAlign:"center", fontSize:11, fontWeight:800,
              color: selectedMonthIdx===i ? T.indigoDark : T.textSoft, transition:"0.2s",
              cursor:"pointer" }} onClick={() => setSelectedMonthIdx(i)}>
              {d.month}
            </div>
          ))}
        </div>
      </div>

      {/* Bottom grid */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
        <div style={{ background:T.bgCard, border:"1px solid "+T.border, borderRadius:12, padding:"16px 20px" }}>
          <div style={{ color:T.text, fontSize:14, fontWeight:900, marginBottom:16 }}>Carrier Payout Rates ({currentMonthData.month})</div>
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            {CARRIER_KPIS.map((carrier, idx) => {
              const rating = getRating(carrier.r);
              return (
                <div key={idx} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", paddingBottom:10, borderBottom:idx<4?"1px solid "+T.border:"none" }}>
                  <span style={{ fontSize:13, fontWeight:800, color:T.text }}>{carrier.n}</span>
                  <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                    <span style={{ fontSize:14, fontWeight:900, color:rating.c }}>{carrier.r}%</span>
                    <Badge label={rating.l} color={rating.c} bg={rating.bg} border={rating.border} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ background:T.bgCard, border:"1px solid "+T.border, borderRadius:12, padding:"16px 20px" }}>
          <div style={{ color:T.text, fontSize:14, fontWeight:900, marginBottom:16 }}>Top Denial Risks Caught</div>
          {sortedFlags.length === 0 ? (
            <div style={{ textAlign:"center", padding:"30px 0", color:T.textSoft, fontSize:12, fontWeight:600 }}>No flags detected yet.</div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              {sortedFlags.map(([flagName, count], idx) => {
                const max = sortedFlags[0][1];
                return (
                  <div key={idx}>
                    <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, fontWeight:700, color:T.textMid, marginBottom:4 }}>
                      <span>{flagName}</span><span>{count}</span>
                    </div>
                    <div style={{ height:8, width:"100%", background:T.amberLight, borderRadius:4, overflow:"hidden" }}>
                      <div style={{ height:"100%", width:`${(count/max)*100}%`, background:T.amber, borderRadius:4 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Revenue Breakdown Modal ──────────────────────────────────────────── */}
      {showRevenueModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:9999,
          display:"flex", alignItems:"center", justifyContent:"center" }}
          onClick={() => setShowRevenueModal(false)}>
          <div style={{ background:T.bgCard, width:"90%", maxWidth:580, borderRadius:16,
            overflow:"hidden", maxHeight:"88vh", display:"flex", flexDirection:"column" }}
            onClick={e => e.stopPropagation()}>

            {/* Modal header */}
            <div style={{ padding:"20px 24px", borderBottom:"1px solid "+T.border, background:T.indigoDark, color:"white",
              display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div>
                <div style={{ fontSize:18, fontWeight:900 }}>{currentMonthData.month} Revenue Breakdown</div>
                <div style={{ fontSize:12, opacity:0.75, marginTop:2 }}>Total: {wholeDollars(monthlyTotalRev)}</div>
              </div>
              <div style={{ display:"flex", gap:10, alignItems:"center" }}>
                <button onClick={handleExport}
                        style={{ padding:"7px 14px", borderRadius:7, border:"1px solid rgba(255,255,255,0.3)", background:"rgba(255,255,255,0.15)", color:"white", fontWeight:800, fontSize:11, cursor:"pointer" }}>
                  ⬇ Export CSV
                </button>
                <button onClick={() => setShowRevenueModal(false)}
                        style={{ background:"transparent", border:"none", color:"white", fontSize:24, cursor:"pointer", lineHeight:1 }}>&times;</button>
              </div>
            </div>

            <div style={{ flex:1, overflowY:"auto", padding:24, display:"flex", flexDirection:"column", gap:24 }}>

              {/* By procedure */}
              <div>
                <div style={{ fontSize:13, fontWeight:900, color:T.text, marginBottom:12 }}>Revenue by Procedure Type</div>
                <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                  {currentMonthData.procedures.map((p, i) => {
                    const pct = Math.round((p.rev / monthlyTotalRev) * 100);
                    return (
                      <div key={i}>
                        <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, fontWeight:700, color:T.textMid, marginBottom:5 }}>
                          <span>{p.name}</span>
                          <span style={{ color:T.text, fontWeight:900 }}>{wholeDollars(p.rev)} <span style={{ color:T.textSoft, fontWeight:600 }}>({pct}%)</span></span>
                        </div>
                        <div style={{ height:10, background:T.indigoLight, borderRadius:5, overflow:"hidden" }}>
                          <div style={{ height:"100%", width:`${pct}%`, background:T.indigoDark, borderRadius:5, transition:"width 0.4s" }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* By insurance */}
              <div>
                <div style={{ fontSize:13, fontWeight:900, color:T.text, marginBottom:12 }}>Revenue by Insurance / Payer</div>
                <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                  {currentMonthData.byInsurance.map((b, i) => {
                    const pct = Math.round((b.rev / monthlyTotalRev) * 100);
                    const barColor = b.name === "Cash" ? T.lime : T.indigo;
                    const barBg    = b.name === "Cash" ? T.limeLight : T.indigoLight;
                    return (
                      <div key={i}>
                        <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, fontWeight:700, color:T.textMid, marginBottom:5 }}>
                          <span>{b.name}</span>
                          <span style={{ color:T.text, fontWeight:900 }}>{wholeDollars(b.rev)} <span style={{ color:T.textSoft, fontWeight:600 }}>({pct}%)</span></span>
                        </div>
                        <div style={{ height:10, background:barBg, borderRadius:5, overflow:"hidden" }}>
                          <div style={{ height:"100%", width:`${pct}%`, background:barColor, borderRadius:5, transition:"width 0.4s" }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Summary table */}
              <div style={{ background:T.bg, borderRadius:10, border:"1px solid "+T.border, overflow:"hidden" }}>
                {[
                  { label:"Insurance Total",   val:wholeDollars(currentMonthData.ins),  color:T.indigo   },
                  { label:"Cash / OOP Total",  val:wholeDollars(currentMonthData.cash), color:T.limeDark },
                  { label:"Total Revenue",     val:wholeDollars(monthlyTotalRev),        color:T.text, bold:true },
                  { label:"Verifications Run", val:currentMonthData.verifs,              color:T.textMid  },
                ].map((row, i, arr) => (
                  <div key={i} style={{ display:"flex", justifyContent:"space-between", padding:"10px 16px",
                    borderBottom: i<arr.length-1 ? "1px solid "+T.border : "none",
                    background: row.bold ? T.indigoLight : "transparent" }}>
                    <span style={{ fontSize:12, fontWeight:700, color:T.textMid }}>{row.label}</span>
                    <span style={{ fontSize:13, fontWeight:row.bold?900:700, color:row.color }}>{row.val}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Clean Claim Rate Drilldown Modal ─────────────────────────────────── */}
      {showClaimModal && (() => {
        // Classify each patient
        const atRisk    = patients.filter(p => !results[p.id] || results[p.id]?.verification_status !== STATUS.VERIFIED);
        const cleared   = patients.filter(p => results[p.id]?.verification_status === STATUS.VERIFIED);

        // Gather all distinct flags across at-risk patients
        const allFlags = {};
        atRisk.forEach(p => {
          (results[p.id]?.action_flags || []).filter(f => f !== "thin_data").forEach(f => {
            allFlags[f] = (allFlags[f] || 0) + 1;
          });
        });

        // AI-style risk narrative — built from real data
        const topFlag = Object.entries(allFlags).sort((a,b) => b[1]-a[1])[0];
        const unverifiedCount = patients.filter(p => !results[p.id]).length;
        const flaggedCount    = patients.filter(p => results[p.id] && results[p.id].verification_status !== STATUS.VERIFIED).length;

        const narrativeParts = [];
        if (unverifiedCount > 0)
          narrativeParts.push(`${unverifiedCount} patient${unverifiedCount>1?"s":""} have not been verified yet — run eligibility checks to clear.`);
        if (flaggedCount > 0)
          narrativeParts.push(`${flaggedCount} patient${flaggedCount>1?"s":""} returned flags after verification.`);
        if (topFlag)
          narrativeParts.push(`Most common issue: "${topFlag[0].replace(/_/g," ")}" (${topFlag[1]} occurrence${topFlag[1]>1?"s":""}) — review coverage details before treatment.`);
        if (revenueAtRisk > 0)
          narrativeParts.push(`${dollars(revenueAtRisk)} in estimated fees is currently at risk of partial denial or patient non-payment.`);
        if (cleared.length === patients.length)
          narrativeParts.push("All patients on today's roster are verified and cleared. Excellent clean claim rate.");

        const narrative = narrativeParts.length > 0 ? narrativeParts.join(" ") : "No eligibility issues detected for today's roster.";

        const getRiskLabel = (p) => {
          const r = results[p.id];
          if (!r) return { label:"Unverified", color:T.slate, bg:T.slateLight, border:T.border };
          if (r.verification_status === STATUS.VERIFIED && !(r.action_flags||[]).filter(f=>f!=="thin_data").length)
            return { label:"Cleared", color:T.limeDark, bg:T.limeLight, border:T.limeBorder };
          if (r.verification_status === STATUS.VERIFIED)
            return { label:"Verified w/ Flags", color:T.amberDark, bg:T.amberLight, border:T.amberBorder };
          return { label:"At Risk", color:T.red, bg:T.redLight, border:T.redBorder };
        };

        return (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:9999,
            display:"flex", alignItems:"center", justifyContent:"center" }}
            onClick={() => setShowClaimModal(false)}>
            <div style={{ background:T.bgCard, width:"92%", maxWidth:640, borderRadius:16,
              overflow:"hidden", maxHeight:"90vh", display:"flex", flexDirection:"column" }}
              onClick={e => e.stopPropagation()}>

              {/* Header */}
              <div style={{ padding:"20px 24px", borderBottom:"1px solid "+T.border,
                background: protectedPct >= 80 ? T.limeDark : T.red,
                color:"white", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div>
                  <div style={{ fontSize:18, fontWeight:900 }}>Clean Claim Rate — Today&apos;s Roster</div>
                  <div style={{ fontSize:12, opacity:0.8, marginTop:2 }}>
                    {cleared.length} of {patients.length} patients cleared · {protectedPct}% protected
                  </div>
                </div>
                <button onClick={() => setShowClaimModal(false)}
                  style={{ background:"transparent", border:"none", color:"white", fontSize:24, cursor:"pointer", lineHeight:1 }}>&times;</button>
              </div>

              <div style={{ flex:1, overflowY:"auto", padding:24, display:"flex", flexDirection:"column", gap:20 }}>

                {/* AI Risk Summary */}
                <div style={{ background:T.indigoLight, border:"1px solid "+T.indigoBorder, borderRadius:12, padding:"16px 18px" }}>
                  <div style={{ fontSize:11, fontWeight:800, color:T.indigo, textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:8 }}>
                    AI Risk Summary
                  </div>
                  <div style={{ fontSize:13, color:T.text, lineHeight:1.7, fontWeight:500 }}>
                    {narrative}
                  </div>
                </div>

                {/* Revenue snapshot */}
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                  <div style={{ background:T.limeLight, border:"1px solid "+T.limeBorder, borderRadius:10, padding:"14px 16px" }}>
                    <div style={{ fontSize:11, fontWeight:800, color:T.limeDark, textTransform:"uppercase", letterSpacing:"0.05em" }}>Revenue Cleared</div>
                    <div style={{ fontSize:24, fontWeight:900, color:T.limeDark, marginTop:4 }}>{dollars(revenueProtected)}</div>
                    <div style={{ fontSize:11, color:T.textSoft, marginTop:2 }}>{cleared.length} patient{cleared.length!==1?"s":""}</div>
                  </div>
                  <div style={{ background:T.redLight, border:"1px solid "+T.redBorder, borderRadius:10, padding:"14px 16px" }}>
                    <div style={{ fontSize:11, fontWeight:800, color:T.red, textTransform:"uppercase", letterSpacing:"0.05em" }}>Revenue At Risk</div>
                    <div style={{ fontSize:24, fontWeight:900, color:T.red, marginTop:4 }}>{dollars(revenueAtRisk)}</div>
                    <div style={{ fontSize:11, color:T.textSoft, marginTop:2 }}>{atRisk.length} patient{atRisk.length!==1?"s":""}</div>
                  </div>
                </div>

                {/* Per-patient breakdown */}
                <div>
                  <div style={{ fontSize:13, fontWeight:900, color:T.text, marginBottom:10 }}>Patient Breakdown</div>
                  <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                    {patients.map(p => {
                      const risk = getRiskLabel(p);
                      const r    = results[p.id];
                      const flags = (r?.action_flags || []).filter(f => f !== "thin_data");
                      return (
                        <div key={p.id} style={{ display:"flex", alignItems:"center", gap:12,
                          background:T.bg, border:"1px solid "+T.border, borderRadius:10,
                          padding:"12px 14px" }}>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontSize:13, fontWeight:800, color:T.text }}>{p.name}</div>
                            <div style={{ fontSize:11, color:T.textSoft, marginTop:2 }}>
                              {p.insurance || "No insurance"} · {p.procedure || ""}
                            </div>
                            {flags.length > 0 && (
                              <div style={{ display:"flex", flexWrap:"wrap", gap:4, marginTop:6 }}>
                                {flags.map((f,i) => (
                                  <span key={i} style={{ fontSize:10, fontWeight:700, color:T.amberDark,
                                    background:T.amberLight, border:"1px solid "+T.amberBorder,
                                    borderRadius:4, padding:"2px 7px" }}>
                                    {f.replace(/_/g," ")}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                          <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:4, flexShrink:0 }}>
                            <span style={{ fontSize:11, fontWeight:800, color:risk.color,
                              background:risk.bg, border:"1px solid "+risk.border,
                              borderRadius:6, padding:"3px 10px" }}>
                              {risk.label}
                            </span>
                            {p.fee ? (
                              <span style={{ fontSize:11, fontWeight:700, color:T.textMid }}>
                                {dollars(p.fee)}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Common flags summary */}
                {Object.keys(allFlags).length > 0 && (
                  <div>
                    <div style={{ fontSize:13, fontWeight:900, color:T.text, marginBottom:10 }}>Flag Breakdown</div>
                    <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                      {Object.entries(allFlags).sort((a,b)=>b[1]-a[1]).map(([flag, count], i) => (
                        <div key={i} style={{ display:"flex", alignItems:"center", gap:12 }}>
                          <div style={{ flex:1, fontSize:12, fontWeight:700, color:T.text, textTransform:"capitalize" }}>
                            {flag.replace(/_/g," ")}
                          </div>
                          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                            <div style={{ width:80, height:6, background:T.redLight, borderRadius:3, overflow:"hidden" }}>
                              <div style={{ height:"100%", width:`${(count/atRisk.length)*100}%`, background:T.red, borderRadius:3 }} />
                            </div>
                            <span style={{ fontSize:11, fontWeight:800, color:T.red, minWidth:20, textAlign:"right" }}>{count}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// SInput — Settings form input with inline validation (hoisted to module level
// so it never gets re-created inside Settings render, which would reset hooks).
// validate: fn(v)→string|null  OR  a VALIDATORS key string ("email","npi",etc.)
const SInput = ({ label, type = "text", placeholder, value, onChange, validate, required }) => {
  const [touched, setTouched] = useState(false);
  const validatorFn = typeof validate === "string" ? VALIDATORS[validate] : validate;
  const inlineErr = touched && validatorFn ? validatorFn(value || "") : null;
  const reqErr    = touched && required && !value?.trim() ? "This field is required" : null;
  const showErr   = inlineErr || reqErr;
  const borderColor = showErr ? "#ef4444" : touched && !showErr && value ? "#16a34a" : T.border;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 11, fontWeight: 800, color: T.textMid, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}{required && <span style={{ color:"#ef4444", marginLeft:3 }}>*</span>}
      </label>
      <input type={type} placeholder={placeholder} value={value} onChange={onChange}
        style={{ padding: "11px 14px", border: "1.5px solid " + borderColor, borderRadius: 8, fontSize: 14,
          background: showErr ? "#fef2f2" : T.bgCard, outline: "none", color: T.text, fontFamily: "inherit",
          width: "100%", transition: "border-color 0.2s, box-shadow 0.2s",
          boxShadow: showErr ? "0 0 0 3px rgba(239,68,68,0.10)" : touched && !showErr && value ? "0 0 0 3px rgba(22,163,74,0.08)" : "none" }}
        onFocus={e => e.target.style.borderColor = showErr ? "#ef4444" : T.indigoDark}
        onBlur={e  => { setTouched(true); e.target.style.borderColor = borderColor; }} />
      {showErr && (
        <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: -2 }}>
          <span style={{ fontSize: 13, lineHeight: 1 }}>⚠️</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#dc2626" }}>{showErr}</span>
        </div>
      )}
    </div>
  );
};

function Settings({ showToast }) {
  const [activeTab, setActiveTab]   = useState("general");

  // General
  const [pracName, setPracName]     = useState("Georgetown Dental Associates");
  const [npiVal, setNpiVal]         = useState("1234567890");
  const [taxIdVal, setTaxIdVal]     = useState("");
  const [emailVal, setEmailVal]     = useState("hello@georgetowndental.com");

  // PMS
  const [pmsSystem]                 = useState("Open Dental");
  const [pmsSyncKey, setPmsSyncKey] = useState("");
  const [showPmsEdit, setShowPmsEdit] = useState(false);

  // RPA vault
  const [rpaVault, setRpaVault]     = useState(
    Object.fromEntries(RPA_PAYERS.map(p => [p.id, { user: "", pass: "" }]))
  );
  const [editingPayer, setEditingPayer] = useState(null);
  const [editUser, setEditUser]     = useState("");
  const [editPass, setEditPass]     = useState("");

  // Team
  const [invites, setInvites] = useState([{ email: "", role: "Front Desk" }]);

  const openEdit = (payerId) => {
    setEditingPayer(payerId);
    setEditUser(rpaVault[payerId]?.user || "");
    setEditPass(rpaVault[payerId]?.pass || "");
  };
  const saveEdit = () => {
    setRpaVault(v => ({ ...v, [editingPayer]: { user: editUser, pass: editPass } }));
    setEditingPayer(null);
    showToast("Credentials updated securely ✓");
  };

  // ── sub-components ────────────────────────────────────────────────────────
  // SInput is hoisted to module level (above Settings) to avoid the
  // "component defined inside render" hook-reset bug.

  const Toggle = ({ label, description, defaultChecked }) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 0", borderBottom: "1px solid " + T.border }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 800, color: T.text }}>{label}</div>
        <div style={{ fontSize: 12, color: T.textSoft, marginTop: 2 }}>{description}</div>
      </div>
      <label style={{ position: "relative", display: "inline-block", width: 44, height: 24, flexShrink: 0 }}>
        <input type="checkbox" defaultChecked={defaultChecked} style={{ opacity: 0, width: 0, height: 0 }}
          onChange={e => {
            e.target.nextSibling.style.background = e.target.checked ? T.lime : T.borderStrong;
            e.target.nextSibling.firstChild.style.transform = e.target.checked ? "translateX(20px)" : "translateX(0)";
          }} />
        <span style={{ position: "absolute", cursor: "pointer", top: 0, left: 0, right: 0, bottom: 0,
          background: defaultChecked ? T.lime : T.borderStrong, transition: "0.3s", borderRadius: 24 }}>
          <span style={{ position: "absolute", height: 18, width: 18, left: 3, bottom: 3, background: "white",
            transition: "0.3s", borderRadius: "50%", transform: defaultChecked ? "translateX(20px)" : "translateX(0)" }} />
        </span>
      </label>
    </div>
  );

  const ManagedCard = ({ emoji, name, description }) => (
    <div style={{ background: T.bgCard, border: "1px solid " + T.limeBorder, borderRadius: 12,
      padding: "18px 22px", display: "flex", alignItems: "center", gap: 16 }}>
      <div style={{ width: 44, height: 44, borderRadius: 10, background: T.limeLight,
        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>
        {emoji}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 15, fontWeight: 900, color: T.text }}>{name}</div>
        <div style={{ fontSize: 12, color: T.textSoft, marginTop: 2 }}>{description}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: T.limeDark }} />
          <span style={{ fontSize: 12, fontWeight: 800, color: T.limeDark }}>Connected</span>
        </div>
        <div style={{ fontSize: 11, fontWeight: 700, color: T.indigo, background: T.indigoLight,
          padding: "2px 8px", borderRadius: 20, border: "1px solid " + T.indigoBorder }}>
          Managed by Level AI
        </div>
      </div>
    </div>
  );

  const RpaEditModal = () => {
    const payer = RPA_PAYERS.find(p => p.id === editingPayer);
    if (!payer) return null;
    return (
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 6000,
        display: "flex", alignItems: "center", justifyContent: "center" }}
        onClick={e => { if (e.target === e.currentTarget) setEditingPayer(null); }}>
        <div style={{ background: T.bgCard, width: 440, borderRadius: 14, overflow: "hidden",
          boxShadow: "0 20px 60px rgba(0,0,0,0.18)", animation: "fadeIn 0.2s ease-out" }}>
          <div style={{ background: T.indigoDark, padding: "18px 22px",
            display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ color: "white", fontSize: 16, fontWeight: 900 }}>
                {payer.logo} {payer.name} — Edit Credentials
              </div>
              <div style={{ color: "rgba(255,255,255,0.65)", fontSize: 12, marginTop: 3 }}>
                Used by RPA bot when API returns thin data
              </div>
            </div>
            <button onClick={() => setEditingPayer(null)}
              style={{ background: "rgba(255,255,255,0.1)", border: "none", color: "white",
                fontSize: 22, cursor: "pointer", borderRadius: 8, width: 34, height: 34,
                display: "flex", alignItems: "center", justifyContent: "center" }}>
              &times;
            </button>
          </div>
          <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ background: T.rpaLight, border: "1px solid " + T.rpaBorder,
              borderRadius: 8, padding: "10px 14px", display: "flex", gap: 8, alignItems: "center" }}>
              <span>{"🔐"}</span>
              <span style={{ fontSize: 12, color: T.rpaDark, fontWeight: 700 }}>
                AES-256 encrypted · Never stored in plaintext
              </span>
            </div>
            <SInput label="Portal Username / Email" placeholder="provider@practice.com"
              value={editUser} onChange={e => setEditUser(e.target.value)} validate="email" required />
            <SInput label="Portal Password" type="password" placeholder="••••••••"
              value={editPass} onChange={e => setEditPass(e.target.value)} validate="password" required />
            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              <button onClick={() => setEditingPayer(null)}
                style={{ flex: 1, padding: "12px", borderRadius: 8, border: "1px solid " + T.border,
                  background: T.bg, color: T.textMid, fontWeight: 700, cursor: "pointer", fontSize: 14 }}>
                Cancel
              </button>
              <button onClick={saveEdit}
                style={{ flex: 2, padding: "12px", borderRadius: 8, border: "none",
                  background: T.indigoDark, color: "white", fontWeight: 800, cursor: "pointer",
                  fontSize: 14, boxShadow: "0 4px 12px rgba(79,70,229,0.3)" }}>
                Save Credentials
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const TABS = [
    { id: "general",      label: "General",      icon: "🏥" },
    { id: "automations",  label: "Automations",  icon: "⚡" },
    { id: "integrations", label: "Integrations", icon: "🔌" },
    { id: "team",         label: "Team",         icon: "👥" },
  ];

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {editingPayer && <RpaEditModal />}

      {/* Sidebar */}
      <div style={{ width: 240, borderRight: "1px solid " + T.border, background: T.bgCard,
        padding: "24px 14px", flexShrink: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ color: T.text, fontSize: 20, fontWeight: 900, marginBottom: 6, paddingLeft: 10 }}>Settings</div>
        <div style={{ color: T.textSoft, fontSize: 11, fontWeight: 700, paddingLeft: 10, marginBottom: 20 }}>
          Georgetown Dental Associates
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              style={{ textAlign: "left", padding: "10px 12px", borderRadius: 8, border: "none",
                background: activeTab === t.id ? T.indigoLight : "transparent",
                color: activeTab === t.id ? T.indigoDark : T.textMid,
                fontWeight: activeTab === t.id ? 800 : 600, cursor: "pointer", fontSize: 13,
                display: "flex", alignItems: "center", gap: 10 }}>
              <span>{t.icon}</span> {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, padding: "32px 40px", overflowY: "auto", background: T.bg }}>
        <div style={{ maxWidth: 660 }}>

          {/* GENERAL */}
          {activeTab === "general" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              <div>
                <div style={{ fontSize: 22, fontWeight: 900, color: T.text }}>Practice Profile</div>
                <div style={{ fontSize: 13, color: T.textSoft, marginTop: 4 }}>
                  Your legal identity for clearinghouse credentialing and claim submissions.
                </div>
              </div>
              <div style={{ background: T.bgCard, border: "1px solid " + T.border, borderRadius: 12,
                padding: 24, display: "flex", flexDirection: "column", gap: 18 }}>
                <SInput label="Practice Name" value={pracName} onChange={e => setPracName(e.target.value)} required validate="required" />
                <div style={{ display: "flex", gap: 14 }}>
                  <div style={{ flex: 1 }}>
                    <SInput label="NPI Number" value={npiVal}
                      onChange={e => setNpiVal(e.target.value.replace(/\D/g,"").slice(0,10))}
                      validate="npi" required />
                  </div>
                  <div style={{ flex: 1 }}>
                    <SInput label="Tax ID (TIN)" type="password" placeholder="XX-XXXXXXX"
                      value={taxIdVal} onChange={e => {
                        const raw = e.target.value.replace(/[^\d]/g,"").slice(0,9);
                        setTaxIdVal(raw.length > 2 ? raw.slice(0,2)+"-"+raw.slice(2) : raw);
                      }} validate="taxId" />
                  </div>
                </div>
                <SInput label="Primary Contact Email" type="email" value={emailVal}
                  onChange={e => setEmailVal(e.target.value)} validate="email" required />
                <button onClick={() => showToast("Practice profile saved.")}
                  style={{ background: T.indigoDark, color: "white", padding: "11px 24px",
                    border: "none", borderRadius: 8, fontWeight: 800, cursor: "pointer",
                    alignSelf: "flex-start", fontSize: 14,
                    boxShadow: "0 4px 12px rgba(79,70,229,0.25)", transition: "0.2s" }}
                  onMouseEnter={e => e.currentTarget.style.opacity = "0.9"}
                  onMouseLeave={e => e.currentTarget.style.opacity = "1"}>
                  Save Changes
                </button>
              </div>
            </div>
          )}

          {/* AUTOMATIONS */}
          {activeTab === "automations" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              <div>
                <div style={{ fontSize: 22, fontWeight: 900, color: T.text }}>AI & Automation Rules</div>
                <div style={{ fontSize: 13, color: T.textSoft, marginTop: 4 }}>
                  Configure how Level AI handles background verification and patient outreach.
                </div>
              </div>
              <div style={{ background: T.bgCard, border: "1px solid " + T.border, borderRadius: 12, padding: "4px 24px" }}>
                <Toggle label="7-Day Pre-Verification" description="Automatically verify patients 7 days before their appointment." defaultChecked={true} />
                <Toggle label="24-Hour Refresh" description="Re-run verification 24 hours prior to catch last-minute plan changes." defaultChecked={true} />
                <Toggle label="RPA Fallback Engine" description="When the clearinghouse API returns thin data, AI logs into the carrier portal." defaultChecked={true} />
                <Toggle label="Auto-Draft Patient SMS" description="AI writes outreach drafts for missing tooth clauses, maxed benefits, and low remaining." defaultChecked={true} />
                <Toggle label="Pre-Auth Automation" description="Automatically generate pre-authorization letters when Missing Tooth Clause is detected." defaultChecked={true} />
              </div>
            </div>
          )}

          {/* INTEGRATIONS */}
          {activeTab === "integrations" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
              <div>
                <div style={{ fontSize: 22, fontWeight: 900, color: T.text }}>Integrations</div>
                <div style={{ fontSize: 13, color: T.textSoft, marginTop: 4 }}>
                  Manage your PMS connection and RPA vault. Clearinghouse and SMS infrastructure is handled by Level AI.
                </div>
              </div>

              {/* Level AI Managed Services */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 900, color: T.textMid, textTransform: "uppercase",
                  letterSpacing: "0.08em", marginBottom: 14 }}>Level AI Infrastructure</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <ManagedCard emoji="⚡" name="Stedi Clearinghouse API"
                    description="Real-time EDI 270/271 eligibility queries across 1,000+ payers" />
                  <ManagedCard emoji="💬" name="Twilio SMS"
                    description="Patient outreach, reminders, and benefit notifications" />
                </div>
                <div style={{ marginTop: 12, padding: "12px 16px", background: T.indigoLight,
                  border: "1px solid " + T.indigoBorder, borderRadius: 10,
                  fontSize: 12, color: T.indigoDark, fontWeight: 700, lineHeight: 1.6 }}>
                  {"ℹ️"} These services are managed centrally by Level AI. No API keys required.
                  Usage is billed per your Level AI subscription plan.
                </div>
              </div>

              {/* PMS Connection */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 900, color: T.textMid, textTransform: "uppercase",
                  letterSpacing: "0.08em", marginBottom: 14 }}>Practice Management System</div>
                <div style={{ background: T.bgCard, border: "1px solid " + T.border, borderRadius: 12, overflow: "hidden" }}>
                  <div style={{ padding: "18px 22px", display: "flex", alignItems: "center", gap: 16 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 10, background: T.indigoLight,
                      display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>
                      🦷
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 15, fontWeight: 900, color: T.text }}>{pmsSystem}</div>
                      <div style={{ fontSize: 12, color: T.textSoft, marginTop: 2 }}>
                        Schedule sync active · Last pulled 4 min ago
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginRight: 12 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: T.limeDark, animation: "pulse 2s infinite" }} />
                      <span style={{ fontSize: 12, fontWeight: 800, color: T.limeDark }}>Live Sync</span>
                    </div>
                    <button onClick={() => setShowPmsEdit(!showPmsEdit)}
                      style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid " + T.indigoBorder,
                        background: T.indigoLight, color: T.indigoDark, fontWeight: 800, cursor: "pointer", fontSize: 12 }}>
                      {showPmsEdit ? "Cancel" : "Update Token"}
                    </button>
                  </div>
                  {showPmsEdit && (
                    <div style={{ borderTop: "1px solid " + T.border, padding: "18px 22px",
                      background: T.bg, display: "flex", gap: 12, alignItems: "flex-end" }}>
                      <div style={{ flex: 1 }}>
                        <SInput label={pmsSystem === "Open Dental" ? "New eKey" : "New Sync Token"}
                          type="password" placeholder="Paste new token…"
                          value={pmsSyncKey} onChange={e => setPmsSyncKey(e.target.value)}
                          validate="apiKey" required />
                      </div>
                      <button onClick={() => { setShowPmsEdit(false); showToast("PMS sync token updated."); }}
                        style={{ padding: "11px 20px", borderRadius: 8, border: "none", background: T.indigoDark,
                          color: "white", fontWeight: 800, cursor: "pointer", fontSize: 14, whiteSpace: "nowrap" }}>
                        Save Token
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* RPA Credential Vault */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 900, color: T.textMid, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    RPA Credential Vault
                  </div>
                  <div style={{ fontSize: 11, color: T.rpaDark, fontWeight: 800, background: T.rpaLight,
                    border: "1px solid " + T.rpaBorder, padding: "3px 10px", borderRadius: 20 }}>
                    🔐 AES-256 Encrypted
                  </div>
                </div>
                <div style={{ fontSize: 12, color: T.textSoft, marginBottom: 16, lineHeight: 1.6 }}>
                  When Stedi returns incomplete data, the RPA bot logs into the carrier's provider portal
                  using these credentials to retrieve full benefits directly.
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {RPA_PAYERS.map(payer => {
                    const creds = rpaVault[payer.id];
                    const hasCreds = creds?.user && creds?.pass;
                    return (
                      <div key={payer.id}
                        style={{ background: T.bgCard, border: "1px solid " + (hasCreds ? T.limeBorder : T.border),
                          borderRadius: 10, padding: "14px 18px", display: "flex", alignItems: "center", gap: 14,
                          transition: "border-color 0.2s" }}>
                        <span style={{ fontSize: 22 }}>{payer.logo}</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 14, fontWeight: 800, color: T.text }}>{payer.name}</div>
                          <div style={{ fontSize: 11, marginTop: 3 }}>
                            {hasCreds ? (
                              <span style={{ color: T.limeDark, fontWeight: 700 }}>✓ Credentials saved · Bot enabled</span>
                            ) : (
                              <span style={{ color: T.textSoft }}>No credentials — RPA fallback disabled for this payer</span>
                            )}
                          </div>
                        </div>
                        {hasCreds && (
                          <div style={{ fontSize: 11, color: T.textSoft, fontFamily: "monospace", marginRight: 4 }}>
                            {creds.user.substring(0, 6)}···
                          </div>
                        )}
                        <button onClick={() => openEdit(payer.id)}
                          style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid " + T.indigoBorder,
                            background: T.indigoLight, color: T.indigoDark, fontWeight: 800,
                            cursor: "pointer", fontSize: 12, flexShrink: 0 }}>
                          {hasCreds ? "Edit" : "+ Add"} Credentials
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

            </div>
          )}

          {/* ──────────── TEAM TAB ──────────────── */}
          {activeTab === "team" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              <div>
                <div style={{ fontSize: 22, fontWeight: 900, color: T.text }}>Team Members</div>
                <div style={{ fontSize: 13, color: T.textSoft, marginTop: 4 }}>
                  Give your front desk and billing staff access to the Level AI dashboard.
                </div>
              </div>
              <div style={{ background: T.bgCard, border: "1px solid " + T.border, borderRadius: 12, padding: 24 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {invites.map((inv, idx) => (
                    <div key={idx} style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
                      <div style={{ flex: 2 }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          {idx === 0 && <label style={{ fontSize: 11, fontWeight: 800, color: T.textMid, textTransform: "uppercase", letterSpacing: "0.05em" }}>Email</label>}
                          <SInput type="email" placeholder="colleague@practice.com" value={inv.email}
                            onChange={e => { const n = [...invites]; n[idx].email = e.target.value; setInvites(n); }}
                            validate={inv.email ? "email" : undefined} />
                        </div>
                      </div>
                      <div style={{ flex: "0 0 130px", display: "flex", flexDirection: "column", gap: 6 }}>
                        {idx === 0 && <label style={{ fontSize: 11, fontWeight: 800, color: T.textMid, textTransform: "uppercase", letterSpacing: "0.05em" }}>Role</label>}
                        <select value={inv.role} onChange={e => { const n = [...invites]; n[idx].role = e.target.value; setInvites(n); }}
                          style={{ padding: "11px 10px", border: "1px solid " + T.border, borderRadius: 8,
                            fontSize: 13, outline: "none", cursor: "pointer", background: T.bgCard, fontFamily: "inherit" }}>
                          <option>Admin</option>
                          <option>Front Desk</option>
                          <option>Biller</option>
                        </select>
                      </div>
                      {idx > 0 && (
                        <button type="button" onClick={() => setInvites(invites.filter((_, i) => i !== idx))}
                          style={{ background: "none", border: "none", color: T.textSoft, cursor: "pointer", fontSize: 22, paddingBottom: 6 }}>
                          &times;
                        </button>
                      )}
                    </div>
                  ))}
                  <button type="button" onClick={() => setInvites([...invites, { email: "", role: "Front Desk" }])}
                    style={{ alignSelf: "flex-start", background: "transparent", border: "none", color: T.indigoDark,
                      fontWeight: 800, fontSize: 13, cursor: "pointer", padding: "4px 0" }}>
                    + Add another team member
                  </button>
                </div>
                <button onClick={() => showToast("Invites sent! 🎉")}
                  style={{ marginTop: 24, background: T.indigoDark, color: "white", padding: "11px 24px",
                    border: "none", borderRadius: 8, fontWeight: 800, cursor: "pointer",
                    fontSize: 14, boxShadow: "0 4px 12px rgba(79,70,229,0.25)" }}>
                  Send Invites
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

// ── Main App Container ────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// LevelAI  ·  Main App Component  ·  Phase 1 — API Data Bridge
//
// What changed vs. the demo build:
//   ✗  generatePatients()              → deleted
//   ✗  buildMockResult()               → deleted
//   ✗  buildThinMockResult()           → deleted
//   ✗  runVerification() (setTimeout)  → deleted
//   ✗  runRPAScraper()   (setTimeout)  → deleted
//
//   ✓  loadDailySchedule()  → GET /api/v1/patients/daily?date=
//   ✓  loadCalendar()       → GET /api/v1/patients/calendar?month=
//   ✓  verify()             → POST /api/v1/verify  (real pipeline)
//   ✓  Skeleton loaders on every data-dependent surface
//   ✓  Error/retry UI on the schedule kanban
// ─────────────────────────────────────────────────────────────────────────────
// Shared toast bar — used in both auth and dashboard contexts
function ToastBar({ msg }) {
  return (
    <div style={{ position:"absolute", bottom:40, right:40, background:T.text, color:"white",
      padding:"16px 24px", borderRadius:8, fontWeight:800, fontSize:13,
      boxShadow:"0 8px 24px rgba(0,0,0,0.15)", zIndex:9999,
      display:"flex", alignItems:"center", gap:12, animation:"slideIn 0.3s ease-out" }}>
      <span style={{ color:T.limeDark, background:T.limeLight, borderRadius:"50%", width:24, height:24, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14 }}>✓</span>
      {msg}
    </div>
  );
}
export default function LevelAI() {
  const { isSignedIn, isLoaded } = useAuth();
  const { signOut } = useClerk();
  const [toastMsg, setToastMsg] = useState("");
  const showToast = useCallback((msg) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(""), 3500);
  }, []);

  // ── Onboarding wizard (new-practice signup) ───────────────────────────────────
  const [showWizard, setShowWizard] = useState(false);
  useEffect(() => {
    if (isSignedIn && typeof window !== "undefined") {
      if (localStorage.getItem("pulp_needs_onboarding") === "1") {
        setShowWizard(true);
      }
    }
  }, [isSignedIn]);
  const handleWizardComplete = useCallback(() => {
    if (typeof window !== "undefined") localStorage.removeItem("pulp_needs_onboarding");
    setShowWizard(false);
    showToast("🎉 Welcome to Level AI! Your practice is live.");
  }, [showToast]);

  // ── Idle timer (20 min) ───────────────────────────────────────────────────────
  const IDLE_MS = 20 * 60 * 1000;
  const WARN_MS = 19 * 60 * 1000; // warn at 19 min, auto-logout at 20
  const [idleWarning, setIdleWarning] = useState(false);
  const idleWarnTimer  = useRef(null);
  const idleLogoutTimer = useRef(null);
  const resetIdle = useCallback(() => {
    setIdleWarning(false);
    clearTimeout(idleWarnTimer.current);
    clearTimeout(idleLogoutTimer.current);
    if (!isSignedIn) return;
    idleWarnTimer.current  = setTimeout(() => setIdleWarning(true), WARN_MS);
    idleLogoutTimer.current = setTimeout(() => signOut(), IDLE_MS);
  }, [isSignedIn, signOut]);
  useEffect(() => {
    if (!isSignedIn) return;
    const events = ["mousemove","keydown","mousedown","touchstart","scroll"];
    events.forEach(e => window.addEventListener(e, resetIdle));
    resetIdle();
    return () => {
      events.forEach(e => window.removeEventListener(e, resetIdle));
      clearTimeout(idleWarnTimer.current);
      clearTimeout(idleLogoutTimer.current);
    };
  }, [isSignedIn, resetIdle]);

  // ── Core data state ──────────────────────────────────────────────────────────
  const [isMounted, setIsMounted]         = useState(false);
  const [tab, setTab]                     = useState("week");

  // patients: the flat list for today's Kanban + DayCardPanel.
  // CalendarView now only needs per-day summary counts (calendarSummary),
  // which it receives via the calendarSummary prop instead of the full patient list.
  const [patients, setPatients]           = useState([]);
  const [calendarSummary, setCalendarSummary] = useState({}); // { "YYYY-MM-DD": { count, hasAlert, hasWarning, available } }

  const [selected, setSelected]           = useState(null);
  const [selectedDayDate, setSelectedDayDate] = useState(null);
  const [selectedDayPatients, setSelectedDayPatients] = useState(null); // null = not loaded

  const [results, setResults]             = useState({});
  const [phases, setPhases]               = useState({});
  const phasesRef                         = useRef({});
  const [agentLog, setAgentLog]           = useState([]);

  // ── Loading / error state ────────────────────────────────────────────────────
  const [dailyLoading, setDailyLoading]   = useState(false);
  const [dailyError, setDailyError]       = useState(null);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [dayPanelLoading, setDayPanelLoading] = useState(false);

  // ── UI state ─────────────────────────────────────────────────────────────────
  const [schedulePanel, setSchedulePanel] = useState("benefits");
  const [prevPanel, setPrevPanel]         = useState(null); // for back navigation
  const [dismissedAlerts, setDismissedAlerts] = useState({ blocked: false, notify: false });
  const [showDirectoryModal, setShowDirectoryModal] = useState(false);

  // Track which patients have had auto-verify queued this session
  const autoQueued = useRef(new Set());

  // ── Mount + practice bootstrap ───────────────────────────────────────────────
  useEffect(() => {
    setIsMounted(true);
    // Bootstrap practice record in Postgres on first login (idempotent)
    fetch("/api/v1/practice", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .catch(() => {}); // non-blocking — fail silently if DB not reachable
  }, []);

  // ── Phase tracking (unchanged logic, new data source) ───────────────────────
  const isLoading = useCallback((id) => {
    const p = phasesRef.current[id];
    return p && p.phase !== "complete" && p.phase !== "error";
  }, []);

  const setPhase = useCallback((id, obj) => {
    phasesRef.current = { ...phasesRef.current, [id]: obj };
    setPhases(prev => ({ ...prev, [id]: obj }));
  }, []);

  // ── Fetch: today's schedule (Kanban) — also used for DayCardPanel refreshes ──
  const loadDailySchedule = useCallback(async (dateStr) => {
    setDailyLoading(true);
    setDailyError(null);
    try {
      const data = await apiGetDailySchedule(dateStr);
      const withHours = data.map(p => {
        if (p.hoursUntil != null) return p;
        const diff = new Date(`${p.appointmentDate}T${p.appointmentTime || "09:00"}`) - new Date();
        return { ...p, hoursUntil: Math.floor(diff / (1000 * 60 * 60)) };
      });
      // Merge today's records into patients, replacing any stale entries for this date
      setPatients(prev => {
        const otherDays = prev.filter(p => p.appointmentDate !== dateStr);
        return [...otherDays, ...withHours];
      });
    } catch (err) {
      setDailyError(err.message);
    } finally {
      setDailyLoading(false);
    }
  }, []);

  // ── Fetch: rolling 7-day window (today + 7 calendar days) ────────────────────
  // Covers today for the kanban AND the next 7 days for WeekAhead + auto-verify.
  // Skips weekends (Sat/Sun) since the practice is closed and the API returns [].
  const loadWeekSchedule = useCallback(async (anchorDate) => {
    // Build every calendar date from today through today+7, skipping weekends
    const anchor = new Date(anchorDate + "T12:00:00");
    const fetchDates = [];
    for (let i = 0; i <= 7; i++) {
      const d = new Date(anchor);
      d.setDate(anchor.getDate() + i);
      const dow = d.getDay();
      if (dow === 0 || dow === 6) continue; // skip Sat/Sun
      fetchDates.push(d.toISOString().split("T")[0]);
    }

    // Fetch all dates in parallel — failures are non-fatal per day
    const settled = await Promise.allSettled(fetchDates.map(d => apiGetDailySchedule(d)));

    const allPatients = [];
    const seen = new Set();
    settled.forEach((r, i) => {
      if (r.status !== "fulfilled") return;
      r.value.forEach(p => {
        // Deduplicate by patient+date+time (same fixture patient can appear on multiple days)
        const key = `${p.id}_${p.appointmentDate}_${p.appointmentTime}`;
        if (seen.has(key)) return;
        seen.add(key);
        if (p.hoursUntil != null) { allPatients.push(p); return; }
        const diff = new Date(`${p.appointmentDate}T${p.appointmentTime || "09:00"}`) - new Date();
        allPatients.push({ ...p, hoursUntil: Math.floor(diff / (1000 * 60 * 60)) });
      });
    });

    setPatients(allPatients);
  }, []);

  // ── Fetch: calendar month summary ────────────────────────────────────────────
  const loadCalendar = useCallback(async (monthStr) => {
    setCalendarLoading(true);
    try {
      // Returns CalendarDaySummary[] — we key by date string for O(1) lookup
      const data = await apiGetCalendar(monthStr);
      const map = {};
      for (const day of data) { map[day.date] = day; }
      setCalendarSummary(prev => ({ ...prev, ...map }));
    } catch (err) {
      // Non-fatal — calendar still renders without summaries
      console.warn("Calendar load failed:", err.message);
    } finally {
      setCalendarLoading(false);
    }
  }, []);

  // ── Fetch: single day's patient list for DayCardPanel ───────────────────────
  const loadDayPanel = useCallback(async (date) => {
    const dateStr = date.toISOString().split("T")[0];
    setSelectedDayDate(date);
    setSelectedDayPatients(null); // triggers skeleton
    setDayPanelLoading(true);
    try {
      const data = await apiGetDailySchedule(dateStr);
      setSelectedDayPatients(data);
    } catch {
      setSelectedDayPatients([]);
    } finally {
      setDayPanelLoading(false);
    }
  }, []);

  // ── Initial data loads ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!isMounted) return;
    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];
    const monthStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}`;
    // Load the full week so WeekAhead shows all upcoming appointments and the
    // 7-day auto-verify window fires correctly for future-dated patients.
    loadWeekSchedule(todayStr);
    loadCalendar(monthStr);
  }, [isMounted, loadWeekSchedule, loadCalendar]);

  // ── Verify: calls real API — same phase logic, no setTimeout ────────────────
  const verify = useCallback(async (patient, trigger = "manual") => {
    if (isLoading(patient.id)) return;
    const runPhases = [];

    setPhase(patient.id, { phase: "api" });
    let apiResult;
    try {
      apiResult = await apiPostVerify(patient.id, trigger, patient);
    } catch (e) {
      setPhase(patient.id, { phase: "error", error: e.message });
      showToast(`Verification failed for ${patient.name}: ${e.message}`);
      return;
    }
    runPhases.push("api");
    setResults(prev => ({ ...prev, [patient.id]: apiResult }));

    const thin = detectThinData(apiResult);
    let finalResult = apiResult;

    if (thin.thin) {
      setPhase(patient.id, { phase: "rpa", reason: thin.reason, missingFields: thin.missingFields });
      try {
        // Same endpoint — backend routes trigger="rpa_fallback" to the RPA pipeline
        const rpaResult = await apiPostVerify(patient.id, "rpa_fallback", patient);
        if (rpaResult) {
          runPhases.push("rpa");
          setPhase(patient.id, { phase: "merging" });
          finalResult = mergeResults(apiResult, rpaResult);
          runPhases.push("merge");
        }
      } catch (e) {
        // RPA failed → keep thin API result, log to console only
        console.warn(`RPA fallback failed for ${patient.id}:`, e.message);
      }
    }

    setResults(prev => ({ ...prev, [patient.id]: finalResult }));
    setPhase(patient.id, { phase: "complete", phases: runPhases });

    const triage = triagePatient(patient, finalResult);
    const issueCount = (triage.block?.length || 0) + (triage.notify?.length || 0);
    if (trigger === "manual") {
      if (finalResult.plan_status === "terminated") {
        showToast(`⚠️ ${patient.name} — Coverage terminated. Patient is self-pay.`);
      } else if (triage.block?.length > 0) {
        showToast(`🔴 ${patient.name} — ${triage.block[0]}`);
      } else if (triage.notify?.length > 0) {
        showToast(`🟡 ${patient.name} — ${triage.notify[0]}`);
      } else {
        showToast(`✅ ${patient.name} verified — All clear.`);
      }
    }
    const isFuture = patient.hoursUntil > 24;
    const newEntries = [buildVerifyEntry(patient, finalResult, trigger, runPhases)];
    if (triage.block.length > 0 && isFuture) newEntries.push(buildRescheduleEntry(patient, triage, trigger));
    else if (triage.notify.length > 0) newEntries.push(buildOutreachEntry(patient, triage));
    setAgentLog(log => [...newEntries.reverse(), ...log]);
  }, [isLoading, setPhase, showToast]);

  // ── Auto-verify: fires for 24h and 7d windows once patients load ─────────────
  useEffect(() => {
    patients.forEach(patient => {
      const h = patient.hoursUntil;
      if (h == null) return;
      const in24h = h <= 24 && h > 0;
      const in7d  = h <= 168 && h > 24;
      const trigger = in24h ? "24h_auto" : in7d ? "7d_auto" : null;
      if (!trigger) return;
      // Include appointmentDate in key so the same patient on different days
      // each get their own independent verification trigger.
      const key = `${patient.id}_${patient.appointmentDate}_${trigger}`;
      if (autoQueued.current.has(key)) return;
      autoQueued.current.add(key);
      setTimeout(() => verify(patient, trigger), (in24h ? 600 : 1200) + Math.random() * 400);
    });
  }, [patients, verify]);

  // ── Event handlers ────────────────────────────────────────────────────────────
  const handleSelect = (p) => {
    setSelected(p);
    setSchedulePanel("benefits");
    setPrevPanel(null); // direct selection — no back needed
    if (!results[p.id] && !isLoading(p.id)) verify(p, "manual");
  };

  const handleRemovePatient = (id) => {
    // Optimistic UI — Phase 2 will add the DELETE /api/v1/appointments/{id} call
    setPatients(prev => prev.filter(p => p.id !== id));
    if (selectedDayPatients) setSelectedDayPatients(prev => prev?.filter(p => p.id !== id));
    showToast("Patient removed from schedule.");
  };

  const handleSelectDay = (date) => {
    loadDayPanel(date);
  };

  const handleAddPatientClick = () => {
    setShowDirectoryModal(true);
  };

  const handleAddPatient = useCallback((p) => {
    const diff = new Date(p.appointmentDate) - new Date();
    const withHours = { ...p, hoursUntil: Math.floor(diff / (1000 * 60 * 60)) + 9 };
    setPatients(prev => [...prev, withHours]);
    // In Phase 2: POST /api/v1/appointments  to persist the booking
  }, []);

  const handleApprove = useCallback((entry) => {
    setAgentLog(log => log.map(e => e.id !== entry.id ? e : {
      ...e, awaitingApproval: false, action: ACTION.APPROVED,
      status: "reschedule_approved",
      resolvedAt: new Date().toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"}),
    }));
    // Phase 4: PATCH /api/v1/agent-log/{entry.id}  { action: "approved" }
  }, []);

  const handleDismiss = useCallback((entry) => {
    setAgentLog(log => log.map(e => e.id !== entry.id ? e : {
      ...e, awaitingApproval: false, action: ACTION.DISMISSED,
      status: "reschedule_dismissed",
      resolvedAt: new Date().toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"}),
    }));
    // Phase 4: PATCH /api/v1/agent-log/{entry.id}  { action: "dismissed" }
  }, []);

  // ── Derived state (same logic as before — different source array) ────────────
  const triageMap = {};
  patients.forEach(p => { if (results[p.id]) triageMap[p.id] = triagePatient(p, results[p.id]); });

  const verifiedCount = patients.filter(p => !isLoading(p.id) && results[p.id]?.verification_status === STATUS.VERIFIED).length;
  const actionCount   = patients.filter(p => !isLoading(p.id) && results[p.id]?.verification_status === STATUS.ACTION_REQUIRED).length;
  const inactiveCount = patients.filter(p => !isLoading(p.id) && results[p.id]?.verification_status === STATUS.INACTIVE).length;
  const pendingCount  = patients.filter(p => !results[p.id] || isLoading(p.id)).length;
  const autoCount     = agentLog.filter(e => e.trigger !== "manual" && e.action === ACTION.VERIFIED).length;
  const rpaCount      = agentLog.filter(e => e.rpaEscalated).length;
  // List of patients that were auto-verified (for AutoVerifiedPanel)
  const autoVerifiedPatientIds = new Set(agentLog.filter(e => e.trigger !== "manual" && e.action === ACTION.VERIFIED).map(e => e.patientId));
  const autoVerifiedList = patients.filter(p => autoVerifiedPatientIds.has(p.id));

  const COLS = [
    { key:"action_required", label:"Action Required", color:T.amber,   bg:T.amberLight, border:T.amberBorder, filter:p=>!isLoading(p.id)&&results[p.id]?.verification_status===STATUS.ACTION_REQUIRED },
    { key:"verified",        label:"Verified",        color:T.limeDark,bg:T.limeLight,  border:T.limeBorder,  filter:p=>!isLoading(p.id)&&results[p.id]?.verification_status===STATUS.VERIFIED        },
    { key:"inactive",        label:"Inactive",        color:T.red,     bg:T.redLight,   border:T.redBorder,   filter:p=>!isLoading(p.id)&&results[p.id]?.verification_status===STATUS.INACTIVE        },
    { key:"pending",         label:"Pending",         color:T.slate,   bg:T.slateLight, border:T.border,      filter:p=>!results[p.id]||isLoading(p.id)                                              },
  ];

  const todayStrLocal = isMounted ? new Date().toISOString().split("T")[0] : "";
  const upcomingPts   = patients.filter(p => p.appointmentDate > todayStrLocal);
  const todayPts      = patients.filter(p => p.appointmentDate === todayStrLocal);
  const triagedUpcoming = upcomingPts.map(p => ({ p, t: triageMap[p.id] })).filter(x => x.t);
  const triagedToday    = todayPts.map(p => ({ p, t: triageMap[p.id] })).filter(x => x.t);

  const blockedList = triagedUpcoming.filter(({ p, t }) => {
    if (t.block.length === 0) return false;
    const entry = agentLog.find(e => e.patientId === p.id && e.action === ACTION.RESCHEDULE);
    return !entry || entry.awaitingApproval;
  });

  const notifyList = [...triagedToday, ...triagedUpcoming].filter(({ p, t }) => {
    if (t.block.length > 0 || t.notify.length === 0) return false;
    const entry = agentLog.find(e => e.patientId === p.id && e.action === ACTION.OUTREACH);
    return !entry || entry.awaitingApproval;
  });

  // ── Skeleton layouts for loading states ──────────────────────────────────────
  const KanbanSkeleton = () => (
    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))", gap:10, minHeight:600 }}>
      {[0,1,2,3].map(col => (
        <div key={col} style={{ borderRadius:12, border:"1px solid " + T.border, background:T.bg, overflow:"hidden" }}>
          <div style={{ padding:"10px 12px", borderBottom:"1px solid " + T.border }}>
            <Skeleton w={70} h={10} />
          </div>
          <div style={{ padding:"8px 6px", display:"flex", flexDirection:"column", gap:6 }}>
            {[0,1,2,3,4].map(row => (
              <div key={row} style={{ background:T.bgCard, borderRadius:10, padding:"12px 13px", display:"flex", flexDirection:"column", gap:7 }}>
                <Skeleton w="65%" h={12} />
                <Skeleton w="45%" h={10} />
                <Skeleton w="85%" h={10} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  const NavCountSkeleton = () => (
    <div style={{ display:"flex", gap:6 }}>
      {[80,68,76,70].map((w,i) => (
        <Skeleton key={i} w={w} h={26} r={20} />
      ))}
    </div>
  );

  // ── Auth gate ─────────────────────────────────────────────────────────────────
  if (!isLoaded) {
    return (
      <div style={{ height: "100vh", background: T.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: T.textSoft, fontSize: 14, fontWeight: 700 }}>Loading…</div>
      </div>
    );
  }
  if (!isSignedIn) {
    return (
      <div style={{ position: "relative", height: "100vh", overflow: "hidden" }}>
        <AuthFlow onComplete={() => {}} showToast={showToast} />
        {toastMsg && <ToastBar msg={toastMsg} />}
      </div>
    );
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ height:"100vh", background:T.bg, fontFamily:"'Nunito',sans-serif", display:"flex", flexDirection:"column", overflow:"hidden", position:"relative" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:5px;} ::-webkit-scrollbar-thumb{background:#C8C8C0;border-radius:4px;}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
        @keyframes skshimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
        @keyframes slideIn{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
      `}</style>

      {/* ── Nav bar ─────────────────────────────────────────────────────── */}
      <div style={{ background:T.bgCard, borderBottom:"1px solid " + T.border, padding:"0 24px", height:60, display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0 }}>

        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ fontSize:24 }}>&#x1F9B7;</div>
          <div>
            <div style={{ color:T.lime, fontSize:20, fontWeight:900 }}>level<span style={{ color:"#334155" }}>ai</span></div>
            <div style={{ color:T.indigo, fontSize:9, fontWeight:800, letterSpacing:"0.1em" }}>insurance made easy</div>
          </div>
        </div>

        <div style={{ display:"flex", gap:4 }}>
          {[
            { id:"schedule",  label:"Daily Schedule" },
            { id:"week",      label:"Week Ahead", badge: agentLog.filter(e=>e.awaitingApproval).length },
            { id:"agent",     label:"AI Workflow" },
            { id:"analytics", label:"Analytics" },
            { id:"settings",  label:"Settings" },
          ].map(tItem => (
            <button key={tItem.id}
              onClick={() => { setTab(tItem.id); setSelectedDayDate(null); }}
              style={{ padding:"8px 14px", borderRadius:8, border:"none",
                background: tab===tItem.id ? T.limeLight : "transparent",
                color: tab===tItem.id ? T.limeDark : T.textMid,
                fontWeight: tab===tItem.id ? 800 : 600, cursor:"pointer",
                position:"relative", transition:"all 0.2s" }}>
              {tItem.label}
              {tItem.badge > 0 && (
                <span style={{ position:"absolute", top:2, right:2, minWidth:16, height:16,
                  borderRadius:8, background:T.red, border:"2px solid " + T.bgCard,
                  fontSize:9, fontWeight:900, color:"#fff",
                  display:"flex", alignItems:"center", justifyContent:"center", padding:"0 3px" }}>
                  {tItem.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Nav status pills — skeleton while today's data is loading */}
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <div style={{ color:T.textSoft, fontSize:11 }}>
            {isMounted ? new Date().toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"}) : ""}
          </div>
          <button
            onClick={() => signOut()}
            style={{ marginLeft:4, padding:"4px 12px", borderRadius:20, border:"1px solid " + T.border,
              background:T.bgCard, color:T.textMid, fontSize:11, fontWeight:700, cursor:"pointer",
              display:"flex", alignItems:"center", gap:5 }}>
            <span>🚪</span> Log out
          </button>
          {dailyLoading ? <NavCountSkeleton /> : (
            <>
              {[
                { label:"Verified",  count:verifiedCount, color:T.limeDark, bg:T.limeLight,  border:T.limeBorder  },
                { label:"Action",    count:actionCount,   color:T.amber,    bg:T.amberLight, border:T.amberBorder },
                { label:"Inactive",  count:inactiveCount, color:T.red,      bg:T.redLight,   border:T.redBorder   },
                { label:"Pending",   count:pendingCount,  color:T.slate,    bg:T.slateLight, border:T.border      },
              ].map(({label,count,color,bg,border}) => (
                <div key={label} style={{ display:"flex", alignItems:"center", gap:5, padding:"4px 10px",
                  borderRadius:20, background:bg, border:"1px solid " + border, color, fontSize:11, fontWeight:800 }}>
                  <span style={{ fontSize:14, fontWeight:900, lineHeight:1 }}>{count}</span>
                  <span>{label}</span>
                </div>
              ))}
              {rpaCount > 0 && (
                <div style={{ display:"flex", alignItems:"center", gap:5, padding:"4px 10px",
                  borderRadius:20, background:T.rpaLight, border:"1px solid " + T.rpaBorder,
                  color:T.rpaDark, fontSize:11, fontWeight:800 }}>
                  <span style={{ fontSize:14, fontWeight:900, lineHeight:1 }}>{rpaCount}</span>
                  <span>RPA</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Tab content ──────────────────────────────────────────────────── */}
      <div style={{ flex:1, overflow:"hidden", display:"flex", flexDirection:"column" }}>

        {tab === "agent" && (
          <AIWorkflow log={agentLog} showToast={showToast}
            results={results} triageMap={triageMap}
            onSelectPatient={p => {
              const pt = patients.find(x => x.id === p.id);
              if (pt) { setSelected(pt); setTab("schedule"); }
            }}
            onApprove={handleApprove} onDismiss={handleDismiss} />
        )}

        {tab === "analytics" && (
          <Analytics patients={patients} results={results} agentLog={agentLog} />
        )}

        {tab === "settings" && <Settings showToast={showToast} />}

        {/* ── Week Ahead tab ────────────────────────────────────────────── */}
        {tab === "week" && (
          <WeekAhead
            patients={patients}
            agentLog={agentLog}
            triageMap={triageMap}
            results={results}
            onApprove={handleApprove}
            onDismiss={handleDismiss}
            showToast={showToast}
            onSelectPatient={p => { setSelected(p); setTab("schedule"); }}
            onVerify={verify}
            isMounted={isMounted}
          />
        )}

        {/* ── Daily Schedule tab ───────────────────────────────────────── */}
        {tab === "schedule" && (
          <div style={{ padding:24, display:"grid", gridTemplateColumns:"1fr 400px", gap:20, height:"100%", overflow:"hidden" }}>
            <div style={{ display:"flex", flexDirection:"column", overflowY:"auto", paddingRight:8, height:"100%", minHeight:0 }}>

              {/* Header row */}
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14, flexShrink:0 }}>
                <div>
                  <div style={{ color:T.text, fontSize:15, fontWeight:900 }}>Today&apos;s Verifications</div>
                  {autoCount > 0 && (
                    <div style={{ color:T.indigo, fontSize:11, fontWeight:700, marginTop:2 }}>
                      &#x1F916; {autoCount} auto-verified{rpaCount > 0 ? ` · ${rpaCount} RPA escalated` : ""}
                    </div>
                  )}
                </div>
                <div style={{ display:"flex", gap:8 }}>
                  <button
                    onClick={() => handleAddPatientClick()}
                    style={{ background:T.bgCard, color:T.text, border:"1px solid " + T.border, padding:"8px 16px", borderRadius:8, fontWeight:800, cursor:"pointer", fontSize:12 }}>
                    + New Patient
                  </button>
                  <button
                    disabled={dailyLoading}
                    onClick={() => {
                      if (!dailyLoading) patients.forEach((p, i) => { if (!isLoading(p.id)) setTimeout(() => verify(p, "manual"), i * 300); });
                    }}
                    style={{ background: dailyLoading ? T.borderStrong : T.lime, color:"#fff", border:"none", padding:"8px 18px", borderRadius:8, fontWeight:800, cursor: dailyLoading ? "not-allowed" : "pointer", fontSize:12, transition:"0.2s" }}>
                    {dailyLoading ? "Loading…" : "Verify All"}
                  </button>
                </div>
              </div>

              {/* Error state with retry */}
              {dailyError && (
                <div style={{ background:T.redLight, border:"1px solid " + T.redBorder, borderRadius:10, padding:"14px 18px", marginBottom:16, flexShrink:0, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <div>
                    <div style={{ color:T.red, fontWeight:900, fontSize:13 }}>Failed to load today&apos;s schedule</div>
                    <div style={{ color:T.red, opacity:0.8, fontSize:12, marginTop:3 }}>{dailyError}</div>
                  </div>
                  <button
                    onClick={() => loadDailySchedule(todayStrLocal)}
                    style={{ background:T.red, color:"white", border:"none", borderRadius:8, padding:"8px 18px", fontWeight:800, cursor:"pointer", fontSize:12 }}>
                    Retry
                  </button>
                </div>
              )}

              <MorningBanner
                blockedCount={blockedList.length}
                notifyCount={notifyList.length}
                botCount={autoCount}
                rpaCount={rpaCount}
                onOpenAlerts={() => { setSchedulePanel("alerts"); setPrevPanel(null); }}
                onOpenNotify={() => { setSchedulePanel("outreach"); setPrevPanel(null); }}
                onOpenAutoVerified={() => { setSchedulePanel("autoverified"); setPrevPanel(null); }}
              />

              {/* Kanban: skeleton while loading, real cards when ready */}
              {dailyLoading ? <KanbanSkeleton /> : (
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))", gap:10, minHeight:600 }}>
                  {COLS.map(col => {
                    const colPts = todayPts.filter(col.filter);
                    return (
                      <div key={col.key} style={{ display:"flex", flexDirection:"column", overflow:"hidden", borderRadius:12, border:"1px solid " + col.border, background:col.bg }}>
                        <div style={{ padding:"10px 12px", borderBottom:"1px solid " + col.border, display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0 }}>
                          <span style={{ fontSize:11, fontWeight:900, textTransform:"uppercase", letterSpacing:"0.06em", color:col.color }}>{col.label}</span>
                          <span style={{ fontSize:11, fontWeight:900, color:col.color, background:"white", width:20, height:20, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 0 0 1px " + col.border }}>
                            {colPts.length}
                          </span>
                        </div>
                        <div style={{ overflowY:"auto", flex:1, padding:"8px 6px", display:"flex", flexDirection:"column", gap:6 }}>
                          {colPts.length === 0
                            ? <div style={{ padding:"24px 0", textAlign:"center", color:col.color, opacity:0.4, fontSize:11, fontWeight:700 }}>None</div>
                            : colPts.map(p => (
                              <PatientCard key={p.id} patient={p} result={results[p.id]} phaseInfo={phases[p.id]}
                                isSelected={selected?.id === p.id} triage={triageMap[p.id]}
                                isAuto={agentLog.some(e => e.patientId===p.id && e.trigger!=="manual")}
                                isRPA={results[p.id]?._source==="hybrid"}
                                onSelect={() => handleSelect(p)} colColor={col.color} colBorder={col.border} />
                            ))
                          }
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div style={{ marginTop:14, marginBottom:20, flexShrink:0, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                {dailyLoading
                  ? <Skeleton w={200} h={11} />
                  : <span style={{ color:T.textSoft, fontSize:11 }}>{patients.length} patients · {isMounted ? new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"}) : ""}</span>
                }
                <span style={{ color:T.indigo, fontSize:11, fontWeight:700 }}>&#x1F916; Auto-verifies 7d + 24h before appt</span>
              </div>
            </div>

            {/* Right panel */}
            <div style={{ background:T.bgCard, borderRadius:12, border:"1px solid " + T.border, overflow:"hidden", display:"flex", flexDirection:"column" }}>
              {schedulePanel === "benefits" && (
                <BenefitsPanel patient={selected} result={selected ? results[selected.id] : null}
                  phaseInfo={selected ? phases[selected.id] : null} onVerify={verify}
                  triage={selected ? triageMap[selected.id] : null} showToast={showToast}
                  onBack={prevPanel ? () => { setSchedulePanel(prevPanel); setPrevPanel(null); } : null}
                  backLabel={prevPanel === "alerts" ? "Back to Needs Attention" : prevPanel === "outreach" ? "Back to Outreach" : prevPanel === "autoverified" ? "Back to Auto-Verified" : null} />
              )}
              {schedulePanel === "alerts" && (
                <AlertsPanel list={blockedList} agentLog={agentLog}
                  onApprove={handleApprove} onDismiss={handleDismiss}
                  onClose={() => setSchedulePanel("benefits")}
                  onSelect={(p) => { setSelected(p); setPrevPanel("alerts"); setSchedulePanel("benefits"); }}
                  showToast={showToast} />
              )}
              {schedulePanel === "outreach" && (
                <OutreachPanel list={notifyList} agentLog={agentLog}
                  onApprove={handleApprove} onDismiss={handleDismiss}
                  onClose={() => setSchedulePanel("benefits")}
                  onSelect={(p) => { setSelected(p); setPrevPanel("outreach"); setSchedulePanel("benefits"); }}
                  showToast={showToast} />
              )}
              {schedulePanel === "autoverified" && (
                <AutoVerifiedPanel
                  list={autoVerifiedList}
                  onClose={() => setSchedulePanel("benefits")}
                  onSelect={(p) => { setSelected(p); setPrevPanel("autoverified"); setSchedulePanel("benefits"); }}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Directory modal ───────────────────────────────────────────────── */}
      {showDirectoryModal && (
        <DirectorySearchModal
          onClose={() => setShowDirectoryModal(false)}
          onSelect={(p) => {
            const diff = new Date(p.appointmentDate) - new Date();
            handleAddPatient({ ...p, hoursUntil: Math.floor(diff / (1000 * 60 * 60)) + 9 });
            setShowDirectoryModal(false);
            showToast(`${p.name} added — ${p.appointmentDate} at ${p.appointmentTime}!`);
          }}
        />
      )}

      {toastMsg && <ToastBar msg={toastMsg} />}

      {/* ── Onboarding wizard overlay (new practices) ───────────────────── */}
      {showWizard && (
        <OnboardingWizard
          onComplete={handleWizardComplete}
          showToast={showToast}
        />
      )}

      {/* ── Idle warning modal ───────────────────────────────────────────── */}
      {idleWarning && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", zIndex:9999,
          display:"flex", alignItems:"center", justifyContent:"center", backdropFilter:"blur(4px)" }}>
          <div style={{ background:T.bgCard, borderRadius:18, padding:"40px 44px", maxWidth:400, width:"90%",
            boxShadow:"0 20px 60px rgba(0,0,0,0.25)", textAlign:"center", border:"1px solid " + T.border }}>
            <div style={{ fontSize:52, marginBottom:12 }}>🥱</div>
            <div style={{ fontSize:22, fontWeight:900, color:T.text, marginBottom:8 }}>
              Psst… you still there?
            </div>
            <div style={{ fontSize:14, color:T.textSoft, lineHeight:1.6, marginBottom:28 }}>
              We&apos;ve noticed some suspicious levels of<br />
              <em>not clicking things</em>. For security, we&apos;ll<br />
              log you out in about a minute. No pressure. 👀
            </div>
            <div style={{ display:"flex", gap:10, justifyContent:"center" }}>
              <button
                onClick={resetIdle}
                style={{ background:T.lime, color:"#fff", border:"none", borderRadius:10,
                  padding:"12px 28px", fontWeight:900, fontSize:15, cursor:"pointer" }}>
                Yes, I&apos;m here! 🙋
              </button>
              <button
                onClick={() => signOut()}
                style={{ background:T.bgCard, color:T.textMid, border:"1px solid " + T.border,
                  borderRadius:10, padding:"12px 20px", fontWeight:700, fontSize:14, cursor:"pointer" }}>
                Log out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
