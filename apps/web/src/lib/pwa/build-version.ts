declare global {
  namespace NodeJS {
    interface ProcessEnv {
      /** Set by `next.config.mjs` (`env`) and replaced with its value when the app is built. */
      readonly VISASTACK_BUILD_VERSION?: string;
    }
  }
}

/**
 * This build's version, the same on every server instance. It must stay a literal
 * `process.env.VISASTACK_BUILD_VERSION` read: Next replaces that exact expression at build time,
 * and a lookup by a variable name would find nothing at runtime, so every deployment would ship
 * an identical worker and no device would ever learn of an update.
 */
export const BUILD_VERSION: string = process.env.VISASTACK_BUILD_VERSION ?? '';
