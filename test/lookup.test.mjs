import test from "node:test";
import assert from "node:assert/strict";
import {
  assignmentCompletionValues,
  courseCompletionValues,
  filterSuggestions,
  resolveAssignment,
  resolveCourse,
} from "../src/lookup.mjs";

test("resolveCourse matches course id, exact name, and exact short name", () => {
  const courses = [
    { id: "123", short: "CS101", name: "Intro to Testing" },
    { id: "456", short: "MATH200", name: "Linear Algebra" },
  ];

  assert.equal(resolveCourse(courses, "123")?.id, "123");
  assert.equal(resolveCourse(courses, "cs101")?.id, "123");
  assert.equal(resolveCourse(courses, "intro to testing")?.id, "123");
  assert.equal(resolveCourse(courses, "intro")?.id, undefined);
});

test("resolveAssignment matches assignment id and exact title case-insensitively", () => {
  const assignments = [
    { id: "88", title: "Homework 1" },
    { id: "", title: "Final Project Proposal" },
  ];

  assert.equal(resolveAssignment(assignments, "88")?.title, "Homework 1");
  assert.equal(resolveAssignment(assignments, "final project proposal")?.title, "Final Project Proposal");
  assert.equal(resolveAssignment(assignments, "proposal")?.title, undefined);
});

test("completion helpers dedupe values and filter by normalized prefixes", () => {
  const courseValues = courseCompletionValues({
    id: "123",
    short: "CS101",
    name: "Intro to Testing",
  });
  const assignmentValues = assignmentCompletionValues({
    id: "",
    title: "Homework 1",
  });

  assert.deepEqual(courseValues, ["123", "CS101", "Intro to Testing"]);
  assert.deepEqual(assignmentValues, ["Homework 1"]);
  assert.deepEqual(filterSuggestions([...courseValues, "CS101"], "cs"), ["CS101"]);
});
