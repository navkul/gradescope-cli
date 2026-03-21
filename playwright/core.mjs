import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_BASE_URL } from "../src/config.mjs";

const COURSE_SHORT_SELECTOR = ".courseBox--shortname, .courseBox__shortname, .courseShortname";
const COURSE_NAME_SELECTOR = ".courseBox--name, .courseBox__name, .courseName, .course-name";
const DEFAULT_TIMEOUT_MS = 45000;
let playwrightModulePromise;

export async function login(options) {
  return runWithBrowser(options, async ({ browser, baseUrl, sessionFile, timeoutMs }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);

    await page.goto(new URL("/login", baseUrl).toString(), { waitUntil: "domcontentloaded" });
    await waitForNetworkIdle(page);

    await page.locator("input[name='session[email]']").fill(options.email);
    await page.locator("input[name='session[password]']").fill(options.password);

    await Promise.allSettled([
      page.waitForLoadState("domcontentloaded", { timeout: timeoutMs }),
      firstVisible([
        page.locator("button[type='submit']").first(),
        page.locator("input[type='submit']").first(),
      ]).then((locator) => {
        if (!locator) {
          throw new Error("could not find the login submit button");
        }
        return locator.click();
      }),
    ]);

    await waitForNetworkIdle(page);

    if (page.url().includes("/login")) {
      const flash = await firstVisibleText(page, [
        ".alert-error",
        ".alert-flashMessage.alert-error",
        ".flash-error",
        ".error",
      ]);
      throw new Error(flash || "login did not establish an authenticated session");
    }

    await ensureAuthenticated(page, baseUrl);
    await saveStorageState(context, sessionFile);

    return {
      ok: true,
      sessionFile,
      email: options.email,
    };
  });
}

export async function listCourses(options) {
  return withAuthenticatedPage(options, async ({ page, baseUrl }) => {
    await page.goto(new URL("/account", baseUrl).toString(), { waitUntil: "domcontentloaded" });
    await waitForNetworkIdle(page);
    return extractCoursesFromAccountPage(page, baseUrl);
  });
}

export async function listAssignments(options) {
  return withAuthenticatedPage(options, async ({ page, baseUrl }) => {
    const courseId = String(options.courseId || "").trim();
    if (!courseId) {
      throw new Error("missing course ID");
    }

    await page.goto(new URL(`/courses/${courseId}`, baseUrl).toString(), { waitUntil: "domcontentloaded" });
    await waitForNetworkIdle(page);

    const assignments = await extractAssignmentsFromCoursePage(page, courseId, baseUrl);
    if (assignments.length === 0) {
      throw new Error(`no assignments found on course ${courseId}`);
    }
    return assignments;
  });
}

export async function result(options) {
  return withAuthenticatedPage(options, async ({ page, baseUrl }) => {
    const reference = String(options.submission || "").trim();
    if (!reference) {
      throw new Error("missing submission reference");
    }

    const target = resolveSubmissionReference(reference);
    await page.goto(new URL(target, baseUrl).toString(), { waitUntil: "domcontentloaded" });
    await waitForNetworkIdle(page);

    if (!page.url().includes("/submissions/")) {
      throw new Error(`submission ${reference} did not resolve to a submission page`);
    }

    const html = await page.content();
    const bodyText = normalizeWhitespace(await page.locator("body").innerText().catch(() => ""));
    if (!html.includes("AssignmentSubmissionViewer") && !bodyText.includes("Submission") && bodyText.toLowerCase().includes("page you were looking for doesn't exist")) {
      throw new Error(`submission ${reference} was not found`);
    }

    return extractSubmissionResultFromPage(page, page.url());
  });
}

