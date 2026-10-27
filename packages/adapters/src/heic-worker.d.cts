// Types for heic-worker.cjs (plain CommonJS so Node runs it unchanged in every environment).

/** The worker file's own path, for `new Worker(...)`. */
export declare const workerFile: string;
/** The initial size of a WebAssembly module's own memory, in 64 KiB pages. */
export declare function initialMemoryPages(binary: Uint8Array): number;
/** A copy of a WebAssembly module whose own memory may grow to at most `maxPages`. */
export declare function limitModuleMemory(binary: Uint8Array, maxPages: number): Uint8Array;
