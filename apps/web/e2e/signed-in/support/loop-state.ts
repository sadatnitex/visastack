/**
 * What the exact-copy loop learns as it goes, kept in one module so the last stage (the one that
 * ends the grant, agency-loop-revoke.spec.ts) can use it. Both files run in the same worker, one
 * after the other. If a worker restarts between them the values are simply missing and the last
 * stage falls back to the agency's clients page.
 */
export const loop: { requestPath?: string; firstCopyName?: string } = {};
