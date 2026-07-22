import { toNextJsHandler } from 'better-auth/next-js';

import { auth } from '@/lib/auth';

const { GET, POST, PATCH, PUT, DELETE } = toNextJsHandler(auth);

export { DELETE, GET, PATCH, POST, PUT };
