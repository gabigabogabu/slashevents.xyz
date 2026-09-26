import { envSchema } from './config';

export type { Env } from './config';
export const env = envSchema.parse(process.env);
