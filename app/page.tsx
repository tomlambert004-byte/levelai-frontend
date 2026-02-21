import Link from "next/link";

/* ─────────────────────────────────────────────────────────────────────────────
 *  Level AI — Marketing Landing Page
 *  Silicon Valley–style dark-first SaaS page
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
    title: "Daily Insurance Risk Snapshot",
    description: "Every patient on tomorrow\u2019s schedule is automatically verified overnight. Walk in to a color-coded dashboard showing exactly who needs attention.",
  },
  {
    icon: IconFileText,
    title: "Smart Pre-Auth Letter Generator",
    description: "One click generates a complete, payer-specific pre-authorization letter with correct CDT codes, clinical narratives, and practice credentials.",
  },
  {
    icon: IconSearch,
    title: "Missing Tooth Clause Intelligence",
    description: "Automatically flags plans with missing tooth clauses and cross-references against the patient\u2019s history so nothing slips through the cracks.",
  },
  {
    icon: IconBot,
    title: "Payer Pal AI Assistant",
    description: "Ask plain-English questions about any patient\u2019s benefits. Payer Pal reads the 271 response and gives you a straight answer in seconds.",
  },
  {
    icon: IconPlug,
    title: "Real PMS Integration",
    description: "Native connections to Open Dental, Dentrix, and Eaglesoft. Patient data syncs automatically \u2014 no CSV uploads, no double-entry.",
  },
  {
    icon: IconPlay,
    title: "Powerful Sandbox Demo",
    description: "Try the full platform with realistic demo data before connecting your practice. No credit card, no commitment \u2014 just click and explore.",
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
    description: "Level AI runs real-time eligibility checks through the Stedi clearinghouse and flags risks before patients arrive.",
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
    description: "For solo practices getting started with AI verification.",
    features: [
      "Up to 300 verifications / month",
      "Daily schedule sync",
      "Payer Pal AI assistant",
      "Pre-auth letter generator",
      "Email support",
    ],
    cta: "Start Free Trial",
    highlighted: false,
  },
  {
    name: "Professional",
    price: "$399",
    period: "/month",
    description: "For growing practices that want the full AI experience.",
    features: [
      "Unlimited verifications",
      "Real-time PMS write-back",
      "SMS patient outreach",
      "RPA payer portal automation",
      "Missing tooth intelligence",
      "Priority support",
    ],
    cta: "Start Free Trial",
    highlighted: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "",
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
    <div className="min-h-screen bg-[#0A0A0A] text-[#F5F5F0] selection:bg-[#14B8A6]/30 overflow-x-hidden">

      {/* ═══════════════════════════ NAVIGATION ═══════════════════════════════ */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/[0.06] bg-[#0A0A0A]/80 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl flex items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-3">
            <img src="/levelai-logo.png" alt="Level AI" className="h-9" draggable={false} />
          </Link>
          <div className="hidden md:flex items-center gap-8 text-sm font-semibold text-[#A3A3A3]">
            <a href="#features" className="hover:text-[#F5F5F0] transition-colors">Features</a>
            <a href="#how-it-works" className="hover:text-[#F5F5F0] transition-colors">How It Works</a>
            <a href="#pricing" className="hover:text-[#F5F5F0] transition-colors">Pricing</a>
            <a href="#contact" className="hover:text-[#F5F5F0] transition-colors">Contact</a>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="hidden sm:inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-bold text-[#F5F5F0] hover:bg-white/[0.08] transition-colors">
              Sign In
            </Link>
            <Link href="/dashboard" className="inline-flex items-center gap-2 rounded-lg bg-[#14B8A6] px-4 py-2 text-sm font-bold text-white hover:bg-[#0D9488] transition-colors shadow-lg shadow-[#14B8A6]/20">
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
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-[#14B8A6]/30 bg-[#14B8A6]/[0.08] px-4 py-1.5 text-xs font-bold text-[#5EEAD4] tracking-wide uppercase">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#14B8A6] animate-pulse" />
            Now in early access
          </div>

          <h1 className="text-5xl md:text-7xl lg:text-8xl font-black leading-[0.95] tracking-tight mb-6">
            Insurance verification
            <br />
            <span className="bg-gradient-to-r from-[#14B8A6] to-[#5EEAD4] bg-clip-text text-transparent">on autopilot.</span>
          </h1>

          <p className="mx-auto max-w-2xl text-lg md:text-xl text-[#A3A3A3] leading-relaxed mb-10">
            Level AI eliminates the insurance chaos that burns out dental front desks.
            Every patient verified before they walk in the door &mdash; automatically.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/dashboard" className="group inline-flex items-center gap-2 rounded-xl bg-[#14B8A6] px-7 py-3.5 text-base font-extrabold text-white shadow-xl shadow-[#14B8A6]/25 hover:shadow-[#14B8A6]/40 hover:bg-[#0D9488] transition-all">
              Get Started Free
              <IconArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link href="/dashboard" className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-7 py-3.5 text-base font-bold text-[#F5F5F0] hover:bg-white/[0.06] transition-colors">
              <IconPlay className="w-4 h-4 text-[#14B8A6]" />
              Try the Sandbox
            </Link>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════ STATS BAR ════════════════════════════════ */}
      <section className="border-y border-white/[0.06] bg-[#111111]/50">
        <div className="mx-auto max-w-6xl grid grid-cols-2 md:grid-cols-4 divide-x divide-white/[0.06]">
          {STATS.map((s) => (
            <div key={s.label} className="py-10 px-6 text-center">
              <div className="text-3xl md:text-4xl font-black text-[#14B8A6] mb-1">{s.value}</div>
              <div className="text-sm text-[#A3A3A3] font-semibold">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ═══════════════════════════ THE PROBLEM ══════════════════════════════ */}
      <section className="py-24 md:py-36">
        <div className="mx-auto max-w-6xl px-6">
          <div className="text-center mb-16">
            <div className="text-xs font-extrabold tracking-[0.2em] uppercase text-[#D4A031] mb-4">The problem</div>
            <h2 className="text-3xl md:text-5xl font-black tracking-tight mb-4">
              Insurance chaos is costing you
              <br className="hidden md:block" /> time, money, and sanity.
            </h2>
            <p className="mx-auto max-w-2xl text-[#A3A3A3] text-lg">
              Dental front desks spend hours every day on the phone with insurance companies.
              The process is manual, error-prone, and soul-crushing.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                icon: IconClock,
                stat: "8+ hours/week",
                title: "Wasted on hold",
                body: "Front desk staff spend an average of 8 hours per week calling insurance companies to verify benefits manually.",
              },
              {
                icon: IconShield,
                stat: "30% of claims",
                title: "Denied on first pass",
                body: "Missing or incorrect insurance data causes nearly a third of dental claims to be denied, delaying revenue by weeks.",
              },
              {
                icon: IconZap,
                stat: "#1 reason",
                title: "Staff burnout",
                body: "Insurance verification is the number one source of front-desk frustration and the leading cause of staff turnover in dental practices.",
              },
            ].map((card) => (
              <div key={card.title} className="group rounded-2xl border border-white/[0.06] bg-[#111111] p-8 hover:border-[#14B8A6]/30 transition-colors">
                <card.icon className="w-8 h-8 text-[#14B8A6] mb-5" />
                <div className="text-2xl font-black text-[#14B8A6] mb-1">{card.stat}</div>
                <div className="text-base font-bold text-[#F5F5F0] mb-3">{card.title}</div>
                <p className="text-sm text-[#A3A3A3] leading-relaxed">{card.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════ THE SOLUTION ═════════════════════════════ */}
      <section className="py-24 md:py-36 bg-gradient-to-b from-transparent via-[#14B8A6]/[0.02] to-transparent">
        <div className="mx-auto max-w-6xl px-6">
          <div className="text-center mb-16">
            <div className="text-xs font-extrabold tracking-[0.2em] uppercase text-[#14B8A6] mb-4">The solution</div>
            <h2 className="text-3xl md:text-5xl font-black tracking-tight mb-4">
              Meet your AI-powered
              <br className="hidden md:block" /> insurance co-pilot.
            </h2>
            <p className="mx-auto max-w-2xl text-[#A3A3A3] text-lg">
              Level AI plugs into your practice management system and handles insurance verification,
              pre-authorization, and patient outreach &mdash; automatically.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
            {[
              { label: "Before Level AI", color: "text-[#E05C6B]", border: "border-[#E05C6B]/20", items: [
                "Hours on the phone with insurance companies",
                "Manually entering data into spreadsheets",
                "Claim denials catching you off guard",
                "Staff burning out from repetitive work",
                "No visibility until patient walks in",
              ]},
              { label: "After Level AI", color: "text-[#14B8A6]", border: "border-[#14B8A6]/20", items: [
                "Every patient verified automatically overnight",
                "PMS syncs in real-time \u2014 zero data entry",
                "Denials flagged and resolved before they happen",
                "Front desk focuses on patient experience",
                "Full visibility 24 hours before every appointment",
              ]},
            ].map((col) => (
              <div key={col.label} className={`rounded-2xl border ${col.border} bg-[#111111] p-8`}>
                <div className={`text-sm font-extrabold tracking-wide uppercase ${col.color} mb-6`}>{col.label}</div>
                <ul className="space-y-4">
                  {col.items.map((item) => (
                    <li key={item} className="flex items-start gap-3 text-sm text-[#A3A3A3] leading-relaxed">
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
              Everything your front desk needs.
              <br className="hidden md:block" /> Nothing it doesn&apos;t.
            </h2>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map((f) => (
              <div key={f.title} className="group rounded-2xl border border-white/[0.06] bg-[#111111] p-7 hover:border-[#14B8A6]/30 hover:shadow-lg hover:shadow-[#14B8A6]/[0.04] transition-all">
                <div className="w-11 h-11 rounded-xl bg-[#14B8A6]/10 flex items-center justify-center mb-5">
                  <f.icon className="w-5 h-5 text-[#14B8A6]" />
                </div>
                <div className="text-base font-bold text-[#F5F5F0] mb-2">{f.title}</div>
                <p className="text-sm text-[#A3A3A3] leading-relaxed">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════ HOW IT WORKS ═════════════════════════════ */}
      <section id="how-it-works" className="py-24 md:py-36 bg-[#111111]/40">
        <div className="mx-auto max-w-5xl px-6">
          <div className="text-center mb-16">
            <div className="text-xs font-extrabold tracking-[0.2em] uppercase text-[#14B8A6] mb-4">How it works</div>
            <h2 className="text-3xl md:text-5xl font-black tracking-tight mb-4">
              Up and running in minutes.
            </h2>
            <p className="mx-auto max-w-xl text-[#A3A3A3] text-lg">
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
                <div className="text-lg font-bold text-[#F5F5F0] mb-2">{step.title}</div>
                <p className="text-sm text-[#A3A3A3] leading-relaxed">{step.description}</p>
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
            <p className="mx-auto max-w-xl text-[#A3A3A3] text-lg">
              Start free. Scale when you&apos;re ready. No contracts, no surprises.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {PRICING.map((plan) => (
              <div
                key={plan.name}
                className={`relative rounded-2xl border p-8 flex flex-col ${
                  plan.highlighted
                    ? "border-[#14B8A6]/40 bg-gradient-to-b from-[#14B8A6]/[0.06] to-[#111111] shadow-xl shadow-[#14B8A6]/10"
                    : "border-white/[0.06] bg-[#111111]"
                }`}
              >
                {plan.highlighted && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[#14B8A6] px-4 py-1 text-xs font-extrabold text-white tracking-wide uppercase">
                    Most Popular
                  </div>
                )}
                <div className="text-sm font-bold text-[#A3A3A3] uppercase tracking-wide mb-2">{plan.name}</div>
                <div className="flex items-baseline gap-1 mb-2">
                  <span className="text-4xl font-black text-[#F5F5F0]">{plan.price}</span>
                  {plan.period && <span className="text-sm text-[#A3A3A3] font-semibold">{plan.period}</span>}
                </div>
                <p className="text-sm text-[#A3A3A3] mb-6 leading-relaxed">{plan.description}</p>
                <ul className="space-y-3 mb-8 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-[#A3A3A3]">
                      <IconCheck className="w-4 h-4 mt-0.5 text-[#14B8A6] flex-shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link
                  href={plan.name === "Enterprise" ? "#contact" : "/dashboard"}
                  className={`block w-full text-center rounded-xl py-3 text-sm font-extrabold transition-colors ${
                    plan.highlighted
                      ? "bg-[#14B8A6] text-white hover:bg-[#0D9488] shadow-lg shadow-[#14B8A6]/20"
                      : "border border-white/10 bg-white/[0.03] text-[#F5F5F0] hover:bg-white/[0.06]"
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
          <div className="rounded-3xl border border-white/[0.06] bg-[#111111] p-12 md:p-16">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#14B8A6]/10 mb-6">
              <IconMail className="w-6 h-6 text-[#14B8A6]" />
            </div>
            <h2 className="text-3xl md:text-4xl font-black tracking-tight mb-4">
              Ready to eliminate insurance chaos?
            </h2>
            <p className="mx-auto max-w-xl text-[#A3A3A3] text-lg mb-8">
              Whether you&apos;re a solo practice or a 50-location DSO, we&apos;d love to show you how Level AI can
              transform your insurance workflow.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/dashboard" className="group inline-flex items-center gap-2 rounded-xl bg-[#14B8A6] px-7 py-3.5 text-base font-extrabold text-white shadow-xl shadow-[#14B8A6]/25 hover:shadow-[#14B8A6]/40 hover:bg-[#0D9488] transition-all">
                Start Your Free Trial
                <IconArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Link>
              <a href="mailto:hello@lvlai.app" className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-7 py-3.5 text-base font-bold text-[#F5F5F0] hover:bg-white/[0.06] transition-colors">
                <IconMail className="w-4 h-4 text-[#14B8A6]" />
                Contact Sales
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════ FOOTER ════════════════════════════════════ */}
      <footer className="border-t border-white/[0.06] py-12">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid md:grid-cols-4 gap-10 mb-12">
            {/* Brand */}
            <div className="md:col-span-1">
              <img src="/levelai-logo.png" alt="Level AI" className="h-8 mb-4" draggable={false} />
              <p className="text-sm text-[#525252] leading-relaxed">
                AI-powered dental insurance verification and benefits management.
              </p>
            </div>
            {/* Links */}
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-[#525252] mb-4">Product</div>
              <ul className="space-y-2 text-sm">
                <li><a href="#features" className="text-[#A3A3A3] hover:text-[#F5F5F0] transition-colors">Features</a></li>
                <li><a href="#pricing" className="text-[#A3A3A3] hover:text-[#F5F5F0] transition-colors">Pricing</a></li>
                <li><a href="#how-it-works" className="text-[#A3A3A3] hover:text-[#F5F5F0] transition-colors">How It Works</a></li>
                <li><Link href="/dashboard" className="text-[#A3A3A3] hover:text-[#F5F5F0] transition-colors">Sandbox Demo</Link></li>
              </ul>
            </div>
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-[#525252] mb-4">Company</div>
              <ul className="space-y-2 text-sm">
                <li><a href="#contact" className="text-[#A3A3A3] hover:text-[#F5F5F0] transition-colors">Contact</a></li>
                <li><a href="mailto:hello@lvlai.app" className="text-[#A3A3A3] hover:text-[#F5F5F0] transition-colors">Support</a></li>
              </ul>
            </div>
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-[#525252] mb-4">Legal</div>
              <ul className="space-y-2 text-sm">
                <li><a href="#" className="text-[#A3A3A3] hover:text-[#F5F5F0] transition-colors">Privacy Policy</a></li>
                <li><a href="#" className="text-[#A3A3A3] hover:text-[#F5F5F0] transition-colors">Terms of Service</a></li>
                <li><a href="#" className="text-[#A3A3A3] hover:text-[#F5F5F0] transition-colors">HIPAA Compliance</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-white/[0.06] pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="text-sm text-[#525252]">&copy; {new Date().getFullYear()} Level AI. All rights reserved.</div>
            <div className="text-sm text-[#525252]">HIPAA compliant &middot; SOC 2 Type II &middot; BAA available</div>
          </div>
        </div>
      </footer>
    </div>
  );
}
