/**
 * Machine-readable error codes used throughout the application.
 * Backend throws these codes, UI/API responses map them to human-readable messages.
 */
export const ErrorCode = {
  // Auth errors
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  AUTHENTICATION_ERROR: "AUTHENTICATION_ERROR",

  // Resource errors
  PROJECT_NOT_FOUND: "PROJECT_NOT_FOUND",
  USER_NOT_FOUND: "USER_NOT_FOUND",
  AGENT_NOT_FOUND: "AGENT_NOT_FOUND",
  NOT_FOUND: "NOT_FOUND",

  // Permission errors
  FORBIDDEN: "FORBIDDEN",

  // Validation errors
  BAD_REQUEST: "BAD_REQUEST",
  INVALID_INPUT: "INVALID_INPUT",
  UNSUPPORTED_METHOD: "UNSUPPORTED_METHOD",

  // Server errors
  INTERNAL_SERVER_ERROR: "INTERNAL_SERVER_ERROR",
  FAILED_TO_STORE_EVENT: "FAILED_TO_STORE_EVENT",
  METHOD_NOT_DEFINED: "METHOD_NOT_DEFINED",
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Human-readable error messages for each error code.
 * Used by UI/API responses to display user-friendly messages.
 */
const errorMessages: Record<ErrorCode, string> = {
  [ErrorCode.INVALID_CREDENTIALS]: "Invalid credentials.",
  [ErrorCode.AUTHENTICATION_ERROR]: "A valid signed request is required.",

  [ErrorCode.PROJECT_NOT_FOUND]: "Project not found or you don't have access.",
  [ErrorCode.USER_NOT_FOUND]: "User not found.",
  [ErrorCode.AGENT_NOT_FOUND]: "Agent not found.",
  [ErrorCode.NOT_FOUND]: "Not found.",

  [ErrorCode.FORBIDDEN]: "You don't have permission to perform this action.",

  [ErrorCode.BAD_REQUEST]: "Invalid request. Please check your input.",
  [ErrorCode.INVALID_INPUT]: "Invalid input. Please check your data.",
  [ErrorCode.UNSUPPORTED_METHOD]: "Unsupported method.",

  [ErrorCode.INTERNAL_SERVER_ERROR]: "Something went wrong. Please try again later.",
  [ErrorCode.FAILED_TO_STORE_EVENT]: "Failed to store event.",
  [ErrorCode.METHOD_NOT_DEFINED]: "This action is not available.",
  [ErrorCode.RATE_LIMIT_EXCEEDED]: "Too many requests. Please wait a moment and try again.",
};

/**
 * Get a human-readable error message from an error.
 * Priority: mapped error message > hint > generic fallback
 */
export function getErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const err = error as { name?: string; hint?: string };
    // First try to get a mapped message for the error code
    if (err.name && err.name in errorMessages) {
      return errorMessages[err.name as ErrorCode];
    }
    // Fall back to the hint if available
    if (err.hint) {
      return err.hint;
    }
  }
  return "An unexpected error occurred.";
}
