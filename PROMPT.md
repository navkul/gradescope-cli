# PROMPT.md

## Repository objective

Build a Gradescope CLI that a user can run locally to:

1. authenticate to their Gradescope account,
2. choose a class,
3. choose an assignment,
4. provide a file path for submission,
5. submit the file,
6. inspect the resulting submission page or response,
7. show any available autograder message back to the user.

Gradescope does not provide an official public API for this. You should determine the best practical implementation path.

## Functional requirements

The CLI must aim to support:

- login with email and password, or another reliable auth path if needed,
- listing user-visible classes,
- selecting a class,
- listing assignments within that class,
- selecting an assignment,
- specifying a local file path,
- uploading/submitting the file,
- scraping or otherwise retrieving submission outcome details,
- showing a submission response if one exists,
- showing autograder text when an autograder is configured and exposes a message,
- handling assignments with no response without crashing.

## Technical direction

You must include Golang meaningfully in the architecture. Beyond that, determine the best packaging approach yourself.

Evaluate these options and choose the best one based on evidence:
- Go CLI + Playwright helper,
- Go CLI + reverse engineered HTTP/session client,
- hybrid approach,
- another justified approach.

Do not lock in too early. Investigate. Prove. Then converge.

## Deliverables

1. A runnable CLI or meaningful runnable vertical slice.
2. Clean architecture for future iteration.
3. Updated markdown docs:
   - `FINDINGS.md`
   - `ARCHITECTURE.md`
   - `PROGRESS.md`
4. Consistent commits using the repo commit spec.
5. Tests or smoke checks for the critical path where practical.

## Credential handling

The user will provide a local file containing Gradescope email and password for testing if needed.

Requirements:
- never hardcode credentials,
- never echo credentials in logs,
- use env vars or a local ignored file,
- redact secrets from docs and terminal output,
- only use the credentials for local validation of the login/submission flow.

## Working style

Bias strongly toward implementation. Do not freeze on uncertainty.

If blocked:
- inspect network traffic,
- inspect DOM structure,
- change selectors,
- try Playwright,
- try request replay,
- compare browser and direct HTTP paths,
- build a quick proof of concept,
- document findings,
- keep moving.

You should not stop because the first route fails. Rethink and continue until there is a working path or a sharply documented blocker with evidence.

## Engineering constraints

- Be DRY.
- Do not over-comment.
- Keep modules cohesive.
- Centralize fragile constants like selectors and endpoints.
- Use typed models where helpful.
- Keep the CLI UX simple.
- Prefer maintainability over hacks, but allow temporary spikes if they are documented and later cleaned up.

## CLI UX target

A good user flow would look something like:

1. `gradescope-cli login`
2. `gradescope-cli classes`
3. `gradescope-cli assignments --course <id>`
4. `gradescope-cli submit --course <id> --assignment <id> --file <path>`
5. `gradescope-cli result --submission <id>`

Or an interactive guided flow if that proves better:
- authenticate,
- choose class,
- choose assignment,
- enter file path,
- submit,
- display parsed result.

You may choose the final UX, but it should be coherent and easy to use.

## Documentation requirements

Keep these files live and useful:

### `FINDINGS.md`
Record evidence, experiments, failures, and confirmed behaviors.

### `ARCHITECTURE.md`
Record the chosen design and why it won.

### `PROGRESS.md`
Record current status, done items, remaining items, and blockers.

## Commit convention

Use:
`type(scope): summary`

Examples:
- `feat(auth): add gradescope session initialization`
- `feat(course): list enrolled courses from dashboard`
- `feat(submit): submit local file to selected assignment`
- `fix(result): parse absent autograder response safely`
- `docs(architecture): define go and automation packaging`
- `refactor(common): deduplicate scraper utilities`

## Success bar

The ideal outcome is a working CLI. The minimum acceptable outcome is a strong vertical slice with real evidence, honest documentation, and a clear path to completion.

Do not just talk about it. Build it.
