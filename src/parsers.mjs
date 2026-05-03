import { load } from "cheerio";
import { DEFAULT_BASE_URL } from "./config.mjs";

const COURSE_SHORT_SELECTOR = ".courseBox--shortname, .courseBox__shortname, .courseShortname";
const COURSE_NAME_SELECTOR = ".courseBox--name, .courseBox__name, .courseName, .course-name";

export function extractCsrfToken(html) {
  const $ = load(html || "");
  return normalizeWhitespace($("meta[name='csrf-token']").attr("content"))
    || normalizeWhitespace($("input[name='authenticity_token']").first().attr("value"));
}

export function extractCoursesFromAccountHtml(html, baseUrl = DEFAULT_BASE_URL) {
  const $ = load(html || "");
  const seen = new Set();
  const courses = [];

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href") || "";
    const match = href.match(/^\/courses\/(\d+)$/);
    if (!match) {
      return;
    }

    const courseId = match[1];
    if (seen.has(courseId)) {
      return;
    }

    const raw = normalizeWhitespace($(element).text());
    const short = normalizeWhitespace($(element).find(COURSE_SHORT_SELECTOR).first().text());
    let name = normalizeWhitespace($(element).find(COURSE_NAME_SELECTOR).first().text());
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
  });

  if (courses.length === 0) {
    throw new Error("no courses found on account page");
  }

  return courses;
}

export function extractAssignmentsFromCourseHtml(html, courseId, baseUrl = DEFAULT_BASE_URL) {
  const $ = load(html || "");
  const assignments = [];
  const seen = new Set();

  $("#assignments-student-table tbody tr").each((index, element) => {
    const row = $(element);
    const title = normalizeWhitespace(row.find("th[scope='row'], .assignmentTitle, .table--primaryLink, td").first().text());
    if (!title) {
      return;
    }

    const links = row.find("a[href]").toArray().map((link) => ({
      href: $(link).attr("href") || "",
      text: normalizeWhitespace($(link).text()),
    }));
    const submitButton = row.find(".js-submitAssignment, [data-assignment-id]").first();
    const submitAssignmentId = submitButton.attr("data-assignment-id") || "";
    const submitPostUrl = submitButton.attr("data-post-url") || "";

    const assignmentHref = links.find((item) => /\/courses\/\d+\/assignments\/\d+(?:$|\/)/.test(item.href))?.href || "";
    const submissionHref = links.find((item) => /\/courses\/\d+\/assignments\/\d+\/submissions\/\d+/.test(item.href))?.href || "";
    const id = extractAssignmentId(assignmentHref || submissionHref || submitPostUrl) || String(submitAssignmentId || "").trim();
    const dedupeKey = id || `${courseId}:${title}`;
    if (seen.has(dedupeKey)) {
      return;
    }

    const status = normalizeWhitespace(row.find(".submissionStatus, .label, .status").first().text());
    seen.add(dedupeKey);
    assignments.push({
      id,
      courseId,
      title,
      status,
      rowIndex: index,
      url: id ? new URL(`/courses/${courseId}/assignments/${id}`, baseUrl).toString() : "",
      submissionUrl: submissionHref ? new URL(submissionHref, baseUrl).toString() : "",
      submitPostUrl: submitPostUrl ? new URL(submitPostUrl, baseUrl).toString() : "",
    });
  });

  return assignments;
}

