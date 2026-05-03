import * as httpBackend from "./http-core.mjs";
import * as playwrightBackend from "../playwright/core.mjs";

const BACKENDS = new Map([
  ["http", httpBackend],
  ["playwright", playwrightBackend],
]);

export function resolveBackendName(command, options = {}) {
  const explicit = normalizeBackendName(options.backend || process.env.GRADESCOPE_BACKEND);
  if (explicit) {
    return explicit;
  }

  if (command === "submit" || command === "wizard" || command === "run") {
    return "playwright";
  }

  return "http";
}

export function getBackend(command, options = {}) {
  const backendName = resolveBackendName(command, options);
  const backend = BACKENDS.get(backendName);
  if (!backend) {
    throw new Error(`unsupported backend "${backendName}"; expected http or playwright`);
  }
  return backend;
}

function normalizeBackendName(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return "";
  }
  if (normalized === "browser" || normalized === "playwrite") {
    return "playwright";
  }
  if (normalized === "fast") {
    return "http";
  }
  if (normalized === "http" || normalized === "playwright") {
    return normalized;
  }
  throw new Error(`unsupported backend "${value}"; expected http or playwright`);
}
