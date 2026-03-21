# PROGRESS.md

## Current status
- In progress: shipped initial Go CLI implementation with login/session persistence, course and assignment scraping, submission form discovery, result scraping, parser tests, and live invalid-login smoke validation.

## Milestones
- 2026-03-20: Confirmed Gradescope login is a CSRF-protected HTML form with cookie-backed session semantics.
- 2026-03-20: Chosen architecture converged on Go-only HTTP/session client with HTML parsing.
- 2026-03-20: Created runnable CLI skeleton and parser test coverage.
- 2026-03-20: `go test ./...`, `go build ./cmd/gradescope-cli`, and a live invalid-login CLI smoke check all passed.

## Completed
- Created Go module and project layout.
- Added `.gitignore` for local secrets, debug output, and build artifacts.
- Implemented credential loading from env vars, password files, and credentials files.
- Implemented session persistence to a local config session file.
- Implemented login, classes, assignments, submit, result, and wizard commands.
- Added unit tests for core parsing helpers.
- Verified the built CLI against the live Gradescope login page with an invalid-credential smoke test.
- Updated `FINDINGS.md` and `ARCHITECTURE.md` with current evidence and design.

## In progress
- Preparing for authenticated validation once local credentials are available.

## Blockers
- No Gradescope credentials were present in the repo or environment during this run, so authenticated end-to-end validation is still pending.
- Course, assignment, and result parsers are built to be resilient, but they still need confirmation against real authenticated HTML.

## Next steps
- Run a local login and listing flow with real credentials from a local file or environment variables.
- Capture authenticated HTML samples if parser tuning is needed.
- Validate a real submission and result page, including the no-response and autograder-present cases.

## Final summary
- The repository now contains a substantial Go-first vertical slice instead of only planning documents.
- Tooling validation is complete; final confidence now depends on one authenticated validation pass with real user credentials.
