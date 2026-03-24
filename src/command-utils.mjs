import { defaultBaseUrl, defaultSessionPath } from "./config.mjs";

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
    if (inlineValue !== undefined) {
      options[toCamelCase(name)] = inlineValue;
      continue;
    }

    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      options[toCamelCase(name)] = next;
      index += 1;
      continue;
    }

    options[toCamelCase(name)] = true;
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