export function extractSubmissionResultFromHtml(html, fallbackUrl = "") {
  const $ = load(html || "");
  const url = fallbackUrl || "";
  let result = {
    submissionId: extractSubmissionId(url),
    url,
    status: "",
    processingStatus: "",
    notice: "",
    response: "",
    responseKind: "",
    autograderMessage: "",
    hasAutograder: false,
    courseId: extractCourseId(url),
    courseName: "",
    assignmentId: extractAssignmentId(url),
    assignmentTitle: "",
    submissionFormat: "",
    gradesVisible: false,
    score: "",
    totalPoints: "",
    scoreDisplay: "",
    lateness: "",
    questionResults: [],
    autograderResults: [],
  };

  const reactProps = $('[data-react-class="AssignmentSubmissionViewer"]').first().attr("data-react-props") || "";
  if (reactProps) {
    try {
      result = {
        ...result,
        ...parseSubmissionReactProps(reactProps, { pageUrl: url }),
      };
    } catch {
      // Fall back to visible page text if Gradescope changes embedded props.
    }
  }

  if (!result.courseName) {
    result.courseName = normalizeWhitespace($(".sidebar--subtitle, .sidebar--title-course + .sidebar--subtitle").first().text());
  }
  if (!result.status) {
    result.status = normalizeWhitespace($(".submissionStatus, .alert-success, title").first().text());
  }
  if (!result.processingStatus) {
    result.processingStatus = result.status;
  }

  if (!result.response) {
    result.response = normalizeWhitespace(findSectionText($, "Response"));
    if (result.response) {
      result.responseKind = "feedback";
    }
  }
  if (!result.response) {
    result.response = normalizeWhitespace($(".submissionBody, .submissionContent, .submission").first().text());
    if (result.response) {
      result.responseKind = "feedback";
    }
  }
  if (result.response === result.status) {
    result.response = "";
    result.responseKind = "";
  }

  if (!result.autograderMessage) {
    result.autograderMessage = normalizeWhitespace(firstNonEmpty(
      findSectionText($, "Autograder"),
      findSectionText($, "Autograder Output"),
      findSectionText($, "Output"),
      $(".autograderResults, .autograder-output, .autograderOutput").first().text(),
    ));
  }
  result.hasAutograder = Boolean(result.autograderMessage);

  return result;
}

export function findLatestSubmissionUrl(html, baseUrl = DEFAULT_BASE_URL) {
  const $ = load(html || "");
  const href = $("a[href]").toArray()
    .map((element) => $(element).attr("href") || "")
    .find((value) => /\/courses\/\d+\/assignments\/\d+\/submissions\/\d+/.test(value));
  return href ? new URL(href, baseUrl).toString() : "";
}

export function extractSubmissionForms(html, baseUrl = DEFAULT_BASE_URL) {
  const $ = load(html || "");
  return $("form").toArray().map((element) => {
    const form = $(element);
    const fields = [];
    form.find("input, textarea, select").each((_, input) => {
      const item = $(input);
      const name = item.attr("name") || "";
      const type = String(item.attr("type") || "").toLowerCase();
      if (!name || type === "file" || type === "submit" || type === "button") {
        return;
      }
      if (item.is("select")) {
        const selected = item.find("option[selected]").first();
        fields.push({
          name,
          value: selected.attr("value") ?? selected.text() ?? "",
        });
        return;
      }
      if ((type === "checkbox" || type === "radio") && item.attr("checked") === undefined) {
        return;
      }
      fields.push({
        name,
        value: item.attr("value") ?? item.text() ?? "",
      });
    });

    const fileInputs = form.find("input[type='file']").toArray().map((input) => ({
      name: $(input).attr("name") || "",
      id: $(input).attr("id") || "",
      multiple: $(input).attr("multiple") !== undefined,
    }));

    return {
      action: new URL(form.attr("action") || ".", baseUrl).toString(),
      method: String(form.attr("method") || "get").toUpperCase(),
      text: normalizeWhitespace(form.text()),
      fields,
      fileInputs,
      html: $.html(form),
    };
  });
}

export function extractSubmitPostUrls(html, baseUrl = DEFAULT_BASE_URL) {
  const $ = load(html || "");
  const urls = [];
  $("[data-post-url]").each((_, element) => {
    const value = $(element).attr("data-post-url") || "";
    if (value) {
      urls.push(new URL(value, baseUrl).toString());
    }
  });
  return [...new Set(urls)];
}

export function extractChoiceOptionsFromForms(forms, kind) {
  const needles = kind === "repository" ? ["repository", "repo"] : ["branch"];
  const result = [];
  for (const form of forms) {
    const $ = load(form.html || "");
    $("select").each((_, select) => {
      const label = normalizeWhitespace([
        $(select).attr("aria-label"),
        $(select).attr("name"),
        $(select).attr("id"),
        $(select).parent().text(),
      ].join(" ")).toLowerCase();
      if (!needles.some((needle) => label.includes(needle))) {
        return;
      }
      $(select).find("option").each((__, option) => {
        const disabled = $(option).attr("disabled") !== undefined;
        const value = normalizeWhitespace($(option).attr("value") || "");
        const optionLabel = normalizeWhitespace($(option).text());
        if (!disabled && (value || optionLabel) && !/^select\b/i.test(optionLabel)) {
          result.push({ value, label: optionLabel, disabled });
        }
      });
    });
  }
  return result;
}

