import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface LinuxProcess {
  pid: number;
  ppid: number;
  pgid: number;
  sid: number;
  state: string;
  elapsedSeconds: number;
  rssKb: number;
  cpuPercent: number;
  command: string;
}

function parseElapsed(value: string): number {
  const parts = value.split('-');
  const clock = parts.pop()?.split(':').map(Number) ?? [];
  const days = parts.length ? Number(parts[0]) : 0;
  const [hours, minutes, seconds] =
    clock.length === 3 ? clock : [0, clock[0] ?? 0, clock[1] ?? 0];
  return days * 86_400 + hours * 3_600 + minutes * 60 + seconds;
}

export async function snapshotLinuxProcesses(): Promise<LinuxProcess[]> {
  if (process.platform !== 'linux') {
    throw new Error('Linux process snapshots require a Linux host.');
  }
  const { stdout } = await execFileAsync('ps', [
    '-eo',
    'pid=,ppid=,pgid=,sid=,stat=,etimes=,rss=,pcpu=,args=',
  ]);
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const match = line.match(
        /^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\S+)\s+(.*)$/
      );
      if (!match) return [];
      return [
        {
          pid: Number(match[1]),
          ppid: Number(match[2]),
          pgid: Number(match[3]),
          sid: Number(match[4]),
          state: match[5],
          elapsedSeconds: parseElapsed(match[6]),
          rssKb: Number(match[7]),
          cpuPercent: Number(match[8]),
          command: match[9],
        },
      ];
    });
}

export function isPlaywrightChromium(process: LinuxProcess): boolean {
  return (
    /(?:chrome|chromium|headless_shell)/i.test(process.command) &&
    /(?:ms-playwright|playwright|remote-debugging-pipe|headless_shell)/i.test(
      process.command
    )
  );
}

export function isBrowserRoot(process: LinuxProcess): boolean {
  return (
    isPlaywrightChromium(process) && !/(?:^|\s)--type=/.test(process.command)
  );
}

export function descendantsOf(
  processes: LinuxProcess[],
  parentPid: number
): LinuxProcess[] {
  const descendants: LinuxProcess[] = [];
  const parents = new Set([parentPid]);
  let added = true;
  while (added) {
    added = false;
    for (const process of processes) {
      if (parents.has(process.ppid) && !parents.has(process.pid)) {
        parents.add(process.pid);
        descendants.push(process);
        added = true;
      }
    }
  }
  return descendants;
}

export function summarizeProcesses(processes: LinuxProcess[]) {
  const chromium = processes.filter(isPlaywrightChromium);
  const browserRoots = chromium.filter(isBrowserRoot);
  return {
    processCount: processes.length,
    chromiumProcessCount: chromium.length,
    browserSessionCount: browserRoots.length,
    chromiumRssMb: Math.round(
      chromium.reduce((total, item) => total + item.rssKb, 0) / 1024
    ),
    chromiumCpuPercent: Number(
      chromium.reduce((total, item) => total + item.cpuPercent, 0).toFixed(1)
    ),
  };
}
