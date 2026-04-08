import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSubmissionType,
  resolveSubmissionType,
  submissionTypeLabel,
} from "../src/submission-options.mjs";

test("normalizeSubmissionType accepts upload aliases and github", () => {
  assert.equal(normalizeSubmissionType("upload"), "upload");
  assert.equal(normalizeSubmissionType("files"), "upload");
  assert.equal(normalizeSubmissionType("github"), "github");
  assert.equal(normalizeSubmissionType(""), "");
});

test("resolveSubmissionType infers upload from file paths", () => {
  assert.equal(resolveSubmissionType({
    filePaths: ["main.py", "utils.py"],
  }), "upload");
});

test("resolveSubmissionType infers github from repo and branch", () => {
  assert.equal(resolveSubmissionType({
    repo: "owner/project",
    branch: "main",
  }), "github");
});

test("resolveSubmissionType rejects mixed upload and github inputs", () => {
  assert.throws(() => resolveSubmissionType({
    submissionType: "upload",
    filePaths: ["main.py"],
    repo: "owner/project",
  }), /cannot mix/i);
});

test("submissionTypeLabel returns user-facing labels", () => {
  assert.equal(submissionTypeLabel("upload"), "Upload");
  assert.equal(submissionTypeLabel("github"), "GitHub");
});
