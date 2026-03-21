package cli

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/arnavkulkarni/gradescope-cli/internal/config"
	"github.com/arnavkulkarni/gradescope-cli/internal/credentials"
	"github.com/arnavkulkarni/gradescope-cli/internal/gradescope"
	"github.com/arnavkulkarni/gradescope-cli/internal/session"
)

type App struct {
	sessionPath string
	debugDir    string
	baseURL     string
}

func New() (*App, error) {
	sessionPath, err := config.DefaultSessionPath()
	if err != nil {
		return nil, err
	}

	debugDir, err := config.DefaultDebugDir()
	if err != nil {
		return nil, err
	}

	baseURL := os.Getenv("GRADESCOPE_BASE_URL")
	if baseURL == "" {
		baseURL = config.DefaultBaseURL
	}

	return &App{
		sessionPath: sessionPath,
		debugDir:    debugDir,
		baseURL:     baseURL,
	}, nil
}

func (a *App) Run(ctx context.Context, args []string) error {
	if len(args) == 0 {
		return a.runWizard(ctx, nil)
	}

	switch args[0] {
	case "login":
		return a.runLogin(ctx, args[1:])
	case "classes":
		return a.runClasses(ctx, args[1:])
	case "assignments":
		return a.runAssignments(ctx, args[1:])
	case "submit":
		return a.runSubmit(ctx, args[1:])
	case "result":
		return a.runResult(ctx, args[1:])
	case "wizard", "run":
		return a.runWizard(ctx, args[1:])
	case "help", "--help", "-h":
		a.printHelp()
		return nil
	default:
		return fmt.Errorf("unknown command %q", args[0])
	}
}

func (a *App) runLogin(ctx context.Context, args []string) error {
	flags := flag.NewFlagSet("login", flag.ContinueOnError)
	email := flags.String("email", "", "Gradescope email")
	password := flags.String("password", "", "Gradescope password")
	passwordFile := flags.String("password-file", "", "file containing the Gradescope password")
	credentialsFile := flags.String("credentials-file", "", "JSON or KEY=VALUE credentials file")
	sessionPath := flags.String("session-file", a.sessionPath, "path to store the session file")
	flags.SetOutput(ioDiscard{})
	if err := flags.Parse(args); err != nil {
		return err
	}

	creds, err := credentials.Load(*email, *password, *passwordFile, *credentialsFile)
	if err != nil {
		return err
	}

	client, jar, err := a.newClient(nil)
	if err != nil {
		return err
	}

	if err := client.Login(ctx, creds); err != nil {
		return err
	}

	if err := session.Save(*sessionPath, client.BaseURL(), creds.Email, jar); err != nil {
		return err
	}

	fmt.Printf("logged in successfully; session saved to %s\n", *sessionPath)
	return nil
}

func (a *App) runClasses(ctx context.Context, args []string) error {
	flags := flag.NewFlagSet("classes", flag.ContinueOnError)
	sessionPath := flags.String("session-file", a.sessionPath, "path to the session file")
	flags.SetOutput(ioDiscard{})
	if err := flags.Parse(args); err != nil {
		return err
	}

	client, _, err := a.newClientFromSession(*sessionPath)
	if err != nil {
		return sessionCommandError(*sessionPath, err)
	}

	courses, err := client.ListCourses(ctx)
	if err != nil {
		return err
	}

	for _, course := range courses {
		label := course.Name
		if course.Short != "" && course.Short != course.Name {
			label = fmt.Sprintf("%s | %s", course.Short, course.Name)
		}
		fmt.Printf("%s\t%s\n", course.ID, label)
	}

	return nil
}

func (a *App) runAssignments(ctx context.Context, args []string) error {
	flags := flag.NewFlagSet("assignments", flag.ContinueOnError)
	courseID := flags.String("course", "", "course ID")
	sessionPath := flags.String("session-file", a.sessionPath, "path to the session file")
	flags.SetOutput(ioDiscard{})
	if err := flags.Parse(args); err != nil {
		return err
	}
	if strings.TrimSpace(*courseID) == "" {
		return errors.New("missing --course")
	}

	client, _, err := a.newClientFromSession(*sessionPath)
	if err != nil {
		return sessionCommandError(*sessionPath, err)
	}

	assignments, err := client.ListAssignments(ctx, *courseID)
	if err != nil {
		return err
	}

	for _, assignment := range assignments {
		if assignment.Status != "" {
			fmt.Printf("%s\t%s\t%s\n", assignment.ID, assignment.Title, assignment.Status)
			continue
		}
		fmt.Printf("%s\t%s\n", assignment.ID, assignment.Title)
	}

	return nil
}

