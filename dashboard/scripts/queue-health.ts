import { RunStatus } from '@prisma/client';

import { prisma } from '../src/lib/db/prisma';
import { createBrowserRunQueue } from '../src/lib/queue/browser-run-queue';
import { getQueueConfiguration } from '../src/lib/queue/config';

const configuration = getQueueConfiguration();
const queue = createBrowserRunQueue(configuration);

try {
  const [counts, workers, queuedRows, runningRows, expiredLeases] =
    await Promise.all([
      queue.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed'),
      queue.getWorkers(),
      prisma.run.count({ where: { status: RunStatus.QUEUED } }),
      prisma.run.count({ where: { status: RunStatus.RUNNING } }),
      prisma.run.count({
        where: {
          status: RunStatus.RUNNING,
          leaseExpiresAt: { lt: new Date() },
        },
      }),
    ]);
  console.info(
    JSON.stringify({
      queue: configuration.queueName,
      jobs: counts,
      workers: workers.length,
      database: { queuedRows, runningRows, expiredLeases },
    })
  );
} finally {
  await queue.close();
  await prisma.$disconnect();
}
