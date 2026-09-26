import { describe, expect, test } from 'bun:test';

import { getLog } from '@/log';

import { removeEventsPastRetentionDuration, removeEventsPastRetentionMaxCount } from './events';

const testLog = getLog();
testLog.level = 'silent';

describe('event retention', () => {
  test('removes events past retention duration', async () => {
    let calls = 0;
    await removeEventsPastRetentionDuration({
      db: {} as any,
      queries: {
        deleteEventsPastRetentionDuration: async () => {
          calls++;
          return { removed: 2 };
        },
      } as any,
      log: testLog,
    });

    expect(calls).toBe(1);
  });

  test('stops duration cleanup when aborted between pages', async () => {
    const controller = new AbortController();
    let calls = 0;
    await removeEventsPastRetentionDuration({
      db: {} as any,
      queries: {
        deleteEventsPastRetentionDuration: async () => {
          calls++;
          controller.abort();
          return {
            removed: 1_000,
            nextCursor: '01900000-0000-7000-8000-000000000001',
          };
        },
      } as any,
      log: testLog,
      signal: controller.signal,
    });

    expect(calls).toBe(1);
  });

  test('removes events past retention max count', async () => {
    let calls = 0;
    await removeEventsPastRetentionMaxCount({
      db: {} as any,
      queries: {
        deleteEventsPastRetentionMaxCount: async () => {
          calls++;
          return { removed: 3, scannedProjects: 0 };
        },
      } as any,
      log: testLog,
    });

    expect(calls).toBe(1);
  });

  test('stops max count cleanup when aborted between pages', async () => {
    const controller = new AbortController();
    let calls = 0;
    await removeEventsPastRetentionMaxCount({
      db: {} as any,
      queries: {
        deleteEventsPastRetentionMaxCount: async () => {
          calls++;
          controller.abort();
          return {
            removed: 3,
            scannedProjects: 100,
            nextProjectCursor: '01900000-0000-7000-8000-000000000001',
          };
        },
      } as any,
      log: testLog,
      signal: controller.signal,
    });

    expect(calls).toBe(1);
  });
});
