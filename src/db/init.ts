import { SQL } from 'bun';
import postgres from 'postgres';

import type { SQL as SQLClient } from '@/db/types';
import { type Env } from '@/env';
import { type Log } from '@/log';

export const getPg = (env: Pick<Env, 'DATABASE_URL'>, log: Log) => {
  const pg = postgres(env.DATABASE_URL, {
    max: 1,
    max_lifetime: null,
    fetch_types: false,
  });
  const closePg = async () => {
    log.info('Closing postgres connection');
    await pg.end();
  };
  return { pg, closePg };
};

export type Pg = ReturnType<typeof postgres>;

export const getDb = (env: Pick<Env, 'DATABASE_URL'>, log: Log) => {
  const db = new SQL(env.DATABASE_URL, {
    connection: {
      search_path: 'app',
    },
  });
  const closeDb = async () => {
    log.info('Closing database connection');
    await db.close();
  };
  return { db, closeDb };
};

export const isDbUp = async (db: SQLClient, pg: Pg, log: Log) => {
  try {
    const [rowDb] = await db`SELECT 1 as "alive"` as { alive: number }[];
    const [rowPg] = await pg`SELECT 1 as "alive"` as { alive: number }[];
    return rowDb?.alive === 1 && rowPg?.alive === 1;
  } catch (error) {
    log.error(error, 'Error checking database status');
    return false;
  }
};
