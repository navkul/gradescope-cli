# AGENTS.md

## Mission

Build a working Gradescope CLI in this repository with a bias toward execution, iteration, and shipping. The primary goal is to produce a usable command-line tool that can:

1. authenticate to Gradescope using user-provided credentials or another viable login path,
2. list and let the user choose a class,
3. list and let the user choose an assignment,
4. accept a local file path for submission,
5. submit the file to the chosen assignment,
6. fetch and display the submission response,
7. detect whether an autograder response exists and, if so, surface the autograder message to the user,
8. persist research, design, and progress into markdown files in this repo.

## Operating posture

Do not stall out on uncertainty. If one path is blocked, rethink and try the next viable path until there is a working implementation or a clearly documented blocker with evidence.

You are explicitly allowed to:
- inspect the site behavior,
- use Playwright,
- reverse engineer the web workflow,
- inspect network requests,
- compare alternative implementation paths,
- build throwaway prototypes,
- replace a weak design with a stronger one,
- refactor toward a cleaner architecture once the workflow is proven.

Prefer progress over overthinking. Do not stop at planning. Build, test, and iterate.

## Product requirements

The CLI should support the following end-user flow:

- login using email and password, or another working auth path if that proves more reliable,
- show classes/courses available to the authenticated user,
- allow class selection,
- show assignments for the selected class,
- allow assignment selection,
- accept the local file path to submit,
- submit the file,
- retrieve the submission result page or data,
- surface any submission status or textual response,
- if an autograder is configured and a message is available, pull that message and show it to the user.

Some assignments may have no response. Handle that case gracefully.

## Architecture expectations

You should decide the best packaging architecture for this CLI. Figure out what belongs in Go and what, if anything, belongs in a browser automation layer. Golang must be used somewhere meaningful in the final architecture.

Possible directions include:
- Go-first CLI with a thin Playwright-driven helper,
- Go orchestrator plus a web automation bridge,
- Go binary plus JSON IPC with a helper runtime,
- another clean architecture you can justify.

Do not assume one approach is best up front. Prove it.

## Research expectations

Gradescope has no official public API for this use case. You should investigate at least these paths:

1. browser automation with Playwright,
2. reverse engineered network/API behavior if feasible,
3. hybrid approach if login/session handling is easier in one layer and submission parsing is easier in another.

Pick the path that is most robust for this repository.

## Credentials and testing

The user will provide their Gradescope email and password in a local file for testing if needed. Use those credentials carefully for testing the login and submission workflow only within this repo and local environment.

Do not hardcode credentials.
Do not print credentials in logs.
Load secrets from files or environment variables.
Redact any sensitive values in output.

## Required repo artifacts

Keep these markdown files updated as you work:

- `FINDINGS.md`
- `ARCHITECTURE.md`
- `PROGRESS.md`

### `FINDINGS.md`
Use this for concrete discoveries:
- login observations,
- request/response findings,
- DOM selectors worth keeping,
- anti-automation obstacles,
- session/cookie behavior,
- successful and failed experiments,
- evidence for chosen implementation path.

### `ARCHITECTURE.md`
Use this for the high-level design:
- components,
- data flow,
- packaging strategy,
- responsibility split between Go and any helper process,
- CLI UX flow,
- error handling model,
- testing strategy.

### `PROGRESS.md`
Use this as an execution log:
- completed tasks,
- current status,
- next steps,
- blockers,
- final state summary.

Update these files throughout the run, not only at the end.

## Engineering rules

Be as DRY as possible.
Do not over-comment the code.
Prefer small, well-named functions and modules.
Use consistent naming and a consistent commit spec.

## Commit policy

Use a consistent commit format for all commits:

`type(scope): summary`

Examples:
- `feat(auth): add session bootstrap flow`
- `feat(submit): upload assignment file through browser workflow`
- `fix(parser): handle missing autograder message`
- `refactor(cli): unify course and assignment selection prompts`
- `docs(findings): record login and submission behavior`
- `test(e2e): add smoke test for login flow`

Keep commit messages imperative and specific.

## Code quality rules

- Prefer clarity over cleverness.
- Keep duplication low.
- Centralize selectors, endpoints, parsers, and shared types.
- Keep side effects isolated.
- Make retries and waits explicit.
- Handle missing elements and absent responses gracefully.
- Build toward a maintainable CLI, not a one-off script.

## Validation expectations

Continuously validate the implementation:
- unit test pure logic where practical,
- add smoke or integration coverage for critical flows,
- manually test login, course selection, assignment selection, file submission, and response scraping,
- verify the no-response case,
- verify the autograder-message-present case if available.

## Execution policy

Do not give up early.
Do not stop with only a design.
Do not leave the repo in a half-thought-out state.
If you hit friction, reduce scope only temporarily, prove a smaller slice works, then expand again.

The standard for success is a repo that moves meaningfully toward a working Gradescope CLI, with clear docs of what works, what partially works, and what remains.
