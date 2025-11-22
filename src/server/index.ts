import { env } from "./env";
import { getDb } from "./db";

const db = getDb(env);

const result = await db`SELECT 1`;
console.log(result);

export { db };