export function parseSubmissionReactProps(value, options = {}) {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  const pageUrl = String(options.pageUrl || "").trim();
  const gradesVisible = inferGradesVisible(parsed);
  const questionResults = buildQuestionResults(parsed, gradesVisible);
  const autograderResults = buildAutograderResults(parsed?.autograder_results);
  const rawStatus = normalizeWhitespace(parsed?.assignment_submission?.status);
  const score = normalizePointValue(parsed?.assignment_submission?.score);
  const totalPoints = normalizePointValue(parsed?.assignment?.total_points);
  const scoreDisplay = formatScoreDisplay(score, totalPoints);
  const response = buildQuestionResponse(questionResults, gradesVisible);
  if (shouldSuppressQuestionResponse(questionResults, autograderResults)) {
    response.text = "";
    response.kind = "";
  }
  const autograderMessage = buildAutograderMessage(parsed?.autograder_results, autograderResults);

  return {
    submissionId: formatId(parsed?.assignment_submission?.id),
    url: absoluteUrlFromPath(pageUrl, parsed?.paths?.submission_path) || pageUrl,
    status: deriveSubmissionStatus({
      rawStatus,
      gradesVisible,
      scoreDisplay,
      questionResults,
      autograderResults,
    }),
    processingStatus: rawStatus,
    notice: normalizeWhitespace(firstNonEmpty(parsed?.alert, ...(parsed?.alerts || []))),
    response: response.text,
    responseKind: response.kind,
    autograderMessage,
    hasAutograder: Boolean(autograderMessage),
    courseId: extractCourseId(parsed?.paths?.course_path || pageUrl),
    assignmentId: formatId(parsed?.assignment?.id) || extractAssignmentId(pageUrl),
    assignmentTitle: normalizeWhitespace(parsed?.assignment?.title),
    submissionFormat: normalizeWhitespace(parsed?.assignment?.submission_format),
    gradesVisible: gradesVisible === true,
    score,
    totalPoints,
    scoreDisplay,
    lateness: normalizeWhitespace(parsed?.assignment_submission?.lateness_in_words),
    questionResults,
    autograderResults,
  };
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

function firstLine(value) {
  return String(value || "").split("\n").map(normalizeWhitespace).find(Boolean) || "";
}

function extractCourseId(value) {
  return String(value || "").match(/\/courses\/(\d+)/)?.[1] || "";
}

function findSectionText($, headingText) {
  const needle = headingText.toLowerCase();
  let found = "";
  $("h1, h2, h3, h4, h5, h6").each((_, heading) => {
    if (found) {
      return;
    }
    const headingValue = normalizeWhitespace($(heading).text());
    if (!headingValue || !headingValue.toLowerCase().includes(needle)) {
      return;
    }

    const values = [];
    let sibling = $(heading).next();
    while (sibling.length > 0) {
      if (/^h[1-6]$/i.test(sibling[0]?.tagName || "")) {
        break;
      }
      const value = normalizeWhitespace(sibling.text());
      if (value) {
        values.push(value);
      }
      sibling = sibling.next();
    }
    found = values.join(" ");
  });
  return found;
}

function inferGradesVisible(parsed) {
  if (typeof parsed?.grades_visible === "boolean") {
    return parsed.grades_visible;
  }
  if (normalizePointValue(parsed?.assignment_submission?.score)) {
    return true;
  }
  if ((parsed?.question_submissions || []).some((submission) => normalizePointValue(submission?.score))) {
    return true;
  }
  if ((parsed?.rubric_items || []).some((item) => item?.present)) {
    return true;
  }
  if ((parsed?.autograder_results?.tests || []).length > 0) {
    return true;
  }
  return null;
}

function buildQuestionResults(parsed, gradesVisible) {
  const questions = Array.isArray(parsed?.questions) ? parsed.questions : [];
  const submissions = Array.isArray(parsed?.question_submissions) ? parsed.question_submissions : [];
  const rubricItems = Array.isArray(parsed?.rubric_items) ? parsed.rubric_items : [];
  const submissionByQuestionId = new Map(submissions.map((submission) => [formatId(submission?.question_id), submission]));
  const rubricByQuestionId = new Map();

  for (const item of rubricItems) {
    const questionId = formatId(item?.question_id);
    if (!questionId) {
      continue;
    }
    const existing = rubricByQuestionId.get(questionId) || [];
    existing.push(item);
    rubricByQuestionId.set(questionId, existing);
  }

  const questionIds = dedupeNonEmpty([
    ...(parsed?.inorder_leaf_question_ids || []).map(formatId),
    ...questions.map((question) => formatId(question?.id)),
    ...submissions.map((submission) => formatId(submission?.question_id)),
    ...rubricItems.map((item) => formatId(item?.question_id)),
  ]);

  return questionIds.map((questionId, index) => {
    const question = questions.find((candidate) => formatId(candidate?.id) === questionId) || {};
    const submission = submissionByQuestionId.get(questionId) || {};
    const rubric = (rubricByQuestionId.get(questionId) || [])
      .filter((item) => item?.present)
      .map((item) => buildRubricItem(item));
    const annotations = Array.isArray(submission?.annotations)
      ? submission.annotations.map((annotation) => normalizeWhitespace(annotation?.content)).filter(Boolean)
      : [];
    const comments = Array.isArray(submission?.evaluations)
      ? submission.evaluations.map((evaluation) => normalizeWhitespace(evaluation?.comments)).filter(Boolean)
      : [];
    const answers = extractAnswerLines(submission?.answers);
    const score = gradesVisible === false ? "" : normalizePointValue(submission?.score);
    const maxScore = gradesVisible === false ? "" : normalizePointValue(question?.weight);
    const scoreDisplay = formatScoreDisplay(score, maxScore);

    return {
      questionId,
      index: normalizeWhitespace(question?.full_index || question?.index || index + 1),
      title: normalizeWhitespace(question?.title || `Question ${index + 1}`),
      score,
      maxScore,
      scoreDisplay,
      rubricItems: rubric,
      annotations,
      comments,
      answers,
    };
  }).filter((item) => item.title || item.answers.length || item.rubricItems.length || item.annotations.length || item.scoreDisplay);
}

function buildRubricItem(item) {
  const lines = String(item?.description || "")
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);

  return {
    title: lines[0] || "",
    details: lines.slice(1).map((line) => line.replace(/^[-*]\s*/, "")).filter(Boolean),
    weight: normalizePointValue(item?.weight),
  };
}

