/**
 * POST /api/v1/stripe/checkout
 *
 * Creates a Stripe Checkout Session for subscription billing.
 * Requires authentication via Clerk.
 *
 * Body: { priceId: "price_xxx" }
 * Returns: { url: "https://checkout.stripe.com/..." }
 */

import { auth } from "@clerk/nextjs/server";

// Lazy-initialize Stripe to avoid build-time errors when env vars are missing
let _stripe = null;
function getStripe() {
  if (!_stripe) {
    const Stripe = require("stripe").default || require("stripe");
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2024-12-18.acacia",
    });
  }
  return _stripe;
}

// Map plan names to their Stripe Price IDs (set these in your Stripe Dashboard)
function getPriceMap() {
  return {
    starter:      process.env.STRIPE_PRICE_STARTER      || null,
    professional: process.env.STRIPE_PRICE_PROFESSIONAL  || null,
    enterprise:   process.env.STRIPE_PRICE_ENTERPRISE    || null,
  };
}

export async function POST(request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { plan } = body;

    const priceMap = getPriceMap();
    if (!plan || !priceMap[plan]) {
      return Response.json(
        { error: "Invalid plan. Choose starter, professional, or enterprise." },
        { status: 400 }
      );
    }

    const priceId = priceMap[plan];
    if (!priceId) {
      return Response.json(
        { error: "This plan is not yet configured for billing. Please contact support." },
        { status: 400 }
      );
    }

    const stripe = getStripe();

    // Look up or create Stripe customer
    const { prisma } = await import("../../../../../lib/prisma.js");
    const practice = await prisma.practice.findUnique({
      where: { clerkUserId: userId },
    });

    let customerId = practice?.stripeCustomerId || null;

    if (!customerId) {
      const customer = await stripe.customers.create({
        metadata: {
          clerkUserId: userId,
          practiceId: practice?.id || "unknown",
        },
      });
      customerId = customer.id;

      // Save customer ID to practice
      if (practice) {
        await prisma.practice.update({
          where: { id: practice.id },
          data: { stripeCustomerId: customerId },
        });
      }
    }

    // Create Checkout Session with 14-day trial
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        trial_period_days: 14,
        metadata: {
          clerkUserId: userId,
          plan,
        },
      },
      success_url: `${process.env.NEXT_PUBLIC_APP_URL || "https://lvlai.app"}/dashboard?billing=success`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL || "https://lvlai.app"}/dashboard?billing=cancelled`,
      allow_promotion_codes: true,
    });

    return Response.json({ url: session.url });
  } catch (err) {
    console.error("[stripe/checkout] Error:", err.message);
    return Response.json(
      { error: "Failed to create checkout session. Please try again." },
      { status: 500 }
    );
  }
}
