import fs from "node:fs/promises";
import { Blob } from "node:buffer";
import { DEFAULT_BASE_URL } from "./config.mjs";
import { GradescopeHttpClient } from "./http-client.mjs";
import { resolveAssignment } from "./lookup.mjs";
import {
  normalizeStringList,
  resolveSubmissionType,
  submissionTypeLabel,
} from "./submission-options.mjs";
import {
  extractAssignmentsFromCourseHtml,
  extractChoiceOptionsFromForms,
  extractCoursesFromAccountHtml,
  extractCsrfToken,
  extractSubmissionForms,
  extractSubmissionResultFromHtml,
  extractSubmitPostUrls,
  findLatestSubmissionUrl,
  normalizeWhitespace,
} from "./parsers.mjs";

const DEFAULT_TIMEOUT_MS = 45000;

export async function login(options) {
  const client = new GradescopeHttpClient(options);
  const loginPage = await client.get("/login");
  const loginHtml = await loginPage.text();
  const token = extractCsrfToken(loginHtml);
  const body = new URLSearchParams();
  if (token) {
    body.set("authenticity_token", token);
  }
  body.set("session[email]", String(options.email || "").trim());
  body.set("session[password]", String(options.password || ""));

  const response = await client.post("/login", body, {
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "referer": client.absoluteUrl("/login"),
      ...(token ? { "x-csrf-token": token } : {}),
    },
  });
  const html = await response.text();
  ensureAuthenticated(response.url, html, "login did not establish an authenticated session");

  await client.saveSession(options.sessionFile);
  return {
    ok: true,
    sessionFile: options.sessionFile,
    email: options.email,
  };
}

export async function listCourses(options) {
  const client = await authenticatedClient(options);
  const response = await client.get("/account");
  const html = await response.text();
  ensureAuthenticated(response.url, html);
  await client.saveSession();
  return extractCoursesFromAccountHtml(html, client.baseUrl);
}

export async function listAssignments(options) {
  const courseId = String(options.courseId || "").trim();
  if (!courseId) {
    throw new Error("missing course ID");
  }

  const client = await authenticatedClient(options);
  const response = await client.get(`/courses/${courseId}`);
  const html = await response.text();
  ensureAuthenticated(response.url, html);
  await client.saveSession();

  const assignments = extractAssignmentsFromCourseHtml(html, courseId, client.baseUrl);
  if (assignments.length === 0) {
    throw new Error(`no assignments found on course ${courseId}`);
  }
  return assignments;
}

export async function result(options) {
  const client = await authenticatedClient(options);
  let target = "";
  let assignment = null;
  const reference = String(options.submission || "").trim();

  if (reference) {
    target = resolveSubmissionReference(reference);
  } else {
    const resolved = await resolveLatestSubmissionFromAssignment(client, options);
    target = resolved.submissionUrl;
    assignment = resolved.assignment;
  }

  const response = await client.get(target);
  const html = await response.text();
  ensureAuthenticated(response.url, html);
  if (!response.url.includes("/submissions/")) {
    throw new Error(`submission ${reference || target} did not resolve to a submission page`);
  }

  const submission = await readSubmissionResult(client, response.url, html, {
    ...options,
    courseId: options.courseId,
    courseName: options.courseName,
    assignmentId: options.assignmentId || assignment?.id,
    assignmentTitle: options.assignmentTitle || assignment?.title,
  });
  await client.saveSession();
  return submission;
}

export async function listSubmissionTypes(options) {
  const { html, client } = await loadSubmissionFlowHtml(options);
  const forms = extractSubmissionForms(html, client.baseUrl);
  const types = [];

  if (forms.some((form) => form.fileInputs.length > 0) || /upload/i.test(html)) {
    types.push("upload");
  }
  if (forms.some((form) => /github|repository|branch/i.test(form.text + form.html)) || /github/i.test(html)) {
    types.push("github");
  }
  await client.saveSession();
  return [...new Set(types)];
}

export async function listGitHubRepositories(options) {
  const { html, client } = await loadSubmissionFlowHtml(options);
  const forms = extractSubmissionForms(html, client.baseUrl);
  const choices = extractChoiceOptionsFromForms(forms, "repository");
  await client.saveSession();
  if (choices.length === 0) {
    throw new Error("could not find GitHub repository choices in the server-rendered form");
  }
  return choices;
}

