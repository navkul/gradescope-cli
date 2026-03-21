package gradescope

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"
	"github.com/arnavkulkarni/gradescope-cli/internal/config"
	"github.com/arnavkulkarni/gradescope-cli/internal/credentials"
)

var courseHrefPattern = regexp.MustCompile(`^/courses/(\d+)$`)

const (
	userAgent                = "gradescope-cli/0.1"
	flashErrorSelector       = ".alert-error, .alert-flashMessage.alert-error, .flash-error, .error"
	courseShortSelector      = ".courseBox--shortname, .courseBox__shortname, .courseShortname"
	courseNameSelector       = ".courseBox--name, .courseBox__name, .courseName, .course-name"
	assignmentTitleSelector  = ".assignmentTitle, .table--primaryLink"
	assignmentStatusSelector = ".submissionStatus, .label, .status"
	submissionBodySelector   = ".submissionBody, .submissionContent, .submission"
	autograderOutputSelector = ".autograderResults, .autograder-output, .autograderOutput"
)

type HTTPStatusError struct {
	StatusCode int
	Method     string
	URL        string
}

func (e *HTTPStatusError) Error() string {
	return fmt.Sprintf("%s %s returned HTTP %d", e.Method, e.URL, e.StatusCode)
}

type Client struct {
	baseURL  string
	http     *http.Client
	debugDir string
}

type SubmitOptions struct {
	CourseID     string
	AssignmentID string
	FilePath     string
}

func New(baseURL string, jar http.CookieJar, debugDir string) *Client {
	if baseURL == "" {
		baseURL = config.DefaultBaseURL
	}

	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		http: &http.Client{
			Jar:     jar,
			Timeout: 90 * time.Second,
		},
		debugDir: debugDir,
	}
}

func (c *Client) BaseURL() string {
	return c.baseURL
}

func (c *Client) Login(ctx context.Context, creds credentials.Credentials) error {
	loginPage, finalURL, err := c.getDocument(ctx, "/login")
	if err != nil {
		return fmt.Errorf("load login page: %w", err)
	}

	form, err := parseForm(loginPage, finalURL.String(), func(sel *goquery.Selection) bool {
		action, _ := sel.Attr("action")
		method, _ := sel.Attr("method")
		return strings.EqualFold(strings.TrimSpace(method), "post") && strings.HasSuffix(action, "/login")
	})
	if err != nil {
		return fmt.Errorf("parse login form: %w", err)
	}

	form.Fields["session[email]"] = creds.Email
	form.Fields["session[password]"] = creds.Password
	if _, exists := form.Fields["session[remember_me]"]; !exists {
		form.Fields["session[remember_me]"] = "0"
	}
	form.Fields["commit"] = "Log In"

	doc, finalURL, err := c.submitForm(ctx, form, nil)
	if err != nil {
		return fmt.Errorf("submit login form: %w", err)
	}

	if flash := extractFlashMessage(doc); flash != "" {
		return errors.New(flash)
	}

	if strings.HasPrefix(finalURL.Path, "/login") {
		return errors.New("login did not establish an authenticated session")
	}

	return nil
}

func (c *Client) CheckAuthenticated(ctx context.Context) error {
	doc, finalURL, err := c.getDocument(ctx, "/account")
	if err != nil {
		return err
	}

	if strings.HasPrefix(finalURL.Path, "/login") {
		return errors.New("session is not authenticated")
	}

	if flash := extractFlashMessage(doc); flash != "" {
		return errors.New(flash)
	}

	return nil
}

func (c *Client) ListCourses(ctx context.Context) ([]Course, error) {
	doc, finalURL, err := c.getDocument(ctx, "/account")
	if err != nil {
		return nil, err
	}

	if strings.HasPrefix(finalURL.Path, "/login") {
		return nil, errors.New("not logged in")
	}

	courses := extractCourses(doc, c.baseURL)
	if len(courses) == 0 {
		_ = c.writeDebug("courses-account.html", doc)
		return nil, errors.New("no courses found on account page")
	}

	return courses, nil
}

