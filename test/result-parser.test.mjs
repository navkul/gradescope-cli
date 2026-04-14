import test from "node:test";
import assert from "node:assert/strict";
import { parseSubmissionReactProps } from "../playwright/core.mjs";

test("parseSubmissionReactProps extracts rubric feedback from graded written submissions", () => {
  const result = parseSubmissionReactProps({
    assignment: {
      id: 7869354,
      title: "Mini-Project 1 Check-in (Written)",
      total_points: "20.0",
      submission_format: "variable_length",
    },
    assignment_submission: {
      id: 400921750,
      status: "processed",
      score: "19.0",
      lateness_in_words: null,
    },
    grades_visible: true,
    paths: {
      course_path: "/courses/1222812",
      submission_path: "/courses/1222812/assignments/7869354/submissions/400921750",
    },
    questions: [
      { id: 1, title: "Parse Tree (Review)", full_index: "1", weight: "4.0" },
      { id: 5, title: "Semantic Derivation", full_index: "5", weight: "4.0" },
    ],
    question_submissions: [
      { question_id: 1, score: "4.0", evaluations: [], annotations: [] },
      {
        question_id: 5,
        score: "3.0",
        evaluations: [],
        annotations: [
          { content: "should not include side conditions" },
        ],
      },
    ],
    rubric_items: [
      {
        question_id: 1,
        description: "Correct",
        weight: "0.0",
        present: true,
      },
      {
        question_id: 5,
        description: "Minor error\n\n* Missing rule names\n* included side conditions",
        weight: "1.0",
        present: true,
      },
    ],
  }, {
    pageUrl: "https://www.gradescope.com/courses/1222812/assignments/7869354/submissions/400921750",
  });

  assert.equal(result.status, "graded");
  assert.equal(result.processingStatus, "processed");
  assert.equal(result.scoreDisplay, "19 / 20");
  assert.equal(result.assignmentTitle, "Mini-Project 1 Check-in (Written)");
  assert.equal(result.responseKind, "feedback");
  assert.match(result.response, /1\. Parse Tree \(Review\) \| 4 \/ 4/);
  assert.match(result.response, /5\. Semantic Derivation \| 3 \/ 4/);
  assert.match(result.response, /rubric: Minor error \| 1 pt/);
  assert.match(result.response, /Missing rule names/);
  assert.match(result.response, /annotation: should not include side conditions/);
});

test("parseSubmissionReactProps extracts autograder test output from programming submissions", () => {
  const result = parseSubmissionReactProps({
    assignment: {
      id: 7945042,
      title: "Mini-Project 2 Check-in (Programming)",
      total_points: "10.0",
      submission_format: "code",
    },
    assignment_submission: {
      id: 404008512,
      status: "processed",
      score: "10.0",
      lateness_in_words: null,
    },
    grades_visible: true,
    paths: {
      course_path: "/courses/1222812",
      submission_path: "/courses/1222812/assignments/7945042/submissions/404008512",
    },
    questions: [
      { id: 9, title: "Autograder", full_index: "1", weight: "10.0" },
    ],
    question_submissions: [
      { question_id: 9, score: "10.0", evaluations: [], annotations: [] },
    ],
    autograder_results: {
      tests: [
        {
          name: "[type_of_expr] basic well-typed",
          score: 5,
          max_score: 5,
          output: "1. PASSED\n2. PASSED",
        },
        {
          name: "[eval_expr] basic",
          score: 5,
          max_score: 5,
          output: "1. PASSED\n2. PASSED\n3. PASSED",
        },
      ],
    },
  }, {
    pageUrl: "https://www.gradescope.com/courses/1222812/assignments/7945042/submissions/404008512",
  });

  assert.equal(result.status, "graded");
  assert.equal(result.scoreDisplay, "10 / 10");
  assert.equal(result.response, "");
  assert.equal(result.hasAutograder, true);
  assert.equal(result.autograderResults.length, 2);
  assert.match(result.autograderMessage, /\[type_of_expr\] basic well-typed \| 5 \/ 5/);
  assert.match(result.autograderMessage, /1\. PASSED/);
  assert.match(result.autograderMessage, /\[eval_expr\] basic \| 5 \/ 5/);
});

test("parseSubmissionReactProps preserves submission details for ungraded online work", () => {
  const result = parseSubmissionReactProps({
    assignment: {
      id: 7503615,
      title: "Course Manual Signature",
      total_points: "0.0",
      submission_format: "online",
    },
    assignment_submission: {
      id: 383389489,
      status: "unprocessed",
      lateness_in_words: "15 Hours, 47 Minutes Late",
    },
    grades_visible: false,
    paths: {
      course_path: "/courses/1222812",
      submission_path: "/courses/1222812/assignments/7503615/submissions/383389489",
    },
    questions: [
      { id: 3, title: "Course Manual Signature", full_index: "1", weight: "0.0" },
    ],
    question_submissions: [
      {
        question_id: 3,
        answers: {
          0: ["I have read the course manual, completed the week 0 checklist, and agree with the terms therein"],
        },
        evaluations: [],
        annotations: [],
      },
    ],
  }, {
    pageUrl: "https://www.gradescope.com/courses/1222812/assignments/7503615/submissions/383389489",
  });

  assert.equal(result.status, "ungraded");
  assert.equal(result.processingStatus, "unprocessed");
  assert.equal(result.scoreDisplay, "");
  assert.equal(result.lateness, "15 Hours, 47 Minutes Late");
  assert.equal(result.responseKind, "submission");
  assert.match(result.response, /1\. Course Manual Signature/);
  assert.match(result.response, /answer: I have read the course manual/);
});