func (a *App) runSubmit(ctx context.Context, args []string) error {
	flags := flag.NewFlagSet("submit", flag.ContinueOnError)
	courseID := flags.String("course", "", "course ID")
	assignmentID := flags.String("assignment", "", "assignment ID")
	filePath := flags.String("file", "", "path to the local file to submit")
	sessionPath := flags.String("session-file", a.sessionPath, "path to the session file")
	flags.SetOutput(ioDiscard{})
	if err := flags.Parse(args); err != nil {
		return err
	}

	if strings.TrimSpace(*assignmentID) == "" {
		return errors.New("missing --assignment")
	}
	if strings.TrimSpace(*filePath) == "" {
		return errors.New("missing --file")
	}

	absPath, err := validateSubmissionFile(*filePath)
	if err != nil {
		return err
	}

	client, _, err := a.newClientFromSession(*sessionPath)
	if err != nil {
		return sessionCommandError(*sessionPath, err)
	}

	result, err := client.Submit(ctx, gradescope.SubmitOptions{
		CourseID:     *courseID,
		AssignmentID: *assignmentID,
		FilePath:     absPath,
	})
	if err != nil {
		return err
	}

	printSubmissionResult(*result)
	return nil
}

func (a *App) runResult(ctx context.Context, args []string) error {
	flags := flag.NewFlagSet("result", flag.ContinueOnError)
	submissionID := flags.String("submission", "", "submission ID or full submission URL")
	sessionPath := flags.String("session-file", a.sessionPath, "path to the session file")
	flags.SetOutput(ioDiscard{})
	if err := flags.Parse(args); err != nil {
		return err
	}
	if strings.TrimSpace(*submissionID) == "" {
		return errors.New("missing --submission")
	}

	client, _, err := a.newClientFromSession(*sessionPath)
	if err != nil {
		return sessionCommandError(*sessionPath, err)
	}

	result, err := client.Result(ctx, *submissionID)
	if err != nil {
		return err
	}

	printSubmissionResult(*result)
	return nil
}

func (a *App) runWizard(ctx context.Context, args []string) error {
	flags := flag.NewFlagSet("wizard", flag.ContinueOnError)
	email := flags.String("email", "", "Gradescope email")
	password := flags.String("password", "", "Gradescope password")
	passwordFile := flags.String("password-file", "", "file containing the Gradescope password")
	credentialsFile := flags.String("credentials-file", "", "JSON or KEY=VALUE credentials file")
	sessionPath := flags.String("session-file", a.sessionPath, "path to the session file")
	flags.SetOutput(ioDiscard{})
	if err := flags.Parse(args); err != nil {
		return err
	}

	client, jar, err := a.newClientFromSession(*sessionPath)
	sessionErr := err
	if err != nil {
		client, jar, err = a.newClient(nil)
		if err != nil {
			return err
		}
	}

	if err := client.CheckAuthenticated(ctx); err != nil {
		creds, loadErr := credentials.Load(*email, *password, *passwordFile, *credentialsFile)
		if loadErr != nil {
			if sessionErr != nil {
				return fmt.Errorf("saved session unavailable (%v); login credentials are required: %w", sessionErr, loadErr)
			}
			return fmt.Errorf("no valid session found; login credentials are required: %w", loadErr)
		}
		if err := client.Login(ctx, creds); err != nil {
			return err
		}
		if err := session.Save(*sessionPath, client.BaseURL(), creds.Email, jar); err != nil {
			return err
		}
	}

	courses, err := client.ListCourses(ctx)
	if err != nil {
		return err
	}
	course, err := promptCourse(courses)
	if err != nil {
		return err
	}

	assignments, err := client.ListAssignments(ctx, course.ID)
	if err != nil {
		return err
	}
	assignment, err := promptAssignment(assignments)
	if err != nil {
		return err
	}

	filePath, err := promptLine(fmt.Sprintf("File path to submit for \"%s\": ", assignment.Title))
	if err != nil {
		return err
	}
	if filePath == "" {
		return errors.New("file path is required")
	}

	absPath, err := validateSubmissionFile(filePath)
	if err != nil {
		return err
	}

	result, err := client.Submit(ctx, gradescope.SubmitOptions{
		CourseID:     course.ID,
		AssignmentID: assignment.ID,
		FilePath:     absPath,
	})
	if err != nil {
		return err
	}

	printSubmissionResult(*result)
	return nil
}

