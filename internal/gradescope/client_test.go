package gradescope

import (
	"strings"
	"testing"

	"github.com/PuerkitoBio/goquery"
)

func TestExtractCourses(t *testing.T) {
	doc := mustDoc(t, `
		<html><body>
		  <a href="/courses/123">
		    <div class="courseBox--shortname">CS101</div>
		    Intro to Testing
		  </a>
		  <a href="/courses/456">History of Systems</a>
		</body></html>
	`)

	courses := extractCourses(doc, "https://www.gradescope.com")
	if len(courses) != 2 {
		t.Fatalf("expected 2 courses, got %d", len(courses))
	}
	if courses[0].ID != "123" || courses[0].Short != "CS101" {
		t.Fatalf("unexpected first course: %+v", courses[0])
	}
	if courses[0].Name != "Intro to Testing" {
		t.Fatalf("unexpected first course name: %+v", courses[0])
	}
}

func TestExtractAssignments(t *testing.T) {
	doc := mustDoc(t, `
		<html><body>
		  <table id="assignments-student-table">
		    <tbody>
		      <tr>
		        <th scope="row"><a href="/courses/123/assignments/789/submissions/456">Homework 1</a></th>
		        <td class="submissionStatus"><div class="submissionStatus--score">10 / 10</div></td>
		      </tr>
		      <tr>
		        <th scope="row"><a href="/courses/123/assignments/790/submissions/457">Homework 2</a></th>
		        <td class="submissionStatus"><div class="submissionStatus--text">Submitted</div></td>
		      </tr>
		      <tr>
		        <th scope="row">Homework 3</th>
		        <td class="submissionStatus"><div class="submissionStatus--text">No Submission</div></td>
		      </tr>
		    </tbody>
		  </table>
		</body></html>
	`)

	assignments := extractAssignments(doc, "https://www.gradescope.com", "123")
	if len(assignments) != 2 {
		t.Fatalf("expected 2 assignments, got %d", len(assignments))
	}
	if assignments[0].ID != "789" || assignments[0].Title != "Homework 1" {
		t.Fatalf("unexpected first assignment: %+v", assignments[0])
	}
	if assignments[0].Status != "10 / 10" {
		t.Fatalf("unexpected first assignment status: %+v", assignments[0])
	}
}

func TestParseUploadForm(t *testing.T) {
	doc := mustDoc(t, `
		<html><body>
		  <form action="/assignments/789/submissions" method="post" enctype="multipart/form-data">
		    <input type="hidden" name="authenticity_token" value="abc123" />
		    <input type="file" name="submission[files][]" />
		    <button type="submit">Submit</button>
		  </form>
		</body></html>
	`)

	form, err := parseUploadForm(doc, "https://www.gradescope.com/assignments/789")
	if err != nil {
		t.Fatalf("expected upload form, got error: %v", err)
	}
	if form.ActionURL != "https://www.gradescope.com/assignments/789/submissions" {
		t.Fatalf("unexpected form action: %s", form.ActionURL)
	}
	if form.FileFieldName != "submission[files][]" {
		t.Fatalf("unexpected file field: %s", form.FileFieldName)
	}
	if form.Fields["authenticity_token"] != "abc123" {
		t.Fatalf("expected authenticity token to be preserved")
	}
}

func TestExtractSubmissionResult(t *testing.T) {
	doc := mustDoc(t, `
		<html><body>
		  <div data-react-class="AssignmentSubmissionViewer" data-react-props='{"assignment_submission":{"id":321,"status":"processed"},"paths":{"submission_path":"/courses/1/assignments/2/submissions/321"}}'></div>
		</body></html>
	`)

	result := extractSubmissionResult(doc, "https://www.gradescope.com/submissions/321")
	if result.SubmissionID != "321" {
		t.Fatalf("unexpected submission id: %s", result.SubmissionID)
	}
	if result.Status != "processed" {
		t.Fatalf("unexpected status: %s", result.Status)
	}
	if result.URL != "https://www.gradescope.com/courses/1/assignments/2/submissions/321" {
		t.Fatalf("unexpected submission url: %+v", result)
	}
}

func TestExtractSubmissionResultWithoutVisibleResponse(t *testing.T) {
	doc := mustDoc(t, `
		<html><body>
		  <div class="alert-success">Submission received</div>
		  <h2>Response</h2>
		  <h2>Autograder Output</h2>
		  <div>Queued for grading</div>
		</body></html>
	`)

	result := extractSubmissionResult(doc, "https://www.gradescope.com/submissions/654")
	if result.Response != "" {
		t.Fatalf("expected empty response, got %q", result.Response)
	}
	if !result.HasAutograder || result.AutograderMessage != "Queued for grading" {
		t.Fatalf("unexpected autograder parsing: %+v", result)
	}
}

func TestResolveSubmissionReference(t *testing.T) {
	if got := resolveSubmissionReference("123"); got != "/submissions/123" {
		t.Fatalf("unexpected bare submission reference: %s", got)
	}
	if got := resolveSubmissionReference("/courses/1/assignments/2/submissions/123"); got != "/courses/1/assignments/2/submissions/123" {
		t.Fatalf("unexpected path submission reference: %s", got)
	}
}

func mustDoc(t *testing.T, html string) *goquery.Document {
	t.Helper()
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
	if err != nil {
		t.Fatalf("build document: %v", err)
	}
	return doc
}
