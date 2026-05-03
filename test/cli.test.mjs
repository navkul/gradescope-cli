import test from "node:test";
import assert from "node:assert/strict";
import { parseCliArgs } from "../src/cli.mjs";

test("parseCliArgs maps top-level help flags to the help command", () => {
  assert.equal(parseCliArgs(["--help"]).command, "help");
  assert.equal(parseCliArgs(["-h"]).command, "help");
});

test("parseCliArgs preserves explicit subcommands", () => {
  const parsed = parseCliArgs(["submit", "./submission.pdf", "--course", "123"]);
  assert.equal(parsed.command, "submit");
  assert.deepEqual(parsed.positionals, ["./submission.pdf"]);
  assert.equal(parsed.options.course, "123");
});

test("parseCliArgs keeps multiple submit files and submission-type options", () => {
  const parsed = parseCliArgs(["submit", "./main.py", "./utils.py", "--submission-type", "upload"]);
  assert.equal(parsed.command, "submit");
  assert.deepEqual(parsed.positionals, ["./main.py", "./utils.py"]);
  assert.equal(parsed.options.submissionType, "upload");
});

test("parseCliArgs preserves repeated --file values", () => {
  const parsed = parseCliArgs(["submit", "--file", "./main.py", "--file", "./utils.py"]);
  assert.equal(parsed.command, "submit");
  assert.deepEqual(parsed.options.file, ["./main.py", "./utils.py"]);
});

test("parseCliArgs accepts wait-for-response on submit", () => {
  const parsed = parseCliArgs(["submit", "--wait-for-response"]);
  assert.equal(parsed.command, "submit");
  assert.equal(parsed.options.waitForResponse, true);
});

test("parseCliArgs accepts course and assignment flags on result", () => {
  const parsed = parseCliArgs(["result", "--course", "CS101", "--assignment", "Homework 1"]);
  assert.equal(parsed.command, "result");
  assert.equal(parsed.options.course, "CS101");
  assert.equal(parsed.options.assignment, "Homework 1");
});

test("parseCliArgs accepts explicit backend selection", () => {
  const parsed = parseCliArgs(["classes", "--backend", "playwright"]);
  assert.equal(parsed.command, "classes");
  assert.equal(parsed.options.backend, "playwright");
});
