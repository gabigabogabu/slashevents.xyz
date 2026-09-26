import { createHash, timingSafeEqual } from 'node:crypto';

import { AppError, ErrorCode } from '@/errors';

export const createTokenAuthenticator = (token: string) => {
  if (!token) throw new Error('An API token is required');
  const expected = createHash('sha256').update(token).digest();
  return (request: Request): void => {
    const match = /^Bearer ([A-Za-z0-9_-]+)$/i.exec(request.headers.get('authorization') ?? '');
    const supplied = createHash('sha256').update(match?.[1] ?? '').digest();
    if (!match || !timingSafeEqual(supplied, expected))
      throw new AppError(ErrorCode.AUTHENTICATION_ERROR, 401, 'A valid instance API token is required');
  };
};
