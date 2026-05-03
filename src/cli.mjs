import fs from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { loadCredentials } from "./credentials.mjs";
import { validateUploadPaths } from "./path-utils.mjs";
import { commonOptions, firstPositional, parseArgs } from "./command-utils.mjs";
import { getBackend } from "./backend.mjs";
import { resolveAssignment, resolveCourse } from "./lookup.mjs";
import {
  resolveSubmissionType,
  normalizeStringList,
  submissionTypeLabel,
  SUBMISSION_TYPE_CHOICES,
} from "./submission-options.mjs";
import {
  printAssignments,
  printCourses,
  printSubmissionResult,
  promptSelection,
  promptUploadPaths,
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
  const timer = startTimer();
  const options = commonOptions(parsed.options);
  const backend = getBackend("login", options);
  const credentials = await loadCredentials(parsed.options, { promptForMissing: true });
  await backend.login({
    ...options,
    ...credentials,
  });
  console.log(`Login succeeded in ${formatElapsed(timer)}; session saved to ${options.sessionFile}`);
}

async function runClasses(parsed) {
  const timer = startTimer();
  const options = commonOptions(parsed.options);
  const backend = getBackend("classes", options);
  const courses = await backend.listCourses(options);
  printCourses(courses);
  console.log(`Retrieved classes in ${formatElapsed(timer)}`);
}

async function runAssignments(parsed) {
  const timer = startTimer();
  const options = commonOptions(parsed.options);
  const backend = getBackend("assignments", options);
  const courseHint = firstPositional(parsed, 0) || String(parsed.options.course || "").trim();
  let courseId = "";

  if (!courseHint) {
    const courses = await backend.listCourses(options);
    const selectedCourse = await promptSelection("Choose a class:", courses, formatCourse);
    courseId = selectedCourse.id;
  } else {
    courseId = await resolveCourseId(backend, options, courseHint);
  }

  const assignments = await backend.listAssignments({
    ...options,
    courseId,
  });
  printAssignments(assignments);
  console.log(`Retrieved assignments in ${formatElapsed(timer)}`);
}

async function runSubmit(parsed) {
  const timer = startTimer();
  const options = commonOptions(parsed.options);
  const backend = getBackend("submit", options);
  await ensureSessionForInteractiveFlow(backend, options, parsed.options);
  const course = await resolveCourseSelection(backend, options, String(parsed.options.course || "").trim());
  const assignment = await resolveAssignmentSelection(
    backend,
    options,
    course.id,
    String(parsed.options.assignment || "").trim(),
  );
  const assignmentHint = assignment.id || assignment.title;

  const requestedType = parsed.options.submissionType || parsed.options.type;
  let submissionType = resolveSubmissionType({
    submissionType: requestedType,
    filePaths: collectUploadPathArgs(parsed),
    repo: parsed.options.repo,
    branch: parsed.options.branch,
  });

  if (!submissionType) {
    submissionType = await promptForSubmissionType(backend, options, course.id, assignmentHint);
  }

  const submitOptions = {
    ...options,
    courseId: course.id,
    courseName: course.name,
    assignment: assignmentHint,
    assignmentId: assignment.id,
    assignmentTitle: assignment.title,
    submissionType,
    waitForResponse: Boolean(parsed.options.waitForResponse),
  };

  if (submissionType === "upload") {
    const uploadPaths = await resolveUploadPathsForSubmit(parsed);
    console.log(`submitting via ${submissionTypeLabel(submissionType)}: ${uploadPaths.map((item) => item.displayPath).join(", ")}`);
    submitOptions.filePaths = uploadPaths.map((item) => item.absolutePath);
  } else if (submissionType === "github") {
    const repo = await resolveGitHubRepository(backend, parsed, options, course.id, assignmentHint);
    const branch = await resolveGitHubBranch(backend, parsed, options, course.id, assignmentHint, repo);
    console.log(`submitting via ${submissionTypeLabel(submissionType)}: ${repo} @ ${branch}`);
    submitOptions.repo = repo;
    submitOptions.branch = branch;
  } else {
    throw new Error(`unsupported submission type "${submissionType}"`);
  }

  const submission = await backend.submit(submitOptions);
  printSubmissionResult(submission);
  console.log(`Submitted in ${formatElapsed(timer)}`);
}

async function runResult(parsed) {
  const timer = startTimer();
  const options = commonOptions(parsed.options);
  const backend = getBackend("result", options);
  const submission = firstPositional(parsed, 0) || String(parsed.options.submission || "").trim();
  const courseHint = String(parsed.options.course || "").trim();
  const assignmentHint = String(parsed.options.assignment || "").trim();

  if (submission && (courseHint || assignmentHint)) {
    throw new Error("cannot combine a submission reference with --course or --assignment");
  }

  await ensureSessionForInteractiveFlow(backend, options, parsed.options);

  const resultOptions = {
    ...options,
  };

  if (submission) {
    resultOptions.submission = submission;
  } else {
    const course = await resolveCourseSelection(backend, options, courseHint);
    const assignment = await resolveAssignmentSelection(backend, options, course.id, assignmentHint);
    resultOptions.courseId = course.id;
    resultOptions.courseName = course.name;
    resultOptions.assignment = assignment.id || assignment.title;
    resultOptions.assignmentId = assignment.id;
    resultOptions.assignmentTitle = assignment.title;
  }

  const submissionResult = await backend.result(resultOptions);
  printSubmissionResult(submissionResult);
  console.log(`Retrieved result in ${formatElapsed(timer)}`);
}

