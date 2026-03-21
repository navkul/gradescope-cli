import test from "node:test";
import assert from "node:assert/strict";
import {
  extractAssignmentsFromCoursePage,
  extractCoursesFromAccountPage,
  extractSubmissionResultFromPage,
} from "../playwright/core.mjs";

const browserCapability = await detectBrowserCapability();

test("extractCoursesFromAccountPage reads course ids and labels from the account page", async (t) => {
  if (!browserCapability.available) {
    t.skip(browserCapability.reason);
    return;
  }
  await withPage(`
    <html>
      <body>
        <a href="/courses/123">
          <div class="courseBox--shortname">CS101</div>
          <div class="courseBox--name">Intro to Testing</div>
        </a>
        <a href="/courses/456">Distributed Systems</a>
      </body>
    </html>
  `, async (page) => {
    const courses = await extractCoursesFromAccountPage(page, "https://www.gradescope.com");
    assert.equal(courses.length, 2);
    assert.equal(courses[0].id, "123");
    assert.equal(courses[0].short, "CS101");
    assert.equal(courses[0].name, "Intro to Testing");
  });
});

test("extractAssignmentsFromCoursePage keeps rows even when no assignment id is visible", async (t) => {
  if (!browserCapability.available) {
    t.skip(browserCapability.reason);
    return;
  }
  await withPage(`
    <html>
      <body>
        <table id="assignments-student-table">
          <tbody>
            <tr>
              <th scope="row">
                <a href="/courses/123/assignments/789/submissions/456">Homework 1</a>
              </th>
              <td class="submissionStatus">10 / 10</td>
            </tr>
            <tr>
              <th scope="row">Homework 2</th>
              <td class="submissionStatus">No Submission</td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  `, async (page) => {
    const assignments = await extractAssignmentsFromCoursePage(page, "123", "https://www.gradescope.com");
    assert.equal(assignments.length, 2);
    assert.equal(assignments[0].id, "789");
    assert.equal(assignments[0].status, "10 / 10");
    assert.equal(assignments[1].id, "");
    assert.equal(assignments[1].title, "Homework 2");
  });
});

test("extractSubmissionResultFromPage reads react props and autograder text", async (t) => {
  if (!browserCapability.available) {
    t.skip(browserCapability.reason);
    return;
  }
  await withPage(`
    <html>
      <body>
        <div
          data-react-class="AssignmentSubmissionViewer"
          data-react-props='{"assignment_submission":{"id":321,"status":"processed"},"paths":{"submission_path":"/courses/1/assignments/2/submissions/321"}}'
        ></div>
        <h2>Autograder Output</h2>
        <div>Queued for grading</div>
      </body>
    </html>
  `, async (page) => {
    const submission = await extractSubmissionResultFromPage(
      page,
      "https://www.gradescope.com/courses/1/assignments/2/submissions/321",
    );
    assert.equal(submission.submissionId, "321");
    assert.equal(submission.status, "processed");
    assert.equal(submission.url, "https://www.gradescope.com/courses/1/assignments/2/submissions/321");
    assert.equal(submission.autograderMessage, "Queued for grading");
    assert.equal(submission.hasAutograder, true);
  });
});

async function withPage(html, callback) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || "0";
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    await callback(page);
  } finally {
    await browser.close();
  }
}

async function detectBrowserCapability() {
  process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || "0";
  const { chromium } = await import("playwright");

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    return { available: true, reason: "" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      available: false,
      reason: `Chromium launch is blocked in this environment: ${message.split("\n")[0]}`,
    };
  } finally {
    await browser?.close().catch(() => {});
  }
}
