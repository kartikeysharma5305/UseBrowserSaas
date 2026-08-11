import type Stripe from 'stripe';

import { prisma } from '@/lib/db/prisma';
import { getStripeClient } from './stripe-client';

export async function getStripeCustomerIdForUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { stripeCustomerId: true },
  });

  return user?.stripeCustomerId ?? null;
}

export async function getOrCreateStripeCustomerForUser(
  userId: string
): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, stripeCustomerId: true },
  });

  if (!user) {
    throw new Error('Authenticated user not found.');
  }

  if (!user.email) {
    throw new Error('User email is required to create a Stripe customer.');
  }

  if (user.stripeCustomerId) {
    return user.stripeCustomerId;
  }

  const stripe = getStripeClient();
  const idempotencyKey = `billing-create-stripe-customer-${user.id}`;

  const customer = await stripe.customers.create(
    {
      email: user.email,
      metadata: {
        internalUserId: user.id,
      },
    },
    {
      idempotencyKey,
    }
  );

  if (!customer?.id) {
    throw new Error('Stripe customer creation did not return an ID.');
  }

  try {
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { stripeCustomerId: customer.id },
      select: { stripeCustomerId: true },
    });

    if (!updated.stripeCustomerId) {
      throw new Error('Stripe customer mapping was not persisted.');
    }
    return updated.stripeCustomerId;
  } catch (error) {
    const refreshed = await prisma.user.findUnique({
      where: { id: user.id },
      select: { stripeCustomerId: true },
    });

    if (refreshed?.stripeCustomerId) {
      return refreshed.stripeCustomerId;
    }

    throw error;
  }
}
