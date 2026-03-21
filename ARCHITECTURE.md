# ARCHITECTURE.md

## Problem statement
- Build a usable Gradescope CLI without an official public API, while keeping Go as the primary implementation language and preserving a path to adapt if private web behavior shifts.

## Chosen architecture
- Go-first CLI with a cookie-backed HTTP client and HTML parsing.
- The CLI discovers courses, assignments, and the submission form by reading the live authenticated HTML instead of relying on guessed private API endpoints.

## Why this architecture won
- Public reconnaissance showed a standard Rails login form and session cookie, which makes browser automation unnecessary for the first working implementation.
- A direct Go client keeps the shipping path smaller, faster, and easier to distribute than a Go-plus-Playwright bundle.
- Parsing live forms reduces brittleness compared with hardcoding hidden field names or submission endpoints.

## Role of Go
- All shipped implementation is in Go: CLI orchestration, credential loading, HTTP session handling, HTML parsing, interactive selection, submission, result scraping, and session persistence.

## Role of Playwright and/or HTTP client
- Current implementation uses only the Go HTTP client.
- Playwright remains a fallback path if a real authenticated account reveals anti-bot friction or dynamic pages that cannot be parsed reliably server-side.

## Component boundaries
- `cmd/gradescope-cli`: process entrypoint.
- `internal/cli`: subcommands, interactive prompts, output rendering.
- `internal/credentials`: credentials loading from flags, env vars, password files, or simple local credentials files.
- `internal/session`: cookie jar creation and session persistence to disk.
- `internal/gradescope`: Gradescope-specific login, course/assignment parsing, submission, and result scraping.
- `internal/config`: default paths and app-level constants.

## CLI UX flow
- `gradescope-cli login --credentials-file creds.json`
- `gradescope-cli classes`
- `gradescope-cli assignments --course <id>`
- `gradescope-cli submit --assignment <id> --file <path>`
- `gradescope-cli result --submission <id>`
- `gradescope-cli` or `gradescope-cli wizard` runs a guided flow using an existing session or supplied credentials.

## Data flow
- Credentials are loaded from flags, environment variables, password files, or a local credentials file.
- Login loads `/login`, parses the live form, posts credentials, and stores the resulting cookie jar to a session file.
- Course and assignment listing fetch authenticated HTML pages and extract links heuristically.
- Submission fetches the assignment page, discovers the upload form, performs the multipart POST, follows redirects, and parses the resulting submission page.

## Error handling
- Authentication failures return the inline flash message when present.
- Missing session or expired session returns a clear error and the wizard can re-login when credentials are available.
- Parser misses write debug HTML snapshots to the local config debug directory for fast follow-up inspection.
- Missing response or missing autograder content is treated as an expected state, not a crash.

## Testing strategy
- Unit tests cover HTML parsing helpers for courses, assignments, submission form discovery, and result parsing.
- `go test ./...` is the baseline automated check.
- End-to-end validation requires a real Gradescope account supplied locally through env vars or a credentials file; the code is wired for that path but not yet executed in this run.

## Future improvements
- Tighten parsers against real authenticated HTML samples once credentials are available.
- Add richer result parsing for structured autograder output once real pages are captured.
- Add optional browser-backed fallback only if authenticated validation proves it necessary.
