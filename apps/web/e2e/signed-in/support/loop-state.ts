/**
 * What the exact-copy loop learns as it goes (agency-loop.spec.ts), kept in one module so its steps
 * can share it. It lives in one worker only: the last stages (answer-from-records.spec.ts and
 * agency-loop-revoke.spec.ts) run in later projects, which get fresh workers, so they must not
 * read it and read the pages they need again instead.
 */
export const loop: { requestPath?: string; requestId?: string; firstCopyName?: string } = {};
