import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import Stripe from 'stripe'; // ★ 元の {} なしのインポートに戻します

admin.initializeApp();
const db = admin.firestore();

const STRIPE_SECRET_KEY = 'sk_test_51TgKksEVJIleCoIakz2UNpoAIsnG8Dypg0p42GEcjX7nkyN0W24riULY9Yfa3vuZGVWKBBX5Ku1PCIkwJtn3qM9n00dlh20MJr';
const WEBHOOK_SECRET    = 'whsec_5JfhrfgvujJSzbcYUdto6kOoEaQsofAZ';

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2026-05-27.dahlia', // ★ バージョンは最新のこれでOKです
});

export const stripeWebhook = functions.https.onRequest(async (req, res) => {
  const sig = req.headers['stripe-signature'] as string;

  let event: any; // ★ 型のエラーを避けるため any にします
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
    const obj = event.data.object as any; // ★ エラーが出ていた型指定を any にしてスルーします
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
