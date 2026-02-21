import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "HIPAA Compliance — Level AI",
  description: "Learn about Level AI's HIPAA compliance practices, data protection measures, and commitment to patient privacy.",
};

/* ─────────────────────────────────────────────────────────────────────────────
 *  HIPAA Compliance — Level AI
 * ───────────────────────────────────────────────────────────────────────────── */

function IconArrowLeft({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5" /><polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

function IconShieldCheck({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" />
    </svg>
  );
}

export default function HipaaPage() {
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
            <div className="text-xs font-extrabold tracking-[0.2em] uppercase text-[#0D9488] mb-4">Compliance</div>
            <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-4">HIPAA Compliance</h1>
            <p className="text-[#525252] text-lg">Our commitment to protecting patient health information</p>
          </div>

          {/* Trust badges */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-16">
            {[
              { label: "HIPAA Compliant", sub: "Full compliance" },
              { label: "BAA Available", sub: "Business Associate Agreement" },
              { label: "Zero PHI at Rest", sub: "Stateless architecture" },
              { label: "Encrypted", sub: "In transit & at rest" },
            ].map((badge) => (
              <div key={badge.label} className="rounded-xl border border-[#0D9488]/20 bg-[#0D9488]/[0.04] p-4 text-center">
                <IconShieldCheck className="w-6 h-6 text-[#0D9488] mx-auto mb-2" />
                <div className="text-sm font-bold text-[#1A1A18]">{badge.label}</div>
                <div className="text-xs text-[#525252] mt-1">{badge.sub}</div>
              </div>
            ))}
          </div>

          <div className="space-y-8">
            <Section title="Our HIPAA Commitment">
              <p>
                Level AI is committed to maintaining the highest standards of data protection and privacy
                in compliance with the Health Insurance Portability and Accountability Act (HIPAA). We understand
                the critical importance of safeguarding Protected Health Information (PHI) and have built our
                platform from the ground up with security and compliance as foundational principles.
              </p>
            </Section>

            <Section title="Zero PHI at Rest Architecture">
              <p>
                Level AI employs a unique stateless architecture designed to minimize PHI exposure:
              </p>
              <ul>
                <li><strong>No patient data is stored in our database.</strong> Patient information is processed in real-time and held only in encrypted, short-lived memory caches that expire daily.</li>
                <li><strong>Verification results are transient.</strong> Insurance verification data exists only for the duration of your active session and is never written to persistent storage.</li>
                <li><strong>Practice Management System (PMS) remains the source of truth.</strong> All patient data originates from and returns to your PMS — Level AI acts as a secure processing layer.</li>
              </ul>
            </Section>

            <Section title="Administrative Safeguards">
              <ul>
                <li><strong>Security Officer:</strong> We maintain a designated Security Officer responsible for HIPAA compliance oversight</li>
                <li><strong>Workforce Training:</strong> All team members undergo comprehensive HIPAA training before accessing any systems</li>
                <li><strong>Access Controls:</strong> Role-based access controls ensure that only authorized personnel can access PHI</li>
                <li><strong>Incident Response:</strong> We maintain a documented incident response plan with defined procedures for identifying, containing, and reporting any potential breaches</li>
                <li><strong>Risk Assessments:</strong> We conduct regular risk assessments to identify and mitigate potential vulnerabilities</li>
              </ul>
            </Section>

            <Section title="Technical Safeguards">
              <ul>
                <li><strong>Encryption in Transit:</strong> All data transmitted between your practice and Level AI is encrypted using TLS 1.2 or higher</li>
                <li><strong>Encryption at Rest:</strong> Any temporarily cached data is encrypted using AES-256 encryption standards</li>
                <li><strong>Authentication:</strong> Multi-factor authentication is available and recommended for all accounts</li>
                <li><strong>Audit Logging:</strong> Comprehensive audit logs track all system access and data processing activities</li>
                <li><strong>Automatic Session Expiry:</strong> User sessions automatically expire after periods of inactivity</li>
                <li><strong>Network Security:</strong> Our infrastructure is hosted on SOC 2 Type II certified platforms with enterprise-grade firewalls and intrusion detection</li>
              </ul>
            </Section>

            <Section title="Physical Safeguards">
              <ul>
                <li><strong>Cloud Infrastructure:</strong> Our services run on enterprise cloud infrastructure with physical security controls including 24/7 monitoring, biometric access, and environmental controls</li>
                <li><strong>No Local Storage:</strong> Level AI does not store PHI on local workstations or portable devices</li>
                <li><strong>Data Center Security:</strong> Our hosting providers maintain SOC 2 Type II and ISO 27001 certifications</li>
              </ul>
            </Section>

            <Section title="Business Associate Agreement (BAA)">
              <p>
                Level AI will execute a Business Associate Agreement (BAA) with all covered entities prior
                to processing any PHI. Our BAA outlines:
              </p>
              <ul>
                <li>The permitted and required uses and disclosures of PHI</li>
                <li>Our obligation to safeguard PHI from unauthorized use or disclosure</li>
                <li>Our commitment to report any security incidents or breaches</li>
                <li>Requirements for return or destruction of PHI upon contract termination</li>
                <li>Our obligations to ensure any subcontractors also comply with HIPAA requirements</li>
              </ul>
              <p>
                To request a BAA, please contact us at{" "}
                <a href="mailto:thomas@lvlai.app" className="text-[#0D9488] hover:text-[#0F766E] transition-colors">thomas@lvlai.app</a>.
              </p>
            </Section>

            <Section title="Breach Notification">
              <p>
                In the unlikely event of a data breach involving PHI, Level AI will:
              </p>
              <ul>
                <li>Notify affected covered entities within 24 hours of discovery</li>
                <li>Provide a detailed incident report including the nature and extent of the breach</li>
                <li>Cooperate fully with any investigation and remediation efforts</li>
                <li>Assist in meeting notification obligations to affected individuals and regulatory authorities as required by the HIPAA Breach Notification Rule</li>
              </ul>
            </Section>

            <Section title="Patient Rights">
              <p>
                Level AI supports covered entities in fulfilling patient rights under HIPAA, including:
              </p>
              <ul>
                <li>The right to access their health information</li>
                <li>The right to request amendments to their records</li>
                <li>The right to receive an accounting of disclosures</li>
                <li>The right to request restrictions on certain uses and disclosures</li>
                <li>The right to receive confidential communications</li>
              </ul>
            </Section>

            <Section title="Continuous Improvement">
              <p>
                We continuously review and improve our security practices. Our compliance program includes:
              </p>
              <ul>
                <li>Annual HIPAA risk assessments and gap analyses</li>
                <li>Regular penetration testing and vulnerability scanning</li>
                <li>Ongoing employee training and awareness programs</li>
                <li>Policy reviews and updates to reflect regulatory changes</li>
                <li>Third-party audits and assessments</li>
              </ul>
            </Section>

            <Section title="Questions?">
              <p>
                If you have questions about our HIPAA compliance practices or would like to request a BAA,
                please don&apos;t hesitate to reach out:
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
            <Link href="/privacy" className="text-[#A3A3A3] hover:text-[#525252] transition-colors">Privacy</Link>
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