export async function submit(options) {
  return withAuthenticatedPage(options, async ({ page, baseUrl, timeoutMs }) => {
    const courseId = String(options.courseId || "").trim();
    if (!courseId) {
      throw new Error("missing course ID");
    }
    const assignmentHint = String(options.assignment || "").trim();
    if (!String(options.filePath || "").trim()) {
      throw new Error("missing file path");
    }

    await page.goto(new URL(`/courses/${courseId}`, baseUrl).toString(), { waitUntil: "domcontentloaded" });
    await waitForNetworkIdle(page);

    const assignments = await extractAssignmentsFromCoursePage(page, courseId, baseUrl);
    const assignment = resolveAssignment(assignments, assignmentHint);
    if (!assignment) {
      throw new Error(`could not find assignment ${assignmentHint} in course ${courseId}`);
    }

    await openAssignment(page, assignment, timeoutMs);
    await openSubmitFlow(page);
    await chooseVariableLengthPDF(page);
    await attachSubmissionFile(page, options.filePath);
    await submitUpload(page);
    await finalizeIfSelectPages(page);

    if (!page.url().includes("/submissions/")) {
      await page.goto(new URL(`/courses/${courseId}`, baseUrl).toString(), { waitUntil: "domcontentloaded" });
      await waitForNetworkIdle(page);
      const refreshedAssignments = await extractAssignmentsFromCoursePage(page, courseId, baseUrl);
      const refreshedAssignment = resolveAssignment(refreshedAssignments, assignment.id || assignment.title);
      if (refreshedAssignment?.submissionUrl) {
        await page.goto(refreshedAssignment.submissionUrl, { waitUntil: "domcontentloaded" });
        await waitForNetworkIdle(page);
      }
    }

    if (!page.url().includes("/submissions/")) {
      throw new Error(`submit did not reach a submission page; final URL was ${page.url()}`);
    }

    return extractSubmissionResultFromPage(page, page.url());
  });
}

export async function extractCoursesFromAccountPage(page, baseUrl = DEFAULT_BASE_URL) {
  const links = page.locator("a[href]");
  const count = await links.count();
  const seen = new Set();
  const courses = [];

  for (let index = 0; index < count; index += 1) {
    const link = links.nth(index);
    const href = (await link.getAttribute("href")) || "";
    const match = href.match(/^\/courses\/(\d+)$/);
    if (!match) {
      continue;
    }

    const courseId = match[1];
    if (seen.has(courseId)) {
      continue;
    }

    const raw = normalizeWhitespace(await link.innerText().catch(() => ""));
    const short = normalizeWhitespace(await firstVisibleTextFromRoot(link, COURSE_SHORT_SELECTOR));
    let name = normalizeWhitespace(await firstVisibleTextFromRoot(link, COURSE_NAME_SELECTOR));
    if (!name) {
      name = stripLeadingCourseShort(raw, short);
    }
    if (!name) {
      name = raw;
    }

    seen.add(courseId);
    courses.push({
      id: courseId,
      name,
      short: short || firstLine(raw),
      raw,
      url: new URL(href, baseUrl).toString(),
    });
  }

  if (courses.length === 0) {
    throw new Error("no courses found on account page");
  }

  return courses;
}

export async function extractAssignmentsFromCoursePage(page, courseId, baseUrl = DEFAULT_BASE_URL) {
  const rows = page.locator("#assignments-student-table tbody tr");
  const count = await rows.count();
  const assignments = [];
  const seen = new Set();

  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    const title = normalizeWhitespace(await firstVisibleTextFromRoot(row, "th[scope='row'], .assignmentTitle, .table--primaryLink, td"));
    if (!title) {
      continue;
    }

    const links = await row.locator("a[href]").evaluateAll((elements) => {
      return elements.map((element) => ({
        href: element.getAttribute("href") || "",
        text: (element.textContent || "").trim(),
      }));
    }).catch(() => []);

    const assignmentHref = links.find((item) => /\/courses\/\d+\/assignments\/\d+(?:$|\/)/.test(item.href))?.href || "";
    const submissionHref = links.find((item) => /\/courses\/\d+\/assignments\/\d+\/submissions\/\d+/.test(item.href))?.href || "";
    const id = extractAssignmentId(assignmentHref || submissionHref);
    const dedupeKey = id || `${courseId}:${title}`;
    if (seen.has(dedupeKey)) {
      continue;
    }

    const status = normalizeWhitespace(await firstVisibleTextFromRoot(row, ".submissionStatus, .label, .status"));
    seen.add(dedupeKey);
    assignments.push({
      id,
      courseId,
      title,
      status,
      rowIndex: index,
      url: assignmentHref ? new URL(stripToAssignmentPath(assignmentHref), baseUrl).toString() : "",
      submissionUrl: submissionHref ? new URL(submissionHref, baseUrl).toString() : "",
    });
  }

  return assignments;
}

