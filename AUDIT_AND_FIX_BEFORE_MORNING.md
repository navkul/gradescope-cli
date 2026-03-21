# AUDIT_AND_FIX_BEFORE_MORNING.md

Run a final audit pass on the Gradescope CLI implementation and leave the repository in the strongest possible state.

## Audit goals

1. verify what actually works,
2. remove avoidable brittleness,
3. clean architecture edges,
4. improve docs,
5. make the current state obvious to the user.

## What to audit

### Authentication
- Does login work with the intended credential-loading path?
- Are secrets redacted?
- Are session failures explained cleanly?

### Course and assignment discovery
- Can the CLI list classes reliably?
- Can it list assignments for a selected class?
- Are parsing assumptions centralized and documented?

### Submission
- Can the CLI accept a user-provided file path?
- Does it validate file existence before attempting submission?
- Does the submission workflow still work end to end?

### Result scraping
- Can it retrieve submission outcome information?
- Does it handle the case where there is no visible response?
- Does it surface autograder text when present?

### CLI UX
- Are commands coherent?
- Are flags and prompts consistent?
- Are errors actionable?

### Code quality
- Is the code DRY?
- Are responsibilities separated cleanly?
- Are shared constants/types/helpers centralized?
- Is over-commenting avoided?
- Are naming and structure consistent?

### Packaging
- Is the Go role in the architecture meaningful and justified?
- If a helper runtime exists, is the boundary clean?
- Can a user understand how to build and run the tool?

## Required doc updates

Before finishing, update:

- `FINDINGS.md`
- `ARCHITECTURE.md`
- `PROGRESS.md`

### `FINDINGS.md`
Add final confirmed findings and unresolved risks.

### `ARCHITECTURE.md`
Make sure the final architecture reflects the code as it actually exists.

### `PROGRESS.md`
Leave a concise end-of-run status including:
- what works,
- what partially works,
- what does not work yet,
- recommended next steps.

## Commit policy

Use the existing commit convention:
`type(scope): summary`

Prefer focused cleanup commits such as:
- `fix(auth): harden session bootstrap retries`
- `fix(submit): validate file path before upload`
- `refactor(parser): centralize response extraction`
- `docs(progress): finalize morning handoff status`

## Final standard

Do not merely say something works. Verify it where possible.

If something is not verified:
- say so clearly,
- document the risk,
- leave the most useful next step.

The repository should be left in a state where the user can quickly understand:
- the chosen implementation path,
- the current level of functionality,
- the strongest next move.