function extractAnswerLines(value) {
  const values = [];
  walkAnswerValues(value, values);
  return dedupeNonEmpty(values.map((item) => normalizeWhitespace(item)));
}

function walkAnswerValues(value, values) {
  if (Array.isArray(value)) {
    for (const item of value) {
      walkAnswerValues(item, values);
    }
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      walkAnswerValues(item, values);
    }
    return;
  }
  const text = normalizeWhitespace(value);
  if (text) {
    values.push(text);
  }
}

function buildQuestionResponse(questionResults, gradesVisible) {
  const lines = [];
  let kind = "";

  for (const question of questionResults) {
    const hasDetail = Boolean(
      question.scoreDisplay
        || question.answers.length
        || question.rubricItems.length
        || question.annotations.length
        || question.comments.length,
    );
    if (!hasDetail) {
      continue;
    }

    const header = [`${question.index}. ${question.title}`];
    if (question.scoreDisplay) {
      header.push(question.scoreDisplay);
    }
    lines.push(header.join(" | "));

    if (!kind) {
      kind = gradesVisible ? "feedback" : "submission";
    }

    for (const answer of question.answers) {
      lines.push(`  answer: ${answer}`);
    }
    for (const item of question.rubricItems) {
      const rubricParts = [item.title];
      if (item.weight && item.weight !== "0") {
        rubricParts.push(`${item.weight} pt`);
      }
      lines.push(`  rubric: ${rubricParts.filter(Boolean).join(" | ")}`);
      for (const detail of item.details) {
        lines.push(`    ${detail}`);
      }
    }
    for (const comment of question.comments) {
      lines.push(`  comment: ${comment}`);
    }
    for (const annotation of question.annotations) {
      lines.push(`  annotation: ${annotation}`);
    }
  }

  return {
    text: lines.join("\n"),
    kind,
  };
}

