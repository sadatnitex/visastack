/**
 * Shared wall-clock bound for an async operation with no other size/cost
 * limit available (Commercial V1 Part 3 §5, "bounded CPU/memory/time").
 * Extracted from `preview-renderer.ts`'s own original copy once
 * `content-limits.ts` and `text-extraction.ts` needed the identical
 * pattern for their own `unpdf`/`mammoth` calls, rather than three
 * independently-maintained copies of the same ten lines.
 */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
