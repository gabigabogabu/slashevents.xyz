import type { SQL } from '@/db/types';

export enum ADVISORY_LOCK_IDS {
  MIGRATIONS,
}

export const waitForAdvisoryLock = (db: SQL, id: ADVISORY_LOCK_IDS) => db`SELECT pg_advisory_lock(${id});`;
export const releaseAdvisoryLock = (db: SQL, id: ADVISORY_LOCK_IDS) => db`SELECT pg_advisory_unlock(${id});`;

export const withAdvisoryLock = async <R>(db: SQL, id: ADVISORY_LOCK_IDS, fn: (connection: SQL) => Promise<R> | R): Promise<R> => {
  const connection = await db.reserve();
  try {
    await waitForAdvisoryLock(connection, id);
    try {
      return await fn(connection);
    } finally {
      await releaseAdvisoryLock(connection, id);
    }
  } finally {
    connection.release();
  }
}
