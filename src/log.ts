import pino from 'pino';

export const getLog = () => pino();
export type Log = ReturnType<typeof getLog>