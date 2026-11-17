// better-auth lists vitest as an optional peer for its own test helpers, which VisaStack never
// imports. Without this hook pnpm links our workspace vitest into better-auth's production
// dependency graph, so `pnpm audit --prod` reports test-only advisories (for example
// GHSA-fc5q-39xc-vjpf in picomatch) as production risks. Removing only that optional peer keeps
// vitest for our own tests and leaves every runtime dependency of better-auth unchanged.
function readPackage(pkg) {
  if (pkg.name !== 'better-auth' || !pkg.peerDependencies?.vitest) return pkg;
  const { vitest: _peer, ...peerDependencies } = pkg.peerDependencies;
  const { vitest: _meta, ...peerDependenciesMeta } = pkg.peerDependenciesMeta ?? {};
  return { ...pkg, peerDependencies, peerDependenciesMeta };
}

module.exports = { hooks: { readPackage } };
