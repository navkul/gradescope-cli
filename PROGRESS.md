# PROGRESS.md

## Current status
- Refreshed on 2026-03-21 after the Playwright-first npm CLI refactor.
- The repo now includes a public npm-oriented CLI path intended to be usable from anywhere in the terminal:
  - npm package install path
  - repo clone plus `npm link` path
- The README and packaging metadata now document that path.

## Completed in this refactor
- Added a new npm `bin` entrypoint:
  - `gradescope-cli -> ./bin/gradescope-cli.mjs`
- Added a Playwright-first command runtime in:
  - `src/cli.mjs`
  - `playwright/core.mjs`
- Added config, credential, prompt, and path helper modules for the new CLI.
- Simplified the public command surface around:
  - `login`
  - `classes`
  - `assignments`
  - `submit <file>`
  - `result`
- Made `submit <file>` the main happy-path command.
- Made `assignments` and `submit` prompt interactively when the course or assignment is omitted.
- Added current-working-directory-relative upload path resolution for `submit <file>`.
- Added install-time Chromium download through npm `postinstall`.
- Forced Playwright browser downloads into the package-local browser directory with `PLAYWRIGHT_BROWSERS_PATH=0`.
- Added a full README with installation, usage, commands, options, and environment variables.
- Updated:
  - `FINDINGS.md`
  - `ARCHITECTURE.md`
  - `PROGRESS.md`

## Validation completed
- `node ./bin/gradescope-cli.mjs help`
  - passed
- `npm run check`
  - passed
- `npm test`
  - passed with browser-backed tests skipped because Chromium launch is blocked in this sandbox
- `npm_config_cache=/tmp/gradescope-cli-npm-cache npm install`
  - passed
- `npm_config_cache=/tmp/gradescope-cli-npm-cache npm pack --dry-run`
  - passed
- `GOCACHE=/tmp/gradescope-cli-gocache go test ./...`
  - passed

## What works now
- The npm package shape is valid and exposes the expected CLI command.
- The install path automatically downloads Chromium.
- The new CLI help and command parsing are in place.
- The new CLI resolves submission file paths from the current working directory.
- The repo now includes formal public-facing documentation in `README.md`.

## What is still blocked here
- Chromium can be downloaded in this sandbox but cannot be launched.
- The concrete browser launch failure here is:
  - macOS Mach-port rendezvous permission denied
- Because of that, this environment cannot run a real end-to-end Gradescope session through the new Playwright CLI.

## Remaining next steps
- Run the new npm CLI on a normal local machine that can launch Chromium.
- Validate with real credentials:
  - `gradescope-cli login`
  - `gradescope-cli classes`
  - `gradescope-cli assignments`
  - `gradescope-cli submit <file>`
  - `gradescope-cli result <submission>`
- Confirm one real autograder-output case through the new CLI.
- Decide whether to fully remove or formally deprecate the older Go-first command path after the new npm path is live-verified.

## Final state summary
- The repo now moves materially toward the requested architecture:
  - full Playwright use for the public CLI path
  - global npm-style usage
  - automatic browser setup
  - simpler submit UX
  - formal README documentation
- The remaining gap is not packaging or command structure anymore.
- The remaining gap is live browser-capable validation against the real Gradescope site outside this sandbox.
