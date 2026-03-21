import os from "node:os";
import path from "node:path";

export const DEFAULT_BASE_URL = "https://www.gradescope.com";

export function appConfigDir() {
  if (process.env.GRADESCOPE_CONFIG_DIR) {
    return path.resolve(process.env.GRADESCOPE_CONFIG_DIR);
  }

  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "gradescope-cli");
  }

  if (process.platform === "win32" && process.env.APPDATA) {
    return path.join(process.env.APPDATA, "gradescope-cli");
  }

  if (process.env.XDG_CONFIG_HOME) {
    return path.join(process.env.XDG_CONFIG_HOME, "gradescope-cli");
  }

  return path.join(os.homedir(), ".config", "gradescope-cli");
}

export function defaultSessionPath() {
  return path.join(appConfigDir(), "session.json");
}

export function defaultDebugDir() {
  return path.join(appConfigDir(), "debug");
}

export function defaultBaseUrl() {
  return process.env.GRADESCOPE_BASE_URL || DEFAULT_BASE_URL;
}
