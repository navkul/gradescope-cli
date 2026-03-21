package gradescope

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"
)

const browserSubmitTimeout = 2 * time.Minute

type playwrightSubmitRequest struct {
	BaseURL      string                   `json:"baseUrl"`
	CourseID     string                   `json:"courseId"`
	AssignmentID string                   `json:"assignmentId"`
	FilePath     string                   `json:"filePath"`
	Cookies      []playwrightSubmitCookie `json:"cookies"`
	TimeoutMS    int                      `json:"timeoutMs"`
}

type playwrightSubmitCookie struct {
	Name     string `json:"name"`
	Value    string `json:"value"`
	Domain   string `json:"domain,omitempty"`
	Path     string `json:"path,omitempty"`
	Expires  int64  `json:"expires,omitempty"`
	Secure   bool   `json:"secure"`
	HttpOnly bool   `json:"httpOnly"`
}

type playwrightSubmitResponse struct {
	FinalURL string `json:"finalUrl"`
	HTML     string `json:"html"`
}

func (c *Client) submitWithPlaywright(ctx context.Context, options SubmitOptions) (*SubmissionResult, error) {
	if options.CourseID == "" {
		courseID, err := c.resolveCourseIDForAssignment(ctx, options.AssignmentID)
		if err != nil {
			return nil, err
		}
		options.CourseID = courseID
	}

	helperPath, err := playwrightHelperPath()
	if err != nil {
		return nil, err
	}

	request, err := c.buildPlaywrightSubmitRequest(options)
	if err != nil {
		return nil, err
	}

	response, err := runPlaywrightSubmit(ctx, helperPath, request)
	if err != nil {
		return nil, err
	}

	if strings.TrimSpace(response.HTML) == "" {
		return nil, errors.New("Playwright submit helper returned an empty HTML payload")
	}

	doc, err := goquery.NewDocumentFromReader(strings.NewReader(response.HTML))
	if err != nil {
		return nil, fmt.Errorf("parse Playwright submit result: %w", err)
	}

	result := extractSubmissionResult(doc, response.FinalURL)
	if result.SubmissionID == "" {
		if parsedURL, parseErr := url.Parse(response.FinalURL); parseErr == nil {
			result.SubmissionID = extractSubmissionID(parsedURL.Path)
		}
	}

	return &result, nil
}

func (c *Client) buildPlaywrightSubmitRequest(options SubmitOptions) (playwrightSubmitRequest, error) {
	baseURL, err := url.Parse(c.baseURL)
	if err != nil {
		return playwrightSubmitRequest{}, fmt.Errorf("parse base URL: %w", err)
	}

	cookies := c.http.Jar.Cookies(baseURL)
	if len(cookies) == 0 {
		return playwrightSubmitRequest{}, errors.New("no session cookies available for browser submit; run `gradescope-cli login` first")
	}

	request := playwrightSubmitRequest{
		BaseURL:      c.baseURL,
		CourseID:     options.CourseID,
		AssignmentID: options.AssignmentID,
		FilePath:     options.FilePath,
		TimeoutMS:    int(browserSubmitTimeout / time.Millisecond),
		Cookies:      make([]playwrightSubmitCookie, 0, len(cookies)),
	}

	for _, cookie := range cookies {
		item := playwrightSubmitCookie{
			Name:     cookie.Name,
			Value:    cookie.Value,
			Domain:   cookie.Domain,
			Path:     cookie.Path,
			Secure:   cookie.Secure,
			HttpOnly: cookie.HttpOnly,
		}
		if !cookie.Expires.IsZero() {
			item.Expires = cookie.Expires.Unix()
		}
		request.Cookies = append(request.Cookies, item)
	}

	return request, nil
}

func runPlaywrightSubmit(ctx context.Context, helperPath string, request playwrightSubmitRequest) (*playwrightSubmitResponse, error) {
	workDir := filepath.Dir(filepath.Dir(helperPath))

	requestFile, err := os.CreateTemp("", "gradescope-submit-request-*.json")
	if err != nil {
		return nil, fmt.Errorf("create Playwright request file: %w", err)
	}
	requestPath := requestFile.Name()
	defer os.Remove(requestPath)
	defer requestFile.Close()

	responseFile, err := os.CreateTemp("", "gradescope-submit-response-*.json")
	if err != nil {
		return nil, fmt.Errorf("create Playwright response file: %w", err)
	}
	responsePath := responseFile.Name()
	defer os.Remove(responsePath)
	defer responseFile.Close()

	if err := json.NewEncoder(requestFile).Encode(request); err != nil {
		return nil, fmt.Errorf("write Playwright request: %w", err)
	}
	if err := requestFile.Close(); err != nil {
		return nil, err
	}
	if err := responseFile.Close(); err != nil {
		return nil, err
	}

	runCtx, cancel := context.WithTimeout(ctx, browserSubmitTimeout)
	defer cancel()

	cmd := exec.CommandContext(runCtx, "node", helperPath, requestPath, responsePath)
	cmd.Dir = workDir
	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		message := strings.TrimSpace(stderr.String())
		if errors.Is(err, exec.ErrNotFound) {
			return nil, errors.New("`node` is not installed or not on PATH; install Node.js, run `npm install`, then `npx playwright install chromium`")
		}
		if message == "" {
			message = err.Error()
		}
		return nil, fmt.Errorf("Playwright submit helper failed: %s", message)
	}

	content, err := os.ReadFile(responsePath)
	if err != nil {
		return nil, fmt.Errorf("read Playwright response: %w", err)
	}

	var response playwrightSubmitResponse
	if err := json.Unmarshal(content, &response); err != nil {
		return nil, fmt.Errorf("decode Playwright response: %w", err)
	}

	return &response, nil
}

func (c *Client) resolveCourseIDForAssignment(ctx context.Context, assignmentID string) (string, error) {
	courses, err := c.ListCourses(ctx)
	if err != nil {
		return "", fmt.Errorf("list courses while resolving assignment %s: %w", assignmentID, err)
	}

	for _, course := range courses {
		assignments, err := c.ListAssignments(ctx, course.ID)
		if err != nil {
			continue
		}
		for _, assignment := range assignments {
			if assignment.ID == assignmentID {
				return course.ID, nil
			}
		}
	}

	return "", fmt.Errorf("could not resolve course for assignment %s from the saved session; rerun submit with --course <course-id>", assignmentID)
}

func playwrightHelperPath() (string, error) {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		return "", errors.New("locate Playwright helper: runtime caller lookup failed")
	}

	root := filepath.Dir(filepath.Dir(filepath.Dir(file)))
	helperPath := filepath.Join(root, "playwright", "submit.mjs")
	if _, err := os.Stat(helperPath); err != nil {
		return "", fmt.Errorf("locate Playwright helper at %s: %w", helperPath, err)
	}

	return helperPath, nil
}
