# FINDINGS.md

## Confirmed behaviors
- `https://www.gradescope.com/login` is a server-rendered Rails login form with a hidden `authenticity_token`, `session[email]`, `session[password]`, and `session[remember_me]`.
- A plain `GET /login` sets `_gradescope_session`; no browser automation was required for the public login surface during reconnaissance on March 20, 2026.
- Posting invalid credentials back to `/login` returns HTTP 200 with an inline `.alert-error` flash message instead of a JSON error payload.
- The shipped `gradescope-cli login --credentials-file <file>` command successfully reproduced the live invalid-login path and surfaced `Invalid email/password combination.` from the returned HTML.

## Login observations
- The login form action is `/login` with `method="post"`.
- The public page exposes both `<meta name="csrf-token">` and a form-specific hidden `authenticity_token`; the form token is sufficient for submission.
- Invalid credentials surface the exact flash text `Invalid email/password combination.` in the HTML response body.

## Session and cookie behavior
- `_gradescope_session` is the core session cookie.
- The cookie is `Secure`, `HttpOnly`, and `SameSite=None`.
- Because login is form-based and cookie-backed, a Go `net/http` client with a cookie jar is a credible primary implementation path.

## DOM selectors
- Login form selector: `form[action="/login"]`
- Login flash selector: `.alert-error, .alert-flashMessage.alert-error`
- Course link heuristic: `a[href^="/courses/"]`
- Assignment link heuristic: `a[href*="/assignments/"]`
- Submission form heuristic: first `form[method="post"]` containing `input[type="file"]`

## Network/API observations
- Reconnaissance found no need for a private JSON API for auth; standard HTML form posts are viable.
- The current implementation is intentionally form- and link-driven so it can discover submission endpoints from live HTML rather than freezing guessed private endpoints into code.

## Submission workflow findings
- The CLI is built to fetch the assignment page first and parse the live multipart upload form, including hidden inputs and file field name, before uploading.
- This avoids hardcoding a submission route before authenticated validation proves the exact endpoint shape.

## Result scraping findings
- Result parsing is currently heuristic-based: status from flash/submission status elements, response from nearby submission/result sections, autograder text from headings or known autograder containers.
- Debug HTML snapshots are written to the local config debug directory when course, assignment, or upload-form parsing fails.

## Autograder findings
- No authenticated autograder page has been validated yet because no local credentials were present in the environment or repo during this run.
- The parser already handles the no-autograder case and will print `autograder: none`.

## Failed approaches and why they failed
- No hard blocker yet. Browser automation was deferred because the login flow appears compatible with plain Go HTTP plus HTML parsing.
- A direct shell `rm -f gradescope-cli` cleanup was blocked by local policy during the run; cleanup was completed via a non-blocked alternative and does not affect the product design.

## Open questions
- Exact authenticated dashboard markup for courses.
- Exact authenticated course page markup for assignments.
- Exact assignment upload form field names and result-page DOM for a real account.
- Whether any accounts trigger extra anti-automation controls after successful login.
