package gradescope

type Course struct {
	ID    string
	Name  string
	URL   string
	Raw   string
	Short string
}

type Assignment struct {
	ID       string
	CourseID string
	Title    string
	URL      string
	Status   string
	Raw      string
}

type SubmissionResult struct {
	SubmissionID      string
	URL               string
	Status            string
	Response          string
	AutograderMessage string
	HasAutograder     bool
}
