"use client";

import { useState, useCallback, useEffect, useRef } from "react";

// ─── Theme ────────────────────────────────────────────────────────────────────
const T = {
  bg:"#F5F5F0", bgCard:"#FFFFFF", bgSelected:"#EEFBE8",
  border:"#E2E2DC", borderStrong:"#C8C8C0",
  lime:"#84CC16", limeLight:"#F0FDF0", limeBorder:"#BBF7B0", limeDark:"#3F6212",
  text:"#1A1A18", textMid:"#52525A", textSoft:"#A0A09A",
  amber:"#D97706", amberLight:"#FFFBEB", amberBorder:"#FCD34D",
  red:"#DC2626", redLight:"#FEF2F2", redBorder:"#FECACA",
  slate:"#64748B", slateLight:"#F8FAFC",
  indigo:"#6366F1", indigoLight:"#EEF2FF", indigoBorder:"#C7D2FE",
  purple:"#7C3AED", purpleLight:"#F5F3FF", purpleBorder:"#DDD6FE",
};

// ─── Triage Buckets ───────────────────────────────────────────────────────────
const TRIAGE = { CLEAR:"CLEAR", WARNING:"WARNING", CRITICAL:"CRITICAL" };

const TRIAGE_CONFIG = {
  [TRIAGE.CLEAR]:    { label:"Clear",    icon:"✓", color:"#3F6212", bg:"#F0FDF0", border:"#BBF7B0", dot:"#84CC16" },
  [TRIAGE.WARNING]:  { label:"Warning",  icon:"⚠", color:"#D97706", bg:"#FFFBEB", border:"#FCD34D", dot:"#D97706" },
  [TRIAGE.CRITICAL]: { label:"Critical", icon:"🚨", color:"#DC2626", bg:"#FEF2F2", border:"#FECACA", dot:"#DC2626" },
};

const STATUS = { VERIFIED:"verified", ACTION_REQUIRED:"action_required", INACTIVE:"inactive", PENDING:"pending", ERROR:"error" };
const STATUS_CONFIG = {
  [STATUS.VERIFIED]:        { label:"Verified",        dot:T.lime,  bg:T.limeLight,  border:T.limeBorder,  text:T.limeDark },
  [STATUS.ACTION_REQUIRED]: { label:"Action Required", dot:T.amber, bg:T.amberLight, border:T.amberBorder, text:T.amber    },
  [STATUS.INACTIVE]:        { label:"Inactive",        dot:T.red,   bg:T.redLight,   border:T.redBorder,   text:T.red      },
  [STATUS.PENDING]:         { label:"Not Checked",     dot:T.slate, bg:T.slateLight, border:T.border,      text:T.slate    },
  [STATUS.ERROR]:           { label:"Error",           dot:T.red,   bg:T.redLight,   border:T.redBorder,   text:T.red      },
};

// ─── CDT Code → Category mapping ─────────────────────────────────────────────
// Used by Triage Engine to match scheduled procedure against benefit coverage
const CDT_CATEGORIES = {
  preventive: ["D1110","D1120","D1206","D1208","D1310","D1320","D1330","D1351","D1352","D0120","D0140","D0150","D0210","D0220","D0230","D0240","D0270","D0272","D0274","D0277","D0330","D4910"],
  restorative:["D2140","D2150","D2160","D2161","D2330","D2331","D2332","D2335","D2390","D2510","D2520","D2530","D2542","D2543","D2544","D2610","D2620","D2630","D2642","D2643","D2644","D2650","D2651","D2652","D2662","D2663","D2664","D2710","D2712","D2720","D2721","D2722","D2740","D2750","D2751","D2752","D2780","D2781","D2782","D2783","D2790","D2910","D2915","D2920","D2930","D2931","D2932","D2933","D2934"],
  endodontic: ["D3110","D3120","D3220","D3221","D3222","D3230","D3240","D3310","D3320","D3330","D3331","D3332","D3333","D3346","D3347","D3348","D3351","D3352","D3353","D3410","D3421","D3425","D3426","D3430","D3450","D3920","D3950"],
  periodontic:["D4210","D4211","D4212","D4240","D4241","D4245","D4249","D4260","D4261","D4263","D4264","D4265","D4266","D4267","D4268","D4270","D4271","D4273","D4274","D4275","D4276","D4277","D4278","D4283","D4285","D4341","D4342","D4346","D4355","D4381","D4910","D4920","D4921","D4999"],
  prosthetic: ["D5110","D5120","D5130","D5140","D5211","D5212","D5213","D5214","D5221","D5222","D5223","D5224","D5225","D5226","D5281","D5282","D5283","D5284","D5286","D5410","D5411","D5421","D5422","D5510","D5511","D5512","D5520","D5610","D5611","D5612","D5621","D5622","D5630","D5640","D5650","D5660","D5670","D5671","D5710","D5711","D5712","D5720","D5721","D5722","D5725","D5730","D5731","D5740","D5741","D5750","D5751","D5760","D5761","D5765","D5850","D5851","D5862","D5863","D5864","D5865","D5866","D5867","D5876","D5899"],
  implant:    ["D6010","D6011","D6012","D6013","D6040","D6041","D6042","D6043","D6050","D6051","D6052","D6055","D6056","D6057","D6058","D6059","D6060","D6061","D6062","D6063","D6064","D6065","D6066","D6067","D6068","D6069","D6070","D6071","D6072","D6073","D6074","D6075","D6076","D6077","D6078","D6079","D6080","D6081","D6082","D6083","D6084","D6085","D6086","D6087","D6088","D6089","D6090","D6091","D6092","D6093","D6094","D6095","D6096","D6097","D6098","D6099","D6100","D6101","D6102","D6103","D6104","D6110","D6111","D6112","D6113","D6114","D6115","D6116","D6117","D6118","D6119","D6120","D6121","D6122","D6123","D6124","D6190","D6191","D6192","D6194","D6195","D6197","D6198","D6199","D6205","D6210","D6211","D6212","D6214","D6240","D6241","D6242","D6243","D6244","D6245","D6246","D6247","D6248","D6251","D6252","D6253","D6545","D6548","D6549","D6600","D6601","D6602","D6603","D6604","D6605","D6606","D6607","D6608","D6609","D6610","D6611","D6612","D6613","D6614","D6615","D6624","D6634","D6710","D6720","D6721","D6722","D6740","D6750","D6751","D6752","D6753","D6780","D6781","D6782","D6783","D6790","D6791","D6792","D6793","D6794","D6930","D6940","D6950","D6980","D6985","D6999"],
  orthodontic:["D8010","D8020","D8030","D8040","D8050","D8060","D8070","D8080","D8090","D8210","D8220","D8660","D8670","D8680","D8681","D8695","D8696","D8697","D8698","D8699","D8701","D8702","D8703","D8704","D8999"],
};

// ─── TRIAGE ENGINE ─────────────────────────────────────────────────────────────
// Core logic: analyzes a verification result + patient context → CLEAR / WARNING / CRITICAL
// If/Then decision tree:
//
// CRITICAL triggers (any one → CRITICAL):
//   1. plan_status !== 'active'
//   2. verification_status === 'error' or missing
//   3. action_flags includes 'wrong_id' or 'call_required'
//   4. annual_remaining_cents === 0 AND procedure is NOT purely preventive
//
// WARNING triggers (any one → WARNING, unless CRITICAL already):
//   5. annual_remaining_cents < 30000 (< $300 remaining on annual max)
//   6. deductible not fully met (individual_deductible_met_cents < individual_deductible_cents)
//      AND procedure is restorative/major
//   7. composite_posterior_downgrade === true AND procedure involves posterior composite
//   8. crown_waiting_period_months > 0 AND procedure is a crown
//   9. cleaning_frequency: used_this_period >= times_per_period (frequency limit hit)
//  10. bitewing_frequency: last service within period, next_eligible_date in future
//  11. missing_tooth_clause.applies === true AND procedure is implant/bridge/partial
//  12. action_flags has any flags not caught above (copay_present, etc.)
//  13. sealant_age_limit exceeded for patient age AND procedure is sealant
//
// CLEAR: none of the above triggered

function getProcedureCategory(procedureText) {
  const text = procedureText.toLowerCase();
  if (/implant/i.test(text)) return "implant";
  if (/crown|onlay|inlay/i.test(text)) return "restorative_major";
  if (/composite|filling|amalgam/i.test(text)) return "restorative_basic";
  if (/prophy|cleaning|prophylaxis|sealant/i.test(text)) return "preventive";
  if (/bwx|bitewing|x-ray|xray|pano|fmx/i.test(text)) return "radiograph";
  if (/root canal|endo/i.test(text)) return "endodontic";
  if (/perio|scaling|srp|d4/i.test(text)) return "periodontic";
  if (/bridge|partial|denture/i.test(text)) return "prosthetic";
  if (/ortho|braces/i.test(text)) return "orthodontic";
  if (/consult|exam/i.test(text)) return "exam";
  return "general";
}

function getPatientAgeYears(dob) {
  if (!dob) return null;
  return Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 86400000));
}

function triagePatient(patient, result) {
  if (!result) return { level: TRIAGE.CRITICAL, reasons: ["Verification not yet run"], writeBack: "Not verified." };

  const reasons = [];
  const warnings = [];
  const category = getProcedureCategory(patient.procedure || "");
  const age = getPatientAgeYears(patient.dob);
  const deductibleRemaining = Math.max(0, (result.individual_deductible_cents ?? 0) - (result.individual_deductible_met_cents ?? 0));
  const remainingMax = result.annual_remaining_cents ?? 0;
  const flags = result.action_flags || [];

  // ── CRITICAL checks ────────────────────────────────────────────────────────
  if (result.plan_status !== "active" || result.verification_status === STATUS.INACTIVE) {
    reasons.push("Insurance plan is inactive or terminated");
  }
  if (result.verification_status === STATUS.ERROR) {
    reasons.push("Verification returned an error — manual call required");
  }
  if (flags.includes("wrong_id")) {
    reasons.push("Member ID mismatch — verify patient's card");
  }
  if (flags.includes("call_required")) {
    reasons.push("Carrier requires phone verification before benefits can be confirmed");
  }
  if (remainingMax === 0 && category !== "preventive" && category !== "radiograph" && category !== "exam") {
    reasons.push("Annual maximum fully exhausted — patient responsible for 100% of fee");
  }
  if (reasons.length > 0) {
    return { level: TRIAGE.CRITICAL, reasons, warnings, writeBack: buildWriteBack(patient, result, TRIAGE.CRITICAL, reasons, warnings) };
  }

  // ── WARNING checks ─────────────────────────────────────────────────────────
  if (remainingMax > 0 && remainingMax < 30000 && category !== "preventive" && category !== "radiograph") {
    warnings.push(`Annual maximum nearly exhausted — only $${(remainingMax / 100).toFixed(0)} remaining`);
  }
  if (deductibleRemaining > 0 && (category === "restorative_basic" || category === "restorative_major" || category === "endodontic" || category === "periodontic" || category === "prosthetic")) {
    warnings.push(`Deductible not fully met — $${(deductibleRemaining / 100).toFixed(0)} still owed before benefits apply`);
  }
  if (result.restorative?.composite_posterior_downgrade && (category === "restorative_basic")) {
    warnings.push("Posterior composite will be downgraded to amalgam reimbursement rate — patient may owe difference");
  }
  if ((result.restorative?.crown_waiting_period_months ?? 0) > 0 && category === "restorative_major") {
    warnings.push(`Crown waiting period active — ${result.restorative.crown_waiting_period_months} months until eligible`);
  }
  const cleanFreq = result.preventive?.cleaning_frequency;
  if (cleanFreq && category === "preventive") {
    const used = cleanFreq.used_this_period ?? 0;
    const total = cleanFreq.times_per_period ?? 2;
    if (used >= total) {
      warnings.push(`Cleaning frequency limit reached — ${used}/${total} used this ${cleanFreq.period?.replace(/_/g, " ")}. Not eligible until ${cleanFreq.next_eligible_date || "next period"}`);
    } else if (used === total - 1) {
      warnings.push(`One cleaning remaining this ${cleanFreq.period?.replace(/_/g, " ")} (${used}/${total} used)`);
    }
  }
  const bwFreq = result.preventive?.bitewing_frequency;
  if (bwFreq && category === "radiograph" && /bwx|bitewing/i.test(patient.procedure || "")) {
    const nextDate = bwFreq.next_eligible_date ? new Date(bwFreq.next_eligible_date) : null;
    if (nextDate && nextDate > new Date()) {
      const daysOut = Math.ceil((nextDate - new Date()) / 86400000);
      warnings.push(`Bitewing frequency limit — next eligible in ${daysOut} day${daysOut !== 1 ? "s" : ""} (${bwFreq.next_eligible_date})`);
    }
  }
  const mtc = result.missing_tooth_clause;
  if (mtc?.applies && (category === "implant" || category === "prosthetic")) {
    warnings.push(`Missing tooth clause applies to teeth ${(mtc.affected_teeth || []).join(", ")} — prosthetic/implant services may be excluded`);
  }
  const sealantLimit = result.preventive?.sealant_age_limit;
  if (sealantLimit && age && age > sealantLimit && /sealant/i.test(patient.procedure || "")) {
    warnings.push(`Patient age (${age}) exceeds sealant age limit (${sealantLimit}) — sealant likely not covered`);
  }
  // Catch remaining flags
  const handledFlags = ["wrong_id","call_required"];
  flags.filter(f => !handledFlags.includes(f)).forEach(f => {
    const desc = result.action_descriptions?.[f];
    if (desc) warnings.push(desc);
  });

  if (warnings.length > 0) {
    return { level: TRIAGE.WARNING, reasons, warnings, writeBack: buildWriteBack(patient, result, TRIAGE.WARNING, reasons, warnings) };
  }

  return { level: TRIAGE.CLEAR, reasons, warnings, writeBack: buildWriteBack(patient, result, TRIAGE.CLEAR, reasons, warnings) };
}