func (c *Client) ListAssignments(ctx context.Context, courseID string) ([]Assignment, error) {
	doc, finalURL, err := c.getDocument(ctx, fmt.Sprintf("/courses/%s", courseID))
	if err != nil {
		return nil, err
	}

	if strings.HasPrefix(finalURL.Path, "/login") {
		return nil, errors.New("not logged in")
	}

	assignments := extractAssignments(doc, c.baseURL, courseID)
	if len(assignments) == 0 {
		_ = c.writeDebug(fmt.Sprintf("course-%s.html", courseID), doc)
		return nil, errors.New("no assignments found on course page")
	}

	return assignments, nil
}

func (c *Client) Submit(ctx context.Context, options SubmitOptions) (*SubmissionResult, error) {
	options.CourseID = strings.TrimSpace(options.CourseID)
	options.AssignmentID = strings.TrimSpace(options.AssignmentID)
	options.FilePath = strings.TrimSpace(options.FilePath)

	if options.AssignmentID == "" {
		return nil, errors.New("missing assignment ID")
	}
	if options.FilePath == "" {
		return nil, errors.New("missing file path")
	}

	backend := strings.ToLower(strings.TrimSpace(os.Getenv("GRADESCOPE_SUBMIT_BACKEND")))
	if backend == "" {
		backend = "auto"
	}

	switch backend {
	case "auto", "playwright":
		return c.submitWithPlaywright(ctx, options)
	case "http":
		return nil, errors.New("the Go-only HTTP submit backend is disabled because it does not complete live Gradescope submissions; use the default Playwright submit backend instead")
	default:
		return nil, fmt.Errorf("unsupported GRADESCOPE_SUBMIT_BACKEND %q", backend)
	}
}

func (c *Client) Result(ctx context.Context, submissionID string) (*SubmissionResult, error) {
	doc, finalURL, err := c.getDocument(ctx, resolveSubmissionReference(submissionID))
	if err != nil {
		var statusErr *HTTPStatusError
		if errors.As(err, &statusErr) && statusErr.StatusCode == http.StatusNotFound && !looksLikeSubmissionPath(submissionID) {
			return nil, fmt.Errorf("submission %s was not found at /submissions/%s; use the full nested submission URL instead, for example /courses/<course>/assignments/<assignment>/submissions/%s", submissionID, submissionID, submissionID)
		}
		return nil, err
	}

	if strings.HasPrefix(finalURL.Path, "/login") {
		return nil, errors.New("not logged in")
	}

	result := extractSubmissionResult(doc, finalURL.String())
	if result.SubmissionID == "" {
		result.SubmissionID = submissionID
	}

	return &result, nil
}

type form struct {
	ActionURL     string
	Method        string
	Fields        map[string]string
	FileFieldName string
}

func (c *Client) getDocument(ctx context.Context, path string) (*goquery.Document, *url.URL, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.resolveURL(path), nil)
	if err != nil {
		return nil, nil, err
	}

	req.Header.Set("User-Agent", userAgent)

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, nil, err
	}

	if resp.StatusCode >= http.StatusBadRequest {
		return nil, resp.Request.URL, &HTTPStatusError{
			StatusCode: resp.StatusCode,
			Method:     req.Method,
			URL:        resp.Request.URL.String(),
		}
	}

	doc, err := goquery.NewDocumentFromReader(bytes.NewReader(body))
	if err != nil {
		return nil, nil, err
	}

	return doc, resp.Request.URL, nil
}

