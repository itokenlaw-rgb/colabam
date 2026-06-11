import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import Stripe from 'stripe';
import * as cors from 'cors';

admin.initializeApp();
const db = admin.firestore();

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY!;
const WEBHOOK_SECRET    = process.env.WEBHOOK_SECRET!;

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2026-05-27.dahlia',
});

const corsHandler = (cors as any)({ origin: 'https://colabam.vercel.app' });

// ── Stripe Webhook ──────────────────────────────────────────
export const stripeWebhook = functions.https.onRequest(async (req, res) => {
  const sig = req.headers['stripe-signature'] as string;

  let event: any;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    res.status(400).send('Webhook Error');
    return;
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const uid = session.client_reference_id;
    if (uid) {
      await db.doc(`users/${uid}`).set(
        { plan: 'pro', stripeCustomerId: session.customer },
        { merge: true }
      );
      console.log(`✅ Plan updated to pro for uid: ${uid}`);
    }
  }

  if (
    event.type === 'customer.subscription.deleted' ||
    event.type === 'invoice.payment_failed'
  ) {
    const obj = event.data.object as any;
    const customerId = 'customer' in obj
      ? (typeof obj.customer === 'string' ? obj.customer : obj.customer?.id)
      : undefined;

    if (customerId) {
      const snap = await db
        .collection('users')
        .where('stripeCustomerId', '==', customerId)
        .limit(1)
        .get();
      if (!snap.empty) {
        await snap.docs[0].ref.update({ plan: 'free' });
        console.log(`⬇️ Plan downgraded to free for customer: ${customerId}`);
      }
    }
  }

  res.json({ received: true });
});

// ── カスタマーポータルURL生成 ────────────────────────────────
export const createPortalSession = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const { uid } = req.body;
    if (!uid) {
      res.status(400).send('uid required');
      return;
    }

    const snap = await db.doc(`users/${uid}`).get();
    const customerId = snap.data()?.stripeCustomerId;
    if (!customerId) {
      res.status(400).send('No customer found');
      return;
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: 'https://colabam.vercel.app',
    });

    res.json({ url: session.url });
  });
});