export async function extractSubmissionResultFromPage(page, fallbackUrl) {
  const url = page.url() || fallbackUrl || "";
  const result = {
    submissionId: extractSubmissionId(url),
    url,
    status: "",
    response: "",
    autograderMessage: "",
    hasAutograder: false,
  };

  const reactProps = await page.locator('[data-react-class="AssignmentSubmissionViewer"]').first().getAttribute("data-react-props").catch(() => "");
  if (reactProps) {
    try {
      const parsed = JSON.parse(reactProps);
      if (parsed?.assignment_submission?.id) {
        result.submissionId = String(parsed.assignment_submission.id);
      }
      if (parsed?.assignment_submission?.status) {
        result.status = normalizeWhitespace(parsed.assignment_submission.status);
      }
      if (parsed?.paths?.submission_path) {
        result.url = new URL(parsed.paths.submission_path, url).toString();
      }
      const alertText = normalizeWhitespace(firstNonEmpty(parsed?.alert, ...(parsed?.alerts || [])));
      if (alertText) {
        result.response = alertText;
      }
    } catch {
      // Ignore malformed embedded props and fall back to visible content.
    }
  }

  if (!result.status) {
    result.status = normalizeWhitespace(await firstVisibleText(page, [
      ".submissionStatus",
      ".alert-success",
      "title",
    ]));
  }

  if (!result.response) {
    result.response = normalizeWhitespace(await findSectionText(page, "Response"));
  }
  if (!result.response) {
    result.response = normalizeWhitespace(await firstVisibleText(page, [
      ".submissionBody",
      ".submissionContent",
      ".submission",
    ]));
  }
  if (result.response === result.status) {
    result.response = "";
  }

  result.autograderMessage = normalizeWhitespace(firstNonEmpty(
    await findSectionText(page, "Autograder"),
    await findSectionText(page, "Autograder Output"),
    await findSectionText(page, "Output"),
    await firstVisibleText(page, [
      ".autograderResults",
      ".autograder-output",
      ".autograderOutput",
    ]),
  ));
  result.hasAutograder = Boolean(result.autograderMessage);

  return result;
}

export function resolveSubmissionReference(reference) {
  const value = String(reference || "").trim();
  if (value.includes("/submissions/")) {
    return value;
  }
  return `/submissions/${value}`;
}

export function extractAssignmentId(value) {
  return String(value || "").match(/\/assignments\/(\d+)/)?.[1] || "";
}

export function extractSubmissionId(value) {
  return String(value || "").match(/\/submissions\/(\d+)/)?.[1] || "";
}

export function normalizeWhitespace(value) {
  return String(value || "").trim().split(/\s+/).filter(Boolean).join(" ");
}

export function firstLine(value) {
  return String(value || "").split("\n").map(normalizeWhitespace).find(Boolean) || "";
}

export function stripLeadingCourseShort(raw, short) {
  const normalizedRaw = normalizeWhitespace(raw);
  const normalizedShort = normalizeWhitespace(short);
  if (!normalizedRaw || !normalizedShort) {
    return normalizedRaw;
  }

  if (!normalizedRaw.toLowerCase().startsWith(normalizedShort.toLowerCase())) {
    return normalizedRaw;
  }

  return normalizedRaw.slice(normalizedShort.length).replace(/^[-|:\s]+/, "").trim();
}

