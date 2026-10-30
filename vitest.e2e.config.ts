// ABOUTME: Vitest config for the slow end-to-end suite in tests/e2e, which builds
// ABOUTME: the MCPB bundle once and starts the built servers over stdio.
import { defineConfig } from "vitest/config";

// E2E checks of the built artifacts (`bun run test:e2e`): runs
// scripts/build-mcpb.sh once, then starts dist/index.js and the unpacked
// MCPB bundle over stdio with dummy credentials. Slow and needs the npm
// registry (bun install inside the bundle), so it is not part of `bun run test`.
export default defineConfig({
  test: {
    include: ["tests/e2e/**/*.test.ts"],
    environment: "node",
    globals: false,
    testTimeout: 60_000,
    hookTimeout: 600_000,
  },
});
