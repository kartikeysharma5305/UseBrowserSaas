import {
  isPlaywrightChromium,
  snapshotLinuxProcesses,
  summarizeProcesses,
} from './lib/linux-process-snapshot';

const workerPid = Number(process.argv[2]);
const processes = await snapshotLinuxProcesses();
const relevant = processes.filter(
  (process) =>
    process.pid === workerPid ||
    process.ppid === workerPid ||
    isPlaywrightChromium(process)
);

console.info(
  JSON.stringify(
    {
      capturedAt: new Date().toISOString(),
      workerPid: Number.isSafeInteger(workerPid) ? workerPid : null,
      summary: summarizeProcesses(processes),
      processes: relevant,
    },
    null,
    2
  )
);
