import 'server-only';

import { prisma } from '../db/prisma';
import { getStripeClient, classifyStripeError } from './stripe-client';

/**
 * Get or create a Stripe customer id for the given internal user id.
 * Returns the stripe customer id string.
 *
 * Race-safety strategy:
 * - If User.stripeCustomerId already exists, return it.
 * - Otherwise create a Stripe customer using a deterministic idempotency key per user.
 * - Attempt to persist the new customer id into the User row using updateMany where stripeCustomerId IS NULL.
 * - If another process set the stripeCustomerId concurrently, delete the newly-created Stripe customer to avoid duplicates and return the existing value.
 */
export async function getOrCreateStripeCustomerForUser(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('User not found');
  if (user.stripeCustomerId) return user.stripeCustomerId;

  const stripe = getStripeClient();
  const idempotencyKey = `create_customer_user_${userId}`;

  let customer;
  try {
    customer = await stripe.customers.create(
      {
        email: user.email,
        metadata: { userId },
      },
      { idempotencyKey }
    );
  } catch (err) {
    const code = classifyStripeError(err);
    const e = new Error(`Stripe customer creation failed: ${code}`);
    // preserve original error on a non-serializable property for logs only
    // (do not serialize or return secrets)
    // @ts-ignore
    e.cause = err;
    throw e;
  }

  // Try to claim the user row only if stripeCustomerId is still null
  const res = await prisma.user.updateMany({
    where: { id: userId, stripeCustomerId: null },
    data: { stripeCustomerId: customer.id },
  });

  if (res.count === 1) {
    return customer.id;
  }

  // Another process wrote stripeCustomerId concurrently. Read the current value and delete the newly-created customer to avoid duplicates.
  const refreshed = await prisma.user.findUnique({ where: { id: userId } });
  if (refreshed?.stripeCustomerId) {
    try {
      await stripe.customers.del(customer.id);
    } catch (deleteErr) {
      // Log safely: don't print secrets. Rethrow only if deletion is essential.
      // Swallow deletion errors to avoid masking the successful concurrent claim.
      // @ts-ignore
      console.warn('Failed to delete duplicate Stripe customer', deleteErr?.message ?? deleteErr);
    }
    return refreshed.stripeCustomerId;
  }

  // Unexpected: no stripeCustomerId on user after concurrent attempt. Try to set it deterministically.
  try {
    await prisma.user.update({ where: { id: userId }, data: { stripeCustomerId: customer.id } });
    return customer.id;
  } catch (finalErr) {
    // If this fails, attempt best-effort cleanup of the created Stripe customer and surface a safe error.
    try {
      await stripe.customers.del(customer.id);
    } catch (_) {
      // ignore
    }
    throw new Error('Failed to persist Stripe customer mapping');
  }
}