async function runWithBrowser(options, callback) {
  const baseUrl = String(options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const sessionFile = path.resolve(String(options.sessionFile || ""));
  const timeoutMs = Number.parseInt(String(options.timeoutMs || DEFAULT_TIMEOUT_MS), 10) || DEFAULT_TIMEOUT_MS;
  const headless = resolveHeadless(options.headless);

  let browser;
  try {
    browser = await launchChromium(headless);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`could not launch Chromium. Run \`playwright install chromium\` if the browser is missing. ${message}`);
  }

  try {
    return await callback({
      browser,
      baseUrl,
      sessionFile,
      timeoutMs,
      headless,
    });
  } finally {
    await browser.close();
  }
}

async function withAuthenticatedPage(options, callback) {
  return runWithBrowser(options, async ({ browser, baseUrl, sessionFile, timeoutMs }) => {
    await fs.access(sessionFile).catch(() => {
      throw new Error(`no saved session at ${sessionFile}; run \`gradescope-cli login\` first`);
    });

    const context = await browser.newContext({ storageState: sessionFile });
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);
    await page.goto(new URL("/account", baseUrl).toString(), { waitUntil: "domcontentloaded" });
    await waitForNetworkIdle(page);
    await ensureAuthenticated(page);

    try {
      const result = await callback({
        page,
        context,
        baseUrl,
        sessionFile,
        timeoutMs,
      });
      await saveStorageState(context, sessionFile);
      return result;
    } finally {
      await context.close();
    }
  });
}

async function saveStorageState(context, sessionFile) {
  await fs.mkdir(path.dirname(sessionFile), { recursive: true });
  await context.storageState({ path: sessionFile });
}

async function ensureAuthenticated(page) {
  if (page.url().includes("/login")) {
    throw new Error("saved session is not authenticated; run `gradescope-cli login` first");
  }
}

async function waitForNetworkIdle(page) {
  try {
    await page.waitForLoadState("networkidle", { timeout: 15000 });
  } catch {
    // Gradescope keeps some background traffic open.
  }
}

async function openAssignment(page, assignment, timeoutMs) {
  if (assignment.url) {
    await page.goto(assignment.url, { waitUntil: "domcontentloaded" });
    await waitForNetworkIdle(page);
    return;
  }

  const row = page.locator("#assignments-student-table tbody tr").nth(assignment.rowIndex);
  const opener = await firstVisible([
    row.locator("a").first(),
    row.getByRole("button", { name: /submit|resubmit/i }).first(),
    row.getByRole("link", { name: /submit|resubmit/i }).first(),
  ]);
  if (!opener) {
    throw new Error(`could not open assignment "${assignment.title}" from the course page`);
  }

  await Promise.allSettled([
    page.waitForLoadState("domcontentloaded", { timeout: timeoutMs }),
    opener.click(),
  ]);
  await waitForNetworkIdle(page);
}

async function openSubmitFlow(page) {
  if (await hasVisibleFileInput(page)) {
    return;
  }

  const opener = await firstVisible([
    page.locator(".js-submitAssignment").first(),
    page.getByRole("button", { name: /^(resubmit|submit)$/i }).first(),
    page.getByRole("link", { name: /^(resubmit|submit)$/i }).first(),
  ]);

  if (!opener) {
    throw new Error(`could not find a Submit or Resubmit control on ${page.url()}`);
  }

  await clickAndSettle(page, opener);
}

async function chooseVariableLengthPDF(page) {
  const pdfChoice = await firstVisible([
    page.locator("#submit-variable-length-pdf").first(),
    page.getByRole("button", { name: /submit pdf/i }).first(),
  ]);

  if (pdfChoice) {
    await clickAndSettle(page, pdfChoice);
  }
}

async function attachSubmissionFile(page, filePath) {
  const input = await firstVisible([
    page.locator("#submission_pdf_attachment").first(),
    page.locator("#submission_file").first(),
    page.locator("input[type=file]").first(),
  ]);

  if (!input) {
    throw new Error(`could not find a file input after opening the submit flow at ${page.url()}`);
  }

  await input.setInputFiles(filePath);
}

