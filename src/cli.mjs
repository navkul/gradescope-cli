import fs from "node:fs/promises";
import { loadCredentials } from "./credentials.mjs";
import { validateUploadPaths } from "./path-utils.mjs";
import { renderCompletionScript, getCompletionSuggestions } from "./completion.mjs";
import { commonOptions, firstPositional, parseArgs } from "./command-utils.mjs";
import { resolveCourse } from "./lookup.mjs";
import {
  resolveSubmissionType,
  normalizeStringList,
  submissionTypeLabel,
  SUBMISSION_TYPE_CHOICES,
} from "./submission-options.mjs";
import {
  login,
  listGitHubBranches,
  listGitHubRepositories,
  listAssignments,
  listCourses,
  listSubmissionTypes,
  result,
  submit,
} from "../playwright/core.mjs";
import {
  printAssignments,
  printCourses,
  printSubmissionResult,
  promptSelection,
  promptUploadPaths,
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

  const requestedType = parsed.options.submissionType || parsed.options.type;
  let submissionType = resolveSubmissionType({
    submissionType: requestedType,
    filePaths: collectUploadPathArgs(parsed),
    repo: parsed.options.repo,
    branch: parsed.options.branch,
  });

  if (!submissionType) {
    submissionType = await promptForSubmissionType(options, courseId, assignmentHint);
  }

  const submitOptions = {
    ...options,
    courseId,
    assignment: assignmentHint,
    submissionType,
  };

  if (submissionType === "upload") {
    const uploadPaths = await resolveUploadPathsForSubmit(parsed);
    console.log(`submitting via ${submissionTypeLabel(submissionType)}: ${uploadPaths.map((item) => item.displayPath).join(", ")}`);
    submitOptions.filePaths = uploadPaths.map((item) => item.absolutePath);
  } else if (submissionType === "github") {
    const repo = await resolveGitHubRepository(parsed, options, courseId, assignmentHint);
    const branch = await resolveGitHubBranch(parsed, options, courseId, assignmentHint, repo);
    console.log(`submitting via ${submissionTypeLabel(submissionType)}: ${repo} @ ${branch}`);
    submitOptions.repo = repo;
    submitOptions.branch = branch;
  } else {
    throw new Error(`unsupported submission type "${submissionType}"`);
  }

  const submission = await submit(submitOptions);
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

async function promptForSubmissionType(options, courseId, assignmentHint) {
  const availableTypes = await listSubmissionTypes({
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

async function resolveGitHubRepository(parsed, options, courseId, assignmentHint) {
  const repo = String(parsed.options.repo || "").trim();
  if (repo) {
    return repo;
  }

  const repositories = await listGitHubRepositories({
    ...options,
    courseId,
    assignment: assignmentHint,
  });
  const selectedRepo = await promptSelection("Choose a GitHub repository:", repositories, formatGitHubChoice);
  return selectedRepo.value || selectedRepo.label;
}

async function resolveGitHubBranch(parsed, options, courseId, assignmentHint, repo) {
  const branch = String(parsed.options.branch || "").trim();
  if (branch) {
    return branch;
  }

  const branches = await listGitHubBranches({
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
  gradescope-cli login [--credentials-file creds.json]
  gradescope-cli classes
  gradescope-cli assignments [course-id-or-name-or-short]
  gradescope-cli submit [<file> ...] [--file <path>] [--submission-type <upload|github>] [--repo <repository>] [--branch <branch>] [--course <course-id-or-name-or-short>] [--assignment <assignment-id-or-title>]
  gradescope-cli result <submission-id-or-url>
  gradescope-cli completion <bash|zsh>

Notes:
  submit accepts one or more upload files, or a GitHub repository plus branch.
  If the submit mode is omitted, the CLI prompts for Upload or GitHub after you choose the assignment.
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
