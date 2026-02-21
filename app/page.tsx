import Link from "next/link";
import { FeatureGrid } from "./FeatureGrid";

/* ─────────────────────────────────────────────────────────────────────────────
 *  Level AI — Marketing Landing Page
 *  Clean, modern light-mode SaaS page
 *  Next.js 16 server component · Tailwind v4
 * ───────────────────────────────────────────────────────────────────────────── */

// ── Inline SVG icons (no deps) ──────────────────────────────────────────────
function IconShield({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}
function IconZap({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}
function IconClock({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  );
}
function IconBot({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="10" rx="2" /><circle cx="12" cy="5" r="2" /><path d="M12 7v4" /><line x1="8" y1="16" x2="8" y2="16" /><line x1="16" y1="16" x2="16" y2="16" />
    </svg>
  );
}
function IconPlug({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22v-5" /><path d="M9 8V2" /><path d="M15 8V2" /><path d="M18 8v4a6 6 0 01-12 0V8z" />
    </svg>
  );
}
function IconPlay({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><polygon points="10 8 16 12 10 16 10 8" />
    </svg>
  );
}
function IconFileText({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" />
    </svg>
  );
}
function IconSearch({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}
function IconCheck({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
function IconArrowRight({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
    </svg>
  );
}
function IconMail({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" />
    </svg>
  );
}

// ── Data ─────────────────────────────────────────────────────────────────────
const FEATURES = [
  {
    icon: IconShield,
    iconName: "IconShield",
    title: "Autonomous Overnight Verification",
    description: "Every patient on tomorrow\u2019s schedule is verified before your team walks in. A color-coded risk dashboard replaces the morning phone marathon.",
    detail: {
      headline: "Your schedule is verified before the coffee is ready.",
      body: "Level AI pulls tomorrow\u2019s schedule from your PMS every evening and runs every patient through our clearinghouse automatically. By the time your front desk opens the dashboard, every patient is color-coded: verified, action required, or inactive. No phone calls. No spreadsheets. No surprises.",
      bullets: [
        "7-day and 24-hour auto-verify windows",
        "Color-coded kanban board with real-time status",
        "Automatic retry for transient payer errors",
        "Works overnight so your team hits the ground running",
      ],
    },
  },
  {
    icon: IconFileText,
    iconName: "IconFileText",
    title: "Instant Pre-Auth Generation",
    description: "One click produces a complete, payer-specific pre-authorization letter with correct CDT codes, clinical narratives, and practice credentials. No templates to fill.",
    detail: {
      headline: "Pre-auth letters that write themselves.",
      body: "Our AI reads the patient\u2019s benefits, identifies the procedure codes, and generates a complete pre-authorization letter tailored to the specific payer\u2019s requirements. It includes the correct CDT codes, clinical narratives, practice credentials, and even the right fax number. One click, done.",
      bullets: [
        "Payer-specific formatting and requirements",
        "Auto-populated CDT codes and clinical narratives",
        "Downloadable PDF ready to send",
        "Eliminates hours of manual letter writing per week",
      ],
    },
  },
  {
    icon: IconSearch,
    iconName: "IconSearch",
    title: "Clause & Limitation Intelligence",
    description: "Automatically flags missing tooth clauses, waiting periods, frequency limitations, and annual max issues \u2014 before the patient is in the chair.",
    detail: {
      headline: "Catch the gotchas that cost you thousands.",
      body: "Most verification tools tell you if a patient is \u201Cactive.\u201D That\u2019s table stakes. Level AI digs into the fine print \u2014 missing tooth clauses, waiting periods, frequency limitations, annual maximums, downgrades, and assignment of benefits. These are the hidden landmines that cause chair-side surprises and claim denials.",
      bullets: [
        "Missing tooth clause detection and flagging",
        "Annual max and deductible tracking",
        "Frequency limitation cross-referencing",
        "Downgrade detection for composites and crowns",
      ],
    },
  },
  {
    icon: IconBot,
    iconName: "IconBot",
    title: "AI Benefits Analyst (Payer Pal)",
    description: "Ask plain-English questions about any patient\u2019s coverage. Our AI reads the full eligibility response and gives a straight answer in seconds.",
    detail: {
      headline: "Ask it anything. Get a straight answer.",
      body: "Payer Pal is your AI-powered benefits analyst. Instead of decoding cryptic 271 responses or waiting on hold with the insurance company, just ask a plain-English question: \u201CDoes this patient have coverage for a crown on #14?\u201D or \u201CWhat\u2019s their remaining annual max?\u201D Payer Pal reads the full eligibility response and gives you a clear, accurate answer in seconds.",
      bullets: [
        "Plain-English Q&A about any patient\u2019s benefits",
        "Reads and interprets full 271 eligibility responses",
        "Answers in seconds, not minutes on hold",
        "Flag answers you disagree with for admin review",
      ],
    },
  },
  {
    icon: IconPlug,
    iconName: "IconPlug",
    title: "Deep PMS Integration",
    description: "Native connections to Open Dental, Dentrix, and Eaglesoft. Schedule data syncs automatically \u2014 no CSV uploads, no double-entry, no IT involvement.",
    detail: {
      headline: "Plug in once. Never think about it again.",
      body: "Level AI connects directly to your practice management system \u2014 Open Dental, Dentrix, or Eaglesoft. Your schedule syncs automatically every 3 minutes throughout the day. New appointments, cancellations, and reschedules are reflected in real-time. No CSV uploads, no manual data entry, no IT department required.",
      bullets: [
        "5-minute setup with guided wizard",
        "Auto-sync every 3 minutes throughout the day",
        "Handles cancellations, add-ons, and reschedules",
        "Webhook support for instant PMS event processing",
      ],
    },
  },
  {
    icon: IconPlay,
    iconName: "IconPlay",
    title: "Risk-Free Sandbox Demo",
    description: "Try the full platform with realistic demo data before connecting your practice. No credit card, no commitment, no sales call required.",
    detail: {
      headline: "See it work before you commit to anything.",
      body: "Our sandbox loads realistic demo patients with real-world insurance scenarios \u2014 verified patients, ones that need action, inactive coverage, and tricky edge cases. Click around, verify patients, generate pre-auth letters, ask Payer Pal questions. It\u2019s the full product experience with zero risk and zero commitment.",
      bullets: [
        "Realistic demo data with 8 patient scenarios",
        "Full feature access \u2014 nothing gated or hidden",
        "No credit card, no sign-up, no sales call",
        "Takes 30 seconds to start exploring",
      ],
    },
  },
];

const STEPS = [
  {
    num: "01",
    title: "Connect your PMS",
    description: "Link Open Dental, Dentrix, or Eaglesoft in under five minutes. We pull tomorrow\u2019s schedule automatically.",
  },
  {
    num: "02",
    title: "AI verifies every patient",
    description: "Level AI runs real-time eligibility checks through our clearinghouse integration and flags risks before patients arrive.",
  },
  {
    num: "03",
    title: "You review & approve",
    description: "A color-coded kanban board shows verified, action-needed, and failed patients. Approve SMS reminders and pre-auth letters with one click.",
  },
];

const PRICING = [
  {
    name: "Starter",
    price: "$199",
    period: "/month",
    trial: "14-day free trial",
    description: "For solo practices getting started with AI verification.",
    features: [
      "Unlimited verifications",
      "Daily schedule sync",
      "Payer Pal AI assistant",
      "Pre-auth letter generator",
      "Email support",
    ],
    cta: "Start 14-Day Free Trial",
    highlighted: false,
  },
  {
    name: "Professional",
    price: "$399",
    period: "/month",
    trial: "14-day free trial",
    description: "For growing practices that want the full AI experience.",
    features: [
      "Unlimited verifications",
      "Real-time PMS write-back",
      "SMS patient outreach",
      "Payer portal automation",
      "Clause & limitation intelligence",
      "Priority support",
    ],
    cta: "Start 14-Day Free Trial",
    highlighted: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "",
    trial: "14-day free trial",
    description: "For DSOs and multi-location groups with advanced needs.",
    features: [
      "Everything in Professional",
      "Multi-location dashboard",
      "Custom integrations",
      "Dedicated account manager",
      "SLA & BAA included",
      "Volume discounts",
    ],
    cta: "Contact Sales",
    highlighted: false,
  },
];

const STATS = [
  { value: "98%", label: "Verification accuracy" },
  { value: "< 3s", label: "Average check time" },
  { value: "40hrs", label: "Saved per month per practice" },
  { value: "500+", label: "Dental practices served" },
];

// ── Page ─────────────────────────────────────────────────────────────────────
export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#F5F5F0] text-[#1A1A18] selection:bg-[#14B8A6]/30 overflow-x-hidden font-sans">

      {/* ═══════════════════════════ NAVIGATION ═══════════════════════════════ */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-black/[0.06] bg-[#F5F5F0]/80 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl flex items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-3">
            <img src="/levelai-logo-dark.png" alt="Level AI" className="h-9" draggable={false} />
          </Link>
          <div className="hidden md:flex items-center gap-8 text-sm font-semibold text-[#525252]">
            <a href="#features" className="hover:text-[#1A1A18] transition-colors">Features</a>
            <a href="#how-it-works" className="hover:text-[#1A1A18] transition-colors">How It Works</a>
            <a href="#pricing" className="hover:text-[#1A1A18] transition-colors">Pricing</a>
            <Link href="/contact" className="hover:text-[#1A1A18] transition-colors">Contact</Link>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login" className="hidden sm:inline-flex items-center gap-2 rounded-lg border border-black/10 bg-black/[0.03] px-4 py-2 text-sm font-bold text-[#1A1A18] hover:bg-black/[0.06] transition-colors">
              Sign In
            </Link>
            <Link href="/login" className="inline-flex items-center gap-2 rounded-lg bg-[#14B8A6] px-4 py-2 text-sm font-bold text-white hover:bg-[#0D9488] transition-colors shadow-lg shadow-[#14B8A6]/20">
              Get Started Free
            </Link>
          </div>
        </div>
      </nav>

      {/* ═══════════════════════════ HERO ══════════════════════════════════════ */}
      <section className="relative pt-32 pb-24 md:pt-44 md:pb-36 overflow-hidden">
        {/* Glow orbs */}
        <div className="absolute top-[-200px] left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-[#14B8A6]/[0.07] rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-[-100px] right-[-200px] w-[500px] h-[500px] bg-[#14B8A6]/[0.04] rounded-full blur-[100px] pointer-events-none" />

        <div className="relative mx-auto max-w-5xl px-6 text-center">
          {/* Badge */}
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-[#14B8A6]/30 bg-[#14B8A6]/[0.08] px-4 py-1.5 text-xs font-bold text-[#0D9488] tracking-wide uppercase">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#14B8A6] animate-pulse" />
            Zero Data Retention Architecture
          </div>

          <h1 className="text-4xl md:text-6xl lg:text-7xl font-black leading-[0.95] tracking-tight mb-6">
            Stop paying your staff to sit on hold
            <br />
            <span className="bg-gradient-to-r from-[#0D9488] to-[#14B8A6] bg-clip-text text-transparent">with insurance companies.</span>
          </h1>

          <p className="mx-auto max-w-2xl text-lg md:text-xl text-[#525252] leading-relaxed mb-10">
            Level AI is the first autonomous dental insurance verification platform built with Zero Data Retention.
            We do the portal scraping and the pre-auths instantly. You just treat the patient.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/login" className="group inline-flex items-center gap-2 rounded-xl bg-[#14B8A6] px-7 py-3.5 text-base font-extrabold text-white shadow-xl shadow-[#14B8A6]/25 hover:shadow-[#14B8A6]/40 hover:bg-[#0D9488] transition-all">
              Get Started Free
              <IconArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link href="/login" className="inline-flex items-center gap-2 rounded-xl border border-black/10 bg-black/[0.03] px-7 py-3.5 text-base font-bold text-[#1A1A18] hover:bg-black/[0.06] transition-colors">
              <IconPlay className="w-4 h-4 text-[#14B8A6]" />
              Try the Sandbox
            </Link>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════ STATS BAR ════════════════════════════════ */}
      <section className="border-y border-black/[0.06] bg-white/50">
        <div className="mx-auto max-w-6xl grid grid-cols-2 md:grid-cols-4 divide-x divide-black/[0.06]">
          {STATS.map((s) => (
            <div key={s.label} className="py-10 px-6 text-center">
              <div className="text-3xl md:text-4xl font-black text-[#14B8A6] mb-1">{s.value}</div>
              <div className="text-sm text-[#525252] font-semibold">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ═══════════════════════════ TRUST INDICATOR (ZDR) ══════════════════ */}
      <section className="py-24 md:py-36">
        <div className="mx-auto max-w-6xl px-6">
          <div className="text-center mb-16">
            <div className="text-xs font-extrabold tracking-[0.2em] uppercase text-[#14B8A6] mb-4">Zero Data Retention</div>
            <h2 className="text-3xl md:text-5xl font-black tracking-tight mb-4">
              Zero patient data stored.
              <br className="hidden md:block" /> Ever.
            </h2>
            <p className="mx-auto max-w-2xl text-[#525252] text-lg">
              Legacy platforms hoard your patient data in vulnerable databases. We don&apos;t. Our stateless
              edge workers process your pre-auths and vanish. 100% HIPAA compliant. 0% data liability.
            </p>
          </div>

          {/* VALUE PILLARS */}
          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                icon: IconZap,
                stat: "Ops Managers",
                title: "Eliminate the workflow, not organize it",
                body: "Most software just organizes manual work. Level AI eliminates it. Our AI reads your schedule, scrapes payer portals, and flags coverage gaps automatically \u2014 before the morning huddle.",
              },
              {
                icon: IconShield,
                stat: "IT & Compliance",
                title: "Stateless architecture, zero attack surface",
                body: "Our stateless architecture shrinks your attack surface to near zero. Protected Health Information is never stored at rest on our servers. No data at rest means no data to breach.",
              },
              {
                icon: IconClock,
                stat: "Practice Owners",
                title: "Stop chair-side surprises cold",
                body: "We catch claim denials before the patient sits in the chair. AI-parsed breakdowns flag missing tooth clauses, annual max issues, and frequency limitations so you never eat a write-off.",
              },
            ].map((card) => (
              <div key={card.title} className="group rounded-2xl border border-black/[0.06] bg-white p-8 hover:border-[#14B8A6]/30 transition-colors">
                <card.icon className="w-8 h-8 text-[#14B8A6] mb-5" />
                <div className="text-xs font-extrabold text-[#14B8A6] uppercase tracking-wider mb-2">{card.stat}</div>
                <div className="text-base font-bold text-[#1A1A18] mb-3">{card.title}</div>
                <p className="text-sm text-[#525252] leading-relaxed">{card.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════ THE SOLUTION ═════════════════════════════ */}
      <section className="py-24 md:py-36 bg-gradient-to-b from-transparent via-[#14B8A6]/[0.02] to-transparent">
        <div className="mx-auto max-w-6xl px-6">
          <div className="text-center mb-16">
            <div className="text-xs font-extrabold tracking-[0.2em] uppercase text-[#14B8A6] mb-4">Legacy vs. Level</div>
            <h2 className="text-3xl md:text-5xl font-black tracking-tight mb-4">
              Your current vendor is a
              <br className="hidden md:block" /> slow, risky liability.
            </h2>
            <p className="mx-auto max-w-2xl text-[#525252] text-lg">
              Legacy verification platforms store your patient data indefinitely, charge per-lookup fees,
              and still require manual phone calls. Level AI is a different category entirely.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
            {[
              { label: "Legacy Platforms", color: "text-[#F87171]", border: "border-[#F87171]/20", items: [
                "Patient data stored in vulnerable databases",
                "Manual phone calls still required for exceptions",
                "Batch processing \u2014 results arrive hours late",
                "Per-verification fees that scale against you",
                "No pre-auth automation, just eligibility checks",
              ]},
              { label: "Level AI", color: "text-[#14B8A6]", border: "border-[#14B8A6]/20", items: [
                "Zero Data Retention \u2014 PHI never stored at rest",
                "Fully autonomous portal scraping, no phone calls",
                "Real-time results before the morning huddle",
                "Flat monthly pricing, unlimited verifications",
                "Pre-auths, eligibility, and outreach \u2014 all automated",
              ]},
            ].map((col) => (
              <div key={col.label} className={`rounded-2xl border ${col.border} bg-white p-8`}>
                <div className={`text-sm font-extrabold tracking-wide uppercase ${col.color} mb-6`}>{col.label}</div>
                <ul className="space-y-4">
                  {col.items.map((item) => (
                    <li key={item} className="flex items-start gap-3 text-sm text-[#525252] leading-relaxed">
                      <IconCheck className={`w-4 h-4 mt-0.5 flex-shrink-0 ${col.color}`} />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════ FEATURES ═════════════════════════════════ */}
      <section id="features" className="py-24 md:py-36">
        <div className="mx-auto max-w-6xl px-6">
          <div className="text-center mb-16">
            <div className="text-xs font-extrabold tracking-[0.2em] uppercase text-[#14B8A6] mb-4">Features</div>
            <h2 className="text-3xl md:text-5xl font-black tracking-tight mb-4">
              Built for practices that
              <br className="hidden md:block" /> refuse to settle.
            </h2>
          </div>

          <FeatureGrid features={FEATURES.map(f => ({
            iconName: f.iconName,
            title: f.title,
            description: f.description,
            detail: f.detail,
          }))} />
        </div>
      </section>

      {/* ═══════════════════════════ HOW IT WORKS ═════════════════════════════ */}
      <section id="how-it-works" className="py-24 md:py-36 bg-white/40">
        <div className="mx-auto max-w-5xl px-6">
          <div className="text-center mb-16">
            <div className="text-xs font-extrabold tracking-[0.2em] uppercase text-[#14B8A6] mb-4">How it works</div>
            <h2 className="text-3xl md:text-5xl font-black tracking-tight mb-4">
              Up and running in minutes.
            </h2>
            <p className="mx-auto max-w-xl text-[#525252] text-lg">
              No lengthy onboarding. No IT department required. Connect your PMS and start verifying today.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {STEPS.map((step, i) => (
              <div key={step.num} className="relative text-center md:text-left">
                {/* Connector line */}
                {i < STEPS.length - 1 && (
                  <div className="hidden md:block absolute top-8 left-[calc(100%+0.5rem)] w-[calc(100%-1rem)] h-px bg-gradient-to-r from-[#14B8A6]/40 to-transparent" />
                )}
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#14B8A6]/10 border border-[#14B8A6]/20 text-xl font-black text-[#14B8A6] mb-5">
                  {step.num}
                </div>
                <div className="text-lg font-bold text-[#1A1A18] mb-2">{step.title}</div>
                <p className="text-sm text-[#525252] leading-relaxed">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════ PRICING ══════════════════════════════════ */}
      <section id="pricing" className="py-24 md:py-36">
        <div className="mx-auto max-w-6xl px-6">
          <div className="text-center mb-16">
            <div className="text-xs font-extrabold tracking-[0.2em] uppercase text-[#14B8A6] mb-4">Pricing</div>
            <h2 className="text-3xl md:text-5xl font-black tracking-tight mb-4">
              Simple, transparent pricing.
            </h2>
            <p className="mx-auto max-w-xl text-[#525252] text-lg">
              Start free. Scale when you&apos;re ready. No contracts, no surprises.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {PRICING.map((plan) => (
              <div
                key={plan.name}
                className={`relative rounded-2xl border p-8 flex flex-col ${
                  plan.highlighted
                    ? "border-[#14B8A6]/40 bg-gradient-to-b from-[#14B8A6]/[0.06] to-[#1A1A1A] shadow-xl shadow-[#14B8A6]/10"
                    : "border-black/[0.06] bg-white"
                }`}
              >
                {plan.highlighted && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[#14B8A6] px-4 py-1 text-xs font-extrabold text-white tracking-wide uppercase">
                    Most Popular
                  </div>
                )}
                <div className="text-sm font-bold text-[#525252] uppercase tracking-wide mb-2">{plan.name}</div>
                <div className="flex items-baseline gap-1 mb-1">
                  <span className="text-4xl font-black text-[#1A1A18]">{plan.price}</span>
                  {plan.period && <span className="text-sm text-[#525252] font-semibold">{plan.period}</span>}
                </div>
                {plan.trial && (
                  <div className="text-xs font-bold text-[#14B8A6] mb-3">{plan.trial} &middot; No credit card required</div>
                )}
                <p className="text-sm text-[#525252] mb-6 leading-relaxed">{plan.description}</p>
                <ul className="space-y-3 mb-8 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-[#525252]">
                      <IconCheck className="w-4 h-4 mt-0.5 text-[#14B8A6] flex-shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link
                  href={plan.name === "Enterprise" ? "/contact" : "/login"}
                  className={`block w-full text-center rounded-xl py-3 text-sm font-extrabold transition-colors ${
                    plan.highlighted
                      ? "bg-[#14B8A6] text-white hover:bg-[#0D9488] shadow-lg shadow-[#14B8A6]/20"
                      : "border border-black/10 bg-black/[0.03] text-[#1A1A18] hover:bg-black/[0.06]"
                  }`}
                >
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════ CONTACT / CTA ════════════════════════════ */}
      <section id="contact" className="py-24 md:py-36 bg-gradient-to-b from-transparent via-[#14B8A6]/[0.03] to-transparent">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <div className="rounded-3xl border border-black/[0.06] bg-white p-12 md:p-16">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#14B8A6]/10 mb-6">
              <IconMail className="w-6 h-6 text-[#14B8A6]" />
            </div>
            <h2 className="text-3xl md:text-4xl font-black tracking-tight mb-4">
              Ready to stop leaving money on the table?
            </h2>
            <p className="mx-auto max-w-xl text-[#525252] text-lg mb-8">
              Whether you&apos;re a solo practice or a 50-location DSO, Level AI eliminates insurance busywork
              and protects your revenue from day one. Zero risk. Zero data stored.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/login" className="group inline-flex items-center gap-2 rounded-xl bg-[#14B8A6] px-7 py-3.5 text-base font-extrabold text-white shadow-xl shadow-[#14B8A6]/25 hover:shadow-[#14B8A6]/40 hover:bg-[#0D9488] transition-all">
                Start Your Free Trial
                <IconArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Link>
              <Link href="/contact" className="inline-flex items-center gap-2 rounded-xl border border-black/10 bg-black/[0.03] px-7 py-3.5 text-base font-bold text-[#1A1A18] hover:bg-black/[0.06] transition-colors">
                <IconMail className="w-4 h-4 text-[#14B8A6]" />
                Contact Sales
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════ FOOTER ════════════════════════════════════ */}
      <footer className="border-t border-black/[0.06] py-12">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid md:grid-cols-4 gap-10 mb-12">
            {/* Brand */}
            <div className="md:col-span-1">
              <img src="/levelai-logo-dark.png" alt="Level AI" className="h-8 mb-4" draggable={false} />
              <p className="text-sm text-[#A3A3A3] leading-relaxed">
                AI-powered dental insurance verification and benefits management.
              </p>
            </div>
            {/* Links */}
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-[#A3A3A3] mb-4">Product</div>
              <ul className="space-y-2 text-sm">
                <li><a href="#features" className="text-[#525252] hover:text-[#1A1A18] transition-colors">Features</a></li>
                <li><a href="#pricing" className="text-[#525252] hover:text-[#1A1A18] transition-colors">Pricing</a></li>
                <li><a href="#how-it-works" className="text-[#525252] hover:text-[#1A1A18] transition-colors">How It Works</a></li>
                <li><Link href="/login" className="text-[#525252] hover:text-[#1A1A18] transition-colors">Sandbox Demo</Link></li>
              </ul>
            </div>
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-[#A3A3A3] mb-4">Company</div>
              <ul className="space-y-2 text-sm">
                <li><Link href="/contact" className="text-[#525252] hover:text-[#1A1A18] transition-colors">Contact</Link></li>
                <li><a href="mailto:support@levelai.app" className="text-[#525252] hover:text-[#1A1A18] transition-colors">Support</a></li>
              </ul>
            </div>
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-[#A3A3A3] mb-4">Legal</div>
              <ul className="space-y-2 text-sm">
                <li><Link href="/privacy" className="text-[#525252] hover:text-[#1A1A18] transition-colors">Privacy Policy</Link></li>
                <li><Link href="/terms" className="text-[#525252] hover:text-[#1A1A18] transition-colors">Terms of Service</Link></li>
                <li><Link href="/hipaa" className="text-[#525252] hover:text-[#1A1A18] transition-colors">HIPAA Compliance</Link></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-black/[0.06] pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="text-sm text-[#A3A3A3]">&copy; {new Date().getFullYear()} Level AI. All rights reserved.</div>
            <div className="text-sm text-[#A3A3A3]">HIPAA compliant &middot; SOC 2 Type II &middot; BAA available</div>
          </div>
        </div>
      </footer>
    </div>
  );
}