async function runWizard(parsed) {
  await runSubmit(parsed);
}

async function ensureSessionForInteractiveFlow(backend, options, rawOptions) {
  await fs.access(options.sessionFile).catch(async () => {
    const credentials = await loadCredentials(rawOptions, { promptForMissing: true });
    await backend.login({
      ...options,
      ...credentials,
    });
  });
}

async function resolveCourseId(backend, options, hint) {
  const courses = await backend.listCourses(options);
  const course = resolveCourse(courses, hint);
  if (!course) {
    throw new Error(`could not find course "${hint}". Use the course ID, exact course name, or exact short name.`);
  }
  return course.id;
}

async function resolveCourseSelection(backend, options, courseHint) {
  const courses = await backend.listCourses(options);
  if (!courseHint) {
    return promptSelection("Choose a class:", courses, formatCourse);
  }

  const course = resolveCourse(courses, courseHint);
  if (!course) {
    throw new Error(`could not find course "${courseHint}". Use the course ID, exact course name, or exact short name.`);
  }
  return course;
}

async function resolveAssignmentSelection(backend, options, courseId, assignmentHint) {
  const assignments = await backend.listAssignments({
    ...options,
    courseId,
  });
  if (!assignmentHint) {
    return promptSelection("Choose an assignment:", assignments, formatAssignment);
  }

  const assignment = resolveAssignment(assignments, assignmentHint);
  if (!assignment) {
    throw new Error(`could not find assignment "${assignmentHint}". Use the assignment ID or exact assignment title.`);
  }
  return assignment;
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

async function resolveUploadPathsForSubmit(parsed) {
  const candidatePaths = collectUploadPathArgs(parsed);
  if (candidatePaths.length > 0) {
    return validateUploadPaths(candidatePaths);
  }

  const promptedPaths = await promptUploadPaths();
  return validateUploadPaths(promptedPaths);
}

function collectUploadPathArgs(parsed) {
  return normalizeStringList([
    ...(parsed.positionals || []),
    parsed.options.file,
  ]);
}

async function promptForSubmissionType(backend, options, courseId, assignmentHint) {
  const availableTypes = await backend.listSubmissionTypes({
    ...options,
    courseId,
    assignment: assignmentHint,
  }).catch(() => []);
  const availableChoices = availableTypes.length > 0
    ? SUBMISSION_TYPE_CHOICES.filter((choice) => availableTypes.includes(choice.key))
    : SUBMISSION_TYPE_CHOICES;
  const selectedType = await promptSelection("Choose a submission type:", availableChoices, (choice) => choice.label);
  return selectedType.key;
}

async function resolveGitHubRepository(backend, parsed, options, courseId, assignmentHint) {
  const repo = String(parsed.options.repo || "").trim();
  if (repo) {
    return repo;
  }

  const repositories = await backend.listGitHubRepositories({
    ...options,
    courseId,
    assignment: assignmentHint,
  });
  const selectedRepo = await promptSelection("Choose a GitHub repository:", repositories, formatGitHubChoice);
  return selectedRepo.value || selectedRepo.label;
}

async function resolveGitHubBranch(backend, parsed, options, courseId, assignmentHint, repo) {
  const branch = String(parsed.options.branch || "").trim();
  if (branch) {
    return branch;
  }

  const branches = await backend.listGitHubBranches({
    ...options,
    courseId,
    assignment: assignmentHint,
    repo,
  });
  const selectedBranch = await promptSelection("Choose a GitHub branch:", branches, formatGitHubChoice);
  return selectedBranch.value || selectedBranch.label;
}

function formatGitHubChoice(choice) {
  if (choice.label && choice.value && choice.label !== choice.value) {
    return `${choice.label} (${choice.value})`;
  }
  return choice.label || choice.value || "";
}

export function parseCliArgs(argv) {
  return parseArgs(argv);
}

function printHelp() {
  console.log(`gradescope-cli

Usage:
  gradescope-cli login [--credentials-file creds.json] [--backend <http|playwright>]
  gradescope-cli classes [--backend <http|playwright>]
  gradescope-cli assignments [course-id-or-name-or-short] [--backend <http|playwright>]
  gradescope-cli submit [<file> ...] [--file <path>] [--submission-type <upload|github>] [--repo <repository>] [--branch <branch>] [--course <course-id-or-name-or-short>] [--assignment <assignment-id-or-title>] [--wait-for-response] [--backend <http|playwright>]
  gradescope-cli result [<submission-id-or-url>] [--submission <submission-id-or-url>] [--course <course-id-or-name-or-short>] [--assignment <assignment-id-or-title>] [--backend <http|playwright>]

Notes:
  submit accepts one or more upload files, or a GitHub repository plus branch.
  If the submit mode is omitted, the CLI prompts for Upload or GitHub after you choose the assignment.
  Course matching accepts an exact ID, exact course name, or exact short name.
  Assignment matching accepts an exact ID or exact title case-insensitively.
  Relative file paths are resolved from your current working directory.
  The default backend is http for login/classes/assignments/result and playwright for submit.

Environment:
  GRADESCOPE_EMAIL
  GRADESCOPE_PASSWORD
  GRADESCOPE_BASE_URL
  GRADESCOPE_BACKEND
  GRADESCOPE_HEADLESS
  GRADESCOPE_CONFIG_DIR
  GRADESCOPE_SKIP_BROWSER_DOWNLOAD`);
}

function startTimer() {
  return performance.now();
}

function formatElapsed(startedAt) {
  return `${(performance.now() - startedAt).toFixed(1)} ms`;
}
