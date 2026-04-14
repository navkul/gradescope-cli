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

export async function promptUploadPaths() {
  const values = [];

  while (true) {
    const prompt = values.length === 0
      ? "File path to submit: "
      : `File path ${values.length + 1} (leave blank to finish): `;
    const answer = await promptLine(prompt);
    if (!answer) {
      if (values.length === 0) {
        throw new Error("at least one file path is required for upload submissions");
      }
      return values;
    }

    values.push(answer);
  }
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
  for (const line of formatSubmissionResultLines(result)) {
    console.log(line);
  }
}

export function formatSubmissionResultLines(result) {
  const lines = [];

  if (result.courseId || result.courseName) {
    const label = result.courseName
      ? `${result.courseId || "-"} | ${result.courseName}`
      : result.courseId;
    lines.push(`course: ${label}`);
  }
  if (result.assignmentId || result.assignmentTitle) {
    const label = result.assignmentTitle
      ? `${result.assignmentId || "-"} | ${result.assignmentTitle}`
      : result.assignmentId;
    lines.push(`assignment: ${label}`);
  }
  if (result.submissionId) {
    lines.push(`submission: ${result.submissionId}`);
  }
  if (result.url) {
    lines.push(`url: ${result.url}`);
  }
  if (result.status) {
    lines.push(`status: ${result.status}`);
  }
  if (result.processingStatus && result.processingStatus !== result.status) {
    lines.push(`processing: ${result.processingStatus}`);
  }
  if (result.scoreDisplay) {
    lines.push(`score: ${result.scoreDisplay}`);
  }
  if (result.lateness) {
    lines.push(`lateness: ${result.lateness}`);
  }
  if (result.notice) {
    lines.push(...formatSection("notice", result.notice));
  }
  if (result.response) {
    lines.push(...formatSection("response", result.response));
  }
  if (result.hasAutograder) {
    lines.push(...formatSection("autograder", result.autograderMessage));
  }

  return lines;
}

function formatSection(label, value) {
  const text = String(value || "").trim();
  if (!text) {
    return [];
  }

  const body = text.split("\n").map((line) => `  ${line}`);
  return [`${label}:`, ...body];
}