func (c *Client) submitForm(ctx context.Context, frm form, file *uploadFile) (*goquery.Document, *url.URL, error) {
	method := strings.ToUpper(strings.TrimSpace(frm.Method))
	if method == "" {
		method = http.MethodPost
	}

	var (
		body        io.Reader
		contentType string
	)

	if file == nil {
		values := url.Values{}
		for key, value := range frm.Fields {
			values.Set(key, value)
		}
		body = strings.NewReader(values.Encode())
		contentType = "application/x-www-form-urlencoded"
	} else {
		var buffer bytes.Buffer
		writer := multipart.NewWriter(&buffer)
		for key, value := range frm.Fields {
			if err := writer.WriteField(key, value); err != nil {
				return nil, nil, err
			}
		}
		part, err := writer.CreateFormFile(file.FieldName, file.FileName)
		if err != nil {
			return nil, nil, err
		}
		if _, err := io.Copy(part, file.Reader); err != nil {
			return nil, nil, err
		}
		if err := writer.Close(); err != nil {
			return nil, nil, err
		}
		body = &buffer
		contentType = writer.FormDataContentType()
	}

	req, err := http.NewRequestWithContext(ctx, method, frm.ActionURL, body)
	if err != nil {
		return nil, nil, err
	}

	req.Header.Set("Content-Type", contentType)
	req.Header.Set("User-Agent", userAgent)

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, nil, err
	}

	if resp.StatusCode >= http.StatusBadRequest {
		return nil, resp.Request.URL, &HTTPStatusError{
			StatusCode: resp.StatusCode,
			Method:     req.Method,
			URL:        resp.Request.URL.String(),
		}
	}

	doc, err := goquery.NewDocumentFromReader(bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, nil, err
	}

	return doc, resp.Request.URL, nil
}

func (c *Client) resolveURL(path string) string {
	if strings.HasPrefix(path, "http://") || strings.HasPrefix(path, "https://") {
		return path
	}

	if strings.HasPrefix(path, "/") {
		return c.baseURL + path
	}

	return c.baseURL + "/" + path
}

type uploadFile struct {
	FieldName string
	FileName  string
	Reader    io.Reader
}

func parseForm(doc *goquery.Document, pageURL string, match func(*goquery.Selection) bool) (form, error) {
	var (
		result form
		found  bool
	)

	doc.Find("form").EachWithBreak(func(_ int, sel *goquery.Selection) bool {
		if !match(sel) {
			return true
		}

		result = buildForm(sel, pageURL)
		found = true
		return false
	})

	if !found {
		return form{}, errors.New("matching form not found")
	}

	return result, nil
}

func parseUploadForm(doc *goquery.Document, pageURL string) (form, error) {
	var (
		result form
		found  bool
	)

	doc.Find("form").EachWithBreak(func(_ int, sel *goquery.Selection) bool {
		if !strings.EqualFold(strings.TrimSpace(selectionAttr(sel, "method")), "post") {
			return true
		}

		fileFieldName := ""
		sel.Find("input[type='file']").EachWithBreak(func(_ int, input *goquery.Selection) bool {
			name := strings.TrimSpace(selectionAttr(input, "name"))
			if name == "" {
				return true
			}
			fileFieldName = name
			return false
		})

		if fileFieldName == "" {
			return true
		}

		result = buildForm(sel, pageURL)
		result.FileFieldName = fileFieldName
		found = true
		return false
	})

	if !found {
		return form{}, errors.New("submission form not found on assignment page")
	}

	return result, nil
}

func buildForm(sel *goquery.Selection, pageURL string) form {
	action := strings.TrimSpace(selectionAttr(sel, "action"))
	if action == "" {
		action = pageURL
	}

	parsedPageURL, _ := url.Parse(pageURL)
	parsedActionURL, err := parsedPageURL.Parse(action)
	if err != nil {
		parsedActionURL = parsedPageURL
	}

	fields := map[string]string{}
	sel.Find("input, textarea, select").Each(func(_ int, input *goquery.Selection) {
		name := strings.TrimSpace(selectionAttr(input, "name"))
		if name == "" {
			return
		}

		inputType := strings.ToLower(strings.TrimSpace(selectionAttr(input, "type")))
		if inputType == "file" || inputType == "submit" || inputType == "button" {
			return
		}
		if inputType == "checkbox" || inputType == "radio" {
			if _, ok := input.Attr("checked"); !ok {
				return
			}
		}

		value := strings.TrimSpace(selectionAttr(input, "value"))
		if goquery.NodeName(input) == "textarea" {
			value = strings.TrimSpace(input.Text())
		}
		if goquery.NodeName(input) == "select" {
			option := input.Find("option[selected]")
			if option.Length() == 0 {
				option = input.Find("option").First()
			}
			if option.Length() > 0 {
				value = strings.TrimSpace(selectionAttr(option, "value"))
			}
		}

		fields[name] = value
	})

	return form{
		ActionURL: parsedActionURL.String(),
		Method:    strings.ToUpper(strings.TrimSpace(selectionAttr(sel, "method"))),
		Fields:    fields,
	}
}

