import {snakeCase, camelCase, mapKeys} from "lodash";

type Delimiter = "_" | "-" | " ";

type SnakeCase<S extends string, First extends boolean = true> =
  S extends `${infer H}${infer T}`
    ? H extends Delimiter
      ? `_${SnakeCase<T, false>}`
      : H extends Lowercase<H>
        ? `${H}${SnakeCase<T, false>}`
        : `${First extends true ? "" : "_"}${Lowercase<H>}${SnakeCase<T, false>}`
    : "";

type CamelCase<S extends string> =
  S extends `${infer Head}${Delimiter}${infer Tail}`
    ? `${Lowercase<Head>}${Capitalize<CamelCase<Tail>>}`
    : Uncapitalize<S>;

type SnakeCaseKeys<T extends Record<string, unknown>> = {
  [K in keyof T as K extends string ? SnakeCase<K> : never]: T[K];
};

type CamelCaseKeys<T extends Record<string, unknown>> = {
  [K in keyof T as K extends string ? CamelCase<K> : never]: T[K];
};

export const snakeCaseKeys = <T extends Record<string, unknown>>(obj: T): SnakeCaseKeys<T> =>
  mapKeys(obj, (_v, k) => snakeCase(k)) as unknown as SnakeCaseKeys<T>;

export const camelCaseKeys = <T extends Record<string, unknown>>(obj: T): CamelCaseKeys<T> =>
  mapKeys(obj, (_v, k) => camelCase(k)) as unknown as CamelCaseKeys<T>;