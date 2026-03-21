import fs from "node:fs/promises";
import { defaultBaseUrl, defaultSessionPath } from "./config.mjs";
import { loadCredentials } from "./credentials.mjs";
import { validateUploadPath } from "./path-utils.mjs";
import {
  login,
  listAssignments,
  listCourses,
  result,
  submit,
} from "../playwright/core.mjs";
import {
  printAssignments,
  printCourses,
  printSubmissionResult,
  promptSelection,
} from "./ui.mjs";

export async function main(argv = process.argv.slice(2)) {
  const parsed = parseArgs(argv);
  const command = parsed.command || "wizard";

  switch (command) {
    case "login":
      await runLogin(parsed);
      return;
    case "classes":
      await runClasses(parsed);
      return;
    case "assignments":
      await runAssignments(parsed);
      return;
    case "submit":
      await runSubmit(parsed);
      return;
    case "result":
      await runResult(parsed);
      return;
    case "wizard":
    case "run":
      await runWizard(parsed);
      return;
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return;
    default:
      throw new Error(`unknown command "${command}"`);
  }
}

async function runLogin(parsed) {
  const options = commonOptions(parsed.options);
  const credentials = await loadCredentials(parsed.options, { promptForMissing: true });
  await login({
    ...options,
    ...credentials,
  });
  console.log(`logged in successfully; session saved to ${options.sessionFile}`);
}

async function runClasses(parsed) {
  const options = commonOptions(parsed.options);
  const courses = await listCourses(options);
  printCourses(courses);
}

async function runAssignments(parsed) {
  const options = commonOptions(parsed.options);
  let courseId = firstPositional(parsed, 0) || String(parsed.options.course || "").trim();

  if (!courseId) {
    const courses = await listCourses(options);
    const selectedCourse = await promptSelection("Choose a class:", courses, formatCourse);
    courseId = selectedCourse.id;
  }

  const assignments = await listAssignments({
    ...options,
    courseId,
  });
  printAssignments(assignments);
}

async function runSubmit(parsed) {
  const options = commonOptions(parsed.options);
  const fileArg = firstPositional(parsed, 0) || parsed.options.file;
  const { absolutePath, displayPath } = await validateUploadPath(fileArg);

  await ensureSessionForInteractiveFlow(options, parsed.options);

  let courseId = String(parsed.options.course || "").trim();
  if (!courseId) {
    const courses = await listCourses(options);
    const selectedCourse = await promptSelection("Choose a class:", courses, formatCourse);
    courseId = selectedCourse.id;
  }

  let assignmentHint = String(parsed.options.assignment || "").trim();
  if (!assignmentHint) {
    const assignments = await listAssignments({
      ...options,
      courseId,
    });
    const selectedAssignment = await promptSelection("Choose an assignment:", assignments, formatAssignment);
    assignmentHint = selectedAssignment.id || selectedAssignment.title;
  }

  console.log(`submitting: ${displayPath}`);
  const submission = await submit({
    ...options,
    courseId,
    assignment: assignmentHint,
    filePath: absolutePath,
  });
  printSubmissionResult(submission);
}

async function runResult(parsed) {
  const options = commonOptions(parsed.options);
  const submission = firstPositional(parsed, 0) || String(parsed.options.submission || "").trim();
  if (!submission) {
    throw new Error("missing submission reference");
  }

  const submissionResult = await result({
    ...options,
    submission,
  });
  printSubmissionResult(submissionResult);
}

async function runWizard(parsed) {
  const options = commonOptions(parsed.options);
  const fileArg = firstPositional(parsed, 0) || parsed.options.file;
  if (!fileArg) {
    throw new Error("missing file path; use `gradescope-cli submit <file>` or `gradescope-cli wizard <file>`");
  }

  await runSubmit(parsed);
}

function commonOptions(options) {
  return {
    baseUrl: options.baseUrl || defaultBaseUrl(),
    sessionFile: options.sessionFile || defaultSessionPath(),
    headless: options.headful ? false : undefined,
  };
}

async function ensureSessionForInteractiveFlow(options, rawOptions) {
  await fs.access(options.sessionFile).catch(async () => {
    const credentials = await loadCredentials(rawOptions, { promptForMissing: true });
    await login({
      ...options,
      ...credentials,
    });
  });
}

function formatCourse(course) {
  return course.short && course.short !== course.name
    ? `${course.short} | ${course.name}`
    : course.name;
}

function formatAssignment(assignment) {
  if (assignment.status) {
    const prefix = assignment.id ? `${assignment.id} | ` : "";
    return `${prefix}${assignment.title} [${assignment.status}]`;
  }
  if (assignment.id) {
    return `${assignment.id} | ${assignment.title}`;
  }
  return assignment.title;
}

function parseArgs(argv) {
  const args = [...argv];
  const command = args[0] && !args[0].startsWith("--") ? args.shift() : "";
  const options = {};
  const positionals = [];

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const [name, inlineValue] = token.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      options[toCamelCase(name)] = inlineValue;
      continue;
    }

    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      options[toCamelCase(name)] = next;
      index += 1;
      continue;
    }

    options[toCamelCase(name)] = true;
  }

  return { command, options, positionals };
}

function firstPositional(parsed, index) {
  return String(parsed.positionals[index] || "").trim();
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function printHelp() {
  console.log(`gradescope-cli

Usage:
  gradescope-cli login [--credentials-file creds.json]
  gradescope-cli classes
  gradescope-cli assignments [course-id]
  gradescope-cli submit <file> [--course <course-id>] [--assignment <assignment-id-or-title>]
  gradescope-cli result <submission-id-or-url>

Notes:
  submit <file> is the simplest path. If --course or --assignment are omitted, the CLI prompts you.
  Relative file paths are resolved from your current working directory.

Environment:
  GRADESCOPE_EMAIL
  GRADESCOPE_PASSWORD
  GRADESCOPE_BASE_URL
  GRADESCOPE_HEADLESS
  GRADESCOPE_CONFIG_DIR
  GRADESCOPE_SKIP_BROWSER_DOWNLOAD`);
}
