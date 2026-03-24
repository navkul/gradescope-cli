import fs from "node:fs/promises";
import { loadCredentials } from "./credentials.mjs";
import { validateUploadPath } from "./path-utils.mjs";
import { renderCompletionScript, getCompletionSuggestions } from "./completion.mjs";
import { commonOptions, firstPositional, parseArgs } from "./command-utils.mjs";
import { resolveCourse } from "./lookup.mjs";
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
  if (argv[0] === "__complete") {
    await runHiddenCompletion(argv.slice(1));
    return;
  }

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
    case "completion":
      await runCompletion(parsed);
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
  const courseHint = firstPositional(parsed, 0) || String(parsed.options.course || "").trim();
  let courseId = "";

  if (!courseHint) {
    const courses = await listCourses(options);
    const selectedCourse = await promptSelection("Choose a class:", courses, formatCourse);
    courseId = selectedCourse.id;
  } else {
    courseId = await resolveCourseId(options, courseHint);
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

  const courseHint = String(parsed.options.course || "").trim();
  let courseId = "";
  if (!courseHint) {
    const courses = await listCourses(options);
    const selectedCourse = await promptSelection("Choose a class:", courses, formatCourse);
    courseId = selectedCourse.id;
  } else {
    courseId = await resolveCourseId(options, courseHint);
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

async function runCompletion(parsed) {
  const shell = firstPositional(parsed, 0).toLowerCase();
  if (!shell) {
    throw new Error("missing shell name; use `gradescope-cli completion bash` or `gradescope-cli completion zsh`");
  }

  console.log(renderCompletionScript(shell));
}

async function runWizard(parsed) {
  const options = commonOptions(parsed.options);
  const fileArg = firstPositional(parsed, 0) || parsed.options.file;
  if (!fileArg) {
    throw new Error("missing file path; use `gradescope-cli submit <file>` or `gradescope-cli wizard <file>`");
  }

  await runSubmit(parsed);
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

async function resolveCourseId(options, hint) {
  const courses = await listCourses(options);
  const course = resolveCourse(courses, hint);
  if (!course) {
    throw new Error(`could not find course "${hint}". Use the course ID, exact course name, or exact short name.`);
  }
  return course.id;
}

async function runHiddenCompletion(argv) {
  const cword = Number.parseInt(String(argv[0] || ""), 10);
  if (!Number.isFinite(cword)) {
    return;
  }

  const suggestions = await getCompletionSuggestions({
    cword,
    words: argv.slice(1),
  }).catch(() => []);

  for (const suggestion of suggestions) {
    console.log(suggestion);
  }
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

export function parseCliArgs(argv) {
  return parseArgs(argv);
}

function printHelp() {
  console.log(`gradescope-cli

Usage:
  gradescope-cli login [--credentials-file creds.json]
  gradescope-cli classes
  gradescope-cli assignments [course-id-or-name-or-short]
  gradescope-cli submit <file> [--course <course-id-or-name-or-short>] [--assignment <assignment-id-or-title>]
  gradescope-cli result <submission-id-or-url>
  gradescope-cli completion <bash|zsh>

Notes:
  submit <file> is the simplest path. If --course or --assignment are omitted, the CLI prompts you.
  Course matching accepts an exact ID, exact course name, or exact short name.
  Assignment matching accepts an exact ID or exact title case-insensitively.
  Relative file paths are resolved from your current working directory.

Environment:
  GRADESCOPE_EMAIL
  GRADESCOPE_PASSWORD
  GRADESCOPE_BASE_URL
  GRADESCOPE_HEADLESS
  GRADESCOPE_CONFIG_DIR
  GRADESCOPE_SKIP_BROWSER_DOWNLOAD`);
}