export async function listGitHubBranches(options) {
  const repo = String(options.repo || "").trim();
  if (!repo) {
    throw new Error("missing GitHub repository");
  }
  const { html, client } = await loadSubmissionFlowHtml(options);
  const forms = extractSubmissionForms(html, client.baseUrl);
  const choices = extractChoiceOptionsFromForms(forms, "branch");
  await client.saveSession();
  if (choices.length === 0) {
    throw new Error("could not find GitHub branch choices in the server-rendered form");
  }
  return choices;
}

export async function submit(options) {
  const courseId = String(options.courseId || "").trim();
  if (!courseId) {
    throw new Error("missing course ID");
  }

  const submissionType = resolveSubmissionType({
    submissionType: options.submissionType,
    filePaths: options.filePaths || options.filePath,
    repo: options.repo,
    branch: options.branch,
  });
  if (!submissionType) {
    throw new Error("missing submission type or submit input");
  }

  const { client, assignment, html } = await loadSubmissionFlowHtml(options);
  let finalUrl = "";
  let finalHtml = "";

  if (submissionType === "upload") {
    const filePaths = normalizeStringList(options.filePaths || options.filePath);
    if (filePaths.length === 0) {
      throw new Error("missing file path");
    }
    ({ finalUrl, finalHtml } = await submitUpload(client, html, filePaths));
  } else if (submissionType === "github") {
    ({ finalUrl, finalHtml } = await submitGitHub(client, html, {
      repo: options.repo,
      branch: options.branch,
    }));
  } else {
    throw new Error(`unsupported submission type "${submissionType}"`);
  }

  if (!finalUrl.includes("/submissions/")) {
    const refreshed = await client.get(`/courses/${courseId}`);
    const refreshedHtml = await refreshed.text();
    const refreshedAssignments = extractAssignmentsFromCourseHtml(refreshedHtml, courseId, client.baseUrl);
    const refreshedAssignment = resolveAssignment(refreshedAssignments, assignment.id || assignment.title);
    if (refreshedAssignment?.submissionUrl) {
      const submission = await client.get(refreshedAssignment.submissionUrl);
      finalUrl = submission.url;
      finalHtml = await submission.text();
    }
  }

  if (!finalUrl.includes("/submissions/")) {
    throw new Error(`submit did not reach a submission page; final URL was ${finalUrl || client.lastUrl}`);
  }

  const result = await readSubmissionResult(client, finalUrl, finalHtml, {
    ...options,
    courseId,
    courseName: options.courseName,
    assignmentId: assignment.id,
    assignmentTitle: assignment.title,
  });
  await client.saveSession();
  return result;
}

export function resolveSubmissionReference(reference) {
  const value = String(reference || "").trim();
  if (value.includes("/submissions/")) {
    return value;
  }
  return `/submissions/${value}`;
}

async function authenticatedClient(options) {
  const sessionFile = String(options.sessionFile || "").trim();
  const client = await GradescopeHttpClient.fromSession({
    baseUrl: options.baseUrl || DEFAULT_BASE_URL,
    sessionFile,
  });
  return client;
}

async function loadSubmissionFlowHtml(options) {
  const courseId = String(options.courseId || "").trim();
  if (!courseId) {
    throw new Error("missing course ID");
  }

  const assignmentHint = String(options.assignment || "").trim();
  if (!assignmentHint) {
    throw new Error("missing assignment");
  }

  const client = await authenticatedClient(options);
  const courseResponse = await client.get(`/courses/${courseId}`);
  const courseHtml = await courseResponse.text();
  ensureAuthenticated(courseResponse.url, courseHtml);

  const assignments = extractAssignmentsFromCourseHtml(courseHtml, courseId, client.baseUrl);
  const assignment = resolveAssignment(assignments, assignmentHint);
  if (!assignment) {
    throw new Error(`could not find assignment ${assignmentHint} in course ${courseId}`);
  }

  const assignmentTarget = assignment.url || `/courses/${courseId}/assignments/${assignment.id}`;
  const assignmentResponse = await client.get(assignmentTarget);
  let html = await assignmentResponse.text();
  ensureAuthenticated(assignmentResponse.url, html);

  if (!hasSubmissionForm(html)) {
    html = await fetchSubmitModalHtml(client, html, assignment);
  }

  return {
    client,
    assignment,
    html,
  };
}

