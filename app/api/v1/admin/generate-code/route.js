/**
 * POST /api/v1/admin/generate-code
 *
 * Generates one or more single-use activation codes.
 * Admin-only — checks ADMIN_USER_IDS env var or Clerk publicMetadata.role.
 */
import { auth, currentUser } from "@clerk/nextjs/server";
import { prisma } from "../../../../../lib/prisma.js";
import crypto from "crypto";

// Character set excludes I, O, 0, 1 to avoid human transcription errors
const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateCode() {
  const segment = () =>
    Array.from(crypto.randomBytes(4))
      .map((b) => CHARS[b % CHARS.length])
      .join("");
  return `LVL-${segment()}-${segment()}`;
}

const ADMIN_IDS = new Set(
  (process.env.ADMIN_USER_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

function isAdmin(userId, user) {
  if (ADMIN_IDS.has(userId)) return true;
  const role = user?.publicMetadata?.role;
  return role === "admin" || role === "owner";
}

export async function POST(request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await currentUser();
    if (!isAdmin(userId, user)) {
      return Response.json(
        { error: "Forbidden — admin access required" },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const count = Math.min(Math.max(parseInt(body.count) || 1, 1), 50);

    const codes = [];
    for (let i = 0; i < count; i++) {
      let code;
      let attempts = 0;
      do {
        code = generateCode();
        attempts++;
      } while (
        attempts < 10 &&
        (await prisma.activationCode.findUnique({ where: { code } }))
      );

      const record = await prisma.activationCode.create({
        data: { code },
      });
      codes.push(record.code);
    }

    return Response.json({ codes });
  } catch (err) {
    console.error("[admin/generate-code] Error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
