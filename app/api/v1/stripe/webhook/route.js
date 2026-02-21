/**
 * POST /api/v1/stripe/webhook
 *
 * Handles Stripe webhook events for subscription lifecycle management.
 * Events: checkout.session.completed, customer.subscription.updated/deleted
 *
 * Verifies webhook signature for security.
 */

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

export async function POST(request) {
  // ── Production safety: require webhook secret ────────────────────────────
  if (process.env.NODE_ENV === "production" && !process.env.STRIPE_WEBHOOK_SECRET) {
    console.error("[stripe/webhook] FATAL: STRIPE_WEBHOOK_SECRET missing in production");
    return Response.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  const body = await request.text();
  const sig = request.headers.get("stripe-signature");

  let event;

  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  try {
    if (webhookSecret) {
      event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
    } else {
      // In development without webhook secret, parse directly
      event = JSON.parse(body);
      console.warn("[stripe/webhook] No webhook secret configured — skipping signature verification");
    }
  } catch (err) {
    console.error("[stripe/webhook] Signature verification failed:", err.message);
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  const { prisma } = await import("../../../../../lib/prisma.js");

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const customerId = session.customer;
        const subscriptionId = session.subscription;

        // Find practice by Stripe customer ID and update subscription info
        const practice = await prisma.practice.findFirst({
          where: { stripeCustomerId: customerId },
        });

        if (practice) {
          await prisma.practice.update({
            where: { id: practice.id },
            data: {
              stripeSubscriptionId: subscriptionId,
              accountMode: "live",
            },
          });
          console.log(`[stripe/webhook] Practice ${practice.id} subscribed: ${subscriptionId}`);
        }
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object;
        const customerId = subscription.customer;
        const status = subscription.status; // active, past_due, canceled, trialing

        const practice = await prisma.practice.findFirst({
          where: { stripeCustomerId: customerId },
        });

        if (practice) {
          const accountMode = ["active", "trialing"].includes(status) ? "live" : "sandbox";
          await prisma.practice.update({
            where: { id: practice.id },
            data: {
              stripeSubscriptionStatus: status,
              accountMode,
            },
          });
          console.log(`[stripe/webhook] Practice ${practice.id} subscription status: ${status}`);
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        const customerId = subscription.customer;

        const practice = await prisma.practice.findFirst({
          where: { stripeCustomerId: customerId },
        });

        if (practice) {
          await prisma.practice.update({
            where: { id: practice.id },
            data: {
              stripeSubscriptionStatus: "canceled",
              accountMode: "sandbox", // Downgrade to sandbox on cancellation
            },
          });
          console.log(`[stripe/webhook] Practice ${practice.id} subscription canceled`);
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object;
        const customerId = invoice.customer;

        const practice = await prisma.practice.findFirst({
          where: { stripeCustomerId: customerId },
        });

        if (practice) {
          await prisma.practice.update({
            where: { id: practice.id },
            data: { stripeSubscriptionStatus: "past_due" },
          });
          console.log(`[stripe/webhook] Practice ${practice.id} payment failed`);
        }
        break;
      }

      default:
        // Unhandled event type — log and ignore
        console.log(`[stripe/webhook] Unhandled event: ${event.type}`);
    }
  } catch (err) {
    console.error(`[stripe/webhook] Error processing ${event.type}:`, err.message);
    return Response.json({ error: "Webhook handler failed" }, { status: 500 });
  }

  return Response.json({ received: true });
}
