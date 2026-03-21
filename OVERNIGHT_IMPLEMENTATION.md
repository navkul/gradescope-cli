# OVERNIGHT_IMPLEMENTATION.md

You are in execution mode.

## Goal

Build as much of a working Gradescope CLI as possible in this repository by morning.

The end-state target is a CLI that can:
- authenticate to Gradescope,
- let the user choose a class,
- let the user choose an assignment,
- accept a file path,
- submit the file,
- fetch the submission result,
- extract any autograder message if present,
- gracefully handle assignments with no visible response.

## Non-negotiables

- Use Golang meaningfully in the final system.
- Keep the code DRY.
- Do not over-comment.
- Keep commit messages consistent with the repo spec.
- Update `FINDINGS.md`, `ARCHITECTURE.md`, and `PROGRESS.md` continuously.
- Do not stop after planning.
- If you get stuck, rethink and continue through another approach.

## Execution order

### Phase 1: reconnaissance
- inspect repo state,
- inspect any existing tooling,
- determine package/runtime needs,
- create or refine a minimal project skeleton,
- investigate Gradescope login and submission workflow,
- compare Playwright vs direct HTTP/session approaches.

### Phase 2: prove the critical path
- get authentication working,
- list classes,
- list assignments for a chosen class,
- identify or prove the submission workflow,
- submit a local file to a testable assignment if possible,
- fetch and parse the resulting submission page or data.

### Phase 3: shape the product
- build a coherent CLI surface,
- improve error handling,
- separate responsibilities cleanly,
- centralize selectors/endpoints/parsers,
- harden the no-response and autograder-response cases.

### Phase 4: validate and document
- test the core flow,
- capture evidence in `FINDINGS.md`,
- write the architecture decision in `ARCHITECTURE.md`,
- record status and next steps in `PROGRESS.md`.

## Strategy guidance

Gradescope has no official public API for this workflow. Use whatever path gives the highest chance of a working tool:

- Playwright-driven automation,
- reverse engineered request/session flow,
- hybrid architecture,
- another justified design.

If direct HTTP is brittle, use Playwright.
If Playwright is too slow or fragile for parsing, use it for login/session bootstrap and move the rest elsewhere.
If Go cannot easily own browser automation, use Go as the CLI/orchestrator and bridge to the automation layer.

Figure out the best packaging.

## Credentials

The user may provide a local file with their Gradescope email and password if needed for testing.

Rules:
- do not hardcode credentials,
- do not print credentials,
- load them securely from a local ignored file or env vars,
- redact them in docs and logs.

## What to persist

Keep these markdown files alive during the run:

### `FINDINGS.md`
Write down:
- selectors,
- endpoints,
- cookies/session behavior,
- response shapes,
- upload workflow observations,
- blockers and failed attempts,
- what was confirmed to work.

### `ARCHITECTURE.md`
Write down:
- component diagram in prose,
- why Go is used where it is,
- why Playwright or direct HTTP was chosen,
- package layout,
- CLI command surface,
- data/control flow.

### `PROGRESS.md`
Write down:
- timestamped milestones,
- completed work,
- current branch status,
- next actions,
- remaining blockers,
- final morning handoff summary.

## Commit policy

Commit frequently with:
`type(scope): summary`

Examples:
- `feat(auth): add browser-backed login flow`
- `feat(assignments): parse course assignments list`
- `feat(submit): upload and submit local artifact`
- `fix(scraper): support missing autograder panel`
- `docs(progress): record overnight implementation status`

## Failure policy

You are not allowed to stop at the first blocker.

When blocked:
- inspect page structure,
- inspect network requests,
- capture HTML,
- capture screenshots if useful,
- compare authenticated and unauthenticated flows,
- reduce to a smaller proof,
- document the finding,
- pivot and continue.

The only acceptable stopping point is either:
1. a meaningfully working implementation, or
2. a sharply documented blocker with code, evidence, and the strongest possible partial implementation already completed.

Keep going.
