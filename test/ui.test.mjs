import test from "node:test";
import assert from "node:assert/strict";
import { formatSubmissionResultLines } from "../src/ui.mjs";

test("formatSubmissionResultLines renders structured feedback and omits legacy none placeholders", () => {
  const lines = formatSubmissionResultLines({
    courseId: "1222812",
    courseName: "Concepts of Programming Languages",
    assignmentId: "7869354",
    assignmentTitle: "Mini-Project 1 Check-in (Written)",
    submissionId: "400921750",
    url: "https://www.gradescope.com/courses/1222812/assignments/7869354/submissions/400921750",
    status: "graded",
    processingStatus: "processed",
    scoreDisplay: "19 / 20",
    response: [
      "1. Parse Tree (Review) | 4 / 4",
      "5. Semantic Derivation | 3 / 4",
      "  rubric: Minor error | 1 pt",
      "    Missing rule names",
      "  annotation: should not include side conditions",
    ].join("\n"),
    hasAutograder: false,
  });

  assert.ok(lines.includes("status: graded"));
  assert.ok(lines.includes("processing: processed"));
  assert.ok(lines.includes("score: 19 / 20"));
  assert.ok(lines.includes("response:"));
  assert.ok(lines.includes("  5. Semantic Derivation | 3 / 4"));
  assert.ok(!lines.includes("response: none"));
  assert.ok(!lines.includes("autograder: none"));
});

test("formatSubmissionResultLines keeps autograder output readable", () => {
  const lines = formatSubmissionResultLines({
    submissionId: "404008512",
    status: "graded",
    scoreDisplay: "10 / 10",
    hasAutograder: true,
    autograderMessage: [
      "[type_of_expr] basic well-typed | 5 / 5",
      "  1. PASSED",
      "[eval_expr] basic | 5 / 5",
      "  1. PASSED",
    ].join("\n"),
  });

  assert.ok(lines.includes("autograder:"));
  assert.ok(lines.includes("  [type_of_expr] basic well-typed | 5 / 5"));
  assert.ok(lines.includes("  [eval_expr] basic | 5 / 5"));
});