func extractFlashMessage(doc *goquery.Document) string {
	return normalizeWhitespace(doc.Find(flashErrorSelector).First().Text())
}

func extractCourses(doc *goquery.Document, baseURL string) []Course {
	seen := map[string]bool{}
	courses := []Course{}

	doc.Find("a[href]").Each(func(_ int, sel *goquery.Selection) {
		href := strings.TrimSpace(selectionAttr(sel, "href"))
		matches := courseHrefPattern.FindStringSubmatch(href)
		if len(matches) != 2 {
			return
		}

		courseID := matches[1]
		if seen[courseID] {
			return
		}

		raw := normalizeWhitespace(sel.Text())
		short := normalizeWhitespace(findNearbyText(sel, courseShortSelector))
		if short == "" {
			short = firstLine(raw)
		}
		name := normalizeWhitespace(findNearbyText(sel, courseNameSelector))
		if name == "" {
			name = stripLeadingCourseShort(raw, short)
		}
		if name == "" {
			name = raw
		}

		seen[courseID] = true
		courses = append(courses, Course{
			ID:    courseID,
			Name:  name,
			URL:   absoluteURL(baseURL, href),
			Raw:   raw,
			Short: short,
		})
	})

	return courses
}

func extractAssignments(doc *goquery.Document, baseURL, courseID string) []Assignment {
	tableAssignments := extractAssignmentsFromTable(doc, baseURL, courseID)
	if len(tableAssignments) > 0 {
		return tableAssignments
	}

	seen := map[string]bool{}
	assignments := []Assignment{}
	prefixes := []string{
		fmt.Sprintf("/courses/%s/assignments/", courseID),
		"/assignments/",
	}

	doc.Find("a[href]").Each(func(_ int, sel *goquery.Selection) {
		href := strings.TrimSpace(selectionAttr(sel, "href"))
		if href == "" {
			return
		}

		matchesPrefix := false
		for _, prefix := range prefixes {
			if strings.HasPrefix(href, prefix) {
				matchesPrefix = true
				break
			}
		}
		if !matchesPrefix {
			return
		}

		id := extractAssignmentID(href)
		if id == "" {
			id = lastNumericPathSegment(href)
		}
		if id == "" || seen[id] {
			return
		}

		title := normalizeWhitespace(sel.Text())
		if title == "" {
			title = normalizeWhitespace(findNearbyText(sel, assignmentTitleSelector))
		}
		if title == "" {
			return
		}

		status := normalizeWhitespace(findNearbyText(sel, assignmentStatusSelector))

		seen[id] = true
		assignments = append(assignments, Assignment{
			ID:       id,
			CourseID: courseID,
			Title:    title,
			URL:      absoluteURL(baseURL, href),
			Status:   status,
			Raw:      title,
		})
	})

	return assignments
}

func extractAssignmentsFromTable(doc *goquery.Document, baseURL, courseID string) []Assignment {
	rows := doc.Find("#assignments-student-table tbody tr")
	if rows.Length() == 0 {
		return nil
	}

	seen := map[string]bool{}
	assignments := []Assignment{}

	rows.Each(func(_ int, row *goquery.Selection) {
		header := row.Find("th[scope='row']").First()
		title := normalizeWhitespace(header.Text())
		if title == "" {
			return
		}

		link := header.Find("a[href]").First()
		href := strings.TrimSpace(selectionAttr(link, "href"))
		id := extractAssignmentID(href)
		if id == "" || seen[id] {
			return
		}

		status := normalizeWhitespace(row.Find(".submissionStatus").First().Text())

		seen[id] = true
		assignments = append(assignments, Assignment{
			ID:       id,
			CourseID: courseID,
			Title:    title,
			URL:      absoluteURL(baseURL, href),
			Status:   status,
			Raw:      normalizeWhitespace(row.Text()),
		})
	})

	return assignments
}

