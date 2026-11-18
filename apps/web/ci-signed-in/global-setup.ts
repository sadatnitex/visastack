import { seed } from './seed';

/** Seeds this run's made-up world once, before any browser test (playwright.ci-signed-in.config.ts). */
export default async function globalSetup(): Promise<void> {
  const ids = await seed();
  console.info(`Signed-in guard seeded: case ${ids.caseId}, agency ${ids.organizationId}`);
}
