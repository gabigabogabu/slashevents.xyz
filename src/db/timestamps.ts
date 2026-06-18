export const timestampToIsoString = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : value;
