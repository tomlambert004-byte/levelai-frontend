import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — Level AI",
  description: "Level AI Privacy Policy. Learn how we collect, use, and protect your personal information.",
};

/* ─────────────────────────────────────────────────────────────────────────────
 *  Privacy Policy — Level AI
 * ───────────────────────────────────────────────────────────────────────────── */

function IconArrowLeft({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5" /><polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

export default function PrivacyPage() {
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
        <div className="mx-auto max-w-3xl px-6">
          <div className="mb-12">
            <div className="text-xs font-extrabold tracking-[0.2em] uppercase text-[#0D9488] mb-4">Legal</div>
            <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-4">Privacy Policy</h1>
            <p className="text-[#525252] text-lg">Last updated: February 2025</p>
          </div>

          <div className="space-y-8">
            <Section title="Introduction">
              <p>
                Level AI (&ldquo;we,&rdquo; &ldquo;our,&rdquo; or &ldquo;us&rdquo;) respects your privacy and is committed to protecting the personal
                information you share with us. This Privacy Policy describes how we collect, use, disclose,
                and safeguard your information when you use our platform, website, and related services.
              </p>
              <p>
                By using Level AI, you consent to the practices described in this Privacy Policy.
                If you do not agree, please discontinue use of our services.
              </p>
            </Section>

            <Section title="Information We Collect">
              <p><strong>Account Information</strong></p>
              <p>When you create an account, we collect:</p>
              <ul>
                <li>Name and contact details (email address, phone number)</li>
                <li>Practice name and business address</li>
                <li>Professional credentials (NPI number, Tax ID)</li>
                <li>Billing and payment information (processed securely by Stripe)</li>
              </ul>

              <p className="mt-4"><strong>Practice Management System Data</strong></p>
              <p>When you connect your PMS, we temporarily process:</p>
              <ul>
                <li>Patient scheduling information (appointment dates, times, procedures)</li>
                <li>Patient demographics necessary for insurance verification</li>
                <li>Insurance information (carrier name, member ID, group number)</li>
              </ul>
              <p>
                <strong>Important:</strong> This data is processed in real-time and is not stored in our database.
                Please see our <Link href="/hipaa" className="text-[#0D9488] hover:text-[#0F766E] transition-colors underline">HIPAA Compliance page</Link> for
                details on our zero-PHI-at-rest architecture.
              </p>

              <p className="mt-4"><strong>Usage Data</strong></p>
              <p>We automatically collect:</p>
              <ul>
                <li>Log data (IP address, browser type, pages visited)</li>
                <li>Device information (operating system, screen resolution)</li>
                <li>Feature usage patterns and interaction data</li>
                <li>Error logs and performance data</li>
              </ul>
            </Section>

            <Section title="How We Use Your Information">
              <p>We use the information we collect to:</p>
              <ul>
                <li>Provide and maintain the Level AI platform and services</li>
                <li>Process insurance verifications and generate reports</li>
                <li>Communicate with you about your account, including support and service updates</li>
                <li>Process payments and manage your subscription</li>
                <li>Improve our products, features, and user experience</li>
                <li>Detect and prevent fraud, abuse, and security incidents</li>
                <li>Comply with legal obligations and enforce our terms</li>
              </ul>
            </Section>

            <Section title="Information Sharing and Disclosure">
              <p>We do not sell your personal information. We may share information with:</p>
              <ul>
                <li><strong>Insurance Clearinghouses:</strong> To process eligibility and benefits verifications on your behalf</li>
                <li><strong>Payment Processors:</strong> Stripe processes all payment information — we never store your credit card details</li>
                <li><strong>Cloud Infrastructure Providers:</strong> Our hosting and infrastructure partners process data under strict contractual obligations</li>
                <li><strong>Legal Authorities:</strong> When required by law, subpoena, or court order</li>
              </ul>
              <p>
                All third-party service providers are bound by confidentiality agreements and, where applicable,
                Business Associate Agreements (BAAs).
              </p>
            </Section>

            <Section title="Data Security">
              <p>
                We implement robust security measures to protect your information:
              </p>
              <ul>
                <li>All data is encrypted in transit using TLS 1.2+</li>
                <li>Temporarily cached data is encrypted at rest using AES-256</li>
                <li>Access to systems is controlled through role-based permissions and multi-factor authentication</li>
                <li>Regular security audits and penetration testing are conducted</li>
                <li>Employees undergo security awareness training</li>
              </ul>
            </Section>

            <Section title="Data Retention">
              <p>We retain different types of data for different periods:</p>
              <ul>
                <li><strong>Patient Data (PHI):</strong> Not retained — processed in real-time only and held in short-lived memory caches that expire daily</li>
                <li><strong>Account Information:</strong> Retained for the duration of your active account, plus 30 days after cancellation for data export purposes</li>
                <li><strong>Billing Records:</strong> Retained for 7 years as required by tax and financial regulations</li>
                <li><strong>Usage Logs:</strong> Retained for 12 months for analytics and security purposes</li>
                <li><strong>Audit Logs:</strong> Retained for 6 years as required by HIPAA</li>
              </ul>
            </Section>

            <Section title="Cookies and Tracking">
              <p>
                We use essential cookies to maintain your session and provide core functionality.
                We do not use third-party advertising cookies or cross-site tracking.
              </p>
              <ul>
                <li><strong>Essential Cookies:</strong> Required for authentication and session management</li>
                <li><strong>Analytics:</strong> We use privacy-respecting analytics to understand usage patterns (no PII is tracked)</li>
              </ul>
            </Section>

            <Section title="Your Rights">
              <p>Depending on your location, you may have the right to:</p>
              <ul>
                <li><strong>Access:</strong> Request a copy of the personal information we hold about you</li>
                <li><strong>Correction:</strong> Request correction of inaccurate or incomplete information</li>
                <li><strong>Deletion:</strong> Request deletion of your personal information (subject to legal retention requirements)</li>
                <li><strong>Portability:</strong> Request your data in a structured, machine-readable format</li>
                <li><strong>Opt-Out:</strong> Opt out of non-essential communications at any time</li>
              </ul>
              <p>
                To exercise any of these rights, please contact us at{" "}
                <a href="mailto:thomas@lvlai.app" className="text-[#0D9488] hover:text-[#0F766E] transition-colors">thomas@lvlai.app</a>.
              </p>
            </Section>

            <Section title="Children's Privacy">
              <p>
                Level AI is not intended for use by individuals under the age of 18. We do not knowingly
                collect personal information from children. If we become aware that we have collected
                information from a child, we will promptly delete it.
              </p>
            </Section>

            <Section title="International Data Transfers">
              <p>
                Our services are primarily operated in the United States. If you access Level AI from
                outside the United States, your information may be transferred to and processed in the
                United States. By using our services, you consent to this transfer.
              </p>
            </Section>

            <Section title="Changes to This Policy">
              <p>
                We may update this Privacy Policy from time to time. We will notify you of material
                changes by email or through a notice on our platform. We encourage you to review this
                policy periodically.
              </p>
            </Section>

            <Section title="Contact Us">
              <p>
                If you have any questions or concerns about this Privacy Policy, please contact us:
              </p>
              <ul>
                <li>Email: <a href="mailto:thomas@lvlai.app" className="text-[#0D9488] hover:text-[#0F766E] transition-colors">thomas@lvlai.app</a></li>
                <li>Phone: <a href="tel:+15123955633" className="text-[#0D9488] hover:text-[#0F766E] transition-colors">(512) 395-5633</a></li>
                <li>Support: <a href="mailto:support@levelai.app" className="text-[#0D9488] hover:text-[#0F766E] transition-colors">support@levelai.app</a></li>
              </ul>
            </Section>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-black/[0.06] py-10">
        <div className="mx-auto max-w-3xl px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="text-sm text-[#A3A3A3]">&copy; {new Date().getFullYear()} Level AI. All rights reserved.</div>
          <div className="flex gap-6 text-sm">
            <Link href="/terms" className="text-[#A3A3A3] hover:text-[#525252] transition-colors">Terms</Link>
            <Link href="/hipaa" className="text-[#A3A3A3] hover:text-[#525252] transition-colors">HIPAA</Link>
            <Link href="/contact" className="text-[#A3A3A3] hover:text-[#525252] transition-colors">Contact</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-xl font-bold text-[#1A1A18] mb-4">{title}</h2>
      <div className="space-y-3 text-[#525252] text-[15px] leading-relaxed [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-2 [&_strong]:text-[#1A1A18] [&_strong]:font-semibold">
        {children}
      </div>
    </div>
  );
}