// ─── Write-Back Builder ───────────────────────────────────────────────────────
// Generates human-readable internal note for dental chart / PMS
function buildWriteBack(patient, result, triageLevel, criticals = [], warnings = []) {
  if (!result) return "Verification pending.";
  const now = new Date().toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  const cleanFreq = result.preventive?.cleaning_frequency;
  const bwFreq = result.preventive?.bitewing_frequency;
  const deductibleRemaining = Math.max(0, (result.individual_deductible_cents ?? 0) - (result.individual_deductible_met_cents ?? 0));
  const deductibleMet = deductibleRemaining === 0;
  const covPrev = result.preventive?.coverage_pct;
  const covRest = result.restorative?.coverage_pct;
  const remaining = result.annual_remaining_cents ?? 0;
  const maxAnnual = result.annual_maximum_cents ?? 0;

  let note = `✦ Verified by AI [${now}] — ${result.payer_name || "Insurance"}\n`;
  note += `Status: ${result.plan_status === "active" ? "Plan ACTIVE" : "Plan INACTIVE"} · Triage: ${triageLevel}\n`;
  note += `Annual Max: $${(maxAnnual / 100).toFixed(0)} · Remaining: $${(remaining / 100).toFixed(0)}\n`;
  note += `Deductible: $${((result.individual_deductible_cents ?? 0) / 100).toFixed(0)} · Met: $${((result.individual_deductible_met_cents ?? 0) / 100).toFixed(0)}${deductibleMet ? " ✓ Fully Met" : ` · $${(deductibleRemaining / 100).toFixed(0)} remaining`}\n`;
  if (covPrev != null) note += `Coverage: ${covPrev}% preventive`;
  if (covRest != null) note += ` · ${covRest}% basic/restorative`;
  if (result.restorative?.copay_cents) note += ` · Co-pay: $${(result.restorative.copay_cents / 100).toFixed(0)}`;
  if (covPrev != null || covRest != null) note += "\n";
  if (cleanFreq) {
    const nextDate = cleanFreq.next_eligible_date;
    const daysOut = nextDate ? Math.ceil((new Date(nextDate) - new Date()) / 86400000) : null;
    note += `Cleanings: ${cleanFreq.used_this_period ?? 0}/${cleanFreq.times_per_period ?? 2} used this ${cleanFreq.period?.replace(/_/g, " ")}`;
    if (daysOut !== null && daysOut > 0) note += ` · Next eligible in ${daysOut} day${daysOut !== 1 ? "s" : ""} (${nextDate})`;
    else note += ` · Eligible now`;
    note += "\n";
  }
  if (bwFreq) {
    const nextDate = bwFreq.next_eligible_date;
    const daysOut = nextDate ? Math.ceil((new Date(nextDate) - new Date()) / 86400000) : null;
    if (daysOut !== null && daysOut > 0) {
      note += `Bitewing X-rays: ${daysOut} day${daysOut !== 1 ? "s" : ""} until next eligible (${nextDate})\n`;
    } else {
      note += `Bitewing X-rays: Eligible now\n`;
    }
  }
  if (result.missing_tooth_clause?.applies) {
    note += `⚠ Missing Tooth Clause: Teeth ${(result.missing_tooth_clause.affected_teeth || []).join(", ")} — ${result.missing_tooth_clause.exception_pathway || "Contact carrier for details"}\n`;
  }
  if (result.restorative?.composite_posterior_downgrade) {
    note += `⚠ Posterior composite will be downgraded to amalgam reimbursement rate\n`;
  }
  if (criticals.length > 0) note += `🚨 CRITICAL: ${criticals.join("; ")}\n`;
  if (warnings.length > 0) note += `⚠ Warnings: ${warnings.join("; ")}\n`;
  note += `─ Next re-verify: 24h before appointment`;
  return note;
}

// ─── Scheduler / Cron Engine ──────────────────────────────────────────────────
// In production this would be a Node.js cron or Python Celery task.
// Here we simulate it with a useEffect interval that scans appointments every 30s.
// Logic:
//   1. Scan all patients with appointments in next 72 hours
//   2. If patient has never been verified → verify immediately
//   3. If patient was verified > 24h ago → re-verify (plan changes catch)
//   4. If appointment is ≤ 24h away and last verify > 1h ago → re-verify (final check)
function useScheduler(patients, results, loadingRef, verifyFn) {
  const schedulerLog = useRef([]);
  const [log, setLog] = useState([]);

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const seventyTwoHoursOut = new Date(now.getTime() + 72 * 3600000);
      const twentyFourHoursOut = new Date(now.getTime() + 24 * 3600000);

      patients.forEach(p => {
        if (!p.appointmentDate || !p.appointmentTime) return;
        const apptDt = new Date(`${p.appointmentDate}T${p.appointmentTime}`);
        if (isNaN(apptDt.getTime())) return;
        if (apptDt > seventyTwoHoursOut || apptDt < now) return; // outside window

        const existing = results.current[p.id];
        const isLoading = loadingRef.current[p.id];
        if (isLoading) return;

        const verifiedAt = existing?.verified_at ? new Date(existing.verified_at) : null;
        const ageMs = verifiedAt ? now - verifiedAt : Infinity;
        const hoursOld = ageMs / 3600000;
        const isWithin24h = apptDt <= twentyFourHoursOut;

        let shouldVerify = false;
        let reason = "";

        if (!existing) { shouldVerify = true; reason = "Initial verification (72h scan)"; }
        else if (hoursOld > 24) { shouldVerify = true; reason = "Re-verify: >24h since last check"; }
        else if (isWithin24h && hoursOld > 1) { shouldVerify = true; reason = "Re-verify: appointment <24h away (final check)"; }

        if (shouldVerify) {
          const entry = { time: now.toLocaleTimeString(), patient: p.name, reason };
          schedulerLog.current = [entry, ...schedulerLog.current.slice(0, 19)];
          setLog([...schedulerLog.current]);
          verifyFn(p);
        }
      });
    };

    const id = setInterval(tick, 30000);
    tick(); // run immediately on mount
    return () => clearInterval(id);
  }, [patients]); // eslint-disable-line

  return log;
}

// ─── Morning Huddle Generator ─────────────────────────────────────────────────
// Generates a concise Slack/Email-ready briefing
function generateMorningHuddle(patients, results, triageMap) {
  const date = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const total = patients.length;
  const verified = Object.values(results).filter(r => r?.verification_status === STATUS.VERIFIED).length;
  const critical = patients.filter(p => triageMap[p.id]?.level === TRIAGE.CRITICAL);
  const warning = patients.filter(p => triageMap[p.id]?.level === TRIAGE.WARNING);
  const clear = patients.filter(p => triageMap[p.id]?.level === TRIAGE.CLEAR);

  const lines = [];
  lines.push(`🦷 *PULP AI — MORNING HUDDLE*`);
  lines.push(`📅 ${date}`);
  lines.push(`─────────────────────────────`);
  lines.push(`📊 *Today's Schedule:* ${total} patients · ${verified} verified · ${critical.length} critical · ${warning.length} warnings`);
  lines.push(``);

  if (critical.length > 0) {
    lines.push(`🚨 *ACTION REQUIRED — ${critical.length} patient${critical.length !== 1 ? "s" : ""} need immediate attention:*`);
    critical.forEach(p => {
      const t = triageMap[p.id];
      const r = results[p.id];
      lines.push(`  • *${p.name}* (${p.appointmentTime}, ${p.procedure})`);
      lines.push(`    Carrier: ${r?.payer_name || p.insurance} | Member: ${p.memberId}`);
      t.reasons.forEach(reason => lines.push(`    ❌ ${reason}`));
      lines.push(`    → Assign to front desk for manual resolution before appointment`);
    });
    lines.push(``);
  }

  if (warning.length > 0) {
    lines.push(`⚠️ *HEADS-UP — ${warning.length} patient${warning.length !== 1 ? "s" : ""} with benefit flags:*`);
    warning.forEach(p => {
      const t = triageMap[p.id];
      const r = results[p.id];
      lines.push(`  • *${p.name}* (${p.appointmentTime}, ${p.procedure})`);
      lines.push(`    Carrier: ${r?.payer_name || p.insurance} | Remaining: $${((r?.annual_remaining_cents ?? 0) / 100).toFixed(0)}`);
      t.warnings.slice(0, 2).forEach(w => lines.push(`    ⚠ ${w}`));
      lines.push(`    → Review estimate with patient at check-in`);
    });
    lines.push(``);
  }

  if (clear.length > 0) {
    lines.push(`✅ *CLEAR — ${clear.length} patient${clear.length !== 1 ? "s" : ""} ready to go:*`);
    clear.forEach(p => {
      const r = results[p.id];
      lines.push(`  • *${p.name}* — ${p.procedure} · $${((r?.annual_remaining_cents ?? 0) / 100).toFixed(0)} remaining`);
    });
    lines.push(``);
  }

  const unverified = patients.filter(p => !results[p.id]);
  if (unverified.length > 0) {
    lines.push(`⏳ *PENDING — ${unverified.length} patient${unverified.length !== 1 ? "s" : ""} not yet verified:*`);
    unverified.forEach(p => lines.push(`  • *${p.name}* — ${p.procedure}`));
    lines.push(``);
  }

  lines.push(`─────────────────────────────`);
  lines.push(`_Generated by Pulp AI Agent at ${new Date().toLocaleTimeString()}_`);
  lines.push(`_Re-verification runs automatically at 72h and 24h before each appointment_`);
  return lines.join("\n");
}

// ─── Verification History Schema ──────────────────────────────────────────────
// In production: PostgreSQL / Supabase table
// CREATE TABLE verification_history (
//   id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
//   patient_id    TEXT NOT NULL REFERENCES patients(id),
//   verified_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
//   triggered_by  TEXT NOT NULL, -- 'manual' | 'scheduler_72h' | 'scheduler_24h' | 'scheduler_1h'
//   triage_level  TEXT NOT NULL, -- 'CLEAR' | 'WARNING' | 'CRITICAL'
//   result_json   JSONB NOT NULL,
//   write_back    TEXT,
//   warnings      TEXT[],
//   critical      TEXT[],
//   expires_at    TIMESTAMPTZ
// );
// CREATE TABLE issue_status (
//   id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
//   patient_id    TEXT NOT NULL REFERENCES patients(id),
//   issue_text    TEXT NOT NULL,
//   status        TEXT DEFAULT 'open', -- 'open' | 'resolved' | 'dismissed'
//   created_at    TIMESTAMPTZ DEFAULT NOW(),
//   resolved_at   TIMESTAMPTZ,
//   resolved_by   TEXT
// );

