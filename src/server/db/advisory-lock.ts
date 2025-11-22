import { type SQL } from "bun";

export enum ADVISORY_LOCK_IDS {
  MIGRATIONS,
}

export const waitForAdvisoryLock = (db: SQL, id: ADVISORY_LOCK_IDS) => db`SELECT pg_advisory_lock(${id})`;
export const releaseAdvisoryLock = (db: SQL, id: ADVISORY_LOCK_IDS) => db`SELECT pg_advisory_unlock(${id})`;

export const withAdvisoryLock = async <R>(db: SQL, id: ADVISORY_LOCK_IDS, fn: () => Promise<R> | R): Promise<R> => {
  await waitForAdvisoryLock(db, id);
  try {
    return await fn();
  } finally {
    await releaseAdvisoryLock(db, id);
  }
}