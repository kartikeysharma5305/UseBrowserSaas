import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { getAuth } from '@/lib/auth';

export async function getCurrentUser() {
  const session = await getAuth().api.getSession({
    headers: await headers(),
  });

  return session?.user ?? null;
}

export async function requireAuth() {
  const user = await getCurrentUser();

  if (!user) {
    redirect('/login');
  }

  return user;
}