// ─── Common payers ────────────────────────────────────────────────────────────
const PAYERS = ["Delta Dental PPO","Delta Dental Premier","Cigna Dental","Aetna DMO","Aetna PPO","MetLife Dental","Guardian Dental","United Concordia","Humana Dental","Ameritas","BlueCross BlueShield Dental","Sun Life Dental","Principal Financial","Anthem Dental","Careington","Dentemax","Other"];
const PROVIDERS = ["Dr. Chen","Dr. Patel","Dr. Kim","Dr. Rodriguez"];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const today = new Date();
const isEligible = (d) => { if (!d) return true; return new Date(d) <= today; };
const daysUntil = (d) => { if (!d) return null; return Math.ceil((new Date(d) - today) / 86400000); };
const dollars = (c) => c != null ? `$${(c/100).toLocaleString("en-US",{minimumFractionDigits:0})}` : "—";
const pct = (n) => n != null ? `${n}%` : "—";
const genId = () => "p" + Math.random().toString(36).slice(2,8);

// ─── Mock verify ──────────────────────────────────────────────────────────────
const mockVerify = (patient) => new Promise((res) => setTimeout(() => {
  const presets = {
    p1: { verification_status:STATUS.VERIFIED, payer_name:"Delta Dental PPO Plus Premier", plan_status:"active", benefit_year_start:"2025-01-01", benefit_year_end:"2025-12-31", annual_maximum_cents:200000, annual_remaining_cents:145000, individual_deductible_cents:5000, individual_deductible_met_cents:5000, action_flags:[], action_descriptions:{}, preventive:{ coverage_pct:100, copay_cents:null, cleaning_frequency:{ times_per_period:2, period:"calendar_year", used_this_period:1, last_service_date:"2024-07-10", next_eligible_date:"2025-01-10", covered_codes:["D1110","D1120"], perio_maintenance_covered:true, perio_maintenance_frequency:{times_per_period:4}, notes:"Perio maintenance (D4910) covered up to 4x/yr with active perio diagnosis on file" }, bitewing_frequency:{ times_per_period:1, period:"calendar_year", last_service_date:"2024-07-10", next_eligible_date:"2025-07-10" }, sealant_coverage_pct:80, sealant_age_limit:14 }, restorative:{ coverage_pct:80, copay_cents:null, composite_posterior_downgrade:false, crown_waiting_period_months:0 }, missing_tooth_clause:{ applies:false, notes:"No missing tooth clause.", affected_teeth:[], excluded_services:[], exception_pathway:null }, verified_at:new Date().toISOString(), expires_at:new Date(Date.now()+172800000).toISOString() },
    p2: { verification_status:STATUS.ACTION_REQUIRED, payer_name:"Cigna Dental 1000", plan_status:"active", benefit_year_start:"2025-01-01", benefit_year_end:"2025-12-31", annual_maximum_cents:150000, annual_remaining_cents:22000, individual_deductible_cents:5000, individual_deductible_met_cents:2500, action_flags:["copay_present","composite_downgrade","annual_max_low","deductible_not_met","missing_tooth_clause"], action_descriptions:{ copay_present:"Patient has a co-pay on covered services", composite_downgrade:"Posterior composite may be downgraded to amalgam rate", annual_max_low:"Annual maximum remaining is below $300", deductible_not_met:"Annual deductible not yet fully met", missing_tooth_clause:"Missing tooth clause applies — prosthetic services may be excluded" }, preventive:{ coverage_pct:100, copay_cents:2000, cleaning_frequency:{ times_per_period:2, period:"calendar_year", used_this_period:2, last_service_date:"2024-08-15", next_eligible_date:"2025-08-15", covered_codes:["D1110","D1120"], perio_maintenance_covered:false, perio_maintenance_frequency:null, notes:"Perio maintenance not a covered benefit under this plan." }, bitewing_frequency:null, sealant_coverage_pct:null, sealant_age_limit:null }, restorative:{ coverage_pct:70, copay_cents:1500, composite_posterior_downgrade:true, crown_waiting_period_months:0 }, missing_tooth_clause:{ applies:true, notes:"Cigna Dental 1000 includes a missing tooth clause for teeth absent prior to policy effective date (Jan 1, 2023).", affected_teeth:["#19","#30"], excluded_services:["Implants (D6010–D6067)","Fixed bridges (D6240–D6252)","Removable partials (D5211–D5214)"], exception_pathway:"Submit pre-authorization with pre-existing loss documentation. Allow 10–15 business days.", policy_effective_date:"2023-01-01" }, verified_at:new Date().toISOString(), expires_at:new Date(Date.now()+172800000).toISOString() },
    p3: { verification_status:STATUS.INACTIVE, payer_name:"MetLife Dental", plan_status:"inactive", benefit_year_start:"2024-01-01", benefit_year_end:"2024-12-31", annual_maximum_cents:100000, annual_remaining_cents:0, individual_deductible_cents:5000, individual_deductible_met_cents:5000, action_flags:[], action_descriptions:{}, preventive:null, restorative:null, missing_tooth_clause:null, verified_at:new Date().toISOString(), expires_at:new Date(Date.now()+172800000).toISOString() },
    p4: { verification_status:STATUS.ACTION_REQUIRED, payer_name:"Aetna DMO", plan_status:"active", benefit_year_start:"2025-01-01", benefit_year_end:"2025-12-31", annual_maximum_cents:100000, annual_remaining_cents:100000, individual_deductible_cents:0, individual_deductible_met_cents:0, action_flags:["missing_tooth_clause"], action_descriptions:{ missing_tooth_clause:"Missing tooth clause applies — verify tooth #14 extraction date vs. policy start" }, preventive:{ coverage_pct:100, copay_cents:null, cleaning_frequency:{ times_per_period:2, period:"calendar_year", used_this_period:0, last_service_date:null, next_eligible_date:null, covered_codes:["D1110","D1120"], perio_maintenance_covered:true, perio_maintenance_frequency:{times_per_period:4}, notes:null }, bitewing_frequency:{ times_per_period:1, period:"calendar_year", last_service_date:null, next_eligible_date:null }, sealant_coverage_pct:100, sealant_age_limit:16 }, restorative:{ coverage_pct:80, copay_cents:null, composite_posterior_downgrade:false, crown_waiting_period_months:12 }, missing_tooth_clause:{ applies:true, notes:"Aetna DMO applies MTC to teeth extracted before policy inception (Jan 1, 2025).", affected_teeth:["#14"], excluded_services:["Implants (D6010–D6067)","Fixed bridges (D6240–D6252)"], exception_pathway:"Request pre-auth with dated extraction records. 5–7 business days.", policy_effective_date:"2025-01-01" }, verified_at:new Date().toISOString(), expires_at:new Date(Date.now()+172800000).toISOString() },
  };
  if (!presets[patient.id]) {
    const options = [presets.p1, presets.p2, presets.p4];
    const pick = options[Math.floor(Math.random() * options.length)];
    res({ ...pick, payer_name: patient.insurance || pick.payer_name });
  } else {
    res(presets[patient.id]);
  }
}, 2000));

// ─── Initial patients ─────────────────────────────────────────────────────────
const INITIAL_PATIENTS = [
  { id:"p1", name:"Margaret Holloway", dob:"1978-04-22", appointmentTime:"9:00 AM",  appointmentDate:"2026-02-19", hoursUntil:47, provider:"Dr. Chen",  procedure:"Prophy + BWX",        fee:28500,  insurance:"Delta Dental PPO", memberId:"DD00112233",  phone:"(512) 555-0142", email:"m.holloway@email.com" },
  { id:"p2", name:"Carlos Reyes",      dob:"1991-11-03", appointmentTime:"10:30 AM", appointmentDate:"2026-02-19", hoursUntil:49, provider:"Dr. Chen",  procedure:"Crown Prep #14",      fee:145000, insurance:"Cigna Dental",     memberId:"CIG98765432", phone:"(512) 555-0287", email:"creyes@email.com"      },
  { id:"p3", name:"Diane Okafor",      dob:"1965-07-18", appointmentTime:"11:15 AM", appointmentDate:"2026-02-19", hoursUntil:50, provider:"Dr. Patel", procedure:"Composite #12",       fee:19500,  insurance:"MetLife",          memberId:"MET44412222", phone:"(512) 555-0391", email:"d.okafor@email.com"    },
  { id:"p4", name:"James Whitfield",   dob:"2002-01-30", appointmentTime:"2:00 PM",  appointmentDate:"2026-02-19", hoursUntil:53, provider:"Dr. Patel", procedure:"Implant Consult #14", fee:35000,  insurance:"Aetna DMO",        memberId:"AET77700011", phone:"(512) 555-0415", email:"jwhitfield@email.com"  },
];

const ANALYTICS = {
  thisMonth:{ total:142, verified:98, actionRequired:31, inactive:13, avgTimeSeconds:4.2 },
  trend:[{month:"Sep",verified:71,action:22,inactive:8},{month:"Oct",verified:84,action:28,inactive:11},{month:"Nov",verified:79,action:33,inactive:14},{month:"Dec",verified:91,action:19,inactive:7},{month:"Jan",verified:88,action:27,inactive:10},{month:"Feb",verified:98,action:31,inactive:13}],
  topFlags:[{flag:"Frequency Limit",count:44,color:T.amber},{flag:"Deductible Not Met",count:38,color:T.indigo},{flag:"Co-pay Present",count:29,color:T.red},{flag:"Missing Tooth Clause",count:21,color:T.red},{flag:"Annual Max Low",count:17,color:T.amber},{flag:"Composite Downgrade",count:12,color:T.slate}],
  topPayers:[{name:"Delta Dental PPO",total:48,successRate:94},{name:"Cigna Dental",total:31,successRate:71},{name:"Aetna DMO",total:27,successRate:78},{name:"MetLife",total:22,successRate:68},{name:"Guardian",total:14,successRate:86}],
};

// ─── Shared UI ────────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const c = STATUS_CONFIG[status] || STATUS_CONFIG[STATUS.PENDING];
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"3px 10px", borderRadius:20, background:c.bg, border:`1px solid ${c.border}`, color:c.text, fontSize:11, fontWeight:700, letterSpacing:"0.02em", textTransform:"uppercase", whiteSpace:"nowrap" }}>
      <span style={{ width:6, height:6, borderRadius:"50%", background:c.dot, flexShrink:0 }} />
      {c.label}
    </span>
  );
}

function TriageBadge({ level }) {
  if (!level) return null;
  const c = TRIAGE_CONFIG[level];
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:4, padding:"3px 9px", borderRadius:20, background:c.bg, border:`1px solid ${c.border}`, color:c.color, fontSize:11, fontWeight:800, letterSpacing:"0.02em", textTransform:"uppercase", whiteSpace:"nowrap" }}>
      <span style={{ fontSize:10 }}>{c.icon}</span> {c.label}
    </span>
  );
}

function Meter({ value, max, color }) {
  const p = max > 0 ? Math.min(100,(value/max)*100) : 0;
  return (
    <div style={{ height:5, background:T.border, borderRadius:3, overflow:"hidden" }}>
      <div style={{ height:"100%", width:`${p}%`, background:color, borderRadius:3, transition:"width 0.9s cubic-bezier(0.23,1,0.32,1)" }} />
    </div>
  );
}

function SectionLabel({ children }) {
  return <div style={{ color:T.textSoft, fontSize:10, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:8, paddingBottom:5, borderBottom:`1px solid ${T.border}` }}>{children}</div>;
}

function BenefitRow({ label, value, sub, highlight }) {
  return (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", padding:"8px 0", borderBottom:`1px solid ${T.border}` }}>
      <span style={{ color:T.textMid, fontSize:12 }}>{label}</span>
      <div style={{ textAlign:"right" }}>
        <div style={{ color:highlight ? T.limeDark : T.text, fontSize:13, fontWeight:600 }}>{value}</div>
        {sub && <div style={{ color:T.textSoft, fontSize:10, marginTop:1 }}>{sub}</div>}
      </div>
    </div>
  );
}

function ActionFlag({ flag, description }) {
  return (
    <div style={{ display:"flex", gap:8, alignItems:"flex-start", padding:"7px 10px", background:T.amberLight, borderLeft:`2.5px solid ${T.amber}`, borderRadius:"0 6px 6px 0", marginBottom:4 }}>
      <span style={{ color:T.amber, fontSize:11, marginTop:1, flexShrink:0 }}>⚠</span>
      <div>
        <div style={{ color:T.amber, fontSize:10, fontWeight:800, textTransform:"uppercase", letterSpacing:"0.04em" }}>{flag.replace(/_/g," ")}</div>
        <div style={{ color:T.textMid, fontSize:11, marginTop:2 }}>{description}</div>
      </div>
    </div>
  );
}

