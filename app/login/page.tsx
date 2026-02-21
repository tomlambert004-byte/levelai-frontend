"use client";

import { useSignIn, useSignUp, useAuth } from "@clerk/nextjs";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

// ── Theme (dark-only for login page, matches the auth panel aesthetic) ────────
const T = {
  bg: "#0A0A0A", bgCard: "#1A1A1A", border: "#1C1C1C", borderStrong: "#2A2A2A",
  text: "#F5F5F0", textMid: "#A3A3A3", textSoft: "#525252",
  red: "#B91C1C", redLight: "#1C0F0F", redBorder: "#5C1A1A",
  indigo: "#14B8A6", indigoLight: "#0A1F1C", indigoBorder: "#134E48", indigoDark: "#5EEAD4",
};

// ── Validators ───────────────────────────────────────────────────────────────
const VALIDATORS: Record<string, (v: string) => string | null> = {
  email:    v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? null : "Enter a valid email address",
  password: v => v.length >= 8 ? null : "Password must be at least 8 characters",
};

// ── OInput ───────────────────────────────────────────────────────────────────
function OInput({ label, type = "text", placeholder, value, onChange, required, validate, error: extError }: {
  label: string; type?: string; placeholder?: string; value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  required?: boolean; validate?: string; error?: string;
}) {
  const [touched, setTouched] = useState(false);
  const validatorFn = validate ? VALIDATORS[validate] : undefined;
  const inlineErr = touched && validatorFn ? validatorFn(value || "") : null;
  const showErr = inlineErr || (touched && required && !value?.trim() ? "This field is required" : null) || extError;
  const borderColor = showErr ? "#ef4444" : touched && !showErr && value ? "#16a34a" : T.borderStrong;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <label style={{ fontSize: 11, fontWeight: 800, color: T.textMid, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}{required && <span style={{ color: "#ef4444", marginLeft: 3 }}>*</span>}
      </label>
      <input type={type} placeholder={placeholder} value={value} onChange={onChange}
        style={{ width: "100%", padding: "13px 16px", border: "1.5px solid " + borderColor, borderRadius: 10,
          fontSize: 14, outline: "none", transition: "border-color 0.2s, box-shadow 0.2s", fontFamily: "inherit",
          color: T.text, background: showErr ? T.redLight : T.bgCard,
          boxShadow: showErr ? "0 0 0 3px rgba(239,68,68,0.12)" : touched && !showErr && value ? "0 0 0 3px rgba(22,163,74,0.10)" : "none" }}
        onFocus={e => e.target.style.borderColor = showErr ? "#ef4444" : T.indigoDark}
        onBlur={() => setTouched(true)} />
      {showErr && (
        <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: -2 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: T.red }}>{showErr}</span>
        </div>
      )}
    </div>
  );
}

// ── Button ───────────────────────────────────────────────────────────────────
function NextBtn({ label = "Continue", onClick, type = "button", disabled = false }: {
  label?: string; onClick?: () => void; type?: "button" | "submit"; disabled?: boolean;
}) {
  return (
    <button type={type} disabled={disabled} onClick={onClick}
      style={{ width: "100%", padding: "15px", background: disabled ? T.textSoft : T.indigoDark, color: "white",
        borderRadius: 10, border: "none", fontSize: 15, fontWeight: 800, cursor: disabled ? "not-allowed" : "pointer",
        marginTop: 8, transition: "0.2s", boxShadow: disabled ? "none" : "0 4px 14px rgba(79,70,229,0.35)" }}
      onMouseEnter={e => { if (!disabled) (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = "translateY(0)"; }}>
      {label}
    </button>
  );
}

// ── Google icon ──────────────────────────────────────────────────────────────
const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 48 48">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
    <path fill="#FBBC05" d="M10.53 28.59a14.5 14.5 0 0 1 0-9.18l-7.98-6.19a24.01 24.01 0 0 0 0 21.56l7.98-6.19z"/>
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
  </svg>
);

