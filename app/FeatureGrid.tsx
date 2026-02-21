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
function IconCheck({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
function IconX({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
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
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {features.map((f, i) => {
          const Icon = ICON_MAP[f.iconName];
          return (
            <button
              key={f.title}
              onClick={() => setActiveIdx(i)}
              className="group rounded-2xl border border-black/[0.06] bg-white p-7 hover:border-[#14B8A6]/30 hover:shadow-lg hover:shadow-[#14B8A6]/[0.04] transition-all text-left cursor-pointer"
            >
              <div className="w-11 h-11 rounded-xl bg-[#14B8A6]/10 flex items-center justify-center mb-5">
                {Icon && <Icon className="w-5 h-5 text-[#14B8A6]" />}
              </div>
              <div className="text-base font-bold text-[#1A1A18] mb-2">{f.title}</div>
              <p className="text-sm text-[#525252] leading-relaxed mb-4">{f.description}</p>
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#14B8A6] opacity-0 group-hover:opacity-100 transition-opacity">
                Learn more
                <svg className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
                </svg>
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Feature Detail Modal ── */}
      {active && ActiveIcon && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          onClick={() => setActiveIdx(null)}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-[fadeIn_0.15s_ease-out]" />

          {/* Modal */}
          <div
            className="relative bg-white rounded-3xl border border-black/[0.06] shadow-2xl max-w-lg w-full max-h-[85vh] overflow-y-auto animate-[modalIn_0.2s_ease-out]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={() => setActiveIdx(null)}
              className="absolute top-4 right-4 w-8 h-8 rounded-full bg-black/[0.04] hover:bg-black/[0.08] flex items-center justify-center transition-colors z-10"
            >
              <IconX className="w-4 h-4 text-[#525252]" />
            </button>

            <div className="p-8 md:p-10">
              {/* Icon + title */}
              <div className="w-14 h-14 rounded-2xl bg-[#14B8A6]/10 flex items-center justify-center mb-6">
                <ActiveIcon className="w-7 h-7 text-[#14B8A6]" />
              </div>

              <div className="text-xs font-extrabold tracking-[0.15em] uppercase text-[#14B8A6] mb-3">
                {active.title}
              </div>

              <h3 className="text-2xl md:text-3xl font-black text-[#1A1A18] leading-tight mb-4">
                {active.detail.headline}
              </h3>

              <p className="text-[#525252] text-base leading-relaxed mb-8">
                {active.detail.body}
              </p>

              {/* Bullets */}
              <ul className="space-y-3 mb-8">
                {active.detail.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded-full bg-[#14B8A6]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <IconCheck className="w-3 h-3 text-[#14B8A6]" />
                    </div>
                    <span className="text-sm text-[#525252] leading-relaxed font-medium">{b}</span>
                  </li>
                ))}
              </ul>

              {/* CTA */}
              <a
                href="/login"
                className="inline-flex items-center gap-2 rounded-xl bg-[#14B8A6] px-6 py-3 text-sm font-extrabold text-white shadow-lg shadow-[#14B8A6]/20 hover:bg-[#0D9488] transition-colors"
              >
                Try it in the Sandbox
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Modal keyframes */}
      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes modalIn { from { opacity: 0; transform: scale(0.95) translateY(8px); } to { opacity: 1; transform: scale(1) translateY(0); } }
      `}</style>
    </>
  );
}
