import test from "node:test";
import assert from "node:assert/strict";
import {
  FILE_COMPLETION_SENTINEL,
  getCompletionSuggestions,
  renderCompletionScript,
} from "../src/completion.mjs";

const courses = [
  { id: "123", short: "CS101", name: "Intro to Testing" },
  { id: "456", short: "HIST210", name: "Distributed Systems" },
];

const assignments = [
  { id: "88", title: "Homework 1" },
  { id: "", title: "Final Project Proposal" },
];

test("completion suggests course ids, short names, and course names", async () => {
  const suggestions = await getCompletionSuggestions(
    {
      cword: 3,
      words: ["gradescope-cli", "submit", "--course", "cs"],
    },
    {
      listCourses: async () => courses,
      listAssignments: async () => assignments,
    },
  );

  assert.deepEqual(suggestions, ["CS101"]);
});

test("completion resolves course hints before suggesting assignments", async () => {
  const suggestions = await getCompletionSuggestions(
    {
      cword: 5,
      words: ["gradescope-cli", "submit", "--course", "cs101", "--assignment", "home"],
    },
    {
      listCourses: async () => courses,
      listAssignments: async () => assignments,
    },
  );

  assert.deepEqual(suggestions, ["Homework 1"]);
});

test("completion returns a file sentinel for submit file positions", async () => {
  const suggestions = await getCompletionSuggestions({
    cword: 2,
    words: ["gradescope-cli", "submit"],
  });

  assert.deepEqual(suggestions, [FILE_COMPLETION_SENTINEL]);
});

test("completion renders installable bash and zsh scripts", () => {
  assert.match(renderCompletionScript("bash"), /__complete/);
  assert.match(renderCompletionScript("bash"), /complete -o default/);
  assert.match(renderCompletionScript("zsh"), /compdef _gradescope_cli_completion gradescope-cli/);
});
