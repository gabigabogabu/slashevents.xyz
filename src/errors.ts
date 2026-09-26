import { z } from 'zod';

export const ErrorCode = {
  // Auth errors
  AUTHENTICATION_ERROR: 'AUTHENTICATION_ERROR',

  // Resource errors
  PROJECT_NOT_FOUND: 'PROJECT_NOT_FOUND',
  NOT_FOUND: 'NOT_FOUND',

  // Permission errors
  FORBIDDEN: 'FORBIDDEN',

  // Validation errors
  BAD_REQUEST: 'BAD_REQUEST',
  INVALID_INPUT: 'INVALID_INPUT',
  UNSUPPORTED_METHOD: 'UNSUPPORTED_METHOD',

  // Server errors
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
  FAILED_TO_STORE_EVENT: 'FAILED_TO_STORE_EVENT',
  METHOD_NOT_DEFINED: 'METHOD_NOT_DEFINED',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export class AppError extends Error {
  constructor(
    code: ErrorCode,
    public status: number,
    public hint?: string,
  ) {
    super(code);
    this.name = code;
  }
}

export class InvalidInputError extends AppError {
  constructor(error: z.ZodError | string) {
    super(
      ErrorCode.INVALID_INPUT,
      400,
      typeof error === 'string' ? error : error.message,
    );
    this.cause = error;
  }
}

export const toAppError = (error: unknown): AppError => {
  if (error instanceof AppError) return error;
  if (error instanceof z.ZodError) return new InvalidInputError(error);
  if (error instanceof Error) {
    return new AppError(ErrorCode.INTERNAL_SERVER_ERROR, 500, error.message);
  }
  return new AppError(ErrorCode.INTERNAL_SERVER_ERROR, 500, 'Unexpected error');
};
