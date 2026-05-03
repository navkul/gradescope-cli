# gradescope-cli

`gradescope-cli` is a Gradescope CLI with a fast HTTP backend for common commands and a Playwright backend for browser-compatible fallback behavior. It logs in, lists classes and assignments, supports both upload and GitHub submission flows, and prints the resulting submission status plus any grading response or autograder text it can find.

## Install

### From npm after publish

```bash
npm install -g gradescope-playwright-cli
```

The installed command is still:

```bash
gradescope-cli
```

The package installs Playwright and runs a postinstall step that downloads Chromium automatically for the fallback/browser-backed submit path. You should not need to run a separate `npx playwright install chromium` step unless the browser download fails or you skipped install scripts.

Do not use `npm install -g gradescope-cli`. That package name is already taken on npm by an unrelated abandoned package from 2019 that pulls in deprecated dependencies such as `request` and `zlib`, which is why installs fail with `node-waf: command not found`.

As of March 21, 2026, `gradescope-playwright-cli` is the published package name for this repo.

### From a local clone

```bash
git clone <repo-url>
cd gradescope-cli
npm install
npm link
```

`npm install` downloads the JavaScript dependencies and Chromium for the Playwright backend. `npm link` exposes the global `gradescope-cli` command so you can run it from anywhere in your terminal.

You can also install the current repo build as a tarball without publishing it:

```bash
npm pack
npm install -g ./gradescope-playwright-cli-*.tgz
```

If you need to skip the browser download temporarily, set `GRADESCOPE_SKIP_BROWSER_DOWNLOAD=1` before install.

## Quick start

```bash
gradescope-cli login
gradescope-cli classes
gradescope-cli assignments
gradescope-cli submit
gradescope-cli submit ./path/to/file1.py ./path/to/file2.py
gradescope-cli submit --wait-for-response
gradescope-cli submit --submission-type github --repo owner/project --branch main
gradescope-cli result --course "Distributed Systems" --assignment "Project 1"
gradescope-cli result /courses/<course>/assignments/<assignment>/submissions/<submission>
```

By default, `login`, `classes`, `assignments`, and `result` use the fast HTTP backend. `submit`, `wizard`, and `run` default to Playwright until the HTTP submit path has more real-assignment validation. You can force either backend:

```bash
gradescope-cli classes --backend http
gradescope-cli classes --backend playwright
gradescope-cli submit --backend http ./submission.py --course 123456 --assignment "Project 1"
GRADESCOPE_BACKEND=playwright gradescope-cli result 399271099
```

The simplest submission flow is:

```bash
gradescope-cli submit
```

If you omit `--course` or `--assignment`, the CLI prompts you to choose them interactively from the authenticated account. If you also omit the submit inputs, the CLI now prompts for the submission type:

- `Upload`: prompts for one or more local file paths
- `GitHub`: prompts for a repository, then prompts for a branch after the repo is selected

When you do pass `--course`, the CLI accepts an exact course ID, exact course name, or exact short name. `--assignment` accepts an exact assignment ID or exact assignment title case-insensitively.

## Commands

### `gradescope-cli login`

Logs in through the Gradescope login page and saves a reusable session file. The default HTTP backend posts the login form directly; `--backend playwright` logs in through Chromium.

Examples:

```bash
gradescope-cli login
gradescope-cli login --credentials-file ./creds.json
gradescope-cli login --email you@example.com --password-file ./password.txt
gradescope-cli login --backend playwright
```

Supported auth inputs:

- `--credentials-file <path>` with either JSON or `KEY=VALUE` content
- `--email <email>` with `--password <password>`
- `--email <email>` with `--password-file <path>`
- `GRADESCOPE_EMAIL` and `GRADESCOPE_PASSWORD`

If values are missing and the command is interactive, the CLI prompts for them.

### `gradescope-cli classes`

Lists the authenticated user’s classes.

```bash
gradescope-cli classes
gradescope-cli classes --backend playwright
```

Output format:

```text
<course-id>    <course-short> | <course-name>
Retrieved classes in 123.4 ms
```

### `gradescope-cli assignments [course-id-or-name-or-short]`

Lists assignments for a course. If the course selector is omitted, the CLI prompts you to pick a class first. If it is provided, the CLI accepts an exact course ID, exact course name, or exact short name.

```bash
gradescope-cli assignments
gradescope-cli assignments 123456
gradescope-cli assignments --course 123456
gradescope-cli assignments --course CS101
gradescope-cli assignments --course "Distributed Systems"
gradescope-cli assignments --course 123456 --backend playwright
```

Output format:

```text
<assignment-id-or->    <assignment-title>    <status-if-present>
Retrieved assignments in 123.4 ms
```

Rows without a visible assignment ID are still shown. They remain selectable in the interactive submit flow even if Gradescope does not expose an ID on the course page.

### `gradescope-cli submit [file ...]`

Submits through either the `Upload` or `GitHub` Gradescope submission type. Upload file paths are resolved from your current working directory, so `gradescope-cli submit ./foo/bar.py` uses the directory you are currently in as the prefix when locating the file.

`submit` defaults to the Playwright backend for compatibility. The HTTP backend can be forced with `--backend http`, but it has not been live-validated across real assignment types yet.

