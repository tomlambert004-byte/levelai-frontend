"use client";
export const dynamic = "force-dynamic";
import { SignedIn, SignedOut, useAuth, SignIn } from "@clerk/nextjs";
import { useState, useCallback, useEffect, useRef } from "react";
// ... your other imports (T, dollars, etc.) ...
import { SignInButton, SignUpButton } from "@clerk/nextjs";
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

const API_BASE =
  (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_API_URL)
    ? process.env.NEXT_PUBLIC_API_URL
    : "http://localhost:8000";

async function apiFetch(path, options = {}) {
  const url = `${API_BASE}${path}`;
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

// POST /api/v1/verify  { patient_id, trigger }
// Returns: VerificationResult  (Stedi / RPA pipeline result)
async function apiPostVerify(patientId, trigger) {
  return apiFetch("/api/v1/verify", {
    method: "POST",
    body: JSON.stringify({ patient_id: patientId, trigger }),
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
  const cfg = {
    api:     { icon:"Search", label:"Querying Clearinghouse...", color:T.lime,    bg:T.limeLight  },
    rpa:     { icon:"Bot",    label:"AI logging into portal...", color:T.rpa,     bg:T.rpaLight   },
    merging: { icon:"Zap",    label:"Merging data...",           color:T.indigo,  bg:T.indigoLight},
  }[phase] || { icon:"Circle", label:"Verifying...", color:T.slate, bg:T.slateLight };

  if (compact) return (
    <div style={{ display:"flex", alignItems:"center", gap:6, padding:"4px 8px", borderRadius:6, background:cfg.bg }}>
      <span style={{ width:6, height:6, borderRadius:"50%", background:cfg.color, animation:"pulse 1.5s infinite", flexShrink:0 }} />
      <span style={{ color:cfg.color, fontSize:10, fontWeight:700 }}>{cfg.label}</span>
    </div>
  );

  return (
    <div style={{ padding:"12px 16px", background:cfg.bg, borderRadius:8, border:"1px solid " + (phase==="rpa"?T.rpaBorder:T.limeBorder) }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom: reason?4:0 }}>
        <span style={{ width:8, height:8, borderRadius:"50%", background:cfg.color, animation:"pulse 1.5s infinite", flexShrink:0 }} />
        <span style={{ color:cfg.color, fontSize:12, fontWeight:800 }}>{cfg.label}</span>
      </div>
      {reason && <div style={{ color:cfg.color, fontSize:11, opacity:0.8, marginLeft:16 }}>{reason}</div>}
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
const OInput = ({ label, type = "text", placeholder, value, onChange, required }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
    <label style={{ fontSize: 11, fontWeight: 800, color: T.textMid, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</label>
    <input type={type} required={required} placeholder={placeholder} value={value} onChange={onChange}
      style={{ width: "100%", padding: "13px 16px", border: "1px solid " + T.borderStrong, borderRadius: 10,
        fontSize: 14, outline: "none", transition: "border-color 0.2s", fontFamily: "inherit", color: T.text }}
      onFocus={e => e.target.style.borderColor = T.indigoDark}
      onBlur={e  => e.target.style.borderColor = T.borderStrong} />
  </div>
);

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
  const [step, setStep] = useState("login");

  // Login / MFA
  const [email, setEmail]     = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState(["", "", "", "", "", ""]);

  // Step 1 – Practice Profile
  const [pracName, setPracName] = useState("");
  const [npi, setNpi]           = useState("");
  const [taxId, setTaxId]       = useState("");

  // Step 2 – PMS
  const [pmsSystem, setPmsSystem]   = useState("");
  const [pmsSyncKey, setPmsSyncKey] = useState("");

  // Step 3 – RPA Vault (keyed by payer id)
  const [rpaVault, setRpaVault] = useState(
    Object.fromEntries(RPA_PAYERS.map(p => [p.id, { user: "", pass: "" }]))
  );
  const [rpaExpanded, setRpaExpanded] = useState("delta");

  // Step 4 – Team
  const [invites, setInvites] = useState([{ email: "", role: "Front Desk" }]);

  // ── handlers ───────────────────────────────────────────────────────────────
  const handleLoginSubmit = (e) => {
    e.preventDefault();
    showToast("Credentials verified. Sending MFA code…");
    setTimeout(() => setStep("mfa"), 800);
  };
  const handleMfaChange = (index, val) => {
    if (val.length > 1) return;
    const nc = [...mfaCode]; nc[index] = val; setMfaCode(nc);
    if (val && index < 5) document.getElementById(`mfa-${index + 1}`).focus();
  };
  const handleMfaSubmit = (e) => {
    e.preventDefault();
    if (mfaCode.join("").length === 6) {
      showToast("Device verified. Let's set up your practice.");
      setTimeout(() => setStep("profile"), 700);
    }
  };
  const handleTeamSubmit = (e) => {
    e.preventDefault();
    showToast("Setup complete! Welcome to Level AI 🎉");
    setTimeout(() => onComplete(), 1000);
  };

  // ── layout shell ───────────────────────────────────────────────────────────
  const isWizardStep = ["profile","pms","rpa","team"].includes(step);

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
    <SignIn routing="hash" />
  </div>
)}
          {/* ───────── MFA ───────── */}
          {step === "mfa" && (
            <div style={{ animation: "fadeIn 0.4s ease-out" }}>
              <div style={{ display: "inline-flex", background: T.indigoLight, color: T.indigoDark,
                padding: "7px 12px", borderRadius: 8, fontWeight: 800, fontSize: 12, marginBottom: 20, gap: 6 }}>
                🔒 HIPAA Secure Login
              </div>
              <div style={{ fontSize: 28, fontWeight: 900, color: T.text, marginBottom: 8 }}>Two-Step Verification</div>
              <div style={{ fontSize: 14, color: T.textSoft, marginBottom: 32, lineHeight: 1.5 }}>
                Enter the 6-digit code sent to your registered device.
              </div>
              <form onSubmit={handleMfaSubmit} style={{ display: "flex", flexDirection: "column", gap: 32 }}>
                <div style={{ display: "flex", gap: 10, justifyContent: "space-between" }}>
                  {mfaCode.map((digit, idx) => (
                    <input key={idx} id={`mfa-${idx}`} type="text" inputMode="numeric" maxLength={1} value={digit}
                      onChange={e => handleMfaChange(idx, e.target.value)}
                      onKeyDown={e => { if (e.key === "Backspace" && !digit && idx > 0) document.getElementById(`mfa-${idx-1}`).focus(); }}
                      style={{ width: 52, height: 62, textAlign: "center", fontSize: 26, fontWeight: 900,
                        border: "2px solid " + (digit ? T.indigoDark : T.borderStrong),
                        borderRadius: 10, outline: "none", background: T.bgCard, color: T.text, transition: "0.2s" }}
                      onFocus={e => e.target.style.borderColor = T.indigoDark}
                      onBlur={e => { if (!digit) e.target.style.borderColor = T.borderStrong; }} />
                  ))}
                </div>
                <NextBtn type="submit" label="Verify & Continue" disabled={mfaCode.join("").length !== 6} />
              </form>
            </div>
          )}

          {/* ───────── WIZARD STEPS ───────── */}
          {isWizardStep && <WizardProgress currentStep={step} />}

          {/* Step 1 – Practice Profile */}
          {step === "profile" && (
            <div style={{ animation: "fadeIn 0.35s ease-out" }}>
              <div style={{ fontSize: 24, fontWeight: 900, color: T.text, marginBottom: 6 }}>Practice Profile</div>
              <div style={{ fontSize: 13, color: T.textSoft, marginBottom: 28, lineHeight: 1.5 }}>
                Your legal identity for clearinghouse credentialing and claim submissions.
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <OInput label="Legal Practice Name" placeholder="e.g. Georgetown Dental Associates" value={pracName} onChange={e=>setPracName(e.target.value)} required />
                <div style={{ display: "flex", gap: 14 }}>
                  <div style={{ flex: 1 }}>
                    <OInput label="NPI Number" placeholder="10 digits" value={npi} onChange={e=>setNpi(e.target.value)} required />
                  </div>
                  <div style={{ flex: 1 }}>
                    <OInput label="Tax ID (TIN)" placeholder="XX-XXXXXXX" value={taxId} onChange={e=>setTaxId(e.target.value)} required />
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 28 }}>
                <NextBtn label="Next: Connect PMS →" onClick={() => { if (pracName && npi && taxId) setStep("pms"); }} />
              </div>
            </div>
          )}

          {/* Step 2 – Connect PMS */}
          {step === "pms" && (
            <div style={{ animation: "fadeIn 0.35s ease-out" }}>
              <div style={{ fontSize: 24, fontWeight: 900, color: T.text, marginBottom: 6 }}>Connect Your PMS</div>
              <div style={{ fontSize: 13, color: T.textSoft, marginBottom: 28, lineHeight: 1.5 }}>
                Level AI pulls your daily schedule directly from your Practice Management System. No manual entry.
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  <label style={{ fontSize: 11, fontWeight: 800, color: T.textMid, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Practice Management System
                  </label>
                  <select value={pmsSystem} onChange={e => setPmsSystem(e.target.value)} required
                    style={{ padding: "13px 16px", border: "1px solid " + T.borderStrong, borderRadius: 10,
                      fontSize: 14, outline: "none", cursor: "pointer", background: T.bgCard,
                      color: pmsSystem ? T.text : T.textSoft, fontFamily: "inherit" }}>
                    <option value="">Select your PMS…</option>
                    {PMS_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>

                {pmsSystem && (
                  <div style={{ animation: "fadeIn 0.3s ease-out" }}>
                    <OInput label={pmsSystem === "Open Dental" ? "eKey" : "Sync Token"}
                      placeholder={pmsSystem === "Open Dental" ? "Paste your Open Dental eKey" : "Paste your API / Sync Token"}
                      type="password" value={pmsSyncKey} onChange={e => setPmsSyncKey(e.target.value)} required />
                  </div>
                )}

                {pmsSystem && (
                  <div style={{ background: T.limeLight, border: "1px solid " + T.limeBorder, borderRadius: 10, padding: "12px 16px",
                    display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <span style={{ fontSize: 18 }}>ℹ️</span>
                    <div style={{ fontSize: 12, color: T.limeDark, lineHeight: 1.5 }}>
                      <strong>Where to find your {pmsSystem === "Open Dental" ? "eKey" : "Sync Token"}:</strong>{" "}
                      {pmsSystem === "Open Dental" && "Open Dental → Setup → Advanced → HL7/API → eKey tab."}
                      {pmsSystem === "Dentrix" && "Dentrix → Office Manager → Tools → Dentrix Enterprise → API Keys."}
                      {pmsSystem === "Eaglesoft" && "Eaglesoft → Setup → Connections → Integration Hub → Token."}
                      {!["Open Dental","Dentrix","Eaglesoft"].includes(pmsSystem) && "Contact your PMS support team for your integration token."}
                    </div>
                  </div>
                )}
              </div>

              <div style={{ marginTop: 28, display: "flex", gap: 10 }}>
                <button onClick={() => setStep("profile")} style={{ flex: "0 0 auto", padding: "15px 20px", borderRadius: 10,
                  border: "1px solid " + T.border, background: T.bgCard, color: T.textMid, fontWeight: 700, cursor: "pointer", fontSize: 14 }}>
                  ← Back
                </button>
                <div style={{ flex: 1 }}>
                  <NextBtn label="Next: RPA Vault →" onClick={() => { if (pmsSystem && pmsSyncKey) setStep("rpa"); }} />
                </div>
              </div>
            </div>
          )}

          {/* Step 3 – RPA Credential Vault */}
          {step === "rpa" && (
            <div style={{ animation: "fadeIn 0.35s ease-out" }}>
              <div style={{ fontSize: 24, fontWeight: 900, color: T.text, marginBottom: 6 }}>RPA Credential Vault</div>
              <div style={{ fontSize: 13, color: T.textSoft, marginBottom: 10, lineHeight: 1.5 }}>
                When a payer's API returns incomplete data, our AI bot logs into their web portal using your provider credentials to scrape the full benefits. Add your top payers below.
              </div>
              <div style={{ background: T.rpaLight, border: "1px solid " + T.rpaBorder, borderRadius: 10,
                padding: "10px 14px", marginBottom: 24, display: "flex", gap: 10, alignItems: "center" }}>
                <span style={{ fontSize: 16 }}>🔐</span>
                <span style={{ fontSize: 12, color: T.rpaDark, fontWeight: 700 }}>
                  Credentials are AES-256 encrypted and never stored in plaintext.
                </span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {RPA_PAYERS.map(payer => {
                  const isOpen = rpaExpanded === payer.id;
                  const creds = rpaVault[payer.id];
                  const filled = creds.user && creds.pass;
                  return (
                    <div key={payer.id} style={{ border: "1px solid " + (filled ? T.limeBorder : T.border),
                      borderRadius: 10, overflow: "hidden", transition: "border-color 0.2s" }}>
                      <div onClick={() => setRpaExpanded(isOpen ? null : payer.id)}
                        style={{ padding: "13px 16px", display: "flex", alignItems: "center", gap: 12,
                          cursor: "pointer", background: isOpen ? T.indigoLight : T.bgCard }}>
                        <span style={{ fontSize: 20 }}>{payer.logo}</span>
                        <span style={{ flex: 1, fontSize: 14, fontWeight: 800, color: T.text }}>{payer.name}</span>
                        {filled && (
                          <span style={{ fontSize: 10, fontWeight: 800, color: T.limeDark, background: T.limeLight,
                            border: "1px solid " + T.limeBorder, padding: "2px 8px", borderRadius: 20 }}>✓ Saved</span>
                        )}
                        <span style={{ color: T.textSoft, fontSize: 18, transform: isOpen ? "rotate(180deg)" : "none", transition: "0.2s" }}>⌄</span>
                      </div>
                      {isOpen && (
                        <div style={{ padding: "14px 16px", borderTop: "1px solid " + T.border,
                          background: T.bg, display: "flex", gap: 12 }}>
                          <div style={{ flex: 1 }}>
                            <OInput label="Portal Username" placeholder="provider@practice.com"
                              value={creds.user}
                              onChange={e => setRpaVault(v => ({ ...v, [payer.id]: { ...v[payer.id], user: e.target.value } }))} />
                          </div>
                          <div style={{ flex: 1 }}>
                            <OInput label="Portal Password" type="password" placeholder="••••••••"
                              value={creds.pass}
                              onChange={e => setRpaVault(v => ({ ...v, [payer.id]: { ...v[payer.id], pass: e.target.value } }))} />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div style={{ fontSize: 12, color: T.textSoft, marginTop: 12, marginBottom: 4 }}>
                Tip: Adding at least 3 payers significantly improves zero-call verification rates.
              </div>

              <div style={{ marginTop: 20, display: "flex", gap: 10 }}>
                <button onClick={() => setStep("pms")} style={{ flex: "0 0 auto", padding: "15px 20px", borderRadius: 10,
                  border: "1px solid " + T.border, background: T.bgCard, color: T.textMid, fontWeight: 700, cursor: "pointer", fontSize: 14 }}>
                  ← Back
                </button>
                <div style={{ flex: 1 }}>
                  <NextBtn label="Next: Invite Team →" onClick={() => setStep("team")} />
                </div>
              </div>
            </div>
          )}

          {/* Step 4 – Invite Team */}
          {step === "team" && (
            <div style={{ animation: "fadeIn 0.35s ease-out" }}>
              <div style={{ fontSize: 24, fontWeight: 900, color: T.text, marginBottom: 6 }}>Invite Your Team</div>
              <div style={{ fontSize: 13, color: T.textSoft, marginBottom: 28, lineHeight: 1.5 }}>
                Give your front desk and billing staff access to the AI workflow dashboard.
              </div>
              <form onSubmit={handleTeamSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {invites.map((inv, idx) => (
                  <div key={idx} style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
                    <div style={{ flex: 2 }}>
                      <OInput label={idx === 0 ? "Email" : ""} type="email" placeholder="colleague@practice.com"
                        value={inv.email} onChange={e => { const n = [...invites]; n[idx].email = e.target.value; setInvites(n); }} required />
                    </div>
                    <div style={{ flex: "0 0 130px", display: "flex", flexDirection: "column", gap: 7 }}>
                      {idx === 0 && <label style={{ fontSize: 11, fontWeight: 800, color: T.textMid, textTransform: "uppercase", letterSpacing: "0.05em" }}>Role</label>}
                      <select value={inv.role} onChange={e => { const n = [...invites]; n[idx].role = e.target.value; setInvites(n); }}
                        style={{ padding: "13px 10px", border: "1px solid " + T.borderStrong, borderRadius: 10,
                          fontSize: 13, outline: "none", cursor: "pointer", background: T.bgCard, fontFamily: "inherit" }}>
                        <option>Admin</option>
                        <option>Front Desk</option>
                        <option>Biller</option>
                      </select>
                    </div>
                    {idx > 0 && (
                      <button type="button" onClick={() => setInvites(invites.filter((_, i) => i !== idx))}
                        style={{ background: "none", border: "none", color: T.textSoft, cursor: "pointer", fontSize: 22, paddingBottom: 4 }}>
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

                <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
                  <button type="button" onClick={() => setStep("rpa")}
                    style={{ flex: "0 0 auto", padding: "15px 20px", borderRadius: 10,
                      border: "1px solid " + T.border, background: T.bgCard, color: T.textMid, fontWeight: 700, cursor: "pointer", fontSize: 14 }}>
                    ← Back
                  </button>
                  <div style={{ flex: 1 }}>
                    <NextBtn type="submit" label="🎉 Launch Dashboard" />
                  </div>
                </div>
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

// ── Preauth Widget ────────────────────────────────────────────────────────────
function PreauthWidget({ patient, result, triage, showToast }) {
  const [status, setStatus]       = useState("idle");
  const [preauthId, setPreauthId] = useState(null);
  const [letter, setLetter]       = useState(null);
  const [errorMsg, setErrorMsg]   = useState(null);
  const [elapsed, setElapsed]     = useState(0);
  const pollRef  = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => () => {
    clearInterval(pollRef.current);
    clearInterval(timerRef.current);
  }, []);

  const startElapsedTimer = () => {
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000);
  };

  const stopTimers = () => {
    clearInterval(pollRef.current);
    clearInterval(timerRef.current);
  };

  const handleSubmit = async () => {
    setStatus("submitting");
    setErrorMsg(null);
    setLetter(null);
    startElapsedTimer();

    try {
      const payload = {
        patient_name:           patient.name,
        patient_dob:            patient.dob,
        member_id:              patient.memberId,
        insurance:              patient.insurance,
        procedure:              patient.procedure,
        provider:               patient.provider,
        appointment_date:       patient.appointmentDate,
        block_reasons:          triage.block,
        affected_teeth:         result?.missing_tooth_clause?.affected_teeth || [],
        annual_remaining_cents: result?.annual_remaining_cents,
      };

      const res = await fetch("http://localhost:8000/api/preauth/submit", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      });

      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      setPreauthId(data.id);
      setStatus("polling");

      pollRef.current = setInterval(async () => {
        try {
          const poll = await fetch(`http://localhost:8000/api/preauth/${data.id}/status`);
          if (!poll.ok) return;
          const pollData = await poll.json();

          if (pollData.status === "SUBMITTED") {
            stopTimers();
            setLetter(pollData.letter);
            setStatus("done");
            showToast("Pre-authorization letter generated! ✓");
          } else if (pollData.status === "ERROR" || pollData.status === "FAILED") {
            stopTimers();
            setErrorMsg(pollData.error || "Generation failed — please try again.");
            setStatus("error");
          }
        } catch (e) {
          console.warn("Poll error:", e);
        }
      }, 2500);

    } catch (e) {
      stopTimers();
      setErrorMsg(e.message || "Could not reach the server.");
      setStatus("error");
    }
  };

  const handleReset = () => {
    stopTimers();
    setStatus("idle");
    setLetter(null);
    setErrorMsg(null);
    setElapsed(0);
  };

  if (status === "idle") return (
    <button onClick={handleSubmit}
      style={{ marginTop: 12, background: T.indigoDark, color: "white", padding: "10px 16px", borderRadius: 8, fontWeight: 800, cursor: "pointer", border: "none", width: "100%", display: "flex", justifyContent: "center", alignItems: "center", gap: 8, transition: "0.2s" }}
      onMouseEnter={e => e.currentTarget.style.opacity = 0.9}
      onMouseLeave={e => e.currentTarget.style.opacity = 1}>
      <span style={{ fontSize: 16 }}>⚡</span> Automate Pre-Authorization
    </button>
  );

  if (status === "submitting" || status === "polling") return (
    <div style={{ marginTop: 12, background: T.indigoLight, border: "1px solid " + T.indigoBorder, borderRadius: 8, padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: T.indigo, animation: "pulse 1.5s infinite", flexShrink: 0 }} />
        <span style={{ color: T.indigoDark, fontSize: 13, fontWeight: 800 }}>
          {status === "submitting" ? "Submitting to AI engine…" : "Generating pre-auth letter…"}
        </span>
        <span style={{ marginLeft: "auto", color: T.indigo, fontSize: 11, fontWeight: 700 }}>{elapsed}s</span>
      </div>
      {status === "polling" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {[
            { label: "Reviewing coverage rules",        done: true           },
            { label: "Drafting clinical justification", done: elapsed > 4   },
            { label: "Formatting payer letter",         done: elapsed > 9   },
            { label: "Finalizing & submitting",         done: elapsed > 14  },
          ].map(step => (
            <div key={step.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 16, height: 16, borderRadius: "50%", fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, background: step.done ? T.limeDark : T.borderStrong, color: step.done ? "white" : T.textSoft, flexShrink: 0 }}>
                {step.done ? "✓" : "·"}
              </span>
              <span style={{ fontSize: 12, fontWeight: 700, color: step.done ? T.limeDark : T.textSoft }}>{step.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  if (status === "error") return (
    <div style={{ marginTop: 12, background: T.redLight, border: "1px solid " + T.redBorder, borderRadius: 8, padding: "12px 14px" }}>
      <div style={{ color: T.red, fontSize: 12, fontWeight: 800, marginBottom: 6 }}>Pre-Auth Failed</div>
      <div style={{ color: T.red, fontSize: 12, marginBottom: 10 }}>{errorMsg}</div>
      <button onClick={handleReset} style={{ background: T.red, color: "white", border: "none", borderRadius: 6, padding: "8px 14px", fontWeight: 800, cursor: "pointer", fontSize: 12 }}>
        Try Again
      </button>
    </div>
  );

  if (status === "done" && letter) return (
    <div style={{ marginTop: 12, background: T.limeLight, border: "1px solid " + T.limeBorder, borderRadius: 8, overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", background: T.limeDark, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: "white", fontSize: 12, fontWeight: 900 }}>✓ Pre-Auth Letter Generated</span>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => { navigator.clipboard.writeText(letter); showToast("Letter copied to clipboard!"); }}
            style={{ background: "rgba(255,255,255,0.2)", color: "white", border: "none", borderRadius: 6, padding: "5px 10px", fontWeight: 800, cursor: "pointer", fontSize: 11 }}>
            Copy
          </button>
          <button onClick={handleReset}
            style={{ background: "transparent", color: "rgba(255,255,255,0.7)", border: "none", borderRadius: 6, padding: "5px 10px", fontWeight: 800, cursor: "pointer", fontSize: 11 }}>
            ✕
          </button>
        </div>
      </div>
      <div style={{ padding: "14px 16px", maxHeight: 280, overflowY: "auto", fontSize: 12, lineHeight: "1.7", color: T.textMid, whiteSpace: "pre-wrap", fontFamily: "Georgia, serif" }}>
        {letter}
      </div>
      <div style={{ padding: "10px 14px", borderTop: "1px solid " + T.limeBorder, display: "flex", gap: 8 }}>
        <button onClick={() => {
          const blob = new Blob([letter], { type: "text/plain" });
          const url  = URL.createObjectURL(blob);
          const a    = document.createElement("a");
          a.href     = url;
          a.download = `preauth_${patient.name.replace(/ /g, "_")}_${patient.appointmentDate}.txt`;
          a.click();
          URL.revokeObjectURL(url);
          showToast("Letter downloaded!");
        }}
          style={{ flex: 1, background: T.indigoDark, color: "white", border: "none", borderRadius: 6, padding: "9px", fontWeight: 800, cursor: "pointer", fontSize: 12 }}>
          ↓ Download Letter
        </button>
        <button onClick={() => showToast("Fax queued to " + patient.insurance + "!")}
          style={{ flex: 1, background: T.bgCard, color: T.indigoDark, border: "1px solid " + T.indigoBorder, borderRadius: 6, padding: "9px", fontWeight: 800, cursor: "pointer", fontSize: 12 }}>
          📠 Fax to Payer
        </button>
      </div>
    </div>
  );

  return null;
}

// ── Benefits Panel ────────────────────────────────────────────────────────────
function BenefitsPanel({ patient, result, phaseInfo, onVerify, triage, showToast }) {
  if (!patient) return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:"100%", color:T.textSoft, gap:8 }}>
      <div style={{ fontSize:32 }}>👈</div>
      <div style={{ fontSize:13, fontWeight:700 }}>Select a patient to review</div>
    </div>
  );

  const loading = phaseInfo && phaseInfo.phase !== "complete" && phaseInfo.phase !== "error";
  const isRPA = result?._source === "hybrid";

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", overflow:"hidden" }}>
      <div style={{ padding:"16px 20px", borderBottom:"1px solid " + T.border, flexShrink:0 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
          <div>
            <div style={{ color:T.text, fontSize:16, fontWeight:900 }}>{patient.name}</div>
            <div style={{ color:T.textSoft, fontSize:11, marginTop:2 }}>DOB {patient.dob} · {patient.memberId}</div>
          </div>
          {!loading && (
            <button onClick={()=>onVerify(patient,"manual")} style={{ padding:"7px 14px", borderRadius:8, border:"1px solid " + T.border, background:T.bg, color:T.textMid, fontWeight:700, cursor:"pointer", fontSize:11 }}>
              Re-verify
            </button>
          )}
        </div>
        <div style={{ marginTop:10, display:"flex", gap:6, flexWrap:"wrap" }}>
          <div style={{ fontSize:11, color:T.textMid, fontWeight:600 }}>{patient.appointmentTime} · {patient.procedure}</div>
          {isRPA && <Badge label="RPA" color={T.rpaDark} bg={T.rpaLight} border={T.rpaBorder} icon="Bot" />}
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

function MorningBanner({ blockedCount, notifyCount, botCount, rpaCount, onOpenAlerts, onOpenNotify }) {
  if (blockedCount === 0 && notifyCount === 0 && botCount === 0) return null;
  return (
    <div style={{ display:"flex", gap:12, marginBottom:20, flexWrap:"wrap" }}>
      {blockedCount > 0 && (
         <div onClick={onOpenAlerts} style={{ flex:"1 1 180px", cursor:"pointer", background:T.redLight, border:"1px solid "+T.redBorder, padding:"14px 18px", borderRadius:12, display:"flex", alignItems:"center", gap:12, transition:"0.15s", boxShadow:"0 2px 4px rgba(0,0,0,0.02)" }}
              onMouseEnter={e=>e.currentTarget.style.borderColor=T.red} onMouseLeave={e=>e.currentTarget.style.borderColor=T.redBorder}>
             <span style={{fontSize:24}}>🚨</span>
             <div>
                 <div style={{fontSize:15, fontWeight:900, color:T.red}}>{blockedCount} Action{blockedCount!==1?"s":""} Needed</div>
                 <div style={{fontSize:12, color:T.red, opacity:0.8, fontWeight:600, marginTop:2}}>View flagged appts &rarr;</div>
             </div>
         </div>
      )}
      {notifyCount > 0 && (
         <div onClick={onOpenNotify} style={{ flex:"1 1 180px", cursor:"pointer", background:T.amberLight, border:"1px solid "+T.amberBorder, padding:"14px 18px", borderRadius:12, display:"flex", alignItems:"center", gap:12, transition:"0.15s", boxShadow:"0 2px 4px rgba(0,0,0,0.02)" }}
              onMouseEnter={e=>e.currentTarget.style.borderColor=T.amberDark} onMouseLeave={e=>e.currentTarget.style.borderColor=T.amberBorder}>
             <span style={{fontSize:24}}>📞</span>
             <div>
                 <div style={{fontSize:15, fontWeight:900, color:T.amberDark}}>{notifyCount} Call{notifyCount!==1?"s":""} Queued</div>
                 <div style={{fontSize:12, color:T.amberDark, opacity:0.8, fontWeight:600, marginTop:2}}>View outreach list &rarr;</div>
             </div>
         </div>
      )}
      {botCount > 0 && (
         <div style={{ flex:"1 1 200px", background:T.rpaLight, border:"1px solid "+T.rpaBorder, padding:"14px 18px", borderRadius:12, display:"flex", alignItems:"center", gap:12 }}>
             <span style={{fontSize:24}}>🤖</span>
             <div>
                 <div style={{fontSize:15, fontWeight:900, color:T.rpaDark}}>{botCount} Auto-Verified</div>
                 <div style={{fontSize:12, color:T.rpaDark, opacity:0.8, fontWeight:600, marginTop:2}}>{rpaCount > 0 ? `${rpaCount} RPA fallbacks used` : `Zero-touch workflows`}</div>
             </div>
         </div>
      )}
    </div>
  )
}

function PatientCard({ patient, result, phaseInfo, isSelected, triage, isAuto, isRPA, onSelect, colColor }) {
  const loading = phaseInfo && phaseInfo.phase !== "complete" && phaseInfo.phase !== "error";
  return (
    <div onClick={onSelect}
      style={{ background:T.bgCard, borderRadius:10, padding:"12px 13px", cursor:"pointer", border:"1.5px solid " + (isSelected?colColor:T.border), boxShadow:isSelected?"0 0 0 3px "+colColor+"22":"0 1px 3px rgba(0,0,0,0.04)", transition:"all 0.15s", display: "flex", flexDirection: "column" }}
      onMouseEnter={e=>{ if(!isSelected){ e.currentTarget.style.borderColor=colColor; e.currentTarget.style.boxShadow="0 0 0 3px "+colColor+"15"; }}}
      onMouseLeave={e=>{ if(!isSelected){ e.currentTarget.style.borderColor=T.border; e.currentTarget.style.boxShadow="0 1px 3px rgba(0,0,0,0.04)"; }}}>
      <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:5, flexWrap:"wrap" }}>
        <span style={{ color:T.text, fontSize:13, fontWeight:800, flex:1 }}>{patient.name}</span>
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

// ── Directory Modal for Calendar Schedule ────────────────────────────────────
function DirectorySearchModal({ time, date, onSelect, onClose }) {
  const [query, setQuery] = useState("");

  const mockDirectory = [
    { id: "dir_1", name: "Amanda Lewis", dob: "1985-04-12", procedure: "Implant Consult", insurance: "MetLife", phone: "(512) 555-1111", provider: "Dr. Patel", fee: 25000, memberId: "MET88899" },
    { id: "dir_2", name: "David Chen", dob: "1992-10-30", procedure: "Prophy + BWX", insurance: "Delta Dental", phone: "(512) 555-2222", provider: "Dr. Chen", fee: 18500, memberId: "DD77733" },
    { id: "dir_3", name: "Sarah Jenkins", dob: "1970-02-14", procedure: "Crown Prep #18", insurance: "Cigna", phone: "(512) 555-3333", provider: "Dr. Kim", fee: 145000, memberId: "CIG44422" },
    { id: "dir_4", name: "Michael Vance", dob: "2001-08-05", procedure: "Root Canal", insurance: "Guardian", phone: "(512) 555-4444", provider: "Dr. Rodriguez", fee: 115000, memberId: "GRD11100" },
    { id: "dir_5", name: "Jessica Taylor", dob: "1998-12-22", procedure: "Composite Fill", insurance: "Aetna DMO", phone: "(512) 555-5555", provider: "Dr. Patel", fee: 25000, memberId: "AET9900" },
  ];

  const filtered = mockDirectory.filter(p => p.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:5000, display:"flex", alignItems:"center", justifyContent:"center" }} onClick={(e)=>{if(e.target===e.currentTarget) onClose();}}>
      <div style={{ background:T.bgCard, width: 480, borderRadius: 12, overflow: "hidden", display: "flex", flexDirection: "column", maxHeight: "80vh" }}>
        <div style={{ padding: "16px 20px", background: T.indigoDark, color: "white", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 900 }}>Select Patient from PMS</div>
            <div style={{ fontSize: 12, opacity: 0.8 }}>Scheduling for {time}</div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: "white", fontSize: 24, cursor: "pointer" }}>&times;</button>
        </div>

        <div style={{ padding: 16, borderBottom: "1px solid " + T.border }}>
          <input type="text" placeholder="Search by name or DOB..." value={query} onChange={e=>setQuery(e.target.value)} autoFocus
                 style={{ width: "100%", padding: "10px 14px", border: "1px solid " + T.border, borderRadius: 8, fontSize: 14, outline: "none", fontFamily: "inherit" }} />
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.length === 0 ? (
             <div style={{ textAlign: "center", padding: "20px", color: T.textSoft, fontSize: 13 }}>No patients found.</div>
          ) : (
            filtered.map(p => (
              <div key={p.id} onClick={() => onSelect({...p, appointmentTime: time, appointmentDate: date, id: "p_dir_" + Date.now()})}
                   style={{ border: "1px solid " + T.border, borderRadius: 8, padding: "12px 16px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", transition: "0.15s" }}
                   onMouseEnter={e => e.currentTarget.style.borderColor = T.indigo} onMouseLeave={e => e.currentTarget.style.borderColor = T.border}>
                 <div>
                   <div style={{ fontSize: 14, fontWeight: 900, color: T.text }}>{p.name}</div>
                   <div style={{ fontSize: 11, color: T.textSoft, marginTop: 4 }}>DOB {p.dob} &middot; {p.procedure}</div>
                 </div>
                 <div style={{ textAlign: "right" }}>
                   <div style={{ fontSize: 12, fontWeight: 800, color: T.textMid }}>{p.insurance}</div>
                   <div style={{ fontSize: 11, color: T.textSoft, marginTop: 4 }}>{p.provider}</div>
                 </div>
              </div>
            ))
          )}
        </div>
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
// ── Clean Week Ahead — 3 Category Boxes + Modal ─────────────────────────────────
function WeekAhead({ patients, results, triageMap, agentLog, showToast, onSelectPatient, onVerify }) {
  const [modalCategory, setModalCategory] = useState(null);

  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];

  const allUpcoming = patients.filter(p => p.appointmentDate >= todayStr);

  const critical = allUpcoming.filter(p => {
    const t = triageMap[p.id];
    return t && t.block.length > 0;
  });

  const headsUp = allUpcoming.filter(p => {
    const t = triageMap[p.id];
    return t && t.block.length === 0 && t.notify.length > 0;
  });

  const clear = allUpcoming.filter(p => {
    const t = triageMap[p.id];
    return !t || (t.block.length === 0 && t.notify.length === 0);
  });

  const openModal = (cat) => setModalCategory(cat);
  const closeModal = () => setModalCategory(null);

  const categoryPatients = {
    critical,
    headsUp,
    clear,
  };

  const categoryConfig = {
    critical: { label: "Critical", color: T.red, bg: T.redLight, border: T.redBorder, count: critical.length },
    headsUp: { label: "Heads Up", color: T.amberDark, bg: T.amberLight, border: T.amberBorder, count: headsUp.length },
    clear: { label: "Clear", color: T.limeDark, bg: T.limeLight, border: T.limeBorder, count: clear.length },
  };

  return (
    <div style={{ padding: 24, height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 22, fontWeight: 900 }}>Week Ahead</div>
        <div style={{ fontSize: 13, color: T.textSoft }}>
          {allUpcoming.length} patients • Issues that need attention
        </div>
      </div>

      {/* 3 Dynamic Category Boxes */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, flex: 1, minHeight: 0 }}>
        {["critical", "headsUp", "clear"].map(cat => {
          const cfg = categoryConfig[cat];
          const patientsInCat = categoryPatients[cat];

          return (
            <div
              key={cat}
              onClick={() => openModal(cat)}
              style={{
                background: cfg.bg,
                border: `2px solid ${cfg.border}`,
                borderRadius: 16,
                padding: 24,
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                alignItems: "center",
                transition: "all 0.2s",
                boxShadow: "0 4px 12px rgba(0,0,0,0.04)",
              }}
              onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-4px)"; e.currentTarget.style.boxShadow = "0 12px 24px rgba(0,0,0,0.08)"; }}
              onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.04)"; }}
            >
              <div style={{ fontSize: 48, fontWeight: 900, color: cfg.color, marginBottom: 8 }}>
                {cfg.count}
              </div>
              <div style={{ fontSize: 17, fontWeight: 800, color: cfg.color }}>
                {cfg.label}
              </div>
              <div style={{ fontSize: 12, color: T.textSoft, marginTop: 8 }}>
                {patientsInCat.length} patient{patientsInCat.length !== 1 ? "s" : ""}
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal */}
      {modalCategory && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={closeModal}>
          <div style={{ background: T.bgCard, width: "90%", maxWidth: 620, borderRadius: 16, overflow: "hidden", maxHeight: "88vh", display: "flex", flexDirection: "column" }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: "20px 24px", borderBottom: "1px solid " + T.border, display: "flex", justifyContent: "space-between", alignItems: "center", background: categoryConfig[modalCategory].bg }}>
              <div style={{ fontSize: 20, fontWeight: 900, color: categoryConfig[modalCategory].color }}>
                {categoryConfig[modalCategory].label} Patients
              </div>
              <button onClick={closeModal} style={{ fontSize: 24, color: T.textSoft, background: "none", border: "none", cursor: "pointer" }}>✕</button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
              {categoryPatients[modalCategory].length === 0 ? (
                <div style={{ textAlign: "center", color: T.textSoft, padding: 40 }}>No patients in this category.</div>
              ) : (
                categoryPatients[modalCategory].map(p => {
                  const t = triageMap[p.id];
                  const reasons = t ? (t.block.length > 0 ? t.block : t.notify) : [];
                  return (
                    <div key={p.id} style={{ border: "1px solid " + T.border, borderRadius: 12, padding: 16, cursor: "pointer", background: T.bg }} onClick={() => { onSelectPatient(p); closeModal(); }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <div style={{ fontWeight: 800, fontSize: 16 }}>{p.name}</div>
                          <div style={{ fontSize: 12, color: T.textMid, marginTop: 2 }}>
                            {p.appointmentDate} · {p.appointmentTime} · {p.procedure}
                          </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: 11, color: T.textSoft }}>{p.insurance}</div>
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
function AIWorkflow({ log, onSelectPatient, onApprove, onDismiss, showToast }) {
  const [showAttentionPanel, setShowAttentionPanel] = useState(true);

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
           <div style={{ display:"flex", flexWrap:"wrap", gap:12, marginBottom:16, flexShrink:0 }}>
            {[
              { label:"Auto-Verified",  value:verifications.filter(e=>e.trigger!=="manual").length, color:T.limeDark, bg:T.limeLight,   border:T.limeBorder  },
              { label:"Reschedules",    value:reschedules.length,                                   color:T.red,      bg:T.redLight,    border:T.redBorder   },
              { label:"Outreach",       value:outreach.length,                                      color:T.amberDark,bg:T.amberLight,  border:T.amberBorder },
              { label:"Calls Avoided",  value:verifications.filter(e=>e.trigger!=="manual").length, color:T.rpaDark,  bg:T.rpaLight,    border:T.rpaBorder   },
            ].map(s=>(
              <div key={s.label} style={{ flex:"1 1 180px", background:s.bg, border:"1px solid " + s.border, borderRadius:10, padding:"12px 14px" }}>
                <div style={{ color:s.color, fontSize:22, fontWeight:900, lineHeight:1 }}>{s.value}</div>
                <div style={{ color:s.color, fontSize:10, fontWeight:700, marginTop:4, opacity:0.75 }}>{s.label}</div>
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
                <div key={entry.id} onClick={()=>onSelectPatient({id:entry.patientId})}
                     style={{ background:T.bgCard, border:"1px solid " + T.border, borderRadius:12, padding:"12px 16px", display:"flex", alignItems:"center", gap:10, cursor:"pointer", transition:"0.15s", flexShrink: 0 }}
                     onMouseEnter={e=>e.currentTarget.style.borderColor=T.indigo} onMouseLeave={e=>e.currentTarget.style.borderColor=T.border}>
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
      </div>
    </div>
  );
}

function Analytics({ patients, results, agentLog }) {
  const [selectedMonthIdx, setSelectedMonthIdx] = useState(5);

  const verifiedIds = Object.keys(results);
  const totalVerified = verifiedIds.length;
  const autoVerifications = agentLog.filter(e => e.action === ACTION.VERIFIED && e.trigger !== "manual");
  const autoRate = totalVerified > 0 ? Math.round((autoVerifications.length / totalVerified) * 100) : 0;
  const timeSavedHours = ((autoVerifications.length * 12) / 60).toFixed(1);

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
    { month: "Sep", ins: 38000, cash: 12000, verifs: 290, kpis: [{n:"Delta Dental PPO", r:91},{n:"Aetna DMO", r:88},{n:"Cigna Dental", r:82},{n:"UnitedHealthcare", r:78},{n:"MetLife", r:74}] },
    { month: "Oct", ins: 42000, cash: 13500, verifs: 310, kpis: [{n:"Delta Dental PPO", r:92},{n:"Aetna DMO", r:89},{n:"Cigna Dental", r:83},{n:"UnitedHealthcare", r:79},{n:"MetLife", r:75}] },
    { month: "Nov", ins: 45000, cash: 12800, verifs: 315, kpis: [{n:"Delta Dental PPO", r:93},{n:"Aetna DMO", r:90},{n:"Cigna Dental", r:84},{n:"UnitedHealthcare", r:80},{n:"MetLife", r:75}] },
    { month: "Dec", ins: 41000, cash: 16000, verifs: 285, kpis: [{n:"Delta Dental PPO", r:93},{n:"Aetna DMO", r:88},{n:"Cigna Dental", r:84},{n:"UnitedHealthcare", r:81},{n:"MetLife", r:77}] },
    { month: "Jan", ins: 51000, cash: 14000, verifs: 350, kpis: [{n:"Delta Dental PPO", r:94},{n:"Aetna DMO", r:90},{n:"Cigna Dental", r:85},{n:"UnitedHealthcare", r:82},{n:"MetLife", r:76}] },
    { month: "Feb", ins: Math.round(revenueProtected/100) + 48000, cash: Math.round(revenueAtRisk/100) + 12000, verifs: 342, kpis: [{n:"Delta Dental PPO", r:96},{n:"Aetna DMO", r:92},{n:"Cigna Dental", r:87},{n:"UnitedHealthcare", r:85},{n:"MetLife", r:81}] },
  ];

  const currentMonthData = HISTORICAL_REV[selectedMonthIdx];
  const monthlyTotalRev = currentMonthData.ins + currentMonthData.cash;
  const CARRIER_KPIS = currentMonthData.kpis;

  const getRating = (r) => r >= 90 ? { l:"Excellent", c:T.limeDark, bg:T.limeLight, border:T.limeBorder } : r >= 80 ? { l:"Good", c:T.indigo, bg:T.indigoLight, border:T.indigoBorder } : { l:"Review Needed", c:T.red, bg:T.redLight, border:T.redBorder };

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

  return (
    <div style={{ padding: 24, height: "100%", overflowY: "auto", display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <div style={{ color:T.text, fontSize:20, fontWeight:900 }}>Analytics Overview</div>
        <div style={{ color:T.textSoft, fontSize:12, marginTop:2 }}>Interactive metrics. Select a month on the chart to update financial data.</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
        <div style={{ background: T.indigoDark, color: "white", borderRadius: 12, padding: "16px 20px", display: "flex", flexDirection: "column", gap: 4, boxShadow: "0 4px 12px rgba(49, 46, 129, 0.2)" }}>
           <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", opacity: 0.8 }}>Total Revenue ({currentMonthData.month})</div>
           <div style={{ fontSize: 28, fontWeight: 900 }}>{wholeDollars(monthlyTotalRev)}</div>
           <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.9 }}>Based on selected month</div>
        </div>
        <div style={{ background: T.bgCard, border: "1px solid " + T.border, borderRadius: 12, padding: "16px 20px", display: "flex", flexDirection: "column", gap: 4 }}>
           <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: T.textSoft }}>Insurance Payouts</div>
           <div style={{ fontSize: 28, fontWeight: 900, color: T.indigo }}>{wholeDollars(currentMonthData.ins)}</div>
           <div style={{ fontSize: 11, fontWeight: 700, color: T.textMid }}>{Math.round((currentMonthData.ins / monthlyTotalRev)*100)}% of monthly revenue</div>
        </div>
        <div style={{ background: T.bgCard, border: "1px solid " + T.border, borderRadius: 12, padding: "16px 20px", display: "flex", flexDirection: "column", gap: 4 }}>
           <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: T.textSoft }}>Cash / Out-of-Pocket</div>
           <div style={{ fontSize: 28, fontWeight: 900, color: T.limeDark }}>{wholeDollars(currentMonthData.cash)}</div>
           <div style={{ fontSize: 11, fontWeight: 700, color: T.textMid }}>{Math.round((currentMonthData.cash / monthlyTotalRev)*100)}% of monthly revenue</div>
        </div>
        <div style={{ background: T.bgCard, border: "1px solid " + T.border, borderRadius: 12, padding: "16px 20px", display: "flex", flexDirection: "column", gap: 4 }}>
           <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: T.textSoft }}>Verifications in {currentMonthData.month}</div>
           <div style={{ fontSize: 28, fontWeight: 900, color: T.text }}>{currentMonthData.verifs}</div>
           <div style={{ fontSize: 11, fontWeight: 700, color: T.textMid }}>Volume across all providers</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
        <div style={{ background:T.bgCard, border:"1px solid " + T.border, borderRadius:12, padding:"16px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ color:T.textSoft, fontSize:11, fontWeight:800, textTransform:"uppercase", letterSpacing:"0.05em" }}>Current Roster Clean Claim Rate</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize:32, fontWeight:900, color:T.limeDark, lineHeight:1 }}>{protectedPct}%</span>
            <span style={{ fontSize:13, fontWeight:700, color:T.textMid }}>Protected</span>
          </div>
          <div style={{ height: 6, width: "100%", background: T.redLight, borderRadius: 3, overflow: "hidden", display: "flex" }}>
            <div style={{ height: "100%", width: `${protectedPct}%`, background: T.lime }} />
          </div>
          <div style={{ fontSize:11, color:T.textSoft, fontWeight:600, marginTop:4 }}>
            {dollars(revenueProtected)} cleared vs {dollars(revenueAtRisk)} at risk today
          </div>
        </div>

        <div style={{ background:T.bgCard, border:"1px solid " + T.border, borderRadius:12, padding:"16px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ color:T.textSoft, fontSize:11, fontWeight:800, textTransform:"uppercase", letterSpacing:"0.05em" }}>Overall Automation Rate</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize:32, fontWeight:900, color:T.indigo, lineHeight:1 }}>{autoRate}%</span>
            <span style={{ fontSize:13, fontWeight:700, color:T.textMid }}>Zero-touch</span>
          </div>
          <div style={{ fontSize:12, color:T.text, fontWeight:700, marginTop:4, display:"flex", alignItems:"center", gap:6 }}>
             <span style={{ width:8, height:8, borderRadius:"50%", background:T.indigo }} />
             {autoVerifications.length} of {totalVerified} verified automatically
          </div>
        </div>

        <div style={{ background:T.bgCard, border:"1px solid " + T.border, borderRadius:12, padding:"16px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ color:T.textSoft, fontSize:11, fontWeight:800, textTransform:"uppercase", letterSpacing:"0.05em" }}>Total Staff Time Saved</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize:32, fontWeight:900, color:T.rpaDark, lineHeight:1 }}>{timeSavedHours}h</span>
            <span style={{ fontSize:13, fontWeight:700, color:T.textMid }}>Recovered</span>
          </div>
          <div style={{ fontSize:12, color:T.text, fontWeight:700, marginTop:4, display:"flex", alignItems:"center", gap:6 }}>
            <span style={{ width:8, height:8, borderRadius:"50%", background:T.rpaDark }} />
            {autoVerifications.length} phone calls avoided
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ background:T.bgCard, border:"1px solid " + T.border, borderRadius:12, padding: "16px 20px", gridColumn: "1 / -1" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 16 }}>
             <div style={{ color:T.text, fontSize:14, fontWeight:900 }}>Revenue Generation (Cash vs. Insurance)</div>
             <div style={{ display: "flex", gap: 12 }}>
               <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: T.textMid }}>
                 <span style={{ width: 10, height: 10, borderRadius: 2, background: T.indigo }} /> Insurance Payout
               </div>
               <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: T.textMid }}>
                 <span style={{ width: 10, height: 10, borderRadius: 2, background: T.lime }} /> Cash / Out-of-Pocket
               </div>
             </div>
          </div>

          <div style={{ display: "flex", alignItems: "flex-end", height: 180, gap: 20, paddingTop: 10, borderBottom: "1px solid " + T.borderStrong }}>
            {HISTORICAL_REV.map((d, i) => {
               const maxH = 80000;
               const insPct = (d.ins / maxH) * 100;
               const cashPct = (d.cash / maxH) * 100;
               const isSelected = selectedMonthIdx === i;

               return (
                 <div key={i} onClick={() => setSelectedMonthIdx(i)} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%", gap: 6, cursor: "pointer", opacity: isSelected ? 1 : 0.4, transition: "0.2s", transform: isSelected ? "scale(1.02)" : "scale(1)" }}>
                    <div style={{ color: isSelected ? T.text : T.textSoft, fontSize: 10, fontWeight: 800 }}>${((d.ins+d.cash)/1000).toFixed(1)}k</div>
                    <div style={{ width: "100%", maxWidth: 60, display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%" }}>
                       <div style={{ height: `${cashPct}%`, background: T.lime, borderRadius: "4px 4px 0 0", borderBottom: "2px solid white" }} title={`Cash: $${d.cash}`} />
                       <div style={{ height: `${insPct}%`, background: T.indigo, borderRadius: "0 0 0 0" }} title={`Insurance: $${d.ins}`} />
                    </div>
                 </div>
               )
            })}
          </div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 20, marginTop: 8 }}>
            {HISTORICAL_REV.map((d, i) => (
               <div key={i} style={{ flex: 1, textAlign: "center", color: selectedMonthIdx === i ? T.text : T.textSoft, fontSize: 11, fontWeight: 800 }}>{d.month}</div>
            ))}
          </div>
        </div>

        <div style={{ background:T.bgCard, border:"1px solid " + T.border, borderRadius:12, padding: "16px 20px" }}>
          <div style={{ color:T.text, fontSize:14, fontWeight:900, marginBottom:16 }}>Carrier Payout Rates ({currentMonthData.month})</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {CARRIER_KPIS.map((carrier, idx) => {
              const rating = getRating(carrier.r);
              return (
                <div key={idx} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 10, borderBottom: idx < 4 ? "1px solid " + T.border : "none" }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: T.text }}>{carrier.n}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                     <span style={{ fontSize: 14, fontWeight: 900, color: rating.c }}>{carrier.r}%</span>
                     <Badge label={rating.l} color={rating.c} bg={rating.bg} border={rating.border} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div style={{ background:T.bgCard, border:"1px solid " + T.border, borderRadius:12, padding: "16px 20px" }}>
          <div style={{ color:T.text, fontSize:14, fontWeight:900, marginBottom:16 }}>Top Denial Risks Caught</div>
          {sortedFlags.length === 0 ? (
            <div style={{ textAlign:"center", padding:"30px 0", color:T.textSoft, fontSize:12, fontWeight:600 }}>No flags detected yet.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {sortedFlags.map(([flagName, count], idx) => {
                const max = sortedFlags[0][1];
                const pctOfMax = (count / max) * 100;
                return (
                  <div key={idx}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 700, color: T.textMid, marginBottom: 4 }}>
                      <span>{flagName}</span>
                      <span>{count}</span>
                    </div>
                    <div style={{ height: 8, width: "100%", background: T.amberLight, borderRadius: 4, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${pctOfMax}%`, background: T.amber, borderRadius: 4 }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

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
  const SInput = ({ label, type = "text", placeholder, value, onChange }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 11, fontWeight: 800, color: T.textMid, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</label>
      <input type={type} placeholder={placeholder} value={value} onChange={onChange}
        style={{ padding: "11px 14px", border: "1px solid " + T.border, borderRadius: 8, fontSize: 14,
          background: T.bgCard, outline: "none", color: T.text, fontFamily: "inherit", width: "100%" }}
        onFocus={e => e.target.style.borderColor = T.indigoDark}
        onBlur={e  => e.target.style.borderColor = T.border} />
    </div>
  );

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
              value={editUser} onChange={e => setEditUser(e.target.value)} />
            <SInput label="Portal Password" type="password" placeholder="••••••••"
              value={editPass} onChange={e => setEditPass(e.target.value)} />
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
                <SInput label="Practice Name" value={pracName} onChange={e => setPracName(e.target.value)} />
                <div style={{ display: "flex", gap: 14 }}>
                  <div style={{ flex: 1 }}>
                    <SInput label="NPI Number" value={npiVal} onChange={e => setNpiVal(e.target.value)} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <SInput label="Tax ID (TIN)" type="password" placeholder="Encrypted"
                      value={taxIdVal} onChange={e => setTaxIdVal(e.target.value)} />
                  </div>
                </div>
                <SInput label="Primary Contact Email" type="email" value={emailVal}
                  onChange={e => setEmailVal(e.target.value)} />
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
                          value={pmsSyncKey} onChange={e => setPmsSyncKey(e.target.value)} />
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
  const [toastMsg, setToastMsg] = useState("");

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
  const [dismissedAlerts, setDismissedAlerts] = useState({ blocked: false, notify: false });
  const [showDirectoryModal, setShowDirectoryModal] = useState(false);
  const [newPatientPreseedTime, setNewPatientPreseedTime] = useState("9:00 AM");
  const [newPatientPreseedDate, setNewPatientPreseedDate] = useState("");

  // Track which patients have had auto-verify queued this session
  const autoQueued = useRef(new Set());

  // ── Mount ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const todayStr = new Date().toISOString().split("T")[0];
    setNewPatientPreseedDate(todayStr);
    setIsMounted(true);
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

  // ── Fetch: today's schedule (Kanban) ─────────────────────────────────────────
  const loadDailySchedule = useCallback(async (dateStr) => {
    setDailyLoading(true);
    setDailyError(null);
    try {
      const data = await apiGetDailySchedule(dateStr);
      // Backend returns hoursUntil pre-computed; if it doesn't yet, compute here:
      const withHours = data.map(p => {
        if (p.hoursUntil != null) return p;
        const diff = new Date(`${p.appointment_date}T${p.appointment_time || "09:00"}`) - new Date();
        return { ...p, hoursUntil: Math.floor(diff / (1000 * 60 * 60)) };
      });
      setPatients(withHours);
    } catch (err) {
      setDailyError(err.message);
    } finally {
      setDailyLoading(false);
    }
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
    setNewPatientPreseedDate(dateStr);
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
    loadDailySchedule(todayStr);
    loadCalendar(monthStr);
  }, [isMounted, loadDailySchedule, loadCalendar]);

  // ── Verify: calls real API — same phase logic, no setTimeout ────────────────
  const verify = useCallback(async (patient, trigger = "manual") => {
    if (isLoading(patient.id)) return;
    const runPhases = [];

    setPhase(patient.id, { phase: "api" });
    let apiResult;
    try {
      apiResult = await apiPostVerify(patient.id, trigger);
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
        const rpaResult = await apiPostVerify(patient.id, "rpa_fallback");
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
      if (!h) return;
      const in24h = h <= 24 && h > 0;
      const in7d  = h <= 168 && h > 24;
      const trigger = in24h ? "24h_auto" : in7d ? "7d_auto" : null;
      if (!trigger) return;
      const key = `${patient.id}_${trigger}`;
      if (autoQueued.current.has(key)) return;
      autoQueued.current.add(key);
      setTimeout(() => verify(patient, trigger), (in24h ? 600 : 1200) + Math.random() * 400);
    });
  }, [patients, verify]);

  // ── Event handlers ────────────────────────────────────────────────────────────
  const handleSelect = (p) => {
    setSelected(p);
    setSchedulePanel("benefits");
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

  const handleAddPatientClick = (time, preseedDate) => {
    setNewPatientPreseedTime(time);
    if (preseedDate) setNewPatientPreseedDate(preseedDate);
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
                    onClick={() => handleAddPatientClick("9:00 AM", todayStrLocal)}
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
                onOpenAlerts={() => setSchedulePanel("alerts")}
                onOpenNotify={() => setSchedulePanel("outreach")}
              />

              {/* Kanban: skeleton while loading, real cards when ready */}
              {dailyLoading ? <KanbanSkeleton /> : (
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))", gap:10, minHeight:600 }}>
                  {COLS.map(col => {
                    const colPts = patients.filter(col.filter);
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
                  triage={selected ? triageMap[selected.id] : null} showToast={showToast} />
              )}
              {schedulePanel === "alerts" && (
                <AlertsPanel list={blockedList} agentLog={agentLog}
                  onApprove={handleApprove} onDismiss={handleDismiss}
                  onClose={() => setSchedulePanel("benefits")}
                  onSelect={(p) => { setSelected(p); setSchedulePanel("benefits"); }}
                  showToast={showToast} />
              )}
              {schedulePanel === "outreach" && (
                <OutreachPanel list={notifyList} agentLog={agentLog}
                  onApprove={handleApprove} onDismiss={handleDismiss}
                  onClose={() => setSchedulePanel("benefits")}
                  onSelect={(p) => { setSelected(p); setSchedulePanel("benefits"); }}
                  showToast={showToast} />
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Directory modal ───────────────────────────────────────────────── */}
      {showDirectoryModal && (
        <DirectorySearchModal
          time={newPatientPreseedTime}
          date={newPatientPreseedDate}
          onClose={() => setShowDirectoryModal(false)}
          onSelect={(p) => {
            const diff = new Date(p.appointmentDate) - new Date();
            handleAddPatient({ ...p, hoursUntil: Math.floor(diff / (1000 * 60 * 60)) + 9 });
            setShowDirectoryModal(false);
            showToast(`${p.name} added to schedule!`);
          }}
        />
      )}

      {toastMsg && <ToastBar msg={toastMsg} />}
    </div>
  );
}
