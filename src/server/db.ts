import { SQL } from "bun";
import { type Env } from "./env";

export const getDb = (env: Env) => new SQL({
  url: env.DATABASE_URL,
});
