import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { DEFAULT_BASE_URL } from "../src/config.mjs";
import { resolveAssignment } from "../src/lookup.mjs";
import {
  normalizeStringList,
  resolveSubmissionType,
  submissionTypeLabel,
} from "../src/submission-options.mjs";

const COURSE_SHORT_SELECTOR = ".courseBox--shortname, .courseBox__shortname, .courseShortname";
const COURSE_NAME_SELECTOR = ".courseBox--name, .courseBox__name, .courseName, .course-name";
const DEFAULT_TIMEOUT_MS = 45000;
const CHOICE_CONTROL_SELECTOR = [
  "select",
  "[role='combobox']",
  "button[aria-haspopup='listbox']",
  "div[aria-haspopup='listbox']",
  ".Select-control",
  ".select__control",
].join(", ");
const CHOICE_OPTION_SELECTOR = [
  "[role='option']",
  ".Select-option",
  ".select__option",
  "[role='listbox'] li",
  "[role='listbox'] button",
].join(", ");
let playwrightModulePromise;
const require = createRequire(import.meta.url);

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

export async function listSubmissionTypes(options) {
  return withAuthenticatedPage(options, async ({ page, baseUrl, timeoutMs }) => {
    await prepareAssignmentSubmitFlow(page, baseUrl, options, timeoutMs);
    return detectAvailableSubmissionTypes(page);
  });
}

export async function listGitHubRepositories(options) {
  return withAuthenticatedPage(options, async ({ page, baseUrl, timeoutMs }) => {
    debugLog("listGitHubRepositories:start");
    await prepareAssignmentSubmitFlow(page, baseUrl, options, timeoutMs);
    debugLog("listGitHubRepositories:submit-flow-ready", page.url());
    await switchSubmissionType(page, "github");
    debugLog("listGitHubRepositories:github-ready", page.url());
    return listGitHubChoices(page, "repository");
  });
}

export async function listGitHubBranches(options) {
  return withAuthenticatedPage(options, async ({ page, baseUrl, timeoutMs }) => {
    const repo = String(options.repo || "").trim();
    if (!repo) {
      throw new Error("missing GitHub repository");
    }

    await prepareAssignmentSubmitFlow(page, baseUrl, options, timeoutMs);
    await switchSubmissionType(page, "github");
    await selectGitHubChoice(page, "repository", repo);
    return listGitHubChoices(page, "branch");
  });
}

