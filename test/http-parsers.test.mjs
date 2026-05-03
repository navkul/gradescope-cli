import test from "node:test";
import assert from "node:assert/strict";
import {
  extractAssignmentsFromCourseHtml,
  extractCoursesFromAccountHtml,
  extractSubmissionForms,
  extractSubmissionResultFromHtml,
} from "../src/parsers.mjs";

test("extractCoursesFromAccountHtml reads course ids and labels", () => {
  const courses = extractCoursesFromAccountHtml(`
    <html>
      <body>
        <a href="/courses/123">
          <div class="courseBox--shortname">CS101</div>
          <div class="courseBox--name">Intro to Testing</div>
        </a>
        <a href="/courses/456">Distributed Systems</a>
      </body>
    </html>
  `, "https://www.gradescope.com");

  assert.equal(courses.length, 2);
  assert.equal(courses[0].id, "123");
  assert.equal(courses[0].short, "CS101");
  assert.equal(courses[0].name, "Intro to Testing");
});

test("extractAssignmentsFromCourseHtml keeps ids from submission links and data attributes", () => {
  const assignments = extractAssignmentsFromCourseHtml(`
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
              <th scope="row">
                <button
                  class="js-submitAssignment"
                  data-assignment-id="999"
                  data-post-url="/courses/123/assignments/999/submissions"
                >
                  Homework 2
                </button>
              </th>
              <td class="submissionStatus">No Submission</td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  `, "123", "https://www.gradescope.com");

  assert.equal(assignments.length, 2);
  assert.equal(assignments[0].id, "789");
  assert.equal(assignments[0].status, "10 / 10");
  assert.equal(assignments[1].id, "999");
  assert.equal(assignments[1].submitPostUrl, "https://www.gradescope.com/courses/123/assignments/999/submissions");
});

test("extractSubmissionResultFromHtml reads embedded result props and visible sections", () => {
  const submission = extractSubmissionResultFromHtml(`
    <html>
      <body>
        <div
          data-react-class="AssignmentSubmissionViewer"
          data-react-props='{"assignment_submission":{"id":321,"status":"processed"},"paths":{"submission_path":"/courses/1/assignments/2/submissions/321"},"alert":"Submission received"}'
        ></div>
        <h2>Response</h2>
        <div>Passed all hidden tests.</div>
        <h2>Autograder Output</h2>
        <div>Queued for grading</div>
      </body>
    </html>
  `, "https://www.gradescope.com/courses/1/assignments/2/submissions/321");

  assert.equal(submission.submissionId, "321");
  assert.equal(submission.courseId, "1");
  assert.equal(submission.assignmentId, "2");
  assert.equal(submission.notice, "Submission received");
  assert.equal(submission.response, "Passed all hidden tests.");
  assert.equal(submission.autograderMessage, "Queued for grading");
});

test("extractSubmissionForms finds hidden fields and file inputs", () => {
  const forms = extractSubmissionForms(`
    <form action="/courses/1/assignments/2/submissions" method="post" enctype="multipart/form-data">
      <input type="hidden" name="authenticity_token" value="token">
      <input type="hidden" name="submission[method]" value="upload">
      <input id="submission_file" type="file" name="submission[files][]">
      <input type="submit" value="Upload">
    </form>
  `, "https://www.gradescope.com");

  assert.equal(forms.length, 1);
  assert.equal(forms[0].action, "https://www.gradescope.com/courses/1/assignments/2/submissions");
  assert.deepEqual(forms[0].fields, [
    { name: "authenticity_token", value: "token" },
    { name: "submission[method]", value: "upload" },
  ]);
  assert.deepEqual(forms[0].fileInputs, [
    { name: "submission[files][]", id: "submission_file", multiple: false },
  ]);
});
