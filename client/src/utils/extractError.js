/**
 * Extract a human-readable error message from an Axios error.
 * Handles the backend's { error, details[] } shape so validation
 * details are always surfaced to the user.
 *
 * Examples:
 *   { error: "Validation error", details: ["String must contain at most 500 character(s)"] }
 *   → "Validation error: String must contain at most 500 character(s)"
 *
 *   { error: "Admin only" }
 *   → "Admin only"
 */
export function extractError(err, fallback = 'Something went wrong') {
  const data = err?.response?.data;
  if (!data) return err?.message || fallback;

  const base = data.error || fallback;
  const details = Array.isArray(data.details) && data.details.length > 0
    ? data.details.join(', ')
    : null;

  return details ? `${base}: ${details}` : base;
}