async function submitUpload(page) {
  const submitter = await firstVisible([
    page.locator("#submit-fixed-length-form input[type=submit]").first(),
    page.locator(".js-submitTypedDocumentForm input[type=submit]").first(),
    page.getByRole("button", { name: /^(upload|submit assignment|submit)$/i }).first(),
    page.locator("input[type=submit][value*='Upload'], input[type=submit][value*='Submit']").first(),
  ]);

  if (!submitter) {
    throw new Error(`could not find the final upload button at ${page.url()}`);
  }

  await clickAndSettle(page, submitter);
}

async function finalizeIfSelectPages(page) {
  if (!page.url().includes("/select_pages")) {
    return;
  }

  const finalize = await firstVisible([
    page.getByRole("button", { name: /submit assignment/i }).first(),
    page.getByRole("button", { name: /^submit$/i }).first(),
    page.locator("input[type=submit][value*='Submit']").first(),
  ]);

  if (!finalize) {
    throw new Error(`upload reached ${page.url()}, but no final Submit button was visible`);
  }

  await clickAndSettle(page, finalize);
}

async function hasVisibleFileInput(page) {
  return Boolean(await firstVisible([
    page.locator("#submission_pdf_attachment").first(),
    page.locator("#submission_file").first(),
    page.locator("input[type=file]").first(),
  ]));
}

async function clickAndSettle(page, locator) {
  await Promise.allSettled([
    page.waitForLoadState("domcontentloaded", { timeout: 15000 }),
    locator.click(),
  ]);
  await waitForNetworkIdle(page);
}

async function firstVisible(locators) {
  for (const locator of locators) {
    try {
      if ((await locator.count()) > 0 && await locator.isVisible()) {
        return locator;
      }
    } catch {
      // Ignore transient visibility errors while the page settles.
    }
  }
  return null;
}

async function firstVisibleText(page, selectors) {
  for (const selector of selectors) {
    const text = normalizeWhitespace(await page.locator(selector).first().innerText().catch(() => ""));
    if (text) {
      return text;
    }
  }
  return "";
}

async function firstVisibleTextFromRoot(root, selector) {
  return normalizeWhitespace(await root.locator(selector).first().innerText().catch(() => ""));
}

async function findSectionText(page, headingText) {
  const headings = page.locator("h1, h2, h3, h4, h5, h6");
  const count = await headings.count();
  const needle = headingText.toLowerCase();

  for (let index = 0; index < count; index += 1) {
    const heading = headings.nth(index);
    const headingValue = normalizeWhitespace(await heading.innerText().catch(() => ""));
    if (!headingValue || !headingValue.toLowerCase().includes(needle)) {
      continue;
    }

    const text = await heading.evaluate((node) => {
      const values = [];
      let sibling = node.nextElementSibling;
      while (sibling) {
        if (/^H[1-6]$/.test(sibling.tagName)) {
          break;
        }
        const value = (sibling.textContent || "").trim();
        if (value) {
          values.push(value);
        }
        sibling = sibling.nextElementSibling;
      }
      return values.join(" ");
    }).catch(() => "");

    if (normalizeWhitespace(text)) {
      return normalizeWhitespace(text);
    }
  }

  return "";
}

function resolveAssignment(assignments, hint) {
  if (!hint) {
    return null;
  }

  const normalizedHint = normalizeWhitespace(hint).toLowerCase();
  return assignments.find((assignment) => {
    return assignment.id === hint || normalizeWhitespace(assignment.title).toLowerCase() === normalizedHint;
  }) || null;
}

function stripToAssignmentPath(href) {
  const match = String(href || "").match(/(\/courses\/\d+\/assignments\/\d+)/);
  return match?.[1] || href;
}

function firstNonEmpty(...values) {
  return values.map(normalizeWhitespace).find(Boolean) || "";
}

function resolveHeadless(option) {
  if (typeof option === "boolean") {
    return option;
  }

  const env = String(process.env.GRADESCOPE_HEADLESS || "").toLowerCase();
  if (env === "0" || env === "false" || env === "no") {
    return false;
  }

  return true;
}

async function launchChromium(headless) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || "0";
  if (!playwrightModulePromise) {
    playwrightModulePromise = import("playwright");
  }
  const { chromium } = await playwrightModulePromise;
  return chromium.launch({ headless });
}
