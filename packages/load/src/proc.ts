import { readFileSync, readdirSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';

/** Linux-only process readings, taken straight from the operating system's process files (no shell). */
const PAGE_BYTES = 4096;
const TICKS_PER_SECOND = 100;

export interface ProcessReading {
  readonly rssBytes: number;
  readonly cpuSeconds: number;
}

/** CPU ticks (user plus system) from the text of a process stat file. The name field may contain spaces and brackets. */
export function parseCpuTicks(stat: string): number {
  const afterName = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  // After the name: state is field 3, so utime and stime (fields 14 and 15) sit at offsets 11 and 12.
  return Number(afterName[11]) + Number(afterName[12]);
}

/** Resident pages from the text of a process statm file (second field). */
export function parseResidentPages(statm: string): number {
  return Number(statm.split(' ')[1]);
}

/** Total resident memory and CPU time of every running process with this name. */
export function readProcessesNamed(name: string): ProcessReading {
  let rssBytes = 0;
  let ticks = 0;
  let entries: string[] = [];
  try {
    entries = readdirSync('/proc').filter((e) => /^\d+$/.test(e));
  } catch {
    return { rssBytes: 0, cpuSeconds: 0 };
  }
  for (const pid of entries) {
    try {
      if (readFileSync(`/proc/${pid}/comm`, 'utf8').trim() !== name) continue;
      ticks += parseCpuTicks(readFileSync(`/proc/${pid}/stat`, 'utf8'));
      rssBytes += parseResidentPages(readFileSync(`/proc/${pid}/statm`, 'utf8')) * PAGE_BYTES;
    } catch {
      // the process ended between listing and reading
    }
  }
  return { rssBytes, cpuSeconds: ticks / TICKS_PER_SECOND };
}

/** Whole-machine CPU counters (jiffies): total and idle, from the first line of /proc/stat. */
export function readMachineCpu(): { total: number; idle: number } {
  try {
    const fields =
      readFileSync('/proc/stat', 'utf8').split('\n')[0]?.trim().split(/\s+/).slice(1).map(Number) ??
      [];
    const total = fields.reduce((a, b) => a + b, 0);
    // idle plus iowait are fields 4 and 5
    return { total, idle: (fields[3] ?? 0) + (fields[4] ?? 0) };
  } catch {
    return { total: 0, idle: 0 };
  }
}

/** Share of the whole machine that was busy between two readings, in percent. */
export function busyPercent(
  before: { total: number; idle: number },
  after: { total: number; idle: number },
): number {
  const total = after.total - before.total;
  return total <= 0 ? 0 : Math.round((1 - (after.idle - before.idle) / total) * 1000) / 10;
}

export function hostSummary(): { cpus: number; memoryMb: number } {
  return { cpus: cpus().length, memoryMb: Math.round(totalmem() / 1048576) };
}
