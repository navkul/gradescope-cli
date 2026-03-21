# gradescope-cli

`gradescope-cli` is a Playwright-first Gradescope CLI. It logs in through the real web app, lists classes and assignments, submits a local file, and prints the resulting submission status and any autograder text it can find.

## Install

### From npm

```bash
npm install -g gradescope-cli
```

The package installs Playwright and runs a postinstall step that downloads Chromium automatically. You should not need to run a separate `npx playwright install chromium` step unless the browser download fails or you skipped install scripts.

### From a local clone

```bash
git clone <repo-url>
cd gradescope-cli
npm install
npm link
```

`npm install` downloads the JavaScript dependencies and Chromium. `npm link` exposes the global `gradescope-cli` command so you can run it from anywhere in your terminal.

If you need to skip the browser download temporarily, set `GRADESCOPE_SKIP_BROWSER_DOWNLOAD=1` before install.

## Quick start

```bash
gradescope-cli login
gradescope-cli classes
gradescope-cli assignments
gradescope-cli submit ./path/to/submission.pdf
gradescope-cli result /courses/<course>/assignments/<assignment>/submissions/<submission>
```

The simplest submission flow is:

```bash
gradescope-cli submit ./submission.pdf
```

If you omit `--course` or `--assignment`, the CLI prompts you to choose them interactively from the authenticated account.

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

### `gradescope-cli assignments [course-id]`

Lists assignments for a course. If `course-id` is omitted, the CLI prompts you to pick a class first.

```bash
gradescope-cli assignments
gradescope-cli assignments 123456
gradescope-cli assignments --course 123456
```

Output format:

```text
<assignment-id-or->    <assignment-title>    <status-if-present>
```

Rows without a visible assignment ID are still shown. They remain selectable in the interactive submit flow even if Gradescope does not expose an ID on the course page.

### `gradescope-cli submit <file>`

Submits a local file. The file path is resolved from your current working directory, so `gradescope-cli submit ./foo/bar.pdf` uses the directory you are currently in as the prefix when locating the file.

```bash
gradescope-cli submit ./submission.pdf
gradescope-cli submit ./submission.pdf --course 123456
gradescope-cli submit ./submission.pdf --course 123456 --assignment 7891011
gradescope-cli submit ./submission.pdf --course 123456 --assignment "Homework 4"
```

Behavior:

- If no session file exists, the CLI logs in first.
- If `--course` is omitted, the CLI prompts you to pick a class.
- If `--assignment` is omitted, the CLI prompts you to pick an assignment.
- Assignment matching accepts either an assignment ID or an exact title.
- After upload, the CLI prints the submission URL, status, response text, and autograder text if it is available.

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

## Development

```bash
npm test
npm run check
```

The repo still contains the earlier Go implementation, but the public CLI and current primary path are now the Playwright-backed npm command.
