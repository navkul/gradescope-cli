# gradescope-cli

`gradescope-cli` is a Playwright-first Gradescope CLI. It logs in through the real web app, lists classes and assignments, supports both upload and GitHub submission flows, and prints the resulting submission status and any autograder text it can find.

## Install

### From npm after publish

```bash
npm install -g gradescope-playwright-cli
```

The installed command is still:

```bash
gradescope-cli
```

The package installs Playwright and runs a postinstall step that downloads Chromium automatically. You should not need to run a separate `npx playwright install chromium` step unless the browser download fails or you skipped install scripts.

Do not use `npm install -g gradescope-cli`. That package name is already taken on npm by an unrelated abandoned package from 2019 that pulls in deprecated dependencies such as `request` and `zlib`, which is why installs fail with `node-waf: command not found`.

As of March 21, 2026, `gradescope-playwright-cli` is the published package name for this repo.

### From a local clone

```bash
git clone <repo-url>
cd gradescope-cli
npm install
npm link
```

`npm install` downloads the JavaScript dependencies and Chromium. `npm link` exposes the global `gradescope-cli` command so you can run it from anywhere in your terminal.

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
gradescope-cli submit --submission-type github --repo owner/project --branch main
gradescope-cli result /courses/<course>/assignments/<assignment>/submissions/<submission>
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

Logs in through the Gradescope login page and saves a reusable Playwright session file.

Examples:

```bash
gradescope-cli login
gradescope-cli login --credentials-file ./creds.json
gradescope-cli login --email you@example.com --password-file ./password.txt
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
```

Output format:

```text
<course-id>    <course-short> | <course-name>
```

### `gradescope-cli assignments [course-id-or-name-or-short]`

Lists assignments for a course. If the course selector is omitted, the CLI prompts you to pick a class first. If it is provided, the CLI accepts an exact course ID, exact course name, or exact short name.

```bash
gradescope-cli assignments
gradescope-cli assignments 123456
gradescope-cli assignments --course 123456
gradescope-cli assignments --course CS101
gradescope-cli assignments --course "Distributed Systems"
```

Output format:

```text
<assignment-id-or->    <assignment-title>    <status-if-present>
```

Rows without a visible assignment ID are still shown. They remain selectable in the interactive submit flow even if Gradescope does not expose an ID on the course page.

### `gradescope-cli submit [file ...]`

Submits through either the `Upload` or `GitHub` Gradescope submission type. Upload file paths are resolved from your current working directory, so `gradescope-cli submit ./foo/bar.py` uses the directory you are currently in as the prefix when locating the file.

```bash
gradescope-cli submit
gradescope-cli submit ./submission.pdf
gradescope-cli submit ./main.py ./utils.py --course 123456 --assignment "Project 1"
gradescope-cli submit --file ./main.py --file ./utils.py --course CS101 --assignment "Project 1"
gradescope-cli submit --submission-type github --repo owner/project --branch main --course 123456 --assignment 7891011
gradescope-cli submit --submission-type github --course "Distributed Systems" --assignment "Project 1"
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
- Course matching accepts either an exact course ID, exact course name, or exact short name.
- Assignment matching accepts either an exact assignment ID or an exact title case-insensitively.
- After submission, the CLI prints the submission URL, status, response text, and autograder text if it is available.

### `gradescope-cli completion <bash|zsh>`

Prints a shell completion script.

```bash
gradescope-cli completion bash
gradescope-cli completion zsh
```

Useful install patterns:

```bash
source <(gradescope-cli completion bash)
autoload -U compinit && compinit
source <(gradescope-cli completion zsh)
```

If you are running from a local clone instead of an installed `gradescope-cli` binary on your `PATH`, use:

```bash
autoload -U compinit && compinit
source <(node ./bin/gradescope-cli.mjs completion zsh)
```

For a persistent zsh setup, add this to `~/.zshrc`:

```zsh
autoload -U compinit
compinit
source <(gradescope-cli completion zsh)
```

Then open a new shell before testing completion.

Completion behavior:

- `--course` suggestions come from the saved session when it is available.
- `--assignment` suggestions come from the saved session and the already-selected `--course` when both are available.
- `--submission-type` suggests `upload` and `github`.
- `--file` uses native shell file completion.
- If no saved session is available, completion falls back gracefully to static command and option suggestions.

### `gradescope-cli result <submission-id-or-url>`

Fetches and prints a submission result page.

```bash
gradescope-cli result 399271099
gradescope-cli result /courses/123/assignments/456/submissions/789
gradescope-cli result https://www.gradescope.com/courses/123/assignments/456/submissions/789
```

For the most reliable result lookup, prefer the full nested submission path. Some accounts cannot access bare `/submissions/<id>` routes.

## Common options

- `--session-file <path>` overrides the saved Playwright session path
- `--base-url <url>` overrides the Gradescope base URL
- `--headful` launches Chromium with a visible window instead of headless mode

## Session storage

By default the CLI stores the Playwright session at:

- macOS: `~/Library/Application Support/gradescope-cli/session.json`
- Linux: `~/.config/gradescope-cli/session.json`
- Windows: `%APPDATA%\gradescope-cli\session.json`

You can override the config root with `GRADESCOPE_CONFIG_DIR`.

## Environment variables

- `GRADESCOPE_EMAIL`
- `GRADESCOPE_PASSWORD`
- `GRADESCOPE_BASE_URL`
- `GRADESCOPE_HEADLESS`
- `GRADESCOPE_CONFIG_DIR`
- `GRADESCOPE_SKIP_BROWSER_DOWNLOAD`

## Codex sandbox limitations

`gradescope-cli` launches a real Chromium process through Playwright for `login`, `classes`, `assignments`, `submit`, and `result`. In the default Codex `workspace-write` sandbox on macOS, that browser process can be installed but it cannot start successfully.

The failure usually looks like:

```text
bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer... Permission denied (1100)
```

This is not a path-resolution issue with your current working directory. It is a macOS sandbox restriction that prevents Chromium from registering the Mach service it needs during startup. In practice:

- `gradescope-cli --help` still works
- plain Node.js commands still work
- browser-backed commands fail inside the default Codex sandbox

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

But the login command still requires a browser-capable environment. Setting credentials alone does not bypass the Chromium launch requirement.

## Development

```bash
npm test
npm run check
```

Browser-backed parser tests are skipped by default so `npm test` stays reliable in restricted environments. To opt into them on a browser-capable machine, run:

```bash
GRADESCOPE_RUN_BROWSER_TESTS=1 npm test
```

The repo still contains the earlier Go implementation, but the public CLI and current primary path are now the Playwright-backed npm command.