func extractSubmissionResult(doc *goquery.Document, pageURL string) SubmissionResult {
	result := SubmissionResult{
		URL: pageURL,
		Status: normalizeWhitespace(firstNonEmpty(
			doc.Find(".submissionStatus").First().Text(),
			doc.Find(".alert-success").First().Text(),
			doc.Find("title").First().Text(),
		)),
		Response: normalizeWhitespace(firstNonEmpty(
			findSectionText(doc, "Submission"),
			findSectionText(doc, "Response"),
			findSectionText(doc, "Results"),
			doc.Find(submissionBodySelector).First().Text(),
		)),
		AutograderMessage: normalizeWhitespace(firstNonEmpty(
			findSectionText(doc, "Autograder"),
			findSectionText(doc, "Autograder Output"),
			findSectionText(doc, "Output"),
			doc.Find(autograderOutputSelector).First().Text(),
		)),
	}

	if result.Response == result.Status {
		result.Response = ""
	}
	result.HasAutograder = result.AutograderMessage != ""
	result.SubmissionID = extractSubmissionIDFromURL(pageURL)

	if reactResult, ok := extractSubmissionReactResult(doc, pageURL); ok {
		if reactResult.SubmissionID != "" {
			result.SubmissionID = reactResult.SubmissionID
		}
		if reactResult.URL != "" {
			result.URL = reactResult.URL
		}
		if reactResult.Status != "" {
			result.Status = reactResult.Status
		}
		if result.Response == "" && reactResult.Response != "" {
			result.Response = reactResult.Response
		}
		if reactResult.AutograderMessage != "" {
			result.AutograderMessage = reactResult.AutograderMessage
			result.HasAutograder = true
		}
	}

	return result
}

type submissionReactProps struct {
	AssignmentSubmission struct {
		ID     int64  `json:"id"`
		Status string `json:"status"`
	} `json:"assignment_submission"`
	Paths struct {
		SubmissionPath string `json:"submission_path"`
	} `json:"paths"`
	Alert  string   `json:"alert"`
	Alerts []string `json:"alerts"`
}

func extractSubmissionReactResult(doc *goquery.Document, pageURL string) (SubmissionResult, bool) {
	node := doc.Find(`[data-react-class="AssignmentSubmissionViewer"]`).First()
	if node.Length() == 0 {
		return SubmissionResult{}, false
	}

	raw := html.UnescapeString(selectionAttr(node, "data-react-props"))
	if strings.TrimSpace(raw) == "" {
		return SubmissionResult{}, false
	}

	var props submissionReactProps
	if err := json.Unmarshal([]byte(raw), &props); err != nil {
		return SubmissionResult{}, false
	}

	result := SubmissionResult{
		SubmissionID: formatIntID(props.AssignmentSubmission.ID),
		URL:          absoluteURLFromPage(pageURL, props.Paths.SubmissionPath),
		Status:       normalizeWhitespace(props.AssignmentSubmission.Status),
		Response:     normalizeWhitespace(firstNonEmpty(props.Alert, strings.Join(props.Alerts, " "))),
	}
	return result, true
}

func extractSubmissionIDFromURL(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}
	return extractSubmissionID(parsed.Path)
}

func extractSubmissionID(path string) string {
	re := regexp.MustCompile(`/submissions/(\d+)`)
	matches := re.FindStringSubmatch(path)
	if len(matches) == 2 {
		return matches[1]
	}
	return ""
}

func extractAssignmentID(path string) string {
	re := regexp.MustCompile(`/assignments/(\d+)`)
	matches := re.FindStringSubmatch(path)
	if len(matches) == 2 {
		return matches[1]
	}
	return ""
}

func findSectionText(doc *goquery.Document, heading string) string {
	var result string

	doc.Find("h1, h2, h3, h4, h5, h6").EachWithBreak(func(_ int, sel *goquery.Selection) bool {
		if !strings.Contains(strings.ToLower(normalizeWhitespace(sel.Text())), strings.ToLower(heading)) {
			return true
		}

		for sibling := sel.Next(); sibling.Length() > 0; sibling = sibling.Next() {
			if isHeading(sibling) {
				break
			}
			text := normalizeWhitespace(sibling.Text())
			if text != "" {
				result = text
				return false
			}
		}

		container := sel.Parent()
		if container.Length() == 0 {
			result = ""
			return false
		}
		switch strings.ToLower(goquery.NodeName(container)) {
		case "body", "html":
			result = ""
			return false
		}
		if container.Find("h1, h2, h3, h4, h5, h6").Length() > 1 {
			result = ""
			return false
		}
		result = stripSectionHeading(normalizeWhitespace(container.Text()), normalizeWhitespace(sel.Text()))
		return false
	})

	return result
}