// ─── Form components ──────────────────────────────────────────────────────────
function Field({ label, required, error, children }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
      <label style={{ color:T.textMid, fontSize:12, fontWeight:700 }}>{label} {required && <span style={{ color:T.red }}>*</span>}</label>
      {children}
      {error && <div style={{ color:T.red, fontSize:11 }}>{error}</div>}
    </div>
  );
}

function Input({ value, onChange, placeholder, type="text", error }) {
  return (
    <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      style={{ padding:"9px 12px", borderRadius:7, border:`1.5px solid ${error ? T.red : T.border}`, fontSize:13, color:T.text, background:T.bgCard, outline:"none", width:"100%", fontFamily:"'Nunito',sans-serif" }}
      onFocus={e => e.target.style.borderColor = T.lime}
      onBlur={e => e.target.style.borderColor = error ? T.red : T.border}
    />
  );
}

function Select({ value, onChange, options, placeholder, error }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{ padding:"9px 12px", borderRadius:7, border:`1.5px solid ${error ? T.red : T.border}`, fontSize:13, color:value ? T.text : T.textSoft, background:T.bgCard, outline:"none", width:"100%", fontFamily:"'Nunito',sans-serif", cursor:"pointer" }}>
      <option value="" disabled>{placeholder}</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

// ─── Add Patient Modal ────────────────────────────────────────────────────────
const EMPTY_FORM = { firstName:"", lastName:"", dob:"", phone:"", email:"", insurance:"", memberId:"", groupNumber:"", subscriberName:"", subscriberDob:"", relationship:"self", provider:"", procedure:"", appointmentDate:"", appointmentTime:"", fee:"" };

