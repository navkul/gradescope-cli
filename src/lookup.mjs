function normalizeLookup(value) {
  return String(value || "").trim().split(/\s+/).filter(Boolean).join(" ").toLowerCase();
}

export function resolveCourse(courses, hint) {
  const rawHint = String(hint || "").trim();
  if (!rawHint) {
    return null;
  }

  const normalizedHint = normalizeLookup(rawHint);
  return courses.find((course) => {
    return course.id === rawHint
      || normalizeLookup(course.name) === normalizedHint
      || normalizeLookup(course.short) === normalizedHint;
  }) || null;
}

export function resolveAssignment(assignments, hint) {
  const rawHint = String(hint || "").trim();
  if (!rawHint) {
    return null;
  }

  const normalizedHint = normalizeLookup(rawHint);
  return assignments.find((assignment) => {
    return assignment.id === rawHint || normalizeLookup(assignment.title) === normalizedHint;
  }) || null;
}

export function courseCompletionValues(course) {
  return dedupeNonEmpty([
    course.id,
    course.short,
    course.name,
  ]);
}

export function assignmentCompletionValues(assignment) {
  return dedupeNonEmpty([
    assignment.id,
    assignment.title,
  ]);
}

export function filterSuggestions(values, currentWord) {
  const trimmedCurrent = String(currentWord || "").trim();
  if (!trimmedCurrent) {
    return dedupeNonEmpty(values);
  }

  const rawNeedle = trimmedCurrent.toLowerCase();
  const normalizedNeedle = normalizeLookup(trimmedCurrent);
  return dedupeNonEmpty(values).filter((value) => {
    const rawValue = String(value || "").trim().toLowerCase();
    const normalizedValue = normalizeLookup(value);
    return rawValue.startsWith(rawNeedle) || normalizedValue.startsWith(normalizedNeedle);
  });
}

function dedupeNonEmpty(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}
