"use client";

import Link from "next/link";
import { useState } from "react";

/* ─────────────────────────────────────────────────────────────────────────────
 *  Contact & Support — Level AI
 *  Includes a support form that POSTs to /api/v1/contact
 * ───────────────────────────────────────────────────────────────────────────── */

function IconArrowLeft({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5" /><polyline points="12 19 5 12 12 5" />
    </svg>
  );
}
function IconMail({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}
function IconPhone({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
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
function IconCheck({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export default function ContactPage() {
  const [form, setForm] = useState({ name: "", email: "", phone: "", issue: "" });
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("sending");
    try {
      const res = await fetch("/api/v1/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("Failed");
      setStatus("sent");
      setForm({ name: "", email: "", phone: "", issue: "" });
    } catch {
      setStatus("error");
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F5F0] text-[#1A1A18] font-sans">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-black/[0.06] bg-[#F5F5F0]/80 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl flex items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-3">
            <img src="/levelai-logo-dark.png" alt="Level AI" className="h-9" draggable={false} />
          </Link>
          <Link href="/" className="flex items-center gap-2 text-sm font-semibold text-[#525252] hover:text-[#1A1A18] transition-colors">
            <IconArrowLeft className="w-4 h-4" />
            Back to Home
          </Link>
        </div>
      </nav>

      {/* Content */}
      <main className="pt-28 pb-24">
        <div className="mx-auto max-w-5xl px-6">
          <div className="text-center mb-16">
            <div className="text-xs font-extrabold tracking-[0.2em] uppercase text-[#0D9488] mb-4">Get in touch</div>
            <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-4">Contact & Support</h1>
            <p className="text-[#525252] text-lg max-w-2xl mx-auto">
              Have a question, need help, or just want to say hello? We&apos;re here for you.
              Reach out and we&apos;ll get back to you as quickly as possible.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-12">
            {/* Contact Info */}
            <div className="space-y-8">
              <h2 className="text-2xl font-bold">Reach Us Directly</h2>

              <div className="space-y-6">
                <ContactCard
                  icon={<IconMail className="w-5 h-5 text-[#0D9488]" />}
                  label="Email"
                  value="thomas@lvlai.app"
                  href="mailto:thomas@lvlai.app"
                  sub="For partnerships, sales, and general inquiries"
                />
                <ContactCard
                  icon={<IconPhone className="w-5 h-5 text-[#0D9488]" />}
                  label="Phone"
                  value="(512) 395-5633"
                  href="tel:+15123955633"
                  sub="Available for calls and text messages"
                />
                <ContactCard
                  icon={<IconMail className="w-5 h-5 text-[#0D9488]" />}
                  label="Support"
                  value="support@levelai.app"
                  href="mailto:support@levelai.app"
                  sub="For technical support and account issues"
                />
                <ContactCard
                  icon={<IconClock className="w-5 h-5 text-[#0D9488]" />}
                  label="Response Time"
                  value="Within 24 hours"
                  sub="We aim to respond to all inquiries within one business day. Urgent issues are prioritized."
                />
              </div>

              <div className="rounded-2xl border border-[#0D9488]/20 bg-[#0D9488]/[0.04] p-6">
                <h3 className="text-base font-bold text-[#1A1A18] mb-2">Our Commitment to You</h3>
                <p className="text-sm text-[#525252] leading-relaxed">
                  At Level AI, we believe great software deserves great support. Whether you&apos;re a solo practice
                  just getting started or a large DSO rolling out across dozens of locations, you&apos;ll always have
                  a real person ready to help. No ticket queues, no chatbots — just honest, helpful support from
                  people who understand dental practices.
                </p>
              </div>
            </div>

            {/* Support Form */}
            <div>
              <div className="rounded-2xl border border-black/[0.06] bg-white p-8">
                <h2 className="text-2xl font-bold mb-2">Send Us a Message</h2>
                <p className="text-sm text-[#525252] mb-8">
                  Fill out the form below and we&apos;ll get back to you shortly.
                </p>

                {status === "sent" ? (
                  <div className="text-center py-12">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-[#0D9488]/10 mb-6">
                      <IconCheck className="w-8 h-8 text-[#0D9488]" />
                    </div>
                    <h3 className="text-xl font-bold mb-2">Message Sent!</h3>
                    <p className="text-[#525252] text-sm mb-6">
                      Thank you for reaching out. We&apos;ll get back to you within 24 hours.
                    </p>
                    <button
                      onClick={() => setStatus("idle")}
                      className="text-sm font-semibold text-[#0D9488] hover:text-[#0F766E] transition-colors"
                    >
                      Send another message
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="space-y-5">
                    <div>
                      <label className="block text-sm font-semibold text-[#1A1A18] mb-2">Name</label>
                      <input
                        type="text"
                        required
                        value={form.name}
                        onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                        placeholder="Dr. Jane Smith"
                        className="w-full rounded-xl border border-black/[0.08] bg-[#F5F5F0] px-4 py-3 text-sm text-[#1A1A18] placeholder:text-[#A3A3A3] focus:border-[#0D9488]/50 focus:outline-none focus:ring-1 focus:ring-[#0D9488]/30 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-[#1A1A18] mb-2">Email</label>
                      <input
                        type="email"
                        required
                        value={form.email}
                        onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                        placeholder="jane@practice.com"
                        className="w-full rounded-xl border border-black/[0.08] bg-[#F5F5F0] px-4 py-3 text-sm text-[#1A1A18] placeholder:text-[#A3A3A3] focus:border-[#0D9488]/50 focus:outline-none focus:ring-1 focus:ring-[#0D9488]/30 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-[#1A1A18] mb-2">Phone <span className="text-[#A3A3A3] font-normal">(optional)</span></label>
                      <input
                        type="tel"
                        value={form.phone}
                        onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                        placeholder="(555) 123-4567"
                        className="w-full rounded-xl border border-black/[0.08] bg-[#F5F5F0] px-4 py-3 text-sm text-[#1A1A18] placeholder:text-[#A3A3A3] focus:border-[#0D9488]/50 focus:outline-none focus:ring-1 focus:ring-[#0D9488]/30 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-[#1A1A18] mb-2">How can we help?</label>
                      <textarea
                        required
                        rows={5}
                        value={form.issue}
                        onChange={e => setForm(f => ({ ...f, issue: e.target.value }))}
                        placeholder="Tell us about your question, issue, or feedback..."
                        className="w-full rounded-xl border border-black/[0.08] bg-[#F5F5F0] px-4 py-3 text-sm text-[#1A1A18] placeholder:text-[#A3A3A3] focus:border-[#0D9488]/50 focus:outline-none focus:ring-1 focus:ring-[#0D9488]/30 transition-colors resize-none"
                      />
                    </div>

                    {status === "error" && (
                      <div className="rounded-xl bg-[#B91C1C]/10 border border-[#B91C1C]/20 px-4 py-3 text-sm text-[#B91C1C]">
                        Something went wrong. Please try again or email us directly at{" "}
                        <a href="mailto:support@levelai.app" className="underline">support@levelai.app</a>.
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={status === "sending"}
                      className="w-full rounded-xl bg-[#0D9488] hover:bg-[#0F766E] text-white font-bold py-3.5 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {status === "sending" ? "Sending…" : "Send Message"}
                    </button>
                  </form>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-black/[0.06] py-10">
        <div className="mx-auto max-w-5xl px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="text-sm text-[#A3A3A3]">&copy; {new Date().getFullYear()} Level AI. All rights reserved.</div>
          <div className="flex gap-6 text-sm">
            <Link href="/terms" className="text-[#A3A3A3] hover:text-[#525252] transition-colors">Terms</Link>
            <Link href="/privacy" className="text-[#A3A3A3] hover:text-[#525252] transition-colors">Privacy</Link>
            <Link href="/hipaa" className="text-[#A3A3A3] hover:text-[#525252] transition-colors">HIPAA</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function ContactCard({ icon, label, value, href, sub }: { icon: React.ReactNode; label: string; value: string; href?: string; sub: string }) {
  return (
    <div className="flex gap-4">
      <div className="w-11 h-11 rounded-xl bg-[#0D9488]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
        {icon}
      </div>
      <div>
        <div className="text-xs font-bold uppercase tracking-wider text-[#A3A3A3] mb-1">{label}</div>
        {href ? (
          <a href={href} className="text-[#1A1A18] font-semibold hover:text-[#0D9488] transition-colors">{value}</a>
        ) : (
          <div className="text-[#1A1A18] font-semibold">{value}</div>
        )}
        <p className="text-xs text-[#525252] mt-1 leading-relaxed">{sub}</p>
      </div>
    </div>
  );
}
