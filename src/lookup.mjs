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
