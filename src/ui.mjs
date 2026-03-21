import readline from "node:readline/promises";

export async function promptLine(prompt) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await rl.question(prompt);
    return answer.trim();
  } finally {
    rl.close();
  }
}

export function promptSecret(prompt) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    return promptLine(prompt);
  }

  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    let value = "";

    function cleanup() {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      stdout.write("\n");
    }

    function onData(chunk) {
      const text = String(chunk);
      for (const char of text) {
        if (char === "\u0003") {
          cleanup();
          reject(new Error("prompt cancelled"));
          return;
        }
        if (char === "\r" || char === "\n") {
          cleanup();
          resolve(value.trim());
          return;
        }
        if (char === "\u007f") {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    }

    stdout.write(prompt);
    stdin.resume();
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.on("data", onData);
  });
}

export async function promptSelection(prompt, items, formatter = (item) => item) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("no choices available");
  }

  console.log(prompt);
  items.forEach((item, index) => {
    console.log(`  ${index + 1}. ${formatter(item)}`);
  });

  const answer = await promptLine("Enter number: ");
  const selected = Number.parseInt(answer, 10);
  if (!Number.isInteger(selected) || selected < 1 || selected > items.length) {
    throw new Error("invalid selection");
  }

  return items[selected - 1];
}

export function printCourses(courses) {
  for (const course of courses) {
    const label = course.short && course.short !== course.name
      ? `${course.short} | ${course.name}`
      : course.name;
    console.log(`${course.id}\t${label}`);
  }
}

export function printAssignments(assignments) {
  for (const assignment of assignments) {
    const id = assignment.id || "-";
    if (assignment.status) {
      console.log(`${id}\t${assignment.title}\t${assignment.status}`);
      continue;
    }
    console.log(`${id}\t${assignment.title}`);
  }
}

export function printSubmissionResult(result) {
  if (result.submissionId) {
    console.log(`submission: ${result.submissionId}`);
  }
  if (result.url) {
    console.log(`url: ${result.url}`);
  }
  if (result.status) {
    console.log(`status: ${result.status}`);
  }
  if (result.response) {
    console.log(`response: ${result.response}`);
  } else {
    console.log("response: none");
  }
  if (result.hasAutograder) {
    console.log(`autograder: ${result.autograderMessage}`);
  } else {
    console.log("autograder: none");
  }
}