export async function submit(options) {
  return withAuthenticatedPage(options, async ({ page, baseUrl, timeoutMs }) => {
    const courseId = String(options.courseId || "").trim();
    if (!courseId) {
      throw new Error("missing course ID");
    }
    const assignmentHint = String(options.assignment || "").trim();
    const submissionType = resolveSubmissionType({
      submissionType: options.submissionType,
      filePaths: options.filePaths || options.filePath,
      repo: options.repo,
      branch: options.branch,
    });
    if (!submissionType) {
      throw new Error("missing submission type or submit input");
    }

    const filePaths = normalizeStringList(options.filePaths || options.filePath);

    const assignment = await prepareAssignmentSubmitFlow(page, baseUrl, options, timeoutMs);

    if (submissionType === "upload") {
      if (filePaths.length === 0) {
        throw new Error("missing file path");
      }

      await switchSubmissionType(page, "upload");
      await chooseVariableLengthPDF(page);
      await attachSubmissionFiles(page, filePaths);
      await submitCurrentSubmission(page);
      await finalizeIfSelectPages(page);
    } else if (submissionType === "github") {
      const repo = String(options.repo || "").trim();
      const branch = String(options.branch || "").trim();
      if (!repo) {
        throw new Error("missing GitHub repository");
      }
      if (!branch) {
        throw new Error("missing GitHub branch");
      }

      await switchSubmissionType(page, "github");
      await selectGitHubChoice(page, "repository", repo);
      await selectGitHubChoice(page, "branch", branch);
      await submitCurrentSubmission(page);
    } else {
      throw new Error(`unsupported submission type "${submissionType}"`);
    }

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
    const submitButtons = await row.locator(".js-submitAssignment, [data-assignment-id]").evaluateAll((elements) => {
      return elements.slice(0, 1).map((element) => ({
        assignmentId: element.getAttribute("data-assignment-id") || "",
        postUrl: element.getAttribute("data-post-url") || "",
      }));
    }).catch(() => []);
    const submitAssignmentId = submitButtons[0]?.assignmentId || "";
    const submitPostUrl = submitButtons[0]?.postUrl || "";

    const assignmentHref = links.find((item) => /\/courses\/\d+\/assignments\/\d+(?:$|\/)/.test(item.href))?.href || "";
    const submissionHref = links.find((item) => /\/courses\/\d+\/assignments\/\d+\/submissions\/\d+/.test(item.href))?.href || "";
    const id = extractAssignmentId(assignmentHref || submissionHref || submitPostUrl) || String(submitAssignmentId || "").trim();
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
      url: id ? new URL(`/courses/${courseId}/assignments/${id}`, baseUrl).toString() : "",
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
    const recovered = await tryInstallChromiumAndRelaunch(error, headless);
    if (!recovered) {
      throw new Error(formatChromiumLaunchError(error));
    }
    browser = recovered;
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

async function prepareAssignmentSubmitFlow(page, baseUrl, options, timeoutMs) {
  const courseId = String(options.courseId || "").trim();
  if (!courseId) {
    throw new Error("missing course ID");
  }

  const assignmentHint = String(options.assignment || "").trim();
  if (!assignmentHint) {
    throw new Error("missing assignment");
  }

  debugLog("prepareAssignmentSubmitFlow:start", courseId, assignmentHint);
  await page.goto(new URL(`/courses/${courseId}`, baseUrl).toString(), { waitUntil: "domcontentloaded" });
  await waitForNetworkIdle(page);
  debugLog("prepareAssignmentSubmitFlow:course-page", page.url());

  const assignments = await extractAssignmentsFromCoursePage(page, courseId, baseUrl);
  debugLog("prepareAssignmentSubmitFlow:assignment-count", String(assignments.length));
  const assignment = resolveAssignment(assignments, assignmentHint);
  if (!assignment) {
    throw new Error(`could not find assignment ${assignmentHint} in course ${courseId}`);
  }
  debugLog("prepareAssignmentSubmitFlow:assignment", assignment.id || "<no-id>", assignment.title, assignment.url || "<no-url>");

  await openAssignment(page, assignment, timeoutMs);
  await openSubmitFlow(page);
  debugLog("prepareAssignmentSubmitFlow:open-submit-flow", page.url());

  return assignment;
}

async function openAssignment(page, assignment, timeoutMs) {
  if (assignment.url) {
    debugLog("openAssignment:goto", assignment.url);
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
  debugLog("openAssignment:clicked-row-opener", page.url());
}

async function openSubmitFlow(page) {
  if (
    await hasVisibleFileInput(page)
    || await findGitHubControl(page, "repository")
    || await findSubmissionTypeTrigger(page, "upload")
    || await findSubmissionTypeTrigger(page, "github")
  ) {
    debugLog("openSubmitFlow:already-open", page.url());
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
  debugLog("openSubmitFlow:opened", page.url());
}

async function detectAvailableSubmissionTypes(page) {
  const available = [];

  if (await isSubmissionTypeReady(page, "upload") || await findSubmissionTypeTrigger(page, "upload")) {
    available.push("upload");
  }
  if (await isSubmissionTypeReady(page, "github") || await findSubmissionTypeTrigger(page, "github")) {
    available.push("github");
  }

  return available;
}

async function switchSubmissionType(page, submissionType) {
  debugLog("switchSubmissionType:start", submissionType, page.url());
  if (await isSubmissionTypeReady(page, submissionType)) {
    debugLog("switchSubmissionType:already-ready", submissionType, page.url());
    return;
  }

  const trigger = await findSubmissionTypeTrigger(page, submissionType);
  if (!trigger) {
    throw new Error(`could not find the ${submissionTypeLabel(submissionType)} submission option on ${page.url()}`);
  }

  await activateSubmissionTypeTrigger(page, trigger);
  await waitForSubmissionType(page, submissionType);
  debugLog("switchSubmissionType:ready", submissionType, page.url());
}

async function waitForSubmissionType(page, submissionType) {
  const timeoutAt = Date.now() + 10000;

  while (Date.now() < timeoutAt) {
    if (await isSubmissionTypeReady(page, submissionType)) {
      return;
    }
    await page.waitForTimeout(250);
  }

  throw new Error(`the ${submissionTypeLabel(submissionType)} submission form did not become ready on ${page.url()}`);
}

async function isSubmissionTypeReady(page, submissionType) {
  if (submissionType === "upload") {
    return await hasVisibleFileInput(page) || Boolean(await firstVisible([
      page.locator("#submit-variable-length-pdf").first(),
      page.getByRole("button", { name: /submit pdf/i }).first(),
    ]));
  }

  if (submissionType === "github") {
    return Boolean(await findGitHubControl(page, "repository"));
  }

  return false;
}

async function findSubmissionTypeTrigger(page, submissionType) {
  const matcher = submissionType === "github" ? /github/i : /upload/i;
  const valueSelector = submissionType === "github" ? "github" : "upload";

  for (const root of await getSubmissionFlowRoots(page)) {
    const trigger = await firstVisible([
      root.locator("label").filter({ hasText: matcher }).first(),
      root.getByLabel(matcher).first(),
      root.getByRole("tab", { name: matcher }).first(),
      root.getByRole("button", { name: matcher }).first(),
      root.getByRole("link", { name: matcher }).first(),
      root.getByRole("radio", { name: matcher }).first(),
      root.locator(`input[type='radio'][value*='${valueSelector}' i]`).first(),
      root.locator(`input[type='radio'][id*='${valueSelector}' i]`).first(),
      root.locator(`input[type='radio'][name*='${valueSelector}' i]`).first(),
    ]);
    if (trigger) {
      return trigger;
    }
  }

  return null;
}

async function chooseVariableLengthPDF(page) {
  const pdfChoice = await firstVisible([
    page.locator("#submit-variable-length-pdf").first(),
    page.getByRole("button", { name: /submit pdf/i }).first(),
  ]);

  if (pdfChoice) {
    await clickAndRender(page, pdfChoice);
  }
}

async function attachSubmissionFiles(page, filePaths) {
  const input = await firstVisible([
    page.locator("#submission_pdf_attachment").first(),
    page.locator("#submission_file").first(),
    page.locator("input[type=file]").first(),
  ]);

  if (!input) {
    throw new Error(`could not find a file input after opening the submit flow at ${page.url()}`);
  }

  await input.setInputFiles(filePaths);
}

async function submitCurrentSubmission(page) {
  const submitter = await firstVisible([
    page.locator("#submit-fixed-length-form input[type=submit]").first(),
    page.locator(".js-submitTypedDocumentForm input[type=submit]").first(),
    page.getByRole("button", { name: /^(upload|submit assignment|submit)$/i }).first(),
    page.locator("input[type=submit][value*='Upload'], input[type=submit][value*='Submit']").first(),
  ]);

  if (!submitter) {
    throw new Error(`could not find the final submit button at ${page.url()}`);
  }

  await clickAndSettle(page, submitter);
}

async function listGitHubChoices(page, kind) {
  debugLog("listGitHubChoices:start", kind, page.url());
  const control = await findGitHubControl(page, kind);
  if (!control) {
    throw new Error(`could not find the GitHub ${kind} control on ${page.url()}`);
  }

  const options = await readChoiceControlOptions(page, control);
  debugLog("listGitHubChoices:done", kind, String(options.length));
  return options;
}

async function selectGitHubChoice(page, kind, hint) {
  const control = await findGitHubControl(page, kind);
  if (!control) {
    throw new Error(`could not find the GitHub ${kind} control on ${page.url()}`);
  }

  await waitForChoiceControlEnabled(page, control, kind);

  const controlTagName = await control.evaluate((node) => node.tagName.toLowerCase()).catch(() => "");
  if (controlTagName === "select") {
    const options = await readChoiceControlOptions(page, control);
    const match = findChoiceOption(options, hint);
    if (!match) {
      throw new Error(`could not find GitHub ${kind} "${hint}"`);
    }

    await control.selectOption(match.value || { label: match.label });
    await waitForNetworkIdle(page);
    await page.waitForTimeout(400);
  } else {
    await openChoiceControl(page, control);

    const options = await readChoiceControlOptions(page, control);
    const match = findChoiceOption(options, hint);
    if (!match) {
      throw new Error(`could not find GitHub ${kind} "${hint}"`);
    }

    const optionLocator = await findChoiceOptionLocator(page, match.label || match.value);
    if (!optionLocator) {
      throw new Error(`could not select GitHub ${kind} "${hint}"`);
    }

    await clickAndRender(page, optionLocator, 400);
  }

  if (kind === "repository") {
    await waitForGitHubBranches(page);
  }
}

async function waitForGitHubBranches(page) {
  const timeoutAt = Date.now() + 10000;

  while (Date.now() < timeoutAt) {
    const control = await findGitHubControl(page, "branch");
    if (control) {
      const enabled = await isChoiceControlEnabled(control);
      if (enabled) {
        const options = await readChoiceControlOptions(page, control).catch(() => []);
        if (options.length > 0) {
          return;
        }
      }
    }

    await page.waitForTimeout(250);
  }

  throw new Error(`GitHub branches did not load on ${page.url()}`);
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

async function findGitHubControl(page, kind) {
  const matchers = kind === "repository"
    ? [/repository/i, /\brepo\b/i]
    : [/branch/i];
  const attributeSelectors = kind === "repository"
    ? [
      "select[name*='repository' i]",
      "select[id*='repository' i]",
      "select[name*='repo' i]",
      "select[id*='repo' i]",
      "[role='combobox'][aria-label*='repository' i]",
      "[role='combobox'][aria-label*='repo' i]",
      "button[aria-haspopup='listbox'][aria-label*='repository' i]",
      "button[aria-haspopup='listbox'][aria-label*='repo' i]",
      "div[aria-haspopup='listbox'][aria-label*='repository' i]",
      "div[aria-haspopup='listbox'][aria-label*='repo' i]",
    ]
    : [
      "select[name*='branch' i]",
      "select[id*='branch' i]",
      "[role='combobox'][aria-label*='branch' i]",
      "button[aria-haspopup='listbox'][aria-label*='branch' i]",
      "div[aria-haspopup='listbox'][aria-label*='branch' i]",
    ];

  for (const root of await getSubmissionFlowRoots(page)) {
    const candidates = [];

    for (const matcher of matchers) {
      candidates.push(
        root.getByLabel(matcher).first(),
        root.getByRole("combobox", { name: matcher }).first(),
        root.locator("label").filter({ hasText: matcher }).locator(CHOICE_CONTROL_SELECTOR).first(),
      );
    }

    candidates.push(...attributeSelectors.map((selector) => root.locator(selector).first()));

    const exactMatch = await firstVisible(candidates);
    if (exactMatch) {
      return exactMatch;
    }

    const contextualMatch = await findChoiceControlByContext(root, kind);
    if (contextualMatch) {
      return contextualMatch;
    }
  }

  return null;
}

async function waitForChoiceControlEnabled(page, control, kind) {
  const timeoutAt = Date.now() + 10000;

  while (Date.now() < timeoutAt) {
    if (await isChoiceControlEnabled(control)) {
      return;
    }
    await page.waitForTimeout(250);
  }

  throw new Error(`the GitHub ${kind} control did not become ready`);
}

async function isChoiceControlEnabled(control) {
  return control.evaluate((node) => {
    if (node.hasAttribute("disabled") || node.getAttribute("aria-disabled") === "true") {
      return false;
    }

    const disabledAncestor = node.closest(
      "[disabled], [aria-disabled='true'], .is-disabled, .Select.is-disabled, .select__control--is-disabled",
    );
    return !disabledAncestor;
  }).catch(() => false);
}

async function readChoiceControlOptions(page, control) {
  const controlTagName = await control.evaluate((node) => node.tagName.toLowerCase()).catch(() => "");
  if (controlTagName === "select") {
    return control.evaluate((node) => {
      return Array.from(node.options || []).map((option) => ({
        value: (option.value || "").trim(),
        label: (option.textContent || "").trim(),
        disabled: Boolean(option.disabled),
      }));
    }).then((options) => options.filter((option) => isUsableChoiceOption(option)));
  }

  await openChoiceControl(page, control);

  const options = [];
  const visibleOptions = page.locator(CHOICE_OPTION_SELECTOR);
  const count = await visibleOptions.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const option = visibleOptions.nth(index);
    try {
      if (!await option.isVisible()) {
        continue;
      }
    } catch {
      continue;
    }

    const item = await option.evaluate((node) => ({
      value: ((node.getAttribute("data-value") || node.getAttribute("value") || "").trim()
        || String(node.textContent || "").trim().replace(/\s+/g, " ").replace(/Last updated at:.*$/i, "").trim()),
      label: String(node.textContent || "").trim().replace(/\s+/g, " ").replace(/Last updated at:.*$/i, "").trim(),
      disabled: node.getAttribute("aria-disabled") === "true" || node.classList.contains("is-disabled"),
    })).catch(() => null);
    if (isUsableChoiceOption(item)) {
      options.push(item);
    }
  }

  return options;
}

function isUsableChoiceOption(option) {
  if (!option || option.disabled) {
    return false;
  }

  const label = normalizeWhitespace(option.label || option.value);
  const value = String(option.value || "").trim();
  if (!label && !value) {
    return false;
  }

  return !/^select\b/i.test(label) && !/^choose\b/i.test(label);
}

function findChoiceOption(options, hint) {
  const rawHint = String(hint || "").trim();
  if (!rawHint) {
    return null;
  }

  const normalizedHint = rawHint.toLowerCase();
  return options.find((option) => {
    return String(option.value || "").trim() === rawHint
      || normalizeWhitespace(option.label).toLowerCase() === normalizedHint
      || String(option.value || "").trim().toLowerCase() === normalizedHint;
  }) || null;
}

function exactCaseInsensitivePattern(value) {
  return new RegExp(`^${escapeRegExp(String(value || "").trim())}$`, "i");
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function debugLog(...parts) {
  if (process.env.GRADESCOPE_DEBUG !== "1") {
    return;
  }

  console.error("[gradescope-debug]", ...parts);
}

async function getSubmissionFlowRoots(page) {
  const modal = await firstVisible([
    page.locator(".modal.show:visible").last(),
    page.locator(".modal:visible").last(),
    page.locator("[role='dialog']:visible").last(),
  ]);

  if (modal) {
    return [modal, page];
  }

  return [page];
}

async function findChoiceControlByContext(root, kind) {
  const controls = await findVisibleChoiceControls(root);
  if (controls.length === 0) {
    return null;
  }

  const needles = kind === "repository" ? ["repository", "repo"] : ["branch"];
  for (const control of controls) {
    const context = normalizeWhitespace(await describeChoiceControlContext(control)).toLowerCase();
    if (needles.some((needle) => context.includes(needle))) {
      return control;
    }
  }

  if (kind === "repository") {
    return controls[0];
  }

  if (kind === "branch" && controls.length > 1) {
    return controls[1];
  }

  return null;
}

async function findVisibleChoiceControls(root) {
  const controls = root.locator(CHOICE_CONTROL_SELECTOR);
  const count = await controls.count().catch(() => 0);
  const visible = [];

  for (let index = 0; index < count; index += 1) {
    const control = controls.nth(index);
    try {
      if (await control.isVisible()) {
        visible.push(control);
      }
    } catch {
      // Ignore transient render errors while controls are mounting.
    }
  }

  return visible;
}

async function describeChoiceControlContext(control) {
  return control.evaluate((node) => {
    const values = [];
    const seen = new Set();
    const push = (value) => {
      const normalized = String(value || "").trim().replace(/\s+/g, " ");
      if (!normalized || seen.has(normalized)) {
        return;
      }
      seen.add(normalized);
      values.push(normalized);
    };

    const readLabelledBy = () => {
      const ids = String(node.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean);
      for (const id of ids) {
        push(document.getElementById(id)?.textContent || "");
      }
    };

    const readExplicitLabels = () => {
      const id = String(node.id || "").trim();
      if (!id) {
        return;
      }

      const escapedId = globalThis.CSS?.escape ? CSS.escape(id) : id.replace(/["\\]/g, "\\$&");
      for (const label of document.querySelectorAll(`label[for="${escapedId}"]`)) {
        push(label.textContent || "");
      }
    };

    const readSiblingLabels = () => {
      let previous = node.previousElementSibling;
      let hops = 0;
      while (previous && hops < 3) {
        push(previous.textContent || "");
        previous = previous.previousElementSibling;
        hops += 1;
      }

      push(node.parentElement?.previousElementSibling?.textContent || "");
    };

    push(node.getAttribute("aria-label") || "");
    push(node.getAttribute("name") || "");
    push(node.getAttribute("id") || "");
    readLabelledBy();
    readExplicitLabels();
    push(node.closest("label")?.textContent || "");
    readSiblingLabels();
    push(node.closest("fieldset")?.querySelector("legend")?.textContent || "");
    push(node.closest(".form-group, .form--group, .formGroup, .field, .Field, td, th, li, div")?.textContent || "");

    return values.join(" ");
  }).catch(() => "");
}

async function openChoiceControl(page, control) {
  if (await isChoiceMenuOpen(page, control)) {
    return;
  }

  await control.click();
  await page.waitForTimeout(250);
}

async function isChoiceMenuOpen(page, control) {
  const expanded = await control.evaluate((node) => {
    return node.getAttribute("aria-expanded") === "true"
      || node.closest("[aria-expanded='true']") !== null;
  }).catch(() => false);
  if (expanded) {
    return true;
  }

  return Boolean(await firstVisible([
    page.getByRole("listbox").last(),
    page.locator(".Select-menu-outer, .Select-menu, .select__menu").last(),
  ]));
}

async function findChoiceOptionLocator(page, label) {
  const pattern = exactCaseInsensitivePattern(label);
  const prefixPattern = new RegExp(`^${escapeRegExp(String(label || "").trim())}(?:\\s|$)`, "i");
  const listbox = await firstVisible([
    page.getByRole("listbox").last(),
    page.locator(".Select-menu-outer, .Select-menu, .select__menu").last(),
  ]);

  const roots = listbox ? [listbox, page] : [page];
  for (const root of roots) {
    const option = await firstVisible([
      root.getByRole("option", { name: pattern }).first(),
      root.getByRole("option", { name: prefixPattern }).first(),
      root.locator(".Select-option, .select__option, .dropdown--item").filter({ hasText: pattern }).first(),
      root.locator(".Select-option, .select__option, .dropdown--item").filter({ hasText: prefixPattern }).first(),
      root.locator("[role='listbox'] li, [role='listbox'] button, .dropdown--item").filter({ hasText: pattern }).first(),
      root.locator("[role='listbox'] li, [role='listbox'] button, .dropdown--item").filter({ hasText: prefixPattern }).first(),
    ]);
    if (option) {
      return option;
    }
  }

  return null;
}

async function clickAndSettle(page, locator) {
  await Promise.allSettled([
    page.waitForLoadState("domcontentloaded", { timeout: 15000 }),
    locator.click(),
  ]);
  await waitForNetworkIdle(page);
}

async function clickAndRender(page, locator, delayMs = 250) {
  await locator.click();
  await page.waitForTimeout(delayMs);
}

async function activateSubmissionTypeTrigger(page, trigger) {
  const [tagName, type, id] = await Promise.all([
    trigger.evaluate((node) => node.tagName.toLowerCase()).catch(() => ""),
    trigger.getAttribute("type").catch(() => ""),
    trigger.getAttribute("id").catch(() => ""),
  ]);

  if (tagName === "input" && type === "radio") {
    if (id) {
      const label = await firstVisible([
        page.locator(`label[for='${id}']`).first(),
      ]);
      if (label) {
        await clickAndRender(page, label);
        return;
      }
    }

    await trigger.check({ force: true });
    await page.waitForTimeout(250);
    return;
  }

  await clickAndRender(page, trigger);
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
    const locator = page.locator(selector).first();
    const count = await locator.count().catch(() => 0);
    if (count === 0) {
      continue;
    }

    const text = normalizeWhitespace(await locator.innerText().catch(() => ""));
    if (text) {
      return text;
    }
  }
  return "";
}

async function firstVisibleTextFromRoot(root, selector) {
  const locator = root.locator(selector).first();
  const count = await locator.count().catch(() => 0);
  if (count === 0) {
    return "";
  }

  return normalizeWhitespace(await locator.innerText().catch(() => ""));
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

async function tryInstallChromiumAndRelaunch(error, headless) {
  if (!isMissingBrowserExecutableError(error)) {
    return null;
  }

  installChromiumBrowser();
  return launchChromium(headless);
}

function installChromiumBrowser() {
  const packagePath = require.resolve("playwright/package.json");
  const cliPath = path.join(path.dirname(packagePath), "cli.js");
  const result = spawnSync(process.execPath, [cliPath, "install", "chromium"], {
    env: {
      ...process.env,
      PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || "0",
    },
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error("Playwright browser install failed");
  }
}

export function isMissingBrowserExecutableError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Executable doesn't exist");
}

export function formatChromiumLaunchError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (isMissingBrowserExecutableError(error)) {
    return `could not launch Chromium because the browser executable is missing. Run \`playwright install chromium\` if the automatic install retry fails. ${message}`;
  }
  return `could not launch Chromium. ${message}`;
}
