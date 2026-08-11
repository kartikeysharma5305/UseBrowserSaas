import { prisma } from '../src/lib/db/prisma';

const cancellationColumns = await prisma.$queryRaw<
  Array<{ column_name: string }>
>`
  SELECT column_name
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'Run'
    AND column_name IN (
      'cancelRequestedAt',
      'canceledAt',
      'canceledByUserId',
      'cancelReason'
    )
  ORDER BY column_name
`;

const counts = {
  users: await prisma.user.count(),
  agents: await prisma.agent.count(),
  runs: await prisma.run.count(),
  events: await prisma.agentEvent.count(),
  artifacts: await prisma.runArtifact.count(),
};

await prisma.$disconnect();
console.info(
  JSON.stringify({
    counts,
    cancellationColumns: cancellationColumns.map((row) => row.column_name),
  })
);
