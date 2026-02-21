"use client";

import { useState, useEffect, useCallback } from "react";

// ── Icon components (duplicated from page.tsx since server components can't pass functions to client) ──
function IconShield({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
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
function IconDollar({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
    </svg>
  );
}
function IconBuilding({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="2" width="16" height="20" rx="2" /><line x1="9" y1="6" x2="9" y2="6" /><line x1="15" y1="6" x2="15" y2="6" /><line x1="9" y1="10" x2="9" y2="10" /><line x1="15" y1="10" x2="15" y2="10" /><line x1="9" y1="14" x2="9" y2="14" /><line x1="15" y1="14" x2="15" y2="14" /><path d="M9 22v-4h6v4" />
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

// Map icon names to components
const ICON_MAP: Record<string, React.FC<{ className?: string }>> = {
  IconShield,
  IconFileText,
  IconSearch,
  IconBot,
  IconPlug,
  IconPlay,
  IconDollar,
  IconBuilding,
};

type FeatureDetail = {
  headline: string;
  body: string;
  bullets: string[];
};

type Feature = {
  iconName: string;
  title: string;
  description: string;
  detail: FeatureDetail;
};

export function FeatureGrid({ features }: { features: Feature[] }) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  // Close on Escape
  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") setActiveIdx(null);
  }, []);
  useEffect(() => {
    if (activeIdx !== null) {
      document.addEventListener("keydown", handleKey);
      document.body.style.overflow = "hidden";
      return () => {
        document.removeEventListener("keydown", handleKey);
        document.body.style.overflow = "";
      };
    }
  }, [activeIdx, handleKey]);

  const active = activeIdx !== null ? features[activeIdx] : null;
  const ActiveIcon = active ? ICON_MAP[active.iconName] : null;

  return (
    <>
      {/* Inject keyframes once */}
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes featureBackdropIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes featureModalIn { from { opacity: 0; transform: scale(0.95) translateY(10px); } to { opacity: 1; transform: scale(1) translateY(0); } }
        .feature-modal-card { scrollbar-width: none; -ms-overflow-style: none; }
        .feature-modal-card::-webkit-scrollbar { display: none; }
      `}} />

      {/* Primary features — 3-column grid */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {features.slice(0, 6).map((f, i) => {
          const Icon = ICON_MAP[f.iconName];
          return (
            <button
              key={f.title}
              onClick={() => setActiveIdx(i)}
              className="group rounded-2xl border border-black/[0.06] bg-white p-7 hover:border-[#3B82F6]/30 hover:shadow-lg hover:shadow-[#3B82F6]/[0.04] transition-all text-left cursor-pointer"
            >
              <div className="w-11 h-11 rounded-xl bg-[#3B82F6]/10 flex items-center justify-center mb-5">
                {Icon && <Icon className="w-5 h-5 text-[#3B82F6]" />}
              </div>
              <div className="text-base font-bold text-[#1A1A18] mb-2">{f.title}</div>
              <p className="text-sm text-[#525252] leading-relaxed mb-4">{f.description}</p>
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#3B82F6] opacity-0 group-hover:opacity-100 transition-opacity">
                Learn more
                <svg className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
                </svg>
              </span>
            </button>
          );
        })}
      </div>

      {/* Highlighted features — wider 2-column layout for visual balance */}
      {features.length > 6 && (
        <div className="grid md:grid-cols-2 gap-6 mt-6">
          {features.slice(6).map((f, i) => {
            const Icon = ICON_MAP[f.iconName];
            return (
              <button
                key={f.title}
                onClick={() => setActiveIdx(i + 6)}
                className="group rounded-2xl border border-black/[0.06] bg-white p-7 hover:border-[#3B82F6]/30 hover:shadow-lg hover:shadow-[#3B82F6]/[0.04] transition-all text-left cursor-pointer"
              >
                <div className="w-11 h-11 rounded-xl bg-[#3B82F6]/10 flex items-center justify-center mb-5">
                  {Icon && <Icon className="w-5 h-5 text-[#3B82F6]" />}
                </div>
                <div className="text-base font-bold text-[#1A1A18] mb-2">{f.title}</div>
                <p className="text-sm text-[#525252] leading-relaxed mb-4">{f.description}</p>
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#3B82F6] opacity-0 group-hover:opacity-100 transition-opacity">
                  Learn more
                  <svg className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
                  </svg>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Feature Detail Modal ── */}
      {active && ActiveIcon && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 9999,
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 16,
          }}
          onClick={() => setActiveIdx(null)}
        >
          {/* Backdrop */}
          <div style={{
            position: "absolute", inset: 0,
            background: "rgba(0,0,0,0.45)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            animation: "featureBackdropIn 0.2s ease-out forwards",
          }} />

          {/* Modal card */}
          <div
            className="feature-modal-card"
            style={{
              position: "relative",
              background: "#fff",
              borderRadius: 24,
              border: "1px solid rgba(0,0,0,0.06)",
              boxShadow: "0 25px 60px rgba(0,0,0,0.15)",
              maxWidth: 520, width: "100%",
              maxHeight: "85vh", overflowY: "auto",
              animation: "featureModalIn 0.25s ease-out forwards",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={() => setActiveIdx(null)}
              style={{
                position: "absolute", top: 16, right: 16,
                width: 36, height: 36, borderRadius: "50%",
                background: "rgba(0,0,0,0.05)", border: "none",
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", zIndex: 10, transition: "background 0.15s",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.1)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.05)"; }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#525252" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>

            <div style={{ padding: "36px 40px" }}>
              {/* Icon */}
              <div style={{
                width: 56, height: 56, borderRadius: 16,
                background: "rgba(59,130,246,0.1)",
                display: "flex", alignItems: "center", justifyContent: "center",
                marginBottom: 24,
              }}>
                <ActiveIcon className="w-7 h-7 text-[#3B82F6]" />
              </div>

              {/* Label */}
              <div style={{
                fontSize: 11, fontWeight: 800, letterSpacing: "0.15em",
                textTransform: "uppercase", color: "#3B82F6", marginBottom: 12,
              }}>
                {active.title}
              </div>

              {/* Headline */}
              <h3 style={{
                fontSize: 28, fontWeight: 900, color: "#1A1A18",
                lineHeight: 1.2, marginBottom: 16,
              }}>
                {active.detail.headline}
              </h3>

              {/* Body */}
              <p style={{
                color: "#525252", fontSize: 15, lineHeight: 1.7, marginBottom: 28,
              }}>
                {active.detail.body}
              </p>

              {/* Bullets */}
              <ul style={{ listStyle: "none", padding: 0, margin: 0, marginBottom: 28 }}>
                {active.detail.bullets.map((b) => (
                  <li key={b} style={{
                    display: "flex", alignItems: "flex-start", gap: 12,
                    marginBottom: 12,
                  }}>
                    <div style={{
                      width: 22, height: 22, borderRadius: "50%",
                      background: "rgba(59,130,246,0.1)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      flexShrink: 0, marginTop: 1,
                    }}>
                      <IconCheck className="w-3 h-3 text-[#3B82F6]" />
                    </div>
                    <span style={{ fontSize: 14, color: "#525252", lineHeight: 1.6, fontWeight: 500 }}>{b}</span>
                  </li>
                ))}
              </ul>

              {/* CTA */}
              <a
                href="/dashboard?sandbox=1"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 8,
                  borderRadius: 12, background: "#3B82F6", color: "#fff",
                  padding: "12px 24px", fontSize: 14, fontWeight: 800,
                  textDecoration: "none", transition: "background 0.15s",
                  boxShadow: "0 4px 14px rgba(59,130,246,0.25)",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#2563EB"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "#3B82F6"; }}
              >
                Try it in the Sandbox
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
