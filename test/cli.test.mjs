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
