import { z } from "zod";

import { ErrorCode } from "./errors";

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
      typeof error === "string" ? error : error.message,
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
  return new AppError(ErrorCode.INTERNAL_SERVER_ERROR, 500, "Unexpected error");
};
