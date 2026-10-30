/**
 * @visastack/core — Universal Core.
 *
 * Framework-agnostic domain primitives shared across every VisaStack surface.
 * This package MUST NOT import from `next`, `react`, or any infrastructure
 * adapter (database, storage, AI). Those live behind their own packages and
 * depend on Core, never the reverse. Keeping this direction one-way is what
 * lets us upgrade the framework, database, or AI provider without touching
 * domain rules.
 */

export const CORE_VERSION = '0.0.0' as const;

export * from './result';
export * from './csv';
export * from './brand';
export * from './domain';
export * from './deployment-mode';
export * from './reference-code';
export * from './match-key';
export * from './day-count';
export * from './money';
export * from './billing-date';
export * from './billing-words';
export * from './switches';
