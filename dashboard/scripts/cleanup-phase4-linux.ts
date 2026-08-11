import { rm } from 'node:fs/promises';
import path from 'node:path';

import { prisma } from '../src/lib/db/prisma';
import {
  isPlaywrightChromium,
  snapshotLinuxProcesses,
} from './lib/linux-process-snapshot';

if (process.platform !== 'linux') {
  throw new Error('Phase 4 Linux cleanup requires a Linux host.');
}

const projectRoot = path.resolve(import.meta.dirname, '..', '..');
const runtimeRoot = path.join(projectRoot, '.runtime', 'linux-drills');
const userWhere = { email: { startsWith: 'phase4-linux-' } } as const;

const users = await prisma.user.findMany({
  where: userWhere,
  select: { id: true },
});
const userIds = users.map((user) => user.id);
const runs = await prisma.run.findMany({
  where: { agent: { userId: { in: userIds } } },
  select: { id: true },
});
const runIds = runs.map((run) => run.id);
const before = {
  users: users.length,
  accounts: await prisma.account.count({
    where: { userId: { in: userIds } },
  }),
  sessions: await prisma.session.count({
    where: { userId: { in: userIds } },
  }),
  agents: await prisma.agent.count({
    where: { userId: { in: userIds } },
  }),
  runs: runIds.length,
  events: await prisma.agentEvent.count({
    where: { runId: { in: runIds } },
  }),
  artifacts: await prisma.runArtifact.count({
    where: { runId: { in: runIds } },
  }),
};

await prisma.user.deleteMany({ where: userWhere });
await rm(runtimeRoot, { recursive: true, force: true });

const chromium = (await snapshotLinuxProcesses()).filter(isPlaywrightChromium);
const after = {
  users: await prisma.user.count({ where: userWhere }),
  accounts: await prisma.account.count({
    where: { userId: { in: userIds } },
  }),
  sessions: await prisma.session.count({
    where: { userId: { in: userIds } },
  }),
  agents: await prisma.agent.count({
    where: { userId: { in: userIds } },
  }),
  runs: await prisma.run.count({
    where: { id: { in: runIds } },
  }),
  events: await prisma.agentEvent.count({
    where: { runId: { in: runIds } },
  }),
  artifacts: await prisma.runArtifact.count({
    where: { runId: { in: runIds } },
  }),
  chromium: chromium.map((process) => ({
    pid: process.pid,
    ppid: process.ppid,
    pgid: process.pgid,
    elapsedSeconds: process.elapsedSeconds,
    command: process.command,
  })),
};

await prisma.$disconnect();
console.info(JSON.stringify({ before, after }));
