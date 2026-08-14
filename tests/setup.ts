import { config } from "dotenv";
import path from "node:path";

// Force the test database regardless of whatever is already in the
// environment (e.g. a developer's shell exporting the dev DATABASE_URL) —
// tests must never be able to accidentally run against dev data.
config({ path: path.resolve(__dirname, "../.env.test"), override: true });

if (!process.env.DATABASE_URL?.includes("patent_horizon_test")) {
  throw new Error(
    `Refusing to run tests: DATABASE_URL does not look like the test database (got "${process.env.DATABASE_URL}"). ` +
      `Check .env.test.`,
  );
}