func (a *App) newClient(jarOverride http.CookieJar) (*gradescope.Client, http.CookieJar, error) {
	jar := jarOverride
	var err error
	if jar == nil {
		jar, err = session.NewJar()
		if err != nil {
			return nil, nil, err
		}
	}

	client := gradescope.New(a.baseURL, jar, a.debugDir)
	return client, jar, nil
}

func (a *App) newClientFromSession(path string) (*gradescope.Client, http.CookieJar, error) {
	stored, jar, err := session.Load(path)
	if err != nil {
		return nil, nil, fmt.Errorf("load session file %s: %w", path, err)
	}

	client := gradescope.New(stored.BaseURL, jar, a.debugDir)
	return client, jar, nil
}

func validateSubmissionFile(path string) (string, error) {
	absPath, err := filepath.Abs(strings.TrimSpace(path))
	if err != nil {
		return "", fmt.Errorf("resolve file path: %w", err)
	}

	info, err := os.Stat(absPath)
	if err != nil {
		return "", fmt.Errorf("submission file %s: %w", absPath, err)
	}
	if info.IsDir() {
		return "", fmt.Errorf("submission file %s is a directory", absPath)
	}

	return absPath, nil
}

func sessionCommandError(path string, err error) error {
	if errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("no saved session at %s; run `gradescope-cli login --credentials-file <file>` first or use `gradescope-cli wizard`", path)
	}
	return err
}

func promptCourse(courses []gradescope.Course) (gradescope.Course, error) {
	labels := make([]string, 0, len(courses))
	for _, course := range courses {
		label := course.Name
		if course.Short != "" && course.Short != course.Name {
			label = fmt.Sprintf("%s | %s", course.Short, course.Name)
		}
		labels = append(labels, label)
	}

	index, err := promptSelection("Choose a class:", labels)
	if err != nil {
		return gradescope.Course{}, err
	}
	return courses[index], nil
}

func promptAssignment(assignments []gradescope.Assignment) (gradescope.Assignment, error) {
	labels := make([]string, 0, len(assignments))
	for _, assignment := range assignments {
		label := assignment.Title
		if assignment.Status != "" {
			label = fmt.Sprintf("%s [%s]", assignment.Title, assignment.Status)
		}
		labels = append(labels, label)
	}

	index, err := promptSelection("Choose an assignment:", labels)
	if err != nil {
		return gradescope.Assignment{}, err
	}
	return assignments[index], nil
}

func promptSelection(prompt string, items []string) (int, error) {
	if len(items) == 0 {
		return 0, errors.New("no choices available")
	}

	fmt.Println(prompt)
	for i, item := range items {
		fmt.Printf("  %d. %s\n", i+1, item)
	}

	line, err := promptLine("Enter number: ")
	if err != nil {
		return 0, err
	}

	index, err := strconv.Atoi(strings.TrimSpace(line))
	if err != nil || index < 1 || index > len(items) {
		return 0, errors.New("invalid selection")
	}

	return index - 1, nil
}

func promptLine(prompt string) (string, error) {
	fmt.Print(prompt)
	reader := bufio.NewReader(os.Stdin)
	line, err := reader.ReadString('\n')
	if err != nil && !errors.Is(err, os.ErrClosed) {
		if errors.Is(err, io.EOF) {
			return strings.TrimSpace(line), nil
		}
		return "", err
	}
	return strings.TrimSpace(line), nil
}

func printSubmissionResult(result gradescope.SubmissionResult) {
	if result.SubmissionID != "" {
		fmt.Printf("submission: %s\n", result.SubmissionID)
	}
	if result.URL != "" {
		fmt.Printf("url: %s\n", result.URL)
	}
	if result.Status != "" {
		fmt.Printf("status: %s\n", result.Status)
	}
	if result.Response != "" {
		fmt.Printf("response: %s\n", result.Response)
	} else {
		fmt.Println("response: none")
	}
	if result.HasAutograder {
		fmt.Printf("autograder: %s\n", result.AutograderMessage)
	} else {
		fmt.Println("autograder: none")
	}
}

func (a *App) printHelp() {
	fmt.Println(`gradescope-cli commands:
  login --credentials-file creds.json
  classes
  assignments --course <course-id>
  submit --assignment <assignment-id> --file <path> [--course <course-id>]
  result --submission <submission-id-or-url>
  wizard

Environment variables:
  GRADESCOPE_EMAIL
  GRADESCOPE_PASSWORD
  GRADESCOPE_BASE_URL
  GRADESCOPE_SUBMIT_BACKEND`)
}

type ioDiscard struct{}

func (ioDiscard) Write(p []byte) (int, error) {
	return len(p), nil
}
