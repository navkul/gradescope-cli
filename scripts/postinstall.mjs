#!/usr/bin/env node

import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import path from "node:path";

const skip = String(process.env.GRADESCOPE_SKIP_BROWSER_DOWNLOAD || "").toLowerCase();
if (skip === "1" || skip === "true" || skip === "yes") {
  process.exit(0);
}

const require = createRequire(import.meta.url);
const packagePath = require.resolve("playwright/package.json");
const cliPath = path.join(path.dirname(packagePath), "cli.js");

const result = spawnSync(process.execPath, [cliPath, "install", "chromium"], {
  env: {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || "0",
  },
  stdio: "inherit",
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
