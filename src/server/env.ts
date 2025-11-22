import zod from "zod";

const envSchema = zod.object({
  NODE_ENV: zod.enum(["development", "production"]),
  PORT: zod.coerce.number().default(3000),
  DATABASE_URL: zod.string(),
});

export type Env = zod.infer<typeof envSchema>;
export const env: Env = envSchema.parse(process.env);