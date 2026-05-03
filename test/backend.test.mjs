import test from "node:test";
import assert from "node:assert/strict";
import { resolveBackendName } from "../src/backend.mjs";

test("resolveBackendName defaults read-only commands to http", () => {
  assert.equal(resolveBackendName("login", {}), "http");
  assert.equal(resolveBackendName("classes", {}), "http");
  assert.equal(resolveBackendName("assignments", {}), "http");
  assert.equal(resolveBackendName("result", {}), "http");
});

test("resolveBackendName defaults submit flows to playwright", () => {
  assert.equal(resolveBackendName("submit", {}), "playwright");
  assert.equal(resolveBackendName("wizard", {}), "playwright");
  assert.equal(resolveBackendName("run", {}), "playwright");
});

test("resolveBackendName accepts explicit backend aliases", () => {
  assert.equal(resolveBackendName("submit", { backend: "http" }), "http");
  assert.equal(resolveBackendName("classes", { backend: "playwright" }), "playwright");
  assert.equal(resolveBackendName("classes", { backend: "fast" }), "http");
  assert.equal(resolveBackendName("classes", { backend: "browser" }), "playwright");
});

test("resolveBackendName rejects unsupported backends", () => {
  assert.throws(() => resolveBackendName("classes", { backend: "other" }), /unsupported backend/);
});
