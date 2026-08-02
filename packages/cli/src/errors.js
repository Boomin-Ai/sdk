/** Shared CLI error type: carries the typed API code, status, and a
 * suggested follow-up command (printed by the top-level handler). */
export class ApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ApiError";
    this.status = details.status;
    this.code = details.code;
    this.requiredScope = details.requiredScope;
    this.suggestedCommand = details.suggestedCommand;
    this.response = details.response;
  }
}
