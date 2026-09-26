import { setTimeout as delay } from 'node:timers/promises';

import type { Log } from '@/log';

export type BackgroundWorkerOptions = {
  intervalMs: number;
  log: Log;
  startAfter: Promise<unknown>;
  run: (log: Log) => Promise<void>;
  shutdownSignal: AbortSignal;
};

const registerBackgroundWorker = async (
  { intervalMs, log: workerLog, startAfter, run, shutdownSignal: signal }: BackgroundWorkerOptions,
) => {
  const sleep = async (sleepLog: Log) => {
    sleepLog.info({ intervalMs }, 'Background worker sleeping');
    try {
      await delay(intervalMs, undefined, { signal });
    } catch (error) {
      if (!signal.aborted)
        throw error;
    }
  };

  try {
    await startAfter;
    while (!signal.aborted) {
      const runLog = workerLog.child({ loopId: Bun.randomUUIDv7() });
      await run(runLog).catch((error) => {
        if (signal.aborted)
          runLog.info({ error }, 'Background worker stopped');
        else
          runLog.error(error, 'Background worker run failed');
      });
      if (!signal.aborted)
        await sleep(runLog);
    }
  } catch (error) {
    if (signal.aborted)
      workerLog.info({ error }, 'Background worker stopped');
    else
      workerLog.error(error, 'Background worker failed');
  }
};

export const startBackgroundWorkers = (
  workers: Record<string, BackgroundWorkerOptions>,
) => Promise.allSettled(Object.values(workers).map(registerBackgroundWorker));
