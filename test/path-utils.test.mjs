import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { extractAssignmentId, extractSubmissionId, normalizeWhitespace, resolveSubmissionReference, stripLeadingCourseShort } from "../playwright/core.mjs";
import { resolveUploadPath } from "../src/path-utils.mjs";

test("resolveUploadPath uses the current directory as the prefix for relative files", () => {
  const cwd = path.join("/tmp", "repo");
  const resolved = resolveUploadPath("submissions/hw1.pdf", cwd);
  assert.equal(resolved.absolutePath, path.join(cwd, "submissions", "hw1.pdf"));
  assert.equal(resolved.displayPath, path.join("submissions", "hw1.pdf"));
});

test("resolveSubmissionReference preserves nested submission paths", () => {
  assert.equal(
    resolveSubmissionReference("/courses/1/assignments/2/submissions/3"),
    "/courses/1/assignments/2/submissions/3",
  );
  assert.equal(resolveSubmissionReference("3"), "/submissions/3");
});

test("extractAssignmentId and extractSubmissionId parse nested Gradescope URLs", () => {
  assert.equal(extractAssignmentId("/courses/1/assignments/22/submissions/9"), "22");
  assert.equal(extractSubmissionId("/courses/1/assignments/22/submissions/9"), "9");
});

test("normalizeWhitespace and stripLeadingCourseShort keep course labels readable", () => {
  assert.equal(normalizeWhitespace("  CS101   Intro \n to Testing "), "CS101 Intro to Testing");
  assert.equal(stripLeadingCourseShort("CS101 | Intro to Testing", "CS101"), "Intro to Testing");
});