function buildAutograderResults(rawAutograder) {
  if (!rawAutograder || !Array.isArray(rawAutograder.tests)) {
    return [];
  }

  return rawAutograder.tests.map((test, index) => {
    const score = normalizePointValue(test?.score);
    const maxScore = normalizePointValue(test?.max_score);
    return {
      index: index + 1,
      name: normalizeWhitespace(test?.name || `Test ${index + 1}`),
      score,
      maxScore,
      scoreDisplay: formatScoreDisplay(score, maxScore),
      status: normalizeWhitespace(test?.status),
      output: normalizeMultilineText(test?.output),
    };
  }).filter((test) => test.name || test.scoreDisplay || test.output || test.status);
}

function buildAutograderMessage(rawAutograder, autograderResults) {
  const lines = [];
  for (const test of autograderResults) {
    const header = [test.name];
    if (test.scoreDisplay) {
      header.push(test.scoreDisplay);
    } else if (test.status) {
      header.push(test.status);
    }
    lines.push(header.filter(Boolean).join(" | "));
    if (test.output) {
      for (const line of test.output.split("\n")) {
        lines.push(`  ${line}`);
      }
    }
  }

  const generalOutput = normalizeMultilineText(rawAutograder?.output);
  if (generalOutput) {
    lines.push("output:");
    for (const line of generalOutput.split("\n")) {
      lines.push(`  ${line}`);
    }
  }

  const stdout = normalizeMultilineText(rawAutograder?.stdout);
  if (stdout) {
    lines.push("stdout:");
    for (const line of stdout.split("\n")) {
      lines.push(`  ${line}`);
    }
  }

  const errorCode = normalizeWhitespace(rawAutograder?.error_code);
  if (errorCode) {
    lines.push(`error: ${errorCode}`);
  }

  return lines.join("\n");
}

function shouldSuppressQuestionResponse(questionResults, autograderResults) {
  if (autograderResults.length === 0 || questionResults.length === 0) {
    return false;
  }
  return questionResults.every((question) => (
    normalizeWhitespace(question?.title).toLowerCase() === "autograder"
      && !question.answers.length
      && !question.rubricItems.length
      && !question.annotations.length
      && !question.comments.length
  ));
}

function deriveSubmissionStatus({ rawStatus, gradesVisible, scoreDisplay, questionResults, autograderResults }) {
  if (gradesVisible === false) {
    return "ungraded";
  }
  if (scoreDisplay || questionResults.length || autograderResults.length) {
    return "graded";
  }
  return rawStatus;
}

function normalizeMultilineText(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line, index, lines) => line.trim() || (index > 0 && index < lines.length - 1))
    .join("\n")
    .trim();
}

function absoluteUrlFromPath(pageUrl, relativePath) {
  if (!pageUrl || !relativePath) {
    return "";
  }
  return new URL(relativePath, pageUrl).toString();
}

function formatId(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  return String(value).trim();
}

function normalizePointValue(value) {
  const text = normalizeWhitespace(value);
  if (!text) {
    return "";
  }
  const numeric = Number.parseFloat(text);
  if (!Number.isFinite(numeric)) {
    return text;
  }
  return Number.isInteger(numeric) ? String(numeric) : String(numeric);
}

function formatScoreDisplay(score, maxScore) {
  if (!score) {
    return "";
  }
  if (!maxScore) {
    return score;
  }
  return `${score} / ${maxScore}`;
}

function dedupeNonEmpty(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const normalized = normalizeWhitespace(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function firstNonEmpty(...values) {
  return values.map(normalizeWhitespace).find(Boolean) || "";
}