function AddPatientModal({ onClose, onAdd }) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [verifyResult, setVerifyResult] = useState(null);
  const set = (key) => (val) => setForm(f => ({ ...f, [key]:val }));
  const err = (key) => errors[key];
  const validateStep1 = () => { const e = {}; if (!form.firstName.trim()) e.firstName="Required"; if (!form.lastName.trim()) e.lastName="Required"; if (!form.dob) e.dob="Required"; setErrors(e); return Object.keys(e).length===0; };
  const validateStep2 = () => { const e = {}; if (!form.insurance) e.insurance="Required"; if (!form.memberId.trim()) e.memberId="Required"; setErrors(e); return Object.keys(e).length===0; };
  const validateStep3 = () => { const e = {}; if (!form.provider) e.provider="Required"; if (!form.procedure.trim()) e.procedure="Required"; if (!form.appointmentDate) e.appointmentDate="Required"; if (!form.appointmentTime) e.appointmentTime="Required"; setErrors(e); return Object.keys(e).length===0; };
  const handleNext = () => { setErrors({}); if (step===1&&validateStep1()) setStep(2); else if (step===2&&validateStep2()) setStep(3); else if (step===3&&validateStep3()) runVerification(); };
  const runVerification = async () => {
    setStep(4);
    const newPatient = { id:genId(), name:`${form.firstName} ${form.lastName}`, dob:form.dob, phone:form.phone, email:form.email, insurance:form.insurance, memberId:form.memberId, provider:form.provider, procedure:form.procedure, appointmentDate:form.appointmentDate, appointmentTime:form.appointmentTime, fee:form.fee?Math.round(parseFloat(form.fee)*100):0, hoursUntil:24 };
    const result = await mockVerify(newPatient);
    setVerifyResult({ patient:newPatient, result });
    setStep(5);
  };
  const handleSave = () => { if (verifyResult) onAdd(verifyResult.patient, verifyResult.result); onClose(); };
  const triage = verifyResult ? triagePatient(verifyResult.patient, verifyResult.result) : null;

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.4)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:24 }} onClick={e => { if (e.target===e.currentTarget) onClose(); }}>
      <div style={{ background:T.bgCard, borderRadius:14, width:"100%", maxWidth:560, boxShadow:"0 20px 60px rgba(0,0,0,0.15)", overflow:"hidden", maxHeight:"90vh", display:"flex", flexDirection:"column" }}>
        <div style={{ padding:"18px 24px 14px", borderBottom:`1px solid ${T.border}`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ color:T.text, fontSize:16, fontWeight:800 }}>Add New Patient</div>
            <div style={{ color:T.textSoft, fontSize:11, marginTop:2 }}>Step {Math.min(step,4)} of 3 — {["Patient Info","Insurance","Appointment","Verifying","Results"][step-1]}</div>
          </div>
          <button onClick={onClose} style={{ background:"none", border:"none", color:T.textSoft, fontSize:20, cursor:"pointer" }}>✕</button>
        </div>
        {step < 4 && (
          <div style={{ padding:"0 24px", paddingTop:16, display:"flex", gap:6 }}>
            {[1,2,3].map(s => <div key={s} style={{ flex:1, height:4, borderRadius:2, background:s<=step?T.lime:T.border }} />)}
          </div>
        )}
        <div style={{ flex:1, overflowY:"auto", padding:"20px 24px" }}>
          {step===1 && (
            <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                <Field label="First Name" required error={err("firstName")}><Input value={form.firstName} onChange={set("firstName")} placeholder="Jane" error={err("firstName")} /></Field>
                <Field label="Last Name" required error={err("lastName")}><Input value={form.lastName} onChange={set("lastName")} placeholder="Smith" error={err("lastName")} /></Field>
              </div>
              <Field label="Date of Birth" required error={err("dob")}><Input type="date" value={form.dob} onChange={set("dob")} error={err("dob")} /></Field>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                <Field label="Phone"><Input value={form.phone} onChange={set("phone")} placeholder="(512) 555-0100" /></Field>
                <Field label="Email"><Input type="email" value={form.email} onChange={set("email")} placeholder="jane@email.com" /></Field>
              </div>
              <div style={{ padding:"12px 14px", background:T.limeLight, border:`1px solid ${T.limeBorder}`, borderRadius:8, color:T.limeDark, fontSize:12 }}>🔒 Patient data encrypted at rest · HIPAA compliant</div>
            </div>
          )}
          {step===2 && (
            <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
              <Field label="Insurance Carrier" required error={err("insurance")}><Select value={form.insurance} onChange={set("insurance")} options={PAYERS} placeholder="Select carrier..." error={err("insurance")} /></Field>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                <Field label="Member ID" required error={err("memberId")}><Input value={form.memberId} onChange={set("memberId")} placeholder="e.g. DD00112233" error={err("memberId")} /></Field>
                <Field label="Group Number"><Input value={form.groupNumber} onChange={set("groupNumber")} placeholder="e.g. GRP001234" /></Field>
              </div>
              <div style={{ borderTop:`1px solid ${T.border}`, paddingTop:14 }}>
                <Field label="Relationship to Subscriber"><Select value={form.relationship} onChange={set("relationship")} options={["self","spouse","child","other"]} placeholder="Select..." /></Field>
              </div>
              <div style={{ padding:"12px 14px", background:T.indigoLight, border:`1px solid ${T.indigoBorder}`, borderRadius:8, color:T.indigo, fontSize:12 }}>💡 Pulp AI will auto-verify and triage this patient after step 3.</div>
            </div>
          )}
          {step===3 && (
            <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
              <Field label="Provider" required error={err("provider")}><Select value={form.provider} onChange={set("provider")} options={PROVIDERS} placeholder="Select provider..." error={err("provider")} /></Field>
              <Field label="Procedure / Reason" required error={err("procedure")}><Input value={form.procedure} onChange={set("procedure")} placeholder="e.g. Prophy + BWX, Crown #14" error={err("procedure")} /></Field>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                <Field label="Appointment Date" required error={err("appointmentDate")}><Input type="date" value={form.appointmentDate} onChange={set("appointmentDate")} error={err("appointmentDate")} /></Field>
                <Field label="Appointment Time" required error={err("appointmentTime")}><Input type="time" value={form.appointmentTime} onChange={set("appointmentTime")} error={err("appointmentTime")} /></Field>
              </div>
              <Field label="Procedure Fee ($)"><Input type="number" value={form.fee} onChange={set("fee")} placeholder="e.g. 285.00" /></Field>
              <div style={{ padding:"12px 14px", background:T.amberLight, border:`1px solid ${T.amberBorder}`, borderRadius:8, color:T.amber, fontSize:12 }}>⚡ AI Triage will classify this patient as Clear / Warning / Critical automatically.</div>
            </div>
          )}
          {step===4 && (
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"40px 0", gap:16 }}>
              <div style={{ width:48, height:48, border:`3px solid ${T.lime}`, borderTopColor:"transparent", borderRadius:"50%", animation:"spin 0.8s linear infinite" }} />
              <div style={{ color:T.text, fontSize:15, fontWeight:800 }}>Verifying + Triaging</div>
              <div style={{ color:T.textSoft, fontSize:13, textAlign:"center", maxWidth:300, lineHeight:1.5 }}>Running eligibility check and AI triage for {form.firstName} {form.lastName}…</div>
              {["Checking member eligibility","Retrieving benefit limits","Running Triage Engine","Generating write-back note"].map(label => (
                <div key={label} style={{ display:"flex", alignItems:"center", gap:8, color:T.textMid, fontSize:12 }}>
                  <div style={{ width:16, height:16, borderRadius:"50%", background:T.limeLight, border:`1px solid ${T.limeBorder}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, color:T.lime }}>✓</div>
                  {label}
                </div>
              ))}
            </div>
          )}
          {step===5 && verifyResult && triage && (
            <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 16px", background:TRIAGE_CONFIG[triage.level].bg, border:`1px solid ${TRIAGE_CONFIG[triage.level].border}`, borderRadius:10 }}>
                <div>
                  <div style={{ color:T.text, fontSize:14, fontWeight:800 }}>{form.firstName} {form.lastName}</div>
                  <div style={{ color:T.textMid, fontSize:12, marginTop:2 }}>{verifyResult.result.payer_name}</div>
                </div>
                <TriageBadge level={triage.level} />
              </div>
              <div style={{ background:T.bgCard, border:`1px solid ${T.border}`, borderRadius:8, padding:"12px 16px" }}>
                <div style={{ color:T.textSoft, fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:10 }}>Benefits Snapshot</div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                  {[{label:"Annual Max",value:dollars(verifyResult.result.annual_maximum_cents)},{label:"Remaining",value:dollars(verifyResult.result.annual_remaining_cents)},{label:"Deductible",value:dollars(verifyResult.result.individual_deductible_cents)},{label:"Ded. Met",value:dollars(verifyResult.result.individual_deductible_met_cents)}].map(({label,value}) => (
                    <div key={label} style={{ padding:"8px 10px", background:T.bg, borderRadius:6, border:`1px solid ${T.border}` }}>
                      <div style={{ color:T.textSoft, fontSize:10, fontWeight:700 }}>{label}</div>
                      <div style={{ color:T.text, fontSize:14, fontWeight:800, marginTop:2 }}>{value}</div>
                    </div>
                  ))}
                </div>
              </div>
              {triage.reasons.length > 0 && (
                <div style={{ background:T.redLight, border:`1px solid ${T.redBorder}`, borderRadius:8, padding:"10px 14px" }}>
                  <div style={{ color:T.red, fontSize:11, fontWeight:800, textTransform:"uppercase", marginBottom:6 }}>🚨 Critical Issues</div>
                  {triage.reasons.map(r => <div key={r} style={{ color:T.red, fontSize:12, marginBottom:3 }}>• {r}</div>)}
                </div>
              )}
              {triage.warnings.length > 0 && (
                <div style={{ background:T.amberLight, border:`1px solid ${T.amberBorder}`, borderRadius:8, padding:"10px 14px" }}>
                  <div style={{ color:T.amber, fontSize:11, fontWeight:800, textTransform:"uppercase", marginBottom:6 }}>⚠ Warnings</div>
                  {triage.warnings.map(w => <div key={w} style={{ color:T.textMid, fontSize:12, marginBottom:3 }}>• {w}</div>)}
                </div>
              )}
              <div style={{ background:T.bg, border:`1px solid ${T.border}`, borderRadius:8, padding:"10px 14px" }}>
                <div style={{ color:T.textSoft, fontSize:10, fontWeight:700, textTransform:"uppercase", marginBottom:6 }}>AI Write-Back Note</div>
                <pre style={{ color:T.textMid, fontSize:11, lineHeight:1.6, whiteSpace:"pre-wrap", fontFamily:"'Nunito',sans-serif" }}>{triage.writeBack}</pre>
              </div>
              <div style={{ padding:"10px 14px", background:T.limeLight, border:`1px solid ${T.limeBorder}`, borderRadius:8, color:T.limeDark, fontSize:12, fontWeight:600 }}>✓ Patient will be added and scheduled for auto-reverification.</div>
            </div>
          )}
        </div>
        <div style={{ padding:"14px 24px", borderTop:`1px solid ${T.border}`, display:"flex", justifyContent:"space-between", alignItems:"center", background:T.bg }}>
          {step < 4 ? (
            <>
              <button onClick={step===1?onClose:()=>{setErrors({});setStep(s=>s-1);}} style={{ padding:"9px 18px", background:"none", border:`1.5px solid ${T.border}`, borderRadius:8, color:T.textMid, fontSize:13, fontWeight:700, cursor:"pointer" }}>{step===1?"Cancel":"← Back"}</button>
              <button onClick={handleNext} style={{ padding:"9px 22px", background:T.lime, border:"none", borderRadius:8, color:"#fff", fontSize:13, fontWeight:800, cursor:"pointer" }}>{step===3?"⚡ Verify + Triage →":"Next →"}</button>
            </>
          ) : step===5 ? (
            <>
              <button onClick={onClose} style={{ padding:"9px 18px", background:"none", border:`1.5px solid ${T.border}`, borderRadius:8, color:T.textMid, fontSize:13, fontWeight:700, cursor:"pointer" }}>Discard</button>
              <button onClick={handleSave} style={{ padding:"9px 22px", background:T.lime, border:"none", borderRadius:8, color:"#fff", fontSize:13, fontWeight:800, cursor:"pointer" }}>✓ Add to Schedule</button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ─── Morning Huddle Modal ─────────────────────────────────────────────────────
function MorningHuddleModal({ onClose, patients, results, triageMap }) {
  const [tab, setTab] = useState("email");
  const huddle = generateMorningHuddle(patients, results, triageMap);
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard.writeText(huddle); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  const critical = patients.filter(p => triageMap[p.id]?.level === TRIAGE.CRITICAL);
  const warning  = patients.filter(p => triageMap[p.id]?.level === TRIAGE.WARNING);
  const clear    = patients.filter(p => triageMap[p.id]?.level === TRIAGE.CLEAR);
  const pending  = patients.filter(p => !results[p.id]);

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:24 }} onClick={e => { if (e.target===e.currentTarget) onClose(); }}>
      <div style={{ background:T.bgCard, borderRadius:14, width:"100%", maxWidth:700, boxShadow:"0 20px 60px rgba(0,0,0,0.2)", overflow:"hidden", maxHeight:"90vh", display:"flex", flexDirection:"column" }}>
        <div style={{ padding:"18px 24px 14px", borderBottom:`1px solid ${T.border}`, display:"flex", justifyContent:"space-between", alignItems:"center", background:"linear-gradient(135deg, #1A1A18 0%, #2d2d2a 100%)" }}>
          <div>
            <div style={{ color:"#fff", fontSize:16, fontWeight:800 }}>☀️ Morning Huddle Report</div>
            <div style={{ color:"rgba(255,255,255,0.5)", fontSize:11, marginTop:2 }}>{new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"})}</div>
          </div>
          <button onClick={onClose} style={{ background:"rgba(255,255,255,0.1)", border:"none", color:"rgba(255,255,255,0.7)", fontSize:18, cursor:"pointer", borderRadius:6, width:32, height:32 }}>✕</button>
        </div>

        {/* Summary row */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:0, borderBottom:`1px solid ${T.border}` }}>
          {[
            { label:"Critical", count:critical.length, color:T.red, bg:T.redLight },
            { label:"Warning",  count:warning.length,  color:T.amber, bg:T.amberLight },
            { label:"Clear",    count:clear.length,    color:T.limeDark, bg:T.limeLight },
            { label:"Pending",  count:pending.length,  color:T.slate, bg:T.slateLight },
          ].map(({label,count,color,bg}) => (
            <div key={label} style={{ padding:"14px 0", textAlign:"center", background:bg, borderRight:`1px solid ${T.border}` }}>
              <div style={{ color, fontSize:28, fontWeight:900 }}>{count}</div>
              <div style={{ color, fontSize:10, fontWeight:800, textTransform:"uppercase", letterSpacing:"0.06em" }}>{label}</div>
            </div>
          ))}
        </div>

        {/* Tab switcher */}
        <div style={{ display:"flex", gap:4, padding:"12px 20px 0", borderBottom:`1px solid ${T.border}` }}>
          {[{id:"email",label:"📧 Email / Slack"},{id:"cards",label:"🗂 Action Cards"}].map(t => (
            <button key={t.id} onClick={()=>setTab(t.id)} style={{ padding:"7px 16px", borderRadius:"6px 6px 0 0", border:`1px solid ${tab===t.id?T.border:"transparent"}`, borderBottom:"none", background:tab===t.id?T.bgCard:T.bg, color:tab===t.id?T.text:T.textSoft, fontSize:12, fontWeight:tab===t.id?700:500, cursor:"pointer" }}>
              {t.label}
            </button>
          ))}
        </div>

        <div style={{ flex:1, overflowY:"auto" }}>
          {tab === "email" && (
            <div style={{ padding:20 }}>
              <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:8 }}>
                <button onClick={copy} style={{ padding:"6px 14px", background:copied?T.lime:T.bgCard, border:`1.5px solid ${copied?T.lime:T.border}`, borderRadius:6, color:copied?"#fff":T.textMid, fontSize:11, fontWeight:700, cursor:"pointer" }}>
                  {copied?"✓ Copied!":"📋 Copy"}
                </button>
              </div>
              <pre style={{ background:T.bg, borderRadius:10, padding:"16px 20px", border:`1px solid ${T.border}`, color:T.text, fontSize:12, lineHeight:1.7, whiteSpace:"pre-wrap", fontFamily:"'Nunito',sans-serif", margin:0 }}>{huddle}</pre>
            </div>
          )}
          {tab === "cards" && (
            <div style={{ padding:20, display:"flex", flexDirection:"column", gap:10 }}>
              {critical.length > 0 && (
                <div>
                  <div style={{ color:T.red, fontSize:11, fontWeight:800, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8 }}>🚨 Critical — Needs Immediate Attention</div>
                  {critical.map(p => {
                    const t = triageMap[p.id];
                    const r = results[p.id];
                    return (
                      <div key={p.id} style={{ background:T.redLight, border:`1px solid ${T.redBorder}`, borderRadius:10, padding:"12px 16px", marginBottom:8 }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8 }}>
                          <div>
                            <div style={{ color:T.text, fontWeight:800, fontSize:14 }}>{p.name}</div>
                            <div style={{ color:T.textMid, fontSize:12, marginTop:2 }}>{p.appointmentTime} · {p.procedure} · {r?.payer_name || p.insurance}</div>
                          </div>
                          <TriageBadge level={TRIAGE.CRITICAL} />
                        </div>
                        {t.reasons.map(r2 => <div key={r2} style={{ color:T.red, fontSize:12, padding:"4px 0", borderTop:`1px solid ${T.redBorder}` }}>❌ {r2}</div>)}
                        <div style={{ marginTop:8, padding:"6px 10px", background:"rgba(220,38,38,0.08)", borderRadius:6, color:T.red, fontSize:11, fontWeight:700 }}>→ Assign to front desk · Call carrier before appointment</div>
                      </div>
                    );
                  })}
                </div>
              )}
              {warning.length > 0 && (
                <div>
                  <div style={{ color:T.amber, fontSize:11, fontWeight:800, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8 }}>⚠ Warning — Review at Check-in</div>
                  {warning.map(p => {
                    const t = triageMap[p.id];
                    const r = results[p.id];
                    return (
                      <div key={p.id} style={{ background:T.amberLight, border:`1px solid ${T.amberBorder}`, borderRadius:10, padding:"12px 16px", marginBottom:8 }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8 }}>
                          <div>
                            <div style={{ color:T.text, fontWeight:800, fontSize:14 }}>{p.name}</div>
                            <div style={{ color:T.textMid, fontSize:12, marginTop:2 }}>{p.appointmentTime} · {p.procedure} · Remaining: {dollars(r?.annual_remaining_cents)}</div>
                          </div>
                          <TriageBadge level={TRIAGE.WARNING} />
                        </div>
                        {t.warnings.map(w => <div key={w} style={{ color:T.textMid, fontSize:12, padding:"4px 0", borderTop:`1px solid ${T.amberBorder}` }}>⚠ {w}</div>)}
                        <div style={{ marginTop:8, padding:"6px 10px", background:"rgba(217,119,6,0.08)", borderRadius:6, color:T.amber, fontSize:11, fontWeight:700 }}>→ Review estimate with patient at check-in</div>
                      </div>
                    );
                  })}
                </div>
              )}
              {clear.length > 0 && (
                <div>
                  <div style={{ color:T.limeDark, fontSize:11, fontWeight:800, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8 }}>✓ Clear — Ready to Go</div>
                  {clear.map(p => {
                    const r = results[p.id];
                    return (
                      <div key={p.id} style={{ background:T.limeLight, border:`1px solid ${T.limeBorder}`, borderRadius:10, padding:"12px 16px", marginBottom:8, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                        <div>
                          <div style={{ color:T.text, fontWeight:700, fontSize:13 }}>{p.name}</div>
                          <div style={{ color:T.textMid, fontSize:11, marginTop:2 }}>{p.appointmentTime} · {p.procedure}</div>
                        </div>
                        <div style={{ textAlign:"right" }}>
                          <div style={{ color:T.limeDark, fontSize:13, fontWeight:800 }}>{dollars(r?.annual_remaining_cents)} remaining</div>
                          <TriageBadge level={TRIAGE.CLEAR} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Scheduler Log ────────────────────────────────────────────────────────────
function SchedulerPanel({ log }) {
  return (
    <div style={{ background:T.bgCard, border:`1px solid ${T.border}`, borderRadius:10, padding:"14px 18px", marginBottom:16 }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
        <div style={{ width:8, height:8, borderRadius:"50%", background:T.lime, boxShadow:`0 0 0 3px ${T.limeBorder}`, animation:"pulse 2s ease-in-out infinite" }} />
        <div style={{ color:T.text, fontSize:12, fontWeight:800 }}>AI Scheduler — Live</div>
        <div style={{ color:T.textSoft, fontSize:10, marginLeft:"auto" }}>Auto-verifies at 72h and 24h before appointment</div>
      </div>
      {log.length === 0 ? (
        <div style={{ color:T.textSoft, fontSize:11, fontStyle:"italic" }}>Scheduler running… next tick in 30s</div>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:4, maxHeight:90, overflowY:"auto" }}>
          {log.slice(0,5).map((entry, i) => (
            <div key={i} style={{ display:"flex", gap:8, alignItems:"center", fontSize:11, color:T.textMid }}>
              <span style={{ color:T.textSoft, flexShrink:0 }}>{entry.time}</span>
              <span style={{ color:T.lime, flexShrink:0 }}>⚡</span>
              <span><strong>{entry.patient}</strong> — {entry.reason}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Write-Back Panel ─────────────────────────────────────────────────────────
function WriteBackPanel({ patient, triage }) {
  const [copied, setCopied] = useState(false);
  if (!triage?.writeBack) return null;
  const copy = () => { navigator.clipboard.writeText(triage.writeBack); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return (
    <div style={{ marginBottom:16 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
        <SectionLabel>AI Write-Back Note</SectionLabel>
        <button onClick={copy} style={{ padding:"3px 10px", background:copied?T.lime:T.bgCard, border:`1px solid ${copied?T.lime:T.border}`, borderRadius:5, color:copied?"#fff":T.textMid, fontSize:10, fontWeight:700, cursor:"pointer" }}>
          {copied?"✓ Copied":"📋 Copy"}
        </button>
      </div>
      <div style={{ background:T.bg, border:`1px solid ${T.border}`, borderRadius:8, padding:"10px 14px" }}>
        <pre style={{ color:T.textMid, fontSize:11, lineHeight:1.7, whiteSpace:"pre-wrap", fontFamily:"'Nunito',sans-serif", margin:0 }}>{triage.writeBack}</pre>
      </div>
    </div>
  );
}

// ─── Triage Summary Bar ───────────────────────────────────────────────────────
function TriageSummaryBar({ patients, triageMap }) {
  const c = patients.filter(p => triageMap[p.id]?.level === TRIAGE.CRITICAL).length;
  const w = patients.filter(p => triageMap[p.id]?.level === TRIAGE.WARNING).length;
  const cl = patients.filter(p => triageMap[p.id]?.level === TRIAGE.CLEAR).length;
  const pend = patients.length - c - w - cl;
  return (
    <div style={{ display:"flex", gap:6 }}>
      {[{label:"Critical",count:c,color:T.red,bg:T.redLight,border:T.redBorder},{label:"Warning",count:w,color:T.amber,bg:T.amberLight,border:T.amberBorder},{label:"Clear",count:cl,color:T.limeDark,bg:T.limeLight,border:T.limeBorder},{label:"Pending",count:pend,color:T.slate,bg:T.slateLight,border:T.border}].map(({label,count,color,bg,border}) => (
        <div key={label} style={{ padding:"4px 12px", background:bg, border:`1px solid ${border}`, borderRadius:20, display:"flex", alignItems:"center", gap:5 }}>
          <span style={{ color, fontSize:14, fontWeight:900 }}>{count}</span>
          <span style={{ color, fontSize:10, fontWeight:700 }}>{label}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Pre-Verify Banner ────────────────────────────────────────────────────────
function PreVerifyBanner({ patients, results, loading, onVerifyAll }) {
  const pending48 = patients.filter(p => p.hoursUntil <= 48 && !results[p.id] && !loading[p.id]).length;
  const verified48 = patients.filter(p => p.hoursUntil <= 48 && results[p.id]?.verification_status === STATUS.VERIFIED).length;
  const action48 = patients.filter(p => p.hoursUntil <= 48 && results[p.id]?.verification_status === STATUS.ACTION_REQUIRED).length;
  const allDone = pending48 === 0;
  return (
    <div style={{ background:allDone?T.limeLight:T.amberLight, border:`1px solid ${allDone?T.limeBorder:T.amberBorder}`, borderRadius:10, padding:"12px 18px", marginBottom:10, display:"flex", alignItems:"center", justifyContent:"space-between", gap:16 }}>
      <div style={{ display:"flex", alignItems:"center", gap:12 }}>
        <div style={{ width:36, height:36, borderRadius:9, background:allDone?T.lime:T.amber, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, flexShrink:0 }}>{allDone?"✓":"⏱"}</div>
        <div>
          <div style={{ color:allDone?T.limeDark:T.amber, fontSize:13, fontWeight:800 }}>
            {allDone ? "All upcoming appointments verified" : `${pending48} appointment${pending48!==1?"s":""} need verification in the next 48 hrs`}
          </div>
          <div style={{ color:T.textMid, fontSize:11, marginTop:2 }}>
            {allDone ? `${verified48} verified · ${action48} need attention · AI Scheduler is active` : "AI Scheduler auto-verifies 72h and 24h before — or run manually now"}
          </div>
        </div>
      </div>
      {!allDone && <button onClick={onVerifyAll} style={{ padding:"7px 14px", background:T.amber, border:"none", borderRadius:7, color:"#fff", fontSize:11, fontWeight:800, cursor:"pointer", whiteSpace:"nowrap", flexShrink:0 }}>⚡ Verify Now</button>}
    </div>
  );
}

// ─── Responsibility Estimator ─────────────────────────────────────────────────
function ResponsibilityEstimator({ patient, result }) {
  if (!result || result.plan_status !== "active" || !patient?.fee) return null;
  const fee = patient.fee;
  const deductibleOwed = Math.max(0,(result.individual_deductible_cents??0)-(result.individual_deductible_met_cents??0));
  const isPreventive = /prophy|clean|bwx|bitewing/i.test(patient.procedure);
  const isImplant    = /implant/i.test(patient.procedure);
  const coveragePct  = isImplant ? 0 : isPreventive ? (result.preventive?.coverage_pct??0) : (result.restorative?.coverage_pct??0);
  const copay        = isPreventive ? (result.preventive?.copay_cents??0) : (result.restorative?.copay_cents??0);
  const remainingMax = result.annual_remaining_cents ?? 0;
  const insurancePays = Math.min(remainingMax, Math.round(fee*(coveragePct/100)));
  const patientOwes  = fee - insurancePays + deductibleOwed + copay;
  const patientPct   = Math.round((patientOwes/fee)*100);
  return (
    <div style={{ marginBottom:16 }}>
      <SectionLabel>Patient Responsibility Estimate</SectionLabel>
      <div style={{ background:T.bgCard, border:`1px solid ${T.border}`, borderRadius:8, overflow:"hidden" }}>
        <div style={{ padding:"14px 16px", background:patientPct>50?T.amberLight:T.limeLight, borderBottom:`1px solid ${T.border}`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ color:T.textSoft, fontSize:10, fontWeight:700, textTransform:"uppercase" }}>Est. Patient Owes</div>
            <div style={{ color:patientPct>50?T.amber:T.limeDark, fontSize:24, fontWeight:900, lineHeight:1.1, marginTop:2 }}>{dollars(patientOwes)}</div>
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ color:T.textSoft, fontSize:10, fontWeight:700, textTransform:"uppercase" }}>Coverage</div>
            <div style={{ color:T.limeDark, fontSize:24, fontWeight:900, lineHeight:1.1, marginTop:2 }}>{pct(coveragePct)}</div>
          </div>
        </div>
        <div style={{ padding:"10px 16px" }}>
          {[{label:"Procedure fee",value:fee,color:T.text,sign:""},{label:`Insurance pays (${coveragePct}%)`,value:-insurancePays,color:T.limeDark,sign:"−"},deductibleOwed>0&&{label:"Deductible remaining",value:deductibleOwed,color:T.amber,sign:"+"},copay>0&&{label:"Co-pay",value:copay,color:T.amber,sign:"+"}].filter(Boolean).map(({label,value,color,sign}) => (
            <div key={label} style={{ display:"flex", justifyContent:"space-between", padding:"5px 0", borderBottom:`1px solid ${T.border}` }}>
              <span style={{ color:T.textMid, fontSize:12 }}>{label}</span>
              <span style={{ color, fontSize:12, fontWeight:700 }}>{sign}{dollars(Math.abs(value))}</span>
            </div>
          ))}
          <div style={{ display:"flex", justifyContent:"space-between", padding:"8px 0" }}>
            <span style={{ color:T.text, fontSize:13, fontWeight:800 }}>Total patient responsibility</span>
            <span style={{ color:patientPct>50?T.amber:T.limeDark, fontSize:13, fontWeight:800 }}>{dollars(patientOwes)}</span>
          </div>
        </div>
        {isImplant && <div style={{ padding:"8px 16px", background:T.redLight, borderTop:`1px solid ${T.redBorder}`, color:T.red, fontSize:11 }}>⚠ Implant services typically not covered — patient likely responsible for full fee</div>}
        <div style={{ padding:"8px 16px", borderTop:`1px solid ${T.border}`, color:T.textSoft, fontSize:10 }}>* Estimate only. Actual patient responsibility may vary.</div>
      </div>
    </div>
  );
}

// ─── Cleaning Tracker ─────────────────────────────────────────────────────────
function CleaningTracker({ freq }) {
  if (!freq) return null;
  const used = freq.used_this_period ?? 0;
  const total = freq.times_per_period ?? 2;
  const remaining = Math.max(0, total - used);
  const eligible = isEligible(freq.next_eligible_date);
  const days = daysUntil(freq.next_eligible_date);
  return (
    <div style={{ background:T.bgCard, border:`1px solid ${T.border}`, borderRadius:8, padding:"12px 14px", marginBottom:4 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
        <span style={{ color:T.textMid, fontSize:11, fontWeight:600 }}>{freq.period?.replace(/_/g," ")}</span>
        <span style={{ fontSize:10, fontWeight:800, padding:"3px 9px", borderRadius:10, background:eligible?T.limeLight:T.redLight, color:eligible?T.limeDark:T.red, border:`1px solid ${eligible?T.limeBorder:T.redBorder}` }}>
          {eligible ? "✓ Eligible Now" : days>0 ? `${days}d until eligible` : "Not Yet Eligible"}
        </span>
      </div>
      <div style={{ display:"flex", gap:5, marginBottom:10 }}>
        {Array.from({length:total}).map((_,i) => <div key={i} style={{ flex:1, height:8, borderRadius:4, background:i<used?T.lime:T.border }} />)}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6, marginBottom:10 }}>
        {[{label:"Used",value:used,color:T.textMid},{label:"Remaining",value:remaining,color:remaining>0?T.limeDark:T.red},{label:"Per Year",value:total,color:T.textSoft}].map(({label,value,color}) => (
          <div key={label} style={{ textAlign:"center", padding:"7px 0", background:T.bg, borderRadius:6, border:`1px solid ${T.border}` }}>
            <div style={{ color, fontSize:17, fontWeight:800 }}>{value}</div>
            <div style={{ color:T.textSoft, fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em", marginTop:1 }}>{label}</div>
          </div>
        ))}
      </div>
      <div style={{ borderTop:`1px solid ${T.border}`, paddingTop:8, display:"flex", flexDirection:"column", gap:4 }}>
        <div style={{ display:"flex", justifyContent:"space-between" }}>
          <span style={{ color:T.textSoft, fontSize:11 }}>Last cleaning</span>
          <span style={{ color:freq.last_service_date?T.textMid:T.limeDark, fontSize:11 }}>{freq.last_service_date||"No record — eligible"}</span>
        </div>
        {freq.next_eligible_date && <div style={{ display:"flex", justifyContent:"space-between" }}>
          <span style={{ color:T.textSoft, fontSize:11 }}>Next eligible</span>
          <span style={{ color:eligible?T.limeDark:T.red, fontSize:11, fontWeight:700 }}>{freq.next_eligible_date}</span>
        </div>}
      </div>
      {freq.perio_maintenance_covered!==undefined && (
        <div style={{ marginTop:8, padding:"7px 10px", borderRadius:6, background:freq.perio_maintenance_covered?T.limeLight:T.redLight, border:`1px solid ${freq.perio_maintenance_covered?T.limeBorder:T.redBorder}` }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <span style={{ color:T.textMid, fontSize:11 }}>Perio maintenance D4910</span>
            <span style={{ color:freq.perio_maintenance_covered?T.limeDark:T.red, fontSize:11, fontWeight:800 }}>{freq.perio_maintenance_covered?`${freq.perio_maintenance_frequency?.times_per_period}x / yr`:"Not covered"}</span>
          </div>
          {freq.notes && <div style={{ color:T.textMid, fontSize:10, lineHeight:1.5, marginTop:2 }}>{freq.notes}</div>}
        </div>
      )}
    </div>
  );
}

// ─── Missing Tooth Clause ─────────────────────────────────────────────────────
function MissingToothClause({ mtc }) {
  const [expanded, setExpanded] = useState(false);
  if (!mtc) return null;
  if (!mtc.applies) return (
    <div style={{ display:"flex", alignItems:"center", gap:8, padding:"9px 12px", background:T.limeLight, border:`1px solid ${T.limeBorder}`, borderRadius:7 }}>
      <span style={{ color:T.lime, fontSize:14 }}>✓</span>
      <span style={{ color:T.limeDark, fontSize:12, fontWeight:700 }}>No missing tooth clause on this plan</span>
    </div>
  );
  return (
    <div style={{ background:T.redLight, border:`1px solid ${T.redBorder}`, borderRadius:8, overflow:"hidden" }}>
      <div onClick={()=>setExpanded(e=>!e)} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 14px", cursor:"pointer" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:14 }}>🦷</span>
          <div>
            <div style={{ color:T.red, fontSize:12, fontWeight:700 }}>Missing Tooth Clause Applies</div>
            <div style={{ color:T.textMid, fontSize:10, marginTop:1 }}>{mtc.affected_teeth?.length>0?`Teeth: ${mtc.affected_teeth.join(", ")}`:""}{mtc.policy_effective_date?` · Policy: ${mtc.policy_effective_date}`:""}</div>
          </div>
        </div>
        <span style={{ color:T.textSoft, fontSize:11 }}>{expanded?"▲":"▼"}</span>
      </div>
      {expanded && (
        <div style={{ padding:"0 14px 12px", borderTop:`1px solid ${T.redBorder}` }}>
          {mtc.excluded_services?.length>0 && <div style={{ marginTop:10 }}>
            <div style={{ color:T.textSoft, fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:5 }}>Excluded Services</div>
            {mtc.excluded_services.map(s=><div key={s} style={{ display:"flex", gap:6, padding:"4px 0", borderBottom:`1px solid ${T.redBorder}` }}><span style={{ color:T.red, fontSize:10 }}>✕</span><span style={{ color:T.textMid, fontSize:11 }}>{s}</span></div>)}
          </div>}
          {mtc.notes && <div style={{ marginTop:10, padding:"8px 10px", background:T.bgCard, borderRadius:5, color:T.textMid, fontSize:11, lineHeight:1.5 }}>{mtc.notes}</div>}
          {mtc.exception_pathway && <div style={{ marginTop:10, padding:"8px 10px", background:T.amberLight, border:`1px solid ${T.amberBorder}`, borderRadius:6, color:T.amber, fontSize:11, lineHeight:1.5 }}>💡 {mtc.exception_pathway}</div>}
        </div>
      )}
    </div>
  );
}

// ─── Patient Row ──────────────────────────────────────────────────────────────
function PatientRow({ patient, onSelect, isSelected, result, loading, triage }) {
  const status = loading ? STATUS.PENDING : (result?.verification_status ?? STATUS.PENDING);
  const urgentSoon = patient.hoursUntil <= 48;
  return (
    <div onClick={()=>onSelect(patient)} style={{ display:"grid", gridTemplateColumns:"1fr 90px 130px 100px 110px 110px", alignItems:"center", gap:10, padding:"13px 20px", cursor:"pointer", background:isSelected?T.bgSelected:T.bgCard, borderLeft:`3px solid ${isSelected?T.lime:"transparent"}`, borderBottom:`1px solid ${T.border}` }}>
      <div>
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          <div style={{ color:T.text, fontSize:13, fontWeight:700 }}>{patient.name}</div>
          {urgentSoon && !result && <span style={{ fontSize:9, fontWeight:800, padding:"1px 6px", borderRadius:8, background:T.amberLight, color:T.amber, border:`1px solid ${T.amberBorder}`, textTransform:"uppercase" }}>Due Soon</span>}
        </div>
        <div style={{ color:T.textSoft, fontSize:11, marginTop:2 }}>{patient.procedure}{patient.fee ? ` · ${dollars(patient.fee)}` : ""}</div>
      </div>
      <div style={{ color:T.textMid, fontSize:12 }}>{patient.appointmentTime}</div>
      <div style={{ color:T.textMid, fontSize:12 }}>{patient.insurance}</div>
      <div style={{ color:T.textSoft, fontSize:12 }}>{patient.provider}</div>
      <div>
        {loading
          ? <span style={{ display:"inline-flex", alignItems:"center", gap:5, color:T.lime, fontSize:11 }}><span style={{ width:8, height:8, border:`1.5px solid ${T.lime}`, borderTopColor:"transparent", borderRadius:"50%", display:"inline-block", animation:"spin 0.7s linear infinite" }} />Checking</span>
          : <StatusBadge status={status} />}
      </div>
      <div style={{ display:"flex", justifyContent:"flex-end" }}>
        {triage && !loading && <TriageBadge level={triage.level} />}
      </div>
    </div>
  );
}

// ─── Benefits Panel ───────────────────────────────────────────────────────────
function BenefitsPanel({ patient, result, loading, onVerify, triage }) {
  if (!patient) return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:"100%", gap:10, color:T.textSoft, background:T.bg }}>
      <div style={{ fontSize:28 }}>☝️</div>
      <div style={{ fontSize:12, fontWeight:600 }}>Select a patient to view benefits & triage</div>
    </div>
  );
  const { preventive:prev, restorative:rest, action_flags=[], action_descriptions={} } = result || {};
  const remainingPct = result ? ((result.annual_remaining_cents??0)/(result.annual_maximum_cents||1))*100 : 0;
  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", overflow:"hidden" }}>
      <div style={{ padding:"16px 18px 12px", borderBottom:`1px solid ${T.border}`, background:T.bgCard }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
          <div>
            <div style={{ color:T.text, fontSize:15, fontWeight:800 }}>{patient.name}</div>
            <div style={{ color:T.textSoft, fontSize:10, marginTop:2 }}>DOB {patient.dob} · {patient.memberId}</div>
            {patient.phone && <div style={{ color:T.textSoft, fontSize:10, marginTop:1 }}>{patient.phone}{patient.email?` · ${patient.email}`:""}</div>}
          </div>
          <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:5 }}>
            {result && <StatusBadge status={result.verification_status} />}
            {triage && <TriageBadge level={triage.level} />}
          </div>
        </div>
        {result && <div style={{ color:T.textMid, fontSize:12, marginTop:6, fontWeight:600 }}>{result.payer_name}</div>}
      </div>
      <div style={{ flex:1, overflowY:"auto", padding:"16px 18px", background:T.bg }}>
        {loading && (
          <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:10, padding:"48px 0", color:T.textSoft }}>
            <div style={{ width:26, height:26, border:`2.5px solid ${T.lime}`, borderTopColor:"transparent", borderRadius:"50%", animation:"spin 0.7s linear infinite" }} />
            <div style={{ fontSize:11, fontWeight:600 }}>Querying clearinghouse + running triage…</div>
          </div>
        )}
        {!result && !loading && (
          <button onClick={()=>onVerify(patient)} style={{ width:"100%", padding:"13px 0", background:T.lime, border:"none", borderRadius:8, color:"#fff", fontSize:13, fontWeight:800, cursor:"pointer" }}>⚡ Run Verification + Triage</button>
        )}
        {result && !loading && (
          <>
            {/* Triage breakdown */}
            {triage && (triage.reasons.length > 0 || triage.warnings.length > 0) && (
              <div style={{ marginBottom:16 }}>
                <SectionLabel>Triage Analysis</SectionLabel>
                {triage.reasons.map(r => (
                  <div key={r} style={{ display:"flex", gap:8, padding:"7px 10px", background:T.redLight, borderLeft:`2.5px solid ${T.red}`, borderRadius:"0 6px 6px 0", marginBottom:4 }}>
                    <span style={{ color:T.red, fontSize:11, flexShrink:0 }}>🚨</span>
                    <span style={{ color:T.textMid, fontSize:11 }}>{r}</span>
                  </div>
                ))}
                {triage.warnings.map(w => (
                  <div key={w} style={{ display:"flex", gap:8, padding:"7px 10px", background:T.amberLight, borderLeft:`2.5px solid ${T.amber}`, borderRadius:"0 6px 6px 0", marginBottom:4 }}>
                    <span style={{ color:T.amber, fontSize:11, flexShrink:0 }}>⚠</span>
                    <span style={{ color:T.textMid, fontSize:11 }}>{w}</span>
                  </div>
                ))}
              </div>
            )}
            {action_flags.length>0 && <div style={{ marginBottom:16 }}><SectionLabel>Raw Action Flags</SectionLabel>{action_flags.map(f=><ActionFlag key={f} flag={f} description={action_descriptions[f]||""} />)}</div>}
            <ResponsibilityEstimator patient={patient} result={result} />
            <div style={{ marginBottom:16 }}>
              <SectionLabel>Annual Benefits</SectionLabel>
              <div style={{ background:T.bgCard, borderRadius:8, padding:"12px 14px", border:`1px solid ${T.border}` }}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                  <span style={{ color:T.textMid, fontSize:11 }}>Remaining / Maximum</span>
                  <span style={{ color:T.text, fontWeight:800, fontSize:13 }}>{dollars(result.annual_remaining_cents)} <span style={{ color:T.textSoft, fontWeight:400 }}>/ {dollars(result.annual_maximum_cents)}</span></span>
                </div>
                <Meter value={result.annual_remaining_cents??0} max={result.annual_maximum_cents??1} color={remainingPct>50?T.lime:remainingPct>20?T.amber:T.red} />
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5, marginTop:12 }}>
                  <span style={{ color:T.textMid, fontSize:11 }}>Deductible Met</span>
                  <span style={{ color:T.text, fontWeight:800, fontSize:13 }}>{dollars(result.individual_deductible_met_cents)} <span style={{ color:T.textSoft, fontWeight:400 }}>/ {dollars(result.individual_deductible_cents)}</span></span>
                </div>
                <Meter value={result.individual_deductible_met_cents??0} max={result.individual_deductible_cents||1} color={T.lime} />
              </div>
            </div>
            {prev && <div style={{ marginBottom:16 }}>
              <SectionLabel>D1000s — Preventive</SectionLabel>
              <div style={{ background:T.bgCard, borderRadius:8, padding:"4px 14px", border:`1px solid ${T.border}`, marginBottom:8 }}>
                <BenefitRow label="Coverage" value={pct(prev.coverage_pct)} highlight={prev.coverage_pct===100} />
                <BenefitRow label="Co-pay" value={prev.copay_cents?dollars(prev.copay_cents):"None"} />
                {prev.bitewing_frequency && <BenefitRow label="Bitewing X-rays" value={`${prev.bitewing_frequency.times_per_period}x / yr`} sub={prev.bitewing_frequency.last_service_date?`Last: ${prev.bitewing_frequency.last_service_date}`:null} />}
                {prev.sealant_coverage_pct && <BenefitRow label="Sealants" value={pct(prev.sealant_coverage_pct)} sub={prev.sealant_age_limit?`Age limit: ${prev.sealant_age_limit}`:null} />}
              </div>
              {prev.cleaning_frequency && <><div style={{ color:T.textSoft, fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:5 }}>Cleaning Eligibility Tracker</div><CleaningTracker freq={prev.cleaning_frequency} /></>}
            </div>}
            {rest && <div style={{ marginBottom:16 }}>
              <SectionLabel>D2000s — Restorative</SectionLabel>
              <div style={{ background:T.bgCard, borderRadius:8, padding:"4px 14px", border:`1px solid ${T.border}` }}>
                <BenefitRow label="Coverage" value={pct(rest.coverage_pct)} />
                <BenefitRow label="Co-pay" value={rest.copay_cents?dollars(rest.copay_cents):"None"} />
                <BenefitRow label="Posterior Composite" value={rest.composite_posterior_downgrade?"Downgraded to amalgam rate":"Full coverage"} />
                {rest.crown_waiting_period_months>0 && <BenefitRow label="Crown Waiting Period" value={`${rest.crown_waiting_period_months} months`} />}
              </div>
            </div>}
            {result.missing_tooth_clause!==undefined && <div style={{ marginBottom:16 }}><SectionLabel>Missing Tooth Clause</SectionLabel><MissingToothClause mtc={result.missing_tooth_clause} /></div>}
            {result.verification_status===STATUS.INACTIVE && <div style={{ padding:"12px 14px", background:T.redLight, border:`1px solid ${T.redBorder}`, borderRadius:8, color:T.red, fontSize:12, marginBottom:16 }}>⚠ Insurance plan is inactive. Patient must provide updated coverage before treatment.</div>}
            <WriteBackPanel patient={patient} triage={triage} />
            <button onClick={()=>onVerify(patient)} style={{ width:"100%", padding:"9px 0", marginTop:4, background:T.bgCard, border:`1.5px solid ${T.lime}`, borderRadius:7, color:T.limeDark, fontSize:11, fontWeight:800, cursor:"pointer" }}>↻ Re-verify + Re-triage</button>
            <div style={{ color:T.textSoft, fontSize:10, textAlign:"center", marginTop:6 }}>Verified {new Date(result.verified_at).toLocaleTimeString()} · Expires {new Date(result.expires_at).toLocaleDateString()}</div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Analytics ────────────────────────────────────────────────────────────────
function AnalyticsView() {
  const { thisMonth, trend, topFlags, topPayers } = ANALYTICS;
  const maxTrend = Math.max(...trend.map(t=>t.verified+t.action+t.inactive));
  return (
    <div style={{ padding:"20px 24px", overflowY:"auto", height:"100%", background:T.bg }}>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:24 }}>
        {[{label:"Total Verifications",value:thisMonth.total,color:T.text,sub:"This month"},{label:"Verified",value:thisMonth.verified,color:T.limeDark,sub:`${Math.round(thisMonth.verified/thisMonth.total*100)}% success rate`},{label:"Action Required",value:thisMonth.actionRequired,color:T.amber,sub:"Need follow-up"},{label:"Avg Verify Time",value:`${thisMonth.avgTimeSeconds}s`,color:T.indigo,sub:"Per patient"}].map(({label,value,color,sub}) => (
          <div key={label} style={{ background:T.bgCard, border:`1px solid ${T.border}`, borderRadius:10, padding:"16px 18px" }}>
            <div style={{ color:T.textSoft, fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>{label}</div>
            <div style={{ color, fontSize:28, fontWeight:900, lineHeight:1 }}>{value}</div>
            <div style={{ color:T.textSoft, fontSize:11, marginTop:4 }}>{sub}</div>
          </div>
        ))}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1.4fr 1fr", gap:16, marginBottom:16 }}>
        <div style={{ background:T.bgCard, border:`1px solid ${T.border}`, borderRadius:10, padding:"18px 20px" }}>
          <div style={{ color:T.text, fontSize:13, fontWeight:800, marginBottom:16 }}>Verification Trend — Last 6 Months</div>
          <div style={{ display:"flex", alignItems:"flex-end", gap:8, height:120 }}>
            {trend.map(({month,verified,action,inactive}) => {
              const vH=Math.round((verified/maxTrend)*120), aH=Math.round((action/maxTrend)*120), iH=Math.round((inactive/maxTrend)*120);
              return (
                <div key={month} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center" }}>
                  <div style={{ width:"100%", display:"flex", flexDirection:"column", justifyContent:"flex-end", height:120, gap:1 }}>
                    <div style={{ height:iH, background:T.redBorder, borderRadius:"2px 2px 0 0" }} />
                    <div style={{ height:aH, background:T.amberBorder }} />
                    <div style={{ height:vH, background:T.lime }} />
                  </div>
                  <div style={{ color:T.textSoft, fontSize:10, marginTop:5, fontWeight:600 }}>{month}</div>
                  <div style={{ color:T.textMid, fontSize:10, fontWeight:700 }}>{verified+action+inactive}</div>
                </div>
              );
            })}
          </div>
          <div style={{ display:"flex", gap:14, marginTop:12 }}>
            {[{label:"Verified",color:T.lime},{label:"Action Req.",color:T.amberBorder},{label:"Inactive",color:T.redBorder}].map(({label,color}) => (
              <div key={label} style={{ display:"flex", alignItems:"center", gap:5 }}>
                <div style={{ width:8, height:8, borderRadius:2, background:color }} />
                <span style={{ color:T.textSoft, fontSize:10 }}>{label}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ background:T.bgCard, border:`1px solid ${T.border}`, borderRadius:10, padding:"18px 20px" }}>
          <div style={{ color:T.text, fontSize:13, fontWeight:800, marginBottom:16 }}>Top Action Flags</div>
          {topFlags.map(({flag,count,color}) => (
            <div key={flag} style={{ marginBottom:10 }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                <span style={{ color:T.textMid, fontSize:12 }}>{flag}</span>
                <span style={{ color, fontSize:12, fontWeight:700 }}>{count}</span>
              </div>
              <div style={{ height:5, background:T.border, borderRadius:3, overflow:"hidden" }}>
                <div style={{ height:"100%", width:`${(count/topFlags[0].count)*100}%`, background:color, borderRadius:3 }} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ background:T.bgCard, border:`1px solid ${T.border}`, borderRadius:10, padding:"18px 20px" }}>
        <div style={{ color:T.text, fontSize:13, fontWeight:800, marginBottom:14 }}>Payer Performance</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:8 }}>
          {topPayers.map(({name,total,successRate}) => (
            <div key={name} style={{ background:T.bg, border:`1px solid ${T.border}`, borderRadius:8, padding:"12px 14px", textAlign:"center" }}>
              <div style={{ color:successRate>=85?T.limeDark:successRate>=75?T.amber:T.red, fontSize:22, fontWeight:900 }}>{successRate}%</div>
              <div style={{ color:T.text, fontSize:11, fontWeight:700, marginTop:3, lineHeight:1.3 }}>{name}</div>
              <div style={{ color:T.textSoft, fontSize:10, marginTop:3 }}>{total} verifications</div>
              <div style={{ marginTop:6, height:4, background:T.border, borderRadius:2, overflow:"hidden" }}>
                <div style={{ height:"100%", width:`${successRate}%`, background:successRate>=85?T.lime:successRate>=75?T.amber:T.red, borderRadius:2 }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function PulpDashboard() {
  const [tab, setTab] = useState("schedule");
  const [patients, setPatients] = useState(INITIAL_PATIENTS);
  const [selected, setSelected] = useState(null);
  const [results, setResults] = useState({});
  const [loading, setLoading] = useState({});
  const [showAddModal, setShowAddModal] = useState(false);
  const [showHuddle, setShowHuddle] = useState(false);

  // Refs for scheduler (needs latest state without re-running effect)
  const resultsRef = useRef(results);
  const loadingRef = useRef(loading);
  useEffect(() => { resultsRef.current = results; }, [results]);
  useEffect(() => { loadingRef.current = loading; }, [loading]);

  const verify = useCallback(async (patient) => {
    setLoading(l => ({ ...l, [patient.id]:true }));
    try { const r = await mockVerify(patient); setResults(prev => ({ ...prev, [patient.id]:r })); }
    finally { setLoading(l => ({ ...l, [patient.id]:false })); }
  }, []);

  // Scheduler: polls every 30s and auto-verifies patients in 72h window
  const schedulerLog = useScheduler(patients, resultsRef, loadingRef, verify);

  const handleSelect = (p) => { setSelected(p); if (!results[p.id] && !loading[p.id]) verify(p); };
  const verifyAll = () => patients.forEach(p => { if (!results[p.id] && !loading[p.id]) verify(p); });

  const handleAddPatient = (newPatient, verifyResult) => {
    setPatients(prev => [...prev, newPatient]);
    setResults(prev => ({ ...prev, [newPatient.id]: verifyResult }));
    setSelected(newPatient);
  };

  // Build triage map for all verified patients
  const triageMap = {};
  patients.forEach(p => {
    if (results[p.id]) triageMap[p.id] = triagePatient(p, results[p.id]);
  });

  const summary = {
    verified: Object.values(results).filter(r => r.verification_status === STATUS.VERIFIED).length,
    action:   Object.values(results).filter(r => r.verification_status === STATUS.ACTION_REQUIRED).length,
    inactive: Object.values(results).filter(r => r.verification_status === STATUS.INACTIVE).length,
    pending:  patients.length - Object.keys(results).length,
  };

  return (
    <div style={{ minHeight:"100vh", background:T.bg, fontFamily:"'Nunito',sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800;900&display=swap');
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Nunito', sans-serif; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #C8C8C0; border-radius: 2px; }
        button:hover { opacity: 0.88; transition: opacity 0.1s; }
      `}</style>

      {/* Nav */}
      <div style={{ background:T.bgCard, borderBottom:`1px solid ${T.border}`, padding:"0 24px", height:56, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div style={{ display:"flex", alignItems:"center", gap:16 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:32, height:32, borderRadius:9, background:T.lime, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>🦷</div>
            <div>
              <div style={{ color:T.lime, fontSize:18, fontWeight:900, letterSpacing:"-0.02em", lineHeight:1 }}>Pulp</div>
              <div style={{ color:T.textSoft, fontSize:9, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", lineHeight:1 }}>AI Agent</div>
            </div>
          </div>
          <div style={{ display:"flex", gap:2 }}>
            {[{id:"schedule",label:"Today's Schedule"},{id:"analytics",label:"Analytics"}].map(t => (
              <button key={t.id} onClick={()=>setTab(t.id)} style={{ padding:"5px 14px", borderRadius:7, border:"none", background:tab===t.id?T.limeLight:"transparent", color:tab===t.id?T.limeDark:T.textMid, fontSize:12, fontWeight:tab===t.id?800:600, cursor:"pointer" }}>{t.label}</button>
            ))}
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <div style={{ color:T.textSoft, fontSize:11, fontWeight:600, marginRight:4 }}>{new Date().toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"})}</div>
          <TriageSummaryBar patients={patients} triageMap={triageMap} />
          <button onClick={()=>setShowHuddle(true)}
            style={{ marginLeft:4, padding:"7px 14px", background:T.text, border:"none", borderRadius:8, color:"#fff", fontSize:12, fontWeight:800, cursor:"pointer", display:"flex", alignItems:"center", gap:6 }}>
            ☀️ Huddle
          </button>
          <button onClick={()=>setShowAddModal(true)}
            style={{ padding:"7px 16px", background:T.lime, border:"none", borderRadius:8, color:"#fff", fontSize:12, fontWeight:800, cursor:"pointer", display:"flex", alignItems:"center", gap:6 }}>
            <span style={{ fontSize:16, lineHeight:1 }}>+</span> New Patient
          </button>
        </div>
      </div>

      {/* Content */}
      {tab === "analytics" ? (
        <div style={{ height:"calc(100vh - 56px)", overflow:"hidden" }}><AnalyticsView /></div>
      ) : (
        <div style={{ height:"calc(100vh - 56px)", display:"flex", flexDirection:"column" }}>
          <div style={{ padding:"12px 24px 0" }}>
            <PreVerifyBanner patients={patients} results={results} loading={loading} onVerifyAll={verifyAll} />
            <SchedulerPanel log={schedulerLog} />
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 400px", flex:1, overflow:"hidden", margin:"0 24px 16px", gap:16 }}>
            {/* Patient table */}
            <div style={{ display:"flex", flexDirection:"column", background:T.bgCard, border:`1px solid ${T.border}`, borderRadius:10, overflow:"hidden" }}>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 90px 130px 100px 110px 110px", gap:10, padding:"10px 20px", borderBottom:`1px solid ${T.border}`, background:T.bg }}>
                {["Patient / Procedure","Time","Insurance","Provider","Status","Triage"].map(h => (
                  <div key={h} style={{ color:T.textSoft, fontSize:10, fontWeight:800, letterSpacing:"0.06em", textTransform:"uppercase", textAlign:h==="Triage"?"right":"left" }}>{h}</div>
                ))}
              </div>
              <div style={{ flex:1, overflowY:"auto" }}>
                {patients.map(p => <PatientRow key={p.id} patient={p} onSelect={handleSelect} isSelected={selected?.id===p.id} result={results[p.id]} loading={loading[p.id]} triage={triageMap[p.id]} />)}
              </div>
              <div style={{ padding:"10px 20px", borderTop:`1px solid ${T.border}`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <span style={{ color:T.textSoft, fontSize:11, fontWeight:600 }}>{patients.length} patients today · AI Triage active</span>
                <div style={{ display:"flex", gap:8 }}>
                  <button onClick={()=>setShowAddModal(true)} style={{ padding:"7px 14px", background:T.bgCard, border:`1.5px solid ${T.lime}`, borderRadius:6, color:T.limeDark, fontSize:11, cursor:"pointer", fontWeight:800 }}>+ Add Patient</button>
                  <button onClick={verifyAll} style={{ padding:"7px 16px", background:T.lime, border:"none", borderRadius:6, color:"#fff", fontSize:11, cursor:"pointer", fontWeight:800 }}>⚡ Verify All</button>
                </div>
              </div>
            </div>
            {/* Benefits + Triage panel */}
            <div style={{ background:T.bgCard, border:`1px solid ${T.border}`, borderRadius:10, overflow:"hidden" }}>
              <BenefitsPanel patient={selected} result={selected?results[selected.id]:null} loading={selected?loading[selected.id]:false} onVerify={verify} triage={selected?triageMap[selected.id]:null} />
            </div>
          </div>
        </div>
      )}

      {showAddModal && <AddPatientModal onClose={()=>setShowAddModal(false)} onAdd={handleAddPatient} />}
      {showHuddle && <MorningHuddleModal onClose={()=>setShowHuddle(false)} patients={patients} results={results} triageMap={triageMap} />}
    </div>
  );
}

