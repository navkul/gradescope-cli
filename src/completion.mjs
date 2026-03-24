import { listAssignments, listCourses } from "../playwright/core.mjs";
import { commonOptions, parseArgs } from "./command-utils.mjs";
import {
  assignmentCompletionValues,
  courseCompletionValues,
  filterSuggestions,
  resolveCourse,
} from "./lookup.mjs";

export const FILE_COMPLETION_SENTINEL = "__GRADESCOPE_COMPLETE_FILES__";

const COMMANDS = [
  "login",
  "classes",
  "assignments",
  "submit",
  "result",
  "wizard",
  "help",
  "completion",
];

const COMMON_OPTIONS = [
  "--session-file",
  "--base-url",
  "--headful",
  "--help",
];

const COMMAND_OPTIONS = {
  login: [
    "--credentials-file",
    "--email",
    "--password",
    "--password-file",
  ],
  classes: [],
  assignments: [
    "--course",
  ],
  submit: [
    "--course",
    "--assignment",
    "--file",
  ],
  result: [
    "--submission",
  ],
  wizard: [
    "--course",
    "--assignment",
    "--file",
    "--credentials-file",
    "--email",
    "--password",
    "--password-file",
  ],
  run: [
    "--course",
    "--assignment",
    "--file",
    "--credentials-file",
    "--email",
    "--password",
    "--password-file",
  ],
  completion: [],
};

export function renderCompletionScript(shell) {
  if (shell === "bash") {
    return `# shellcheck shell=bash
_gradescope_cli_completion() {
  local cmd="\${COMP_WORDS[0]}"
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local -a suggestions

  mapfile -t suggestions < <("$cmd" __complete "$COMP_CWORD" "\${COMP_WORDS[@]}")

  if [[ \${#suggestions[@]} -eq 1 && \${suggestions[0]} == "${FILE_COMPLETION_SENTINEL}" ]]; then
    compopt -o filenames 2>/dev/null
    mapfile -t COMPREPLY < <(compgen -f -- "$cur")
    return 0
  fi

  COMPREPLY=("\${suggestions[@]}")
}

complete -o default -F _gradescope_cli_completion gradescope-cli`;
  }

  if (shell === "zsh") {
    return `#compdef gradescope-cli

_gradescope_cli_completion() {
  local cmd="\${words[1]}"
  local -a suggestions

  suggestions=("\${(@f)$("$cmd" __complete "$((CURRENT - 1))" "\${words[@]}")}")

  if (( \${#suggestions[@]} == 1 )) && [[ \${suggestions[1]} == "${FILE_COMPLETION_SENTINEL}" ]]; then
    _files
    return 0
  fi

  if (( \${#suggestions[@]} > 0 )); then
    compadd -Q -- "\${suggestions[@]}"
  fi
}

compdef _gradescope_cli_completion gradescope-cli`;
  }

  throw new Error(`unsupported shell "${shell}"; expected bash or zsh`);
}

export async function getCompletionSuggestions(request, dependencies = {}) {
  const words = Array.isArray(request.words) ? request.words.map((value) => String(value || "")) : [];
  const requestedIndex = Number.parseInt(String(request.cword ?? ""), 10);
  const cword = Number.isFinite(requestedIndex)
    ? Math.max(0, Math.min(requestedIndex, words.length))
    : words.length;

  const beforeCurrent = words.slice(1, cword);
  const currentWord = words[cword] || "";
  const previousWord = cword > 0 ? words[cword - 1] || "" : "";
  const parsed = parseArgs(beforeCurrent);
  const command = parsed.command || "";
  const loadCourses = dependencies.listCourses || listCourses;
  const loadAssignments = dependencies.listAssignments || listAssignments;

  if (previousWord === "--course") {
    return completeCourseSuggestions(parsed, currentWord, loadCourses);
  }

  if (previousWord === "--assignment") {
    return completeAssignmentSuggestions(parsed, currentWord, loadCourses, loadAssignments);
  }

  if (shouldCompleteFiles({ command, parsed, previousWord, currentWord })) {
    return [FILE_COMPLETION_SENTINEL];
  }

  if (!command) {
    return filterSuggestions(COMMANDS, currentWord);
  }

  if (command === "completion" && parsed.positionals.length === 0) {
    return filterSuggestions(["bash", "zsh"], currentWord);
  }

  if (command === "assignments" && parsed.positionals.length === 0 && !currentWord.startsWith("-")) {
    return completeCourseSuggestions(parsed, currentWord, loadCourses);
  }

  if (currentWord.startsWith("-") || currentWord === "") {
    return filterSuggestions(availableOptions(command, parsed.options), currentWord);
  }

  return [];
}

function shouldCompleteFiles({ command, parsed, previousWord, currentWord }) {
  if (previousWord === "--file") {
    return true;
  }

  if (currentWord.startsWith("-")) {
    return false;
  }

  if ((command === "submit" || command === "wizard" || command === "run") && parsed.positionals.length === 0) {
    return true;
  }

  return false;
}

async function completeCourseSuggestions(parsed, currentWord, loadCourses) {
  const courses = await loadCourses(commonOptions(parsed.options)).catch(() => []);
  return filterSuggestions(courses.flatMap(courseCompletionValues), currentWord);
}

async function completeAssignmentSuggestions(parsed, currentWord, loadCourses, loadAssignments) {
  const courseHint = String(parsed.options.course || "").trim();
  if (!courseHint) {
    return [];
  }

  const options = commonOptions(parsed.options);
  const courses = await loadCourses(options).catch(() => []);
  const course = resolveCourse(courses, courseHint);
  if (!course) {
    return [];
  }

  const assignments = await loadAssignments({
    ...options,
    courseId: course.id,
  }).catch(() => []);

  return filterSuggestions(assignments.flatMap(assignmentCompletionValues), currentWord);
}

function availableOptions(command, parsedOptions) {
  const usedOptions = new Set(Object.keys(parsedOptions));
  const options = [
    ...(COMMAND_OPTIONS[command] || []),
    ...COMMON_OPTIONS,
  ];

  return [...new Set(options)].filter((option) => {
    if (option === "--help") {
      return true;
    }
    return !usedOptions.has(optionKey(option));
  });
}

function optionKey(option) {
  return option.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}
