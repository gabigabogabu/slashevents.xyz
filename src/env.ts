import zod from "zod";
import { existsSync, readFileSync } from "node:fs";

const loadDotEnv = () => {
  if (!existsSync(".env")) return;
  const contents = readFileSync(".env", "utf8");
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex < 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] ??= value;
  }
};

loadDotEnv();

const envSchema = zod.object({
  NODE_ENV: zod.enum(["development", "production"]).default("development"),
  PORT: zod.coerce.number().default(3000),
  DATABASE_URL: zod.string(),
});

export type Env = zod.infer<typeof envSchema>;
export const env: Env = envSchema.parse(process.env);