```bash
gradescope-cli submit
gradescope-cli submit ./submission.pdf
gradescope-cli submit ./main.py ./utils.py --course 123456 --assignment "Project 1"
gradescope-cli submit --file ./main.py --file ./utils.py --course CS101 --assignment "Project 1"
gradescope-cli submit --wait-for-response --course CS101 --assignment "Project 1" ./main.py ./utils.py
gradescope-cli submit --submission-type github --repo owner/project --branch main --course 123456 --assignment 7891011
gradescope-cli submit --submission-type github --course "Distributed Systems" --assignment "Project 1"
gradescope-cli submit --backend http ./main.py --course 123456 --assignment "Project 1"
```

Behavior:

- If no session file exists, the CLI logs in first.
- If `--course` is omitted, the CLI prompts you to pick a class.
- If `--assignment` is omitted, the CLI prompts you to pick an assignment.
- If neither upload files nor GitHub repo/branch are provided, the CLI prompts you to choose `Upload` or `GitHub`.
- Upload submissions accept one or more files through positional paths or `--file`.
- Interactive upload mode prompts for additional files until you enter a blank line.
- GitHub submissions accept `--repo` and `--branch`, or they can be chosen interactively from the live Gradescope form.
- The branch list is loaded only after the repository is selected, so the CLI selects the repo first and then fetches the branch choices.
- `--wait-for-response` keeps polling the submission page for up to the normal command timeout and returns as soon as a grading response or autograder output appears.
- Course matching accepts either an exact course ID, exact course name, or exact short name.
- Assignment matching accepts either an exact assignment ID or an exact title case-insensitively.
- After submission, the CLI prints the submission URL, status, grading response text, and autograder text if they are available.
- The final line reports total elapsed time, for example `Submitted in 1234.5 ms`.

### `gradescope-cli result [submission-id-or-url]`

Fetches and prints a submission result page.

```bash
gradescope-cli result 399271099
gradescope-cli result /courses/123/assignments/456/submissions/789
gradescope-cli result https://www.gradescope.com/courses/123/assignments/456/submissions/789
gradescope-cli result --course 123456 --assignment 7891011
gradescope-cli result --course CS101 --assignment "Project 1"
gradescope-cli result 399271099 --backend playwright
```

For the most reliable result lookup, prefer the full nested submission path. Some accounts cannot access bare `/submissions/<id>` routes.

If you omit the submission reference, the CLI can now resolve the latest submission interactively:

- `--course` accepts an exact course ID, exact course name, or exact short name
- `--assignment` accepts an exact assignment ID or exact assignment title
- if `--course` is omitted, the CLI prompts you to choose a class
- if `--assignment` is omitted, the CLI prompts you to choose an assignment
- the CLI then loads the latest visible submission result for that assignment
- the final line reports total elapsed time, for example `Retrieved result in 123.4 ms`

## Common options

- `--session-file <path>` overrides the saved session path
- `--base-url <url>` overrides the Gradescope base URL
- `--backend <http|playwright>` chooses the fast HTTP backend or browser-backed Playwright backend
- `--headful` launches Chromium with a visible window instead of headless mode when using Playwright

## Session storage

By default the CLI stores a Playwright-compatible storage-state session at:

- macOS: `~/Library/Application Support/gradescope-cli/session.json`
- Linux: `~/.config/gradescope-cli/session.json`
- Windows: `%APPDATA%\gradescope-cli\session.json`

You can override the config root with `GRADESCOPE_CONFIG_DIR`.

## Environment variables

- `GRADESCOPE_EMAIL`
- `GRADESCOPE_PASSWORD`
- `GRADESCOPE_BASE_URL`
- `GRADESCOPE_BACKEND`
- `GRADESCOPE_HEADLESS`
- `GRADESCOPE_CONFIG_DIR`
- `GRADESCOPE_SKIP_BROWSER_DOWNLOAD`

## Codex sandbox limitations

`gradescope-cli` no longer needs Chromium for the default `login`, `classes`, `assignments`, or `result` paths because those commands use direct HTTP requests. Browser-backed commands still launch Chromium through Playwright when you run `submit` without `--backend http`, or when you explicitly pass `--backend playwright`.

The failure usually looks like:

```text
bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer... Permission denied (1100)
```

This is not a path-resolution issue with your current working directory. It is a macOS sandbox restriction that prevents Chromium from registering the Mach service it needs during startup. In practice:

- `gradescope-cli --help` still works
- plain Node.js commands still work
- default HTTP-backed commands can run without launching Chromium
- browser-backed commands may fail inside the default Codex sandbox

Ways to run the CLI successfully from Codex:

- use `danger-full-access` so Playwright can launch Chromium outside the restricted sandbox
- or run the specific `gradescope-cli` command with sandbox escalation
- or run the command in a normal terminal outside Codex

You can still provide credentials non-interactively from Codex:

```bash
export GRADESCOPE_EMAIL="you@example.com"
export GRADESCOPE_PASSWORD="your-password"
gradescope-cli login
```

If you force `--backend playwright`, setting credentials alone does not bypass the Chromium launch requirement.

## Development

```bash
npm install
npm test
npm run check
```

Browser-backed parser tests are skipped by default so `npm test` stays reliable in restricted environments. To opt into them on a browser-capable machine, run:

```bash
GRADESCOPE_RUN_BROWSER_TESTS=1 npm test
```

The earlier Go implementation has been removed. The maintained development and runtime path is the npm command. The default backend is HTTP for read-oriented commands and Playwright for submit.