async function fetchSubmitModalHtml(client, html, assignment) {
  const urls = [
    ...extractSubmitPostUrls(html, client.baseUrl),
    assignment.submitPostUrl,
  ].filter(Boolean);
  const token = extractCsrfToken(html);

  for (const url of [...new Set(urls)]) {
    const body = new URLSearchParams();
    if (token) {
      body.set("authenticity_token", token);
    }

    const response = await client.post(url, body, {
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-requested-with": "XMLHttpRequest",
        "accept": "text/html,application/javascript,*/*;q=0.8",
        ...(token ? { "x-csrf-token": token } : {}),
      },
    });
    const modalHtml = await response.text();
    if (hasSubmissionForm(modalHtml)) {
      return `${html}\n${modalHtml}`;
    }
    const extracted = extractEscapedHtmlFromJavaScript(modalHtml);
    if (hasSubmissionForm(extracted)) {
      return `${html}\n${extracted}`;
    }
  }

  return html;
}

function hasSubmissionForm(html) {
  const forms = extractSubmissionForms(html);
  return forms.some((form) => form.fileInputs.length > 0 || /github|repository|branch|submission/i.test(form.text + form.html));
}

async function submitUpload(client, html, filePaths) {
  const forms = extractSubmissionForms(html, client.baseUrl);
  const form = forms.find((candidate) => candidate.fileInputs.length > 0)
    || forms.find((candidate) => /upload|submission/i.test(candidate.text + candidate.html));
  if (!form) {
    throw new Error("could not find an upload form in the server-rendered assignment submit flow");
  }

  const fileInput = form.fileInputs[0] || {};
  const fieldName = fileInput.name || inferUploadFieldName(fileInput);
  const body = new FormData();
  appendFormFields(body, form.fields);

  for (const filePath of filePaths) {
    const data = await fs.readFile(filePath);
    const name = filePath.split(/[\\/]/).pop() || "submission";
    body.append(fieldName, new Blob([data]), name);
  }

  const response = await client.post(form.action, body, {
    headers: formHeaders(html, form.action),
  });
  let finalUrl = response.url;
  let finalHtml = await response.text();

  if (finalUrl.includes("/select_pages")) {
    ({ finalUrl, finalHtml } = await finalizeSelectPages(client, finalHtml, finalUrl));
  }

  return { finalUrl, finalHtml };
}

async function submitGitHub(client, html, options) {
  const repo = String(options.repo || "").trim();
  const branch = String(options.branch || "").trim();
  if (!repo) {
    throw new Error("missing GitHub repository");
  }
  if (!branch) {
    throw new Error("missing GitHub branch");
  }

  const forms = extractSubmissionForms(html, client.baseUrl);
  const form = forms.find((candidate) => /github|repository|branch/i.test(candidate.text + candidate.html));
  if (!form) {
    throw new Error("could not find a GitHub submission form in the server-rendered assignment submit flow");
  }

  const body = new URLSearchParams();
  for (const field of form.fields) {
    const fieldName = field.name.toLowerCase();
    if (fieldName.includes("repo") || fieldName.includes("repository")) {
      body.append(field.name, repo);
    } else if (fieldName.includes("branch")) {
      body.append(field.name, branch);
    } else {
      body.append(field.name, field.value);
    }
  }
  ensureBodyHasGitHubFields(body, form, repo, branch);

  const response = await client.post(form.action, body, {
    headers: {
      ...formHeaders(html, form.action),
      "content-type": "application/x-www-form-urlencoded",
    },
  });

  return {
    finalUrl: response.url,
    finalHtml: await response.text(),
  };
}

async function finalizeSelectPages(client, html, pageUrl) {
  const forms = extractSubmissionForms(html, pageUrl);
  const form = forms.find((candidate) => /submit assignment|submit/i.test(candidate.text + candidate.html)) || forms[0];
  if (!form) {
    throw new Error(`upload reached ${pageUrl}, but no final Submit form was found`);
  }

  const body = new URLSearchParams();
  appendFormFields(body, form.fields);
  const response = await client.post(form.action, body, {
    headers: {
      ...formHeaders(html, form.action),
      "content-type": "application/x-www-form-urlencoded",
    },
  });

  return {
    finalUrl: response.url,
    finalHtml: await response.text(),
  };
}

