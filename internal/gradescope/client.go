package gradescope

import (
	"bytes"
	"context"
	"errors"
	"fmt"
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

type Client struct {
	baseURL  string
	http     *http.Client
	debugDir string
}

type SubmitOptions struct {
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
	doc, finalURL, err := c.getDocument(ctx, fmt.Sprintf("/assignments/%s", options.AssignmentID))
	if err != nil {
		return nil, err
	}

	if strings.HasPrefix(finalURL.Path, "/login") {
		return nil, errors.New("not logged in")
	}

	form, err := parseUploadForm(doc, finalURL.String())
	if err != nil {
		_ = c.writeDebug(fmt.Sprintf("assignment-%s.html", options.AssignmentID), doc)
		return nil, err
	}

	file, err := os.Open(options.FilePath)
	if err != nil {
		return nil, fmt.Errorf("open file: %w", err)
	}
	defer file.Close()

	doc, finalURL, err = c.submitForm(ctx, form, &uploadFile{
		FieldName: form.FileFieldName,
		FileName:  filepath.Base(options.FilePath),
		Reader:    file,
	})
	if err != nil {
		return nil, fmt.Errorf("submit assignment file: %w", err)
	}

	result := extractSubmissionResult(doc, finalURL.String())
	if result.SubmissionID == "" {
		result.SubmissionID = extractSubmissionID(finalURL.Path)
	}

	return &result, nil
}

func (c *Client) Result(ctx context.Context, submissionID string) (*SubmissionResult, error) {
	doc, finalURL, err := c.getDocument(ctx, fmt.Sprintf("/submissions/%s", submissionID))
	if err != nil {
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

	req.Header.Set("User-Agent", "gradescope-cli/0.1")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()

	doc, err := goquery.NewDocumentFromReader(resp.Body)
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
	req.Header.Set("User-Agent", "gradescope-cli/0.1")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()

	doc, err := goquery.NewDocumentFromReader(resp.Body)
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
	return normalizeWhitespace(doc.Find(".alert-error, .alert-flashMessage.alert-error, .flash-error, .error").First().Text())
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
		name := raw
		short := normalizeWhitespace(findNearbyText(sel, ".courseBox--shortname, .courseBox__shortname, .courseShortname"))
		if short == "" {
			short = firstLine(raw)
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
		if !matchesPrefix || strings.Contains(href, "/submissions") {
			return
		}

		id := lastNumericPathSegment(href)
		if id == "" || seen[id] {
			return
		}

		title := normalizeWhitespace(sel.Text())
		if title == "" {
			title = normalizeWhitespace(findNearbyText(sel, ".assignmentTitle, .table--primaryLink"))
		}
		if title == "" {
			return
		}

		status := normalizeWhitespace(findNearbyText(sel, ".submissionStatus, .label, .status"))

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
			doc.Find(".submissionBody, .submissionContent, .submission").First().Text(),
		)),
		AutograderMessage: normalizeWhitespace(firstNonEmpty(
			findSectionText(doc, "Autograder"),
			findSectionText(doc, "Autograder Output"),
			findSectionText(doc, "Output"),
			doc.Find(".autograderResults, .autograder-output, .autograderOutput").First().Text(),
		)),
	}

	if result.Response == result.Status {
		result.Response = ""
	}
	result.HasAutograder = result.AutograderMessage != ""
	result.SubmissionID = extractSubmissionIDFromURL(pageURL)

	return result
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

func findSectionText(doc *goquery.Document, heading string) string {
	var result string

	doc.Find("h1, h2, h3, h4, h5, h6").EachWithBreak(func(_ int, sel *goquery.Selection) bool {
		if !strings.Contains(strings.ToLower(normalizeWhitespace(sel.Text())), strings.ToLower(heading)) {
			return true
		}

		container := sel.Parent()
		result = normalizeWhitespace(container.Text())
		return false
	})

	return result
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
