const SUBMISSION_TYPE_MAP = new Map([
  ["upload", "upload"],
  ["file", "upload"],
  ["files", "upload"],
  ["github", "github"],
  ["git-hub", "github"],
  ["git_hub", "github"],
]);

export const SUBMISSION_TYPE_CHOICES = [
  {
    key: "upload",
    label: "Upload",
  },
  {
    key: "github",
    label: "GitHub",
  },
];

export function normalizeSubmissionType(value) {
  const normalized = normalizeOptionToken(value);
  return SUBMISSION_TYPE_MAP.get(normalized) || "";
}

export function resolveSubmissionType(options = {}) {
  const explicitType = String(options.submissionType || "").trim();
  const normalizedExplicitType = normalizeSubmissionType(explicitType);
  if (explicitType && !normalizedExplicitType) {
    throw new Error(`unsupported submission type "${explicitType}"; expected upload or github`);
  }

  const filePaths = normalizeStringList(options.filePaths);
  const hasFiles = filePaths.length > 0;
  const hasGitHubInputs = Boolean(String(options.repo || "").trim() || String(options.branch || "").trim());

  if (hasFiles && hasGitHubInputs) {
    throw new Error("cannot mix upload file paths with GitHub repo or branch options");
  }
  if (normalizedExplicitType === "upload" && hasGitHubInputs) {
    throw new Error("submission type upload cannot be combined with --repo or --branch");
  }
  if (normalizedExplicitType === "github" && hasFiles) {
    throw new Error("submission type github cannot be combined with upload file paths");
  }

  if (normalizedExplicitType) {
    return normalizedExplicitType;
  }
  if (hasFiles) {
    return "upload";
  }
  if (hasGitHubInputs) {
    return "github";
  }

  return "";
}

export function submissionTypeLabel(value) {
  const normalized = normalizeSubmissionType(value);
  return SUBMISSION_TYPE_CHOICES.find((choice) => choice.key === normalized)?.label || "";
}

export function normalizeStringList(values) {
  if (Array.isArray(values)) {
    return values.flatMap((value) => normalizeStringList(value));
  }

  const trimmed = String(values || "").trim();
  return trimmed ? [trimmed] : [];
}

function normalizeOptionToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}
