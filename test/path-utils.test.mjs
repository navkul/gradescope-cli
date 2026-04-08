import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  extractAssignmentId,
  extractSubmissionId,
  formatChromiumLaunchError,
  isMissingBrowserExecutableError,
  normalizeWhitespace,
  resolveSubmissionReference,
  stripLeadingCourseShort,
} from "../playwright/core.mjs";
import { resolveUploadPath, resolveUploadPaths } from "../src/path-utils.mjs";

test("resolveUploadPath uses the current directory as the prefix for relative files", () => {
  const cwd = path.join("/tmp", "repo");
  const resolved = resolveUploadPath("submissions/hw1.pdf", cwd);
  assert.equal(resolved.absolutePath, path.join(cwd, "submissions", "hw1.pdf"));
  assert.equal(resolved.displayPath, path.join("submissions", "hw1.pdf"));
});

test("resolveUploadPaths preserves multiple upload files in order", () => {
  const cwd = path.join("/tmp", "repo");
  const resolved = resolveUploadPaths(["src/main.py", "README.md"], cwd);
  assert.equal(resolved.length, 2);
  assert.equal(resolved[0].absolutePath, path.join(cwd, "src", "main.py"));
  assert.equal(resolved[1].displayPath, "README.md");
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

test("isMissingBrowserExecutableError detects Playwright missing-browser failures", () => {
  const error = new Error("browserType.launch: Executable doesn't exist at /tmp/chrome");
  assert.equal(isMissingBrowserExecutableError(error), true);
  assert.equal(isMissingBrowserExecutableError(new Error("browserType.launch: Target page closed")), false);
});

test("formatChromiumLaunchError only suggests install steps for missing-browser failures", () => {
  const missing = new Error("browserType.launch: Executable doesn't exist at /tmp/chrome");
  const crash = new Error("browserType.launch: Target page, context or browser has been closed");

  assert.match(formatChromiumLaunchError(missing), /browser executable is missing/i);
  assert.match(formatChromiumLaunchError(missing), /playwright install chromium/);
  assert.doesNotMatch(formatChromiumLaunchError(crash), /playwright install chromium/);
});