// ═════════════════════════════════════════════════════════════════════════════
// Login Page — /login
// ═════════════════════════════════════════════════════════════════════════════
export default function LoginPage() {
  const router = useRouter();
  const { isSignedIn, isLoaded: authLoaded } = useAuth();
  const { signIn, setActive: setSignInActive, isLoaded: signInLoaded } = useSignIn();
  const { signUp, setActive: setSignUpActive, isLoaded: signUpLoaded } = useSignUp();

  const [step, setStep] = useState<"login" | "signup" | "verify">("login");
  const [authErr, setAuthErr] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [verifyCode, setVerifyCode] = useState(["", "", "", "", "", ""]);

  // Already signed in — redirect to dashboard
  useEffect(() => {
    if (authLoaded && isSignedIn) {
      router.replace("/dashboard");
    }
  }, [authLoaded, isSignedIn, router]);

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleGoogleSignIn = async () => {
    if (!signInLoaded || !signIn) return;
    try {
      await signIn.authenticateWithRedirect({
        strategy: "oauth_google",
        redirectUrl: "/sso-callback",
        redirectUrlComplete: "/dashboard",
      });
    } catch (err: any) {
      setAuthErr(err.errors?.[0]?.message || "Google sign-in failed.");
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signInLoaded || !signIn) return;
    setAuthErr("");
    try {
      const res = await signIn.create({ identifier: email, password });
      if (res.status === "complete" && res.createdSessionId) {
        await setSignInActive!({ session: res.createdSessionId });
        // useEffect will handle redirect once isSignedIn flips
      }
    } catch (err: any) {
      const msg = err.errors?.[0]?.message || "";
      const code = err.errors?.[0]?.code || "";
      if (code === "form_identifier_not_found") {
        setAuthErr("No account found with this email. Create one below.");
      } else if (code === "form_password_incorrect") {
        setAuthErr("Incorrect password. Please try again.");
      } else {
        setAuthErr(msg || "Sign in failed. Please check your credentials.");
      }
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signUpLoaded || !signUp) return;
    setAuthErr("");
    try {
      await signUp.create({ emailAddress: email, password });
      await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
      setStep("verify");
    } catch (err: any) {
      const msg = err.errors?.[0]?.message || "";
      const code = err.errors?.[0]?.code || "";
      if (code === "form_identifier_exists") {
        setAuthErr("An account with this email already exists. Sign in instead.");
      } else {
        setAuthErr(msg || "Sign up failed.");
      }
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signUpLoaded || !signUp) return;
    setAuthErr("");
    const code = verifyCode.join("");
    if (code.length !== 6) return;
    try {
      const res = await signUp.attemptEmailAddressVerification({ code });
      if (res.status === "complete" || res.createdSessionId) {
        if (typeof window !== "undefined") localStorage.setItem("pulp_needs_onboarding", "1");
        await setSignUpActive!({ session: res.createdSessionId });
      } else {
        setAuthErr("Additional verification needed. Please contact support.");
      }
    } catch (err: any) {
      const msg = err.errors?.[0]?.message || "";
      const errCode = err.errors?.[0]?.code || "";
      if (errCode === "form_code_already_verified" || msg.toLowerCase().includes("already verified")) {
        try {
          if (signUp?.createdSessionId) {
            if (typeof window !== "undefined") localStorage.setItem("pulp_needs_onboarding", "1");
            await setSignUpActive!({ session: signUp.createdSessionId });
            return;
          }
        } catch {}
        setAuthErr("Email verified but sign-up couldn't complete. Please sign in instead.");
        return;
      }
      setAuthErr(msg || "Invalid code. Please try again.");
    }
  };

  const handleSandbox = () => {
    // Navigate to dashboard with sandbox query param
    router.push("/dashboard?sandbox=1");
  };

  // Loading state
  if (!authLoaded) {
    return (
      <div style={{ height: "100vh", background: T.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: T.textSoft, fontSize: 14, fontWeight: 700 }}>Loading...</div>
      </div>
    );
  }

  // Already signed in — show nothing while redirecting
  if (isSignedIn) return null;

  return (
    <div style={{ height: "100vh", display: "flex", background: T.bg, fontFamily: "'Satoshi', system-ui, sans-serif" }}>

      {/* ── Left brand panel ── */}
      <div style={{ width: 420, flexShrink: 0, background: "#0A0A0A", color: "white", padding: "56px 48px",
        display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-start", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: -80, right: -80, width: 360, height: 360, background: "#14B8A6",
          opacity: 0.08, borderRadius: "50%", filter: "blur(80px)" }} />
        <div style={{ position: "absolute", bottom: -60, left: -60, width: 280, height: 280, background: "#14B8A6",
          opacity: 0.05, borderRadius: "50%", filter: "blur(80px)" }} />

        <div style={{ position: "relative", zIndex: 10 }}>
          <div style={{ marginBottom: 36 }}>
            <img src="/levelai-logo.png" alt="Level AI"
              style={{ height: 52, width: 52 * 2.5, objectFit: "contain", objectPosition: "left center", display: "block" }}
              draggable={false} />
          </div>
          <h1 style={{ fontSize: 36, fontWeight: 900, lineHeight: 1.18, marginBottom: 22, maxWidth: 340 }}>
            Insurance verification on autopilot.
          </h1>
          <p style={{ fontSize: 15, lineHeight: 1.75, opacity: 0.75, maxWidth: 340 }}>
            Every patient&apos;s insurance &mdash; verified before they walk in. Connect your practice management system and we&apos;ll handle the rest.
          </p>
        </div>
      </div>

      {/* ── Right panel ── */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
        padding: "40px 60px", overflowY: "auto" }}>
        <div style={{ width: "100%", maxWidth: 460 }}>

          {/* ───────── LOGIN ───────── */}
          {step === "login" && (
            <div style={{ animation: "fadeIn 0.4s ease-out" }}>
              <div style={{ fontSize: 30, fontWeight: 900, color: T.text, marginBottom: 6 }}>Welcome to Level AI</div>
              <div style={{ fontSize: 14, color: T.textSoft, marginBottom: 32, lineHeight: 1.5 }}>
                Sign in or create an account to get started.
              </div>
              <form onSubmit={handleSignIn} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <OInput label="Email" type="email" placeholder="you@practice.com" value={email} onChange={e => { setEmail(e.target.value); setAuthErr(""); }} required validate="email" />
                <OInput label="Password" type="password" placeholder="••••••••" value={password} onChange={e => { setPassword(e.target.value); setAuthErr(""); }} required />
                {authErr && <div style={{ color: T.red, fontSize: 13, fontWeight: 700, padding: "10px 14px", background: T.redLight, borderRadius: 8, border: "1px solid " + T.redBorder }}>{authErr}</div>}
                <NextBtn type="submit" label="Sign In &rarr;" />
              </form>
              {/* Google OAuth */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "20px 0" }}>
                <div style={{ flex: 1, height: 1, background: T.border }} />
                <span style={{ fontSize: 12, color: T.textSoft, fontWeight: 600 }}>or</span>
                <div style={{ flex: 1, height: 1, background: T.border }} />
              </div>
              <button onClick={handleGoogleSignIn}
                style={{ width: "100%", padding: "13px", background: T.bgCard, color: T.text,
                  border: "2px solid " + T.borderStrong, borderRadius: 10, fontSize: 14, fontWeight: 700,
                  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, transition: "0.2s" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = T.indigoDark; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = T.borderStrong; }}>
                <GoogleIcon />
                Continue with Google
              </button>
              <div style={{ marginTop: 20, borderTop: "1px solid " + T.border, paddingTop: 20 }}>
                <div style={{ fontSize: 13, color: T.textSoft, marginBottom: 12 }}>New to Level AI?</div>
                <button onClick={() => { setStep("signup"); setAuthErr(""); setEmail(""); setPassword(""); }}
                  style={{ width: "100%", padding: "14px", background: "transparent", color: T.indigoDark,
                    border: "2px solid " + T.indigoDark, borderRadius: 10, fontSize: 15, fontWeight: 800, cursor: "pointer" }}>
                  New Practice &mdash; Create Account
                </button>
                <button onClick={handleSandbox}
                  style={{ width: "100%", padding: "14px", marginTop: 12, background: "transparent",
                    color: T.textSoft, border: "2px dashed " + T.borderStrong, borderRadius: 10,
                    fontSize: 14, fontWeight: 700, cursor: "pointer", transition: "0.2s",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = T.indigoDark; (e.currentTarget as HTMLElement).style.color = T.indigoDark; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = T.borderStrong; (e.currentTarget as HTMLElement).style.color = T.textSoft; }}>
                  Test Drive the Sandbox &mdash; No Login Required
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
                <NextBtn type="submit" label="Create Account &rarr;" />
              </form>
              {/* Google OAuth */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "20px 0" }}>
                <div style={{ flex: 1, height: 1, background: T.border }} />
                <span style={{ fontSize: 12, color: T.textSoft, fontWeight: 600 }}>or</span>
                <div style={{ flex: 1, height: 1, background: T.border }} />
              </div>
              <button onClick={handleGoogleSignIn}
                style={{ width: "100%", padding: "13px", background: T.bgCard, color: T.text,
                  border: "2px solid " + T.borderStrong, borderRadius: 10, fontSize: 14, fontWeight: 700,
                  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, transition: "0.2s" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = T.indigoDark; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = T.borderStrong; }}>
                <GoogleIcon />
                Continue with Google
              </button>
              <div style={{ marginTop: 20, textAlign: "center" }}>
                <button onClick={() => { setStep("login"); setAuthErr(""); }}
                  style={{ background: "none", border: "none", color: T.indigoDark, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                  Already have an account? Sign in
                </button>
              </div>
            </div>
          )}

          {/* ───────── VERIFY ───────── */}
          {step === "verify" && (
            <div style={{ animation: "fadeIn 0.4s ease-out" }}>
              <div style={{ fontSize: 30, fontWeight: 900, color: T.text, marginBottom: 6 }}>Check your email</div>
              <div style={{ fontSize: 14, color: T.textSoft, marginBottom: 32, lineHeight: 1.5 }}>
                We sent a 6-digit code to <strong style={{ color: T.text }}>{email}</strong>
              </div>
              <form onSubmit={handleVerify} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                  {verifyCode.map((digit, i) => (
                    <input key={i} type="text" inputMode="numeric" maxLength={1} value={digit}
                      style={{ width: 48, height: 56, textAlign: "center", fontSize: 22, fontWeight: 900,
                        border: "2px solid " + (digit ? T.indigoDark : T.borderStrong), borderRadius: 10,
                        background: T.bgCard, color: T.text, outline: "none", fontFamily: "inherit",
                        transition: "border-color 0.2s" }}
                      onChange={e => {
                        const v = e.target.value.replace(/\D/g, "");
                        const next = [...verifyCode];
                        next[i] = v;
                        setVerifyCode(next);
                        setAuthErr("");
                        if (v && i < 5) {
                          const nextInput = e.target.parentElement?.children[i + 1] as HTMLInputElement;
                          nextInput?.focus();
                        }
                      }}
                      onKeyDown={e => {
                        if (e.key === "Backspace" && !digit && i > 0) {
                          const prevInput = (e.target as HTMLElement).parentElement?.children[i - 1] as HTMLInputElement;
                          prevInput?.focus();
                        }
                      }}
                      onPaste={e => {
                        const paste = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
                        if (paste.length > 0) {
                          e.preventDefault();
                          const next = [...verifyCode];
                          for (let j = 0; j < 6; j++) next[j] = paste[j] || "";
                          setVerifyCode(next);
                        }
                      }}
                    />
                  ))}
                </div>
                {authErr && <div style={{ color: T.red, fontSize: 13, fontWeight: 700, padding: "10px 14px", background: T.redLight, borderRadius: 8, border: "1px solid " + T.redBorder }}>{authErr}</div>}
                <NextBtn type="submit" label="Verify Email &rarr;" disabled={verifyCode.join("").length !== 6} />
              </form>
              <div style={{ marginTop: 20, textAlign: "center" }}>
                <button onClick={() => { setStep("login"); setAuthErr(""); setVerifyCode(["","","","","",""]); }}
                  style={{ background: "none", border: "none", color: T.indigoDark, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                  Back to sign in
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Keyframe animations */}
      <style>{`@keyframes fadeIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }`}</style>
    </div>
  );
}
