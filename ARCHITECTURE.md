# ARCHITECTURE.md

## Direction
- The repository is shifting to a Playwright-first architecture for the user-facing CLI.
- The primary public distribution target is now npm, not the Go binary.
- The earlier Go code remains in the repo, but it is no longer the primary documented runtime path.

## Primary architecture
- `bin/gradescope-cli.mjs`
  - npm-exposed executable entrypoint
- `src/cli.mjs`
  - command parsing
  - interactive flow orchestration
  - output formatting
- `src/config.mjs`
  - config and session paths
- `src/credentials.mjs`
  - env/file/interactive credential loading
- `src/path-utils.mjs`
  - current-directory-relative file resolution for uploads
- `src/ui.mjs`
  - prompts and CLI output helpers
- `playwright/core.mjs`
  - all browser-backed Gradescope interactions
- `scripts/postinstall.mjs`
  - automatic Chromium installation during npm install

## Why Playwright is now the primary path
- The user asked to simplify the implementation by using Playwright for all commands.
- Gradescope has no official public API for this workflow.
- Browser automation gives a single consistent execution model for:
  - login
  - session reuse
  - class listing
  - assignment listing
  - submit
  - result parsing
- This removes the split-brain design where some commands used HTTP parsing and only submit used Playwright.

## Packaging strategy
- npm is the primary shipping format.
- Supported install flows:
  - published package: `npm install -g gradescope-cli`
  - repo clone: `npm install && npm link`
- The package installs Chromium automatically during `postinstall`.
- The installer sets `PLAYWRIGHT_BROWSERS_PATH=0` so Playwright stores browsers inside the package-local browser directory.
- That avoids depending on a separate manual browser install step and helps keep the npm install self-contained.

## Session model
- The CLI stores a Playwright `storageState` JSON file at the config directory.
- Commands reuse that saved state when opening new browser contexts.
- The session path is overrideable with `--session-file`.
- The config root is overrideable with `GRADESCOPE_CONFIG_DIR`.

## Data flow

### `login`
- launch Chromium
- open `/login`
- submit the real Gradescope login form
- verify the browser is authenticated
- save `storageState` to the session file

### `classes`
- load the saved Playwright session state
- open `/account`
- extract course links and labels from the real page

### `assignments`
- load the saved Playwright session state
- if no course is provided, prompt the user to choose one
- open `/courses/<course-id>`
- parse assignment rows from `#assignments-student-table`

### `submit <file>`
- resolve the file path relative to the current working directory
- load or create an authenticated browser session
- if no course is provided, prompt for a class
- if no assignment is provided, prompt for an assignment
- open the assignment flow in the live UI
- attach the local file through the browser
- finalize upload if the flow includes `/select_pages`
- parse and print the resulting submission page

### `result`
- open the provided submission reference in an authenticated browser context
- prefer React-backed result data when present
- fall back to visible response/autograder sections

## CLI UX model
- Keep the common path minimal:
  - `gradescope-cli submit <file>`
- Interactive selection is built in instead of forcing IDs up front.
- Explicit identifiers are still supported when the caller wants scripting or repeatability:
  - `--course <course-id>`
  - `--assignment <assignment-id-or-title>`

## Error handling model
- Missing session:
  - explain that the user should run `gradescope-cli login`
- Missing credentials during login:
  - prompt interactively when possible
- Missing browser runtime:
  - surface an actionable Playwright install error
- Missing class or assignment:
  - fail with a direct lookup error
- Missing submission page:
  - fail instead of pretending the result parsed successfully

## Testing strategy
- Fast unit tests cover:
  - path resolution
  - submission reference normalization
  - assignment/submission ID extraction
  - whitespace and course-label normalization
- Browser-backed parser tests exist for:
  - course extraction
  - assignment extraction
  - submission result extraction
- In this Codex sandbox those browser-backed tests are skipped because Chromium cannot launch even after download.
- The legacy Go tests still run and remain useful regression coverage for the older parser code that is still in the repo.

## Current limits
- The new npm CLI has not yet been live-validated against a real Gradescope account in this sandbox because browser launch is blocked here.
- The public CLI path is implemented and packaged, but real browser-capable validation still must happen on a normal local machine.
- The repo still contains older Go code and older Playwright helper code; the architecture has shifted, but the cleanup is not yet a full removal pass.
