import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service — Level AI",
  description: "Level AI Terms of Service. Read about our terms, conditions, and usage policies.",
};

/* ─────────────────────────────────────────────────────────────────────────────
 *  Terms of Service — Level AI
 *  Matches the dark-first marketing site aesthetic
 * ───────────────────────────────────────────────────────────────────────────── */

function IconArrowLeft({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5" /><polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-[#0A0A0A] text-[#F5F5F0] font-sans">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/[0.06] bg-[#0A0A0A]/80 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl flex items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-3">
            <img src="/levelai-logo.png" alt="Level AI" className="h-9" draggable={false} />
          </Link>
          <Link href="/" className="flex items-center gap-2 text-sm font-semibold text-[#A3A3A3] hover:text-[#F5F5F0] transition-colors">
            <IconArrowLeft className="w-4 h-4" />
            Back to Home
          </Link>
        </div>
      </nav>

      {/* Content */}
      <main className="pt-28 pb-24">
        <div className="mx-auto max-w-3xl px-6">
          <div className="mb-12">
            <div className="text-xs font-extrabold tracking-[0.2em] uppercase text-[#14B8A6] mb-4">Legal</div>
            <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-4">Terms of Service</h1>
            <p className="text-[#A3A3A3] text-lg">Last updated: February 2025</p>
          </div>

          <div className="prose-custom space-y-8">
            <Section title="1. Acceptance of Terms">
              <p>
                By accessing or using Level AI&apos;s platform, website, and related services (collectively, the &ldquo;Service&rdquo;),
                you agree to be bound by these Terms of Service (&ldquo;Terms&rdquo;). If you do not agree to these Terms,
                please do not use our Service.
              </p>
              <p>
                These Terms apply to all users, including dental practices, individual practitioners,
                office administrators, and any person who accesses the Service on behalf of an organization.
              </p>
            </Section>

            <Section title="2. Description of Service">
              <p>
                Level AI provides AI-powered dental insurance verification, benefits management, and
                practice workflow tools. Our Service includes:
              </p>
              <ul>
                <li>Automated insurance eligibility and benefits verification</li>
                <li>Real-time integration with Practice Management Systems (PMS)</li>
                <li>AI-assisted patient communication tools</li>
                <li>Pre-authorization letter generation</li>
                <li>Insurance claims intelligence and denial prevention</li>
                <li>Sandbox demonstration environment</li>
              </ul>
            </Section>

            <Section title="3. Account Registration">
              <p>
                To use certain features of the Service, you must create an account. You agree to:
              </p>
              <ul>
                <li>Provide accurate, current, and complete registration information</li>
                <li>Maintain the security of your account credentials</li>
                <li>Notify us immediately of any unauthorized access to your account</li>
                <li>Accept responsibility for all activities that occur under your account</li>
              </ul>
              <p>
                You must be at least 18 years of age and have the authority to enter into these Terms
                on behalf of your dental practice or organization.
              </p>
            </Section>

            <Section title="4. Subscription and Billing">
              <p>
                Level AI offers subscription-based pricing with the following terms:
              </p>
              <ul>
                <li><strong>Free Trial:</strong> All plans include a 14-day free trial. No credit card is required to start your trial.</li>
                <li><strong>Billing Cycle:</strong> After your trial period, subscriptions are billed monthly unless you select an annual plan.</li>
                <li><strong>Cancellation:</strong> You may cancel your subscription at any time. Your access will continue through the end of your current billing period.</li>
                <li><strong>Refunds:</strong> We offer prorated refunds for annual plans cancelled within the first 30 days.</li>
                <li><strong>Price Changes:</strong> We will provide at least 30 days&apos; notice before any price increases take effect.</li>
              </ul>
            </Section>

            <Section title="5. Acceptable Use">
              <p>You agree not to:</p>
              <ul>
                <li>Use the Service for any unlawful purpose</li>
                <li>Attempt to gain unauthorized access to any part of the Service</li>
                <li>Use the Service to transmit harmful code, malware, or viruses</li>
                <li>Reverse engineer, decompile, or disassemble any part of the Service</li>
                <li>Use automated systems (bots, scrapers) to access the Service without authorization</li>
                <li>Share your account credentials with unauthorized individuals</li>
                <li>Use the Service in a manner that could impair its performance or functionality</li>
              </ul>
            </Section>

            <Section title="6. Data and Privacy">
              <p>
                Your use of the Service is also governed by our <Link href="/privacy" className="text-[#14B8A6] hover:text-[#5EEAD4] transition-colors underline">Privacy Policy</Link> and
                our <Link href="/hipaa" className="text-[#14B8A6] hover:text-[#5EEAD4] transition-colors underline">HIPAA Compliance</Link> commitments.
              </p>
              <p>
                We take the protection of patient health information (PHI) extremely seriously.
                All data handling is conducted in accordance with HIPAA regulations and industry best practices.
                We will enter into a Business Associate Agreement (BAA) with covered entities as required by law.
              </p>
            </Section>

            <Section title="7. Intellectual Property">
              <p>
                The Service, including all content, features, and functionality, is owned by Level AI
                and is protected by copyright, trademark, and other intellectual property laws.
              </p>
              <p>
                You retain ownership of all data you provide to the Service. By using the Service,
                you grant us a limited license to process your data solely for the purpose of providing
                the Service to you.
              </p>
            </Section>

            <Section title="8. Disclaimer of Warranties">
              <p>
                The Service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; without warranties of any kind,
                whether express or implied. Level AI does not warrant that:
              </p>
              <ul>
                <li>The Service will be uninterrupted, timely, secure, or error-free</li>
                <li>Insurance verification results will be 100% accurate in all cases</li>
                <li>The Service will meet all of your specific requirements</li>
              </ul>
              <p>
                Level AI is a verification assistance tool and does not replace professional judgment.
                Users are responsible for confirming critical insurance information before providing treatment.
              </p>
            </Section>

            <Section title="9. Limitation of Liability">
              <p>
                To the maximum extent permitted by law, Level AI shall not be liable for any indirect,
                incidental, special, consequential, or punitive damages, including loss of profits, data,
                or business opportunities, arising from your use of the Service.
              </p>
              <p>
                Our total liability for any claims arising from or related to the Service shall not exceed
                the amount you have paid to Level AI in the twelve (12) months preceding the claim.
              </p>
            </Section>

            <Section title="10. Indemnification">
              <p>
                You agree to indemnify and hold harmless Level AI, its officers, directors, employees,
                and agents from any claims, damages, losses, or expenses (including reasonable attorney&apos;s fees)
                arising from your use of the Service or violation of these Terms.
              </p>
            </Section>

            <Section title="11. Termination">
              <p>
                We may suspend or terminate your access to the Service at any time for violation of
                these Terms or for any other reason with reasonable notice. Upon termination:
              </p>
              <ul>
                <li>Your right to use the Service will immediately cease</li>
                <li>We will provide you with the ability to export your data for 30 days</li>
                <li>We will securely delete your data in accordance with our data retention policies</li>
              </ul>
            </Section>

            <Section title="12. Changes to Terms">
              <p>
                We reserve the right to modify these Terms at any time. We will provide notice of material
                changes via email or through the Service. Your continued use of the Service after changes
                take effect constitutes your acceptance of the revised Terms.
              </p>
            </Section>

            <Section title="13. Governing Law">
              <p>
                These Terms shall be governed by and construed in accordance with the laws of the
                State of Texas, without regard to its conflict of law provisions. Any disputes arising
                from these Terms shall be resolved in the courts of Travis County, Texas.
              </p>
            </Section>

            <Section title="14. Contact Information">
              <p>
                If you have any questions about these Terms, please contact us:
              </p>
              <ul>
                <li>Email: <a href="mailto:thomas@lvlai.app" className="text-[#14B8A6] hover:text-[#5EEAD4] transition-colors">thomas@lvlai.app</a></li>
                <li>Phone: <a href="tel:+15123955633" className="text-[#14B8A6] hover:text-[#5EEAD4] transition-colors">(512) 395-5633</a></li>
                <li>Support: <a href="mailto:support@levelai.app" className="text-[#14B8A6] hover:text-[#5EEAD4] transition-colors">support@levelai.app</a></li>
              </ul>
            </Section>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/[0.06] py-10">
        <div className="mx-auto max-w-3xl px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="text-sm text-[#525252]">&copy; {new Date().getFullYear()} Level AI. All rights reserved.</div>
          <div className="flex gap-6 text-sm">
            <Link href="/privacy" className="text-[#525252] hover:text-[#A3A3A3] transition-colors">Privacy Policy</Link>
            <Link href="/hipaa" className="text-[#525252] hover:text-[#A3A3A3] transition-colors">HIPAA</Link>
            <Link href="/contact" className="text-[#525252] hover:text-[#A3A3A3] transition-colors">Contact</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ── Reusable section component ──────────────────────────────────────────── */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-xl font-bold text-[#F5F5F0] mb-4">{title}</h2>
      <div className="space-y-3 text-[#A3A3A3] text-[15px] leading-relaxed [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-2 [&_strong]:text-[#F5F5F0] [&_strong]:font-semibold">
        {children}
      </div>
    </div>
  );
}