func isHeading(sel *goquery.Selection) bool {
	switch strings.ToLower(goquery.NodeName(sel)) {
	case "h1", "h2", "h3", "h4", "h5", "h6":
		return true
	default:
		return false
	}
}

func findNearbyText(sel *goquery.Selection, selector string) string {
	text := normalizeWhitespace(sel.Find(selector).First().Text())
	if text != "" {
		return text
	}

	parent := sel.Parent()
	if parent.Length() == 0 {
		return ""
	}

	return normalizeWhitespace(parent.Find(selector).First().Text())
}

func selectionAttr(sel *goquery.Selection, name string) string {
	value, _ := sel.Attr(name)
	return value
}

func lastNumericPathSegment(path string) string {
	re := regexp.MustCompile(`(\d+)(?:/)?$`)
	matches := re.FindStringSubmatch(path)
	if len(matches) == 2 {
		return matches[1]
	}
	return ""
}

func absoluteURL(baseURL, href string) string {
	base, err := url.Parse(baseURL)
	if err != nil {
		return href
	}
	parsed, err := base.Parse(href)
	if err != nil {
		return href
	}
	return parsed.String()
}

func absoluteURLFromPage(pageURL, href string) string {
	if strings.TrimSpace(href) == "" {
		return ""
	}

	base, err := url.Parse(pageURL)
	if err != nil {
		return href
	}
	parsed, err := base.Parse(href)
	if err != nil {
		return href
	}
	return parsed.String()
}

func normalizeWhitespace(value string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if normalizeWhitespace(value) != "" {
			return value
		}
	}
	return ""
}

func firstLine(value string) string {
	lines := strings.Split(value, "\n")
	for _, line := range lines {
		line = normalizeWhitespace(line)
		if line != "" {
			return line
		}
	}
	return ""
}

func stripLeadingCourseShort(raw, short string) string {
	raw = normalizeWhitespace(raw)
	short = normalizeWhitespace(short)
	if raw == "" || short == "" {
		return raw
	}

	lowerRaw := strings.ToLower(raw)
	lowerShort := strings.ToLower(short)
	if !strings.HasPrefix(lowerRaw, lowerShort) {
		return raw
	}

	trimmed := strings.TrimSpace(raw[len(short):])
	return strings.TrimSpace(strings.TrimLeft(trimmed, "-|:"))
}

func stripSectionHeading(text, heading string) string {
	text = normalizeWhitespace(text)
	heading = normalizeWhitespace(heading)
	if text == "" || heading == "" {
		return text
	}
	if strings.EqualFold(text, heading) {
		return ""
	}
	if !strings.HasPrefix(strings.ToLower(text), strings.ToLower(heading)) {
		return text
	}

	trimmed := strings.TrimSpace(text[len(heading):])
	trimmed = strings.TrimLeft(trimmed, ":|-")
	return strings.TrimSpace(trimmed)
}

func resolveSubmissionReference(ref string) string {
	ref = strings.TrimSpace(ref)
	if looksLikeSubmissionPath(ref) {
		return ref
	}
	return "/submissions/" + ref
}

func looksLikeSubmissionPath(ref string) bool {
	return strings.Contains(ref, "/submissions/")
}

func formatIntID(id int64) string {
	if id == 0 {
		return ""
	}
	return fmt.Sprintf("%d", id)
}

func (c *Client) writeDebug(name string, doc *goquery.Document) error {
	if c.debugDir == "" {
		return nil
	}

	html, err := doc.Html()
	if err != nil {
		return err
	}

	if err := os.MkdirAll(c.debugDir, 0o755); err != nil {
		return err
	}

	return os.WriteFile(filepath.Join(c.debugDir, name), []byte(html), 0o600)
}