async function resolveLatestSubmissionFromAssignment(client, options) {
  const courseId = String(options.courseId || "").trim();
  if (!courseId) {
    throw new Error("missing course ID");
  }

  const assignmentHint = String(options.assignment || "").trim();
  if (!assignmentHint) {
    throw new Error("missing assignment");
  }

  const courseResponse = await client.get(`/courses/${courseId}`);
  const courseHtml = await courseResponse.text();
  ensureAuthenticated(courseResponse.url, courseHtml);

  const assignments = extractAssignmentsFromCourseHtml(courseHtml, courseId, client.baseUrl);
  const assignment = resolveAssignment(assignments, assignmentHint);
  if (!assignment) {
    throw new Error(`could not find assignment ${assignmentHint} in course ${courseId}`);
  }

  if (assignment.submissionUrl) {
    return {
      assignment,
      submissionUrl: assignment.submissionUrl,
    };
  }

  if (assignment.url) {
    const assignmentResponse = await client.get(assignment.url);
    const assignmentHtml = await assignmentResponse.text();
    const submissionUrl = findLatestSubmissionUrl(assignmentHtml, client.baseUrl);
    if (submissionUrl) {
      return {
        assignment,
        submissionUrl,
      };
    }
  }

  throw new Error(`assignment "${assignment.title}" does not have a submission result yet`);
}

async function readSubmissionResult(client, pageUrl, html, options = {}) {
  const timeoutMs = Number.parseInt(String(options.timeoutMs || DEFAULT_TIMEOUT_MS), 10) || DEFAULT_TIMEOUT_MS;
  const waitForResponse = Boolean(options.waitForResponse);
  let result = extractSubmissionResultFromHtml(html, pageUrl);

  if (waitForResponse && !hasSubmissionResponse(result)) {
    const timeoutAt = Date.now() + timeoutMs;
    while (Date.now() < timeoutAt) {
      await sleep(2000);
      const response = await client.get(pageUrl);
      pageUrl = response.url;
      html = await response.text();
      result = extractSubmissionResultFromHtml(html, pageUrl);
      if (hasSubmissionResponse(result)) {
        break;
      }
    }
  }

  return attachSubmissionMetadata(result, options);
}

function ensureAuthenticated(url, html, message = "saved session is not authenticated; run `gradescope-cli login` first") {
  const text = normalizeWhitespace(html).toLowerCase();
  if (String(url || "").includes("/login") || text.includes("log in to gradescope")) {
    throw new Error(message);
  }
}

function appendFormFields(body, fields) {
  for (const field of fields) {
    body.append(field.name, field.value);
  }
}

function formHeaders(html, action) {
  const token = extractCsrfToken(html);
  return {
    "referer": action,
    ...(token ? { "x-csrf-token": token } : {}),
  };
}

function inferUploadFieldName(fileInput) {
  if (/pdf/i.test(fileInput.id || "")) {
    return "submission[pdf_attachment]";
  }
  return "submission[files][]";
}

function ensureBodyHasGitHubFields(body, form, repo, branch) {
  const names = form.fields.map((field) => field.name);
  if (!names.some((name) => /repo|repository/i.test(name))) {
    body.append("submission[repository]", repo);
  }
  if (!names.some((name) => /branch/i.test(name))) {
    body.append("submission[branch]", branch);
  }
}

function hasSubmissionResponse(result) {
  if (result?.hasAutograder) {
    return true;
  }
  if (result?.responseKind === "feedback") {
    return true;
  }
  if (!result?.gradesVisible) {
    return false;
  }
  return Boolean(normalizeWhitespace(result?.scoreDisplay) || result?.questionResults?.length);
}

function attachSubmissionMetadata(result, options = {}) {
  return {
    ...result,
    courseId: String(options.courseId || result.courseId || "").trim(),
    courseName: normalizeWhitespace(options.courseName || result.courseName || ""),
    assignmentId: String(options.assignmentId || result.assignmentId || "").trim(),
    assignmentTitle: normalizeWhitespace(options.assignmentTitle || result.assignmentTitle || ""),
  };
}

function extractEscapedHtmlFromJavaScript(value) {
  const text = String(value || "");
  const quoted = text.match(/(["'`])((?:\\.|(?!\1).)*)<\/?form[\s\S]*?\1/);
  if (!quoted) {
    return text;
  }
  return quoted[0]
    .slice(1, -1)
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\"/g, "\"")
    .replace(/\\'/g, "'")
    .replace(/\\\//g, "/");
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
