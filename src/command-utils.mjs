import { defaultBaseUrl, defaultSessionPath } from "./config.mjs";

const MULTI_VALUE_OPTIONS = new Set([
  "file",
]);

export function parseArgs(argv) {
  const args = [...argv];
  let command = "";
  if (args[0]) {
    if (isHelpToken(args[0])) {
      command = "help";
      args.shift();
    } else if (!args[0].startsWith("-")) {
      command = args.shift();
    }
  }

  const options = {};
  const positionals = [];

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const [name, inlineValue] = token.slice(2).split("=", 2);
    const optionKey = toCamelCase(name);
    if (inlineValue !== undefined) {
      assignOption(options, optionKey, inlineValue);
      continue;
    }

    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      assignOption(options, optionKey, next);
      index += 1;
      continue;
    }

    assignOption(options, optionKey, true);
  }

  return { command, options, positionals };
}

export function commonOptions(options) {
  return {
    baseUrl: options.baseUrl || defaultBaseUrl(),
    sessionFile: options.sessionFile || defaultSessionPath(),
    headless: options.headful ? false : undefined,
  };
}

export function firstPositional(parsed, index) {
  return String(parsed.positionals[index] || "").trim();
}

export function isHelpToken(value) {
  return value === "--help" || value === "-h";
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function assignOption(options, key, value) {
  if (!MULTI_VALUE_OPTIONS.has(key)) {
    options[key] = value;
    return;
  }

  if (options[key] === undefined) {
    options[key] = value;
    return;
  }

  options[key] = Array.isArray(options[key])
    ? [...options[key], value]
    : [options[key], value];
}
