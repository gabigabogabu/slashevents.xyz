import zod from "zod";

// Transform to replace escaped newlines with actual newlines (for PEM keys in .env files)
const pemKeyTransform = zod.string().transform((val) => val.replace(/\\n/g, "\n"));

const envSchema = zod.object({
  NODE_ENV: zod.enum(["development", "production"]),
  PORT: zod.coerce.number().default(3000),
  DATABASE_URL: zod.string(),
  APP_JWT_PRIVATE_KEY: pemKeyTransform,
  APP_JWT_PUBLIC_KEY: pemKeyTransform,
  API_JWT_PRIVATE_KEY: pemKeyTransform,
  API_JWT_PUBLIC_KEY: pemKeyTransform,
});

export type Env = zod.infer<typeof envSchema>;
export const env: Env = envSchema.parse(process.env);