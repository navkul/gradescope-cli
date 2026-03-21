# FINDINGS.md

## Current tool state
- As of March 21, 2026, the repo now has a Playwright-first public CLI path.
- The primary public entrypoint is the npm bin:
  - `gradescope-cli login`
  - `gradescope-cli classes`
  - `gradescope-cli assignments [course-id]`
  - `gradescope-cli submit <file>`
  - `gradescope-cli result <submission-id-or-url>`
- The earlier Go implementation still exists in the repo, but the documented and packaged primary path is now the npm CLI.

## Packaging findings
- `package.json` now exposes the global bin:
  - `gradescope-cli -> ./bin/gradescope-cli.mjs`
- The package is no longer `private`.
- The published/installable package now includes:
  - `bin/`
  - `src/`
  - `playwright/`
  - `scripts/`
  - `README.md`
- `npm pack --dry-run` succeeded on March 21, 2026 and showed the expected 11 shipped files.
- `npm install` now runs a `postinstall` script that downloads Chromium automatically.
- The postinstall script must force `PLAYWRIGHT_BROWSERS_PATH=0` so the browser installs into the package-local Playwright directory instead of a user cache path.
- Without that override, Playwright attempted to write into `~/Library/Caches/ms-playwright`, which this sandbox denied.
- `package-lock.json` resolved Playwright to `1.58.2`, so the package dependency was pinned to the same exact version for reproducibility.

## Repo-clone install path
- The clone-based global usage path is now:
  - `npm install`
  - `npm link`
- That gives the user a global `gradescope-cli` command without requiring them to stay inside the repo directory.

## Session and config findings
- The new npm CLI uses Playwright browser sessions as the primary auth/session mechanism.
- The default session file path is now intended to be a Playwright `storageState` JSON file at the app config directory:
  - macOS: `~/Library/Application Support/gradescope-cli/session.json`
  - Linux: `~/.config/gradescope-cli/session.json`
  - Windows: `%APPDATA%\\gradescope-cli\\session.json`
- `GRADESCOPE_CONFIG_DIR` overrides the config root.
- `GRADESCOPE_BASE_URL` still overrides the Gradescope base URL.

## Command UX findings
- The CLI is simpler if `submit` is the main interactive path:
  - `gradescope-cli submit <file>` is now the primary happy path
  - if `--course` is omitted, the CLI prompts for a class
  - if `--assignment` is omitted, the CLI prompts for an assignment
- `assignments` also prompts for course selection when no course ID is provided.
- Assignment matching in `submit` accepts either:
  - an assignment ID
  - an exact assignment title
- Relative file paths are resolved from the current working directory before upload.
- The CLI also prints the resolved display path so the user can see what local file is being submitted.

## Parsing findings
- The Playwright course parser extracts course IDs from links matching `/courses/<id>`.
- The Playwright assignment parser keeps rows even when no assignment ID is visible in the course table.
- For rows that do expose a submission link, the parser can still recover:
  - assignment ID
  - assignment page path
  - latest submission path
- This is stronger than the older Go-only assignment listing behavior because `No Submission` rows can still remain visible in the interactive selection flow even when the row exposes no ID.

## Submit workflow findings
- The new Playwright submit flow still uses the live Gradescope UI controls:
  - open assignment
  - open `Submit` or `Resubmit`
  - choose variable-length PDF flow when present
  - attach the file
  - click the upload control
  - click the final `Submit` control on `/select_pages` when required
- If the flow does not naturally land on a submission URL, the code retries by reloading the course page and reopening the latest submission URL for the selected assignment when possible.

## Result parsing findings
- Result extraction still favors the embedded React payload when `AssignmentSubmissionViewer` is present.
- Visible fallback parsing still looks for:
  - submission status
  - response text
  - autograder text
- Full nested submission paths remain the most reliable lookup format.

## Validation findings
- `node ./bin/gradescope-cli.mjs help` succeeds.
- `npm run check` succeeds.
- `npm test` succeeds with:
  - 4 passing unit tests
  - 3 skipped browser-backed parser tests
- The browser-backed tests are skipped here because Chromium launch is blocked by the sandbox even after the browser was installed locally.
- `GOCACHE=/tmp/gradescope-cli-gocache go test ./...` succeeds.
- `npm install` succeeds when the npm cache is redirected to a writable temp directory in this environment:
  - `npm_config_cache=/tmp/gradescope-cli-npm-cache npm install`

## Sandbox-specific blocker
- Chromium download now works in this environment.
- Chromium launch still fails in this Codex sandbox with a macOS Mach-port permission error:
  - `bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer... Permission denied (1100)`
- That means the Playwright runtime can be installed here but not actually executed end-to-end here.

## Remaining live-validation gaps
- No real Gradescope login was re-run through the new npm CLI in this sandbox because the browser cannot launch here.
- No live submit was re-run through the new npm CLI in this sandbox for the same reason.
- The new public CLI still needs one browser-capable machine validation with real credentials for:
  - login
  - class listing
  - assignment listing
  - `submit <file>`
  - result scraping
  - autograder-message-present case
