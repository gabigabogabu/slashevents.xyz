// Auto-generated clients with inferred types from server
import type { AppRpc, AdminRpc, ApiRpc } from "../index";

type IsUndefined<T> = [T] extends [undefined] ? true : false;
type IsEmptyObject<T> = T extends object ? (keyof T extends never ? true : false) : false;
type ClientRPC<T> = {
  [K in keyof T]: T[K] extends (args: infer A) => infer R
    ? IsUndefined<A> extends true
      ? () => Promise<R>
      : IsEmptyObject<A> extends true
        ? (args?: A) => Promise<R>
        : (args: A) => Promise<R>
    : never;
};

export function createRpcClient<T>(
  callFn: (body: { id: string; method: string; params: unknown }[]) => Promise<string>
): ClientRPC<T> {
  let counter = 0;
  const sessionId = crypto.randomUUID();
  const nextId = () => `${sessionId}_${counter++}`;

  const call = async (method: string, params: unknown, id: string = nextId()): Promise<unknown> => {
    const body = [{ id, method, params }];
    const returned = await callFn(body);

    let results: unknown;
    try {
      results = JSON.parse(returned);
    } catch (error) {
      throw new Error(`[${id}] ${method}: invalid RPC response shape`);
    }

    if (!Array.isArray(results)) {
      throw new Error(`[${id}] ${method}: invalid RPC response shape`);
    }
    const match = results.find((r: any) => r && r.id === id);
    if (!match) {
      throw new Error(`[${id}] ${method}: missing result for request id`);
    }
    if ("error" in match) {
      const err = match.error ?? {};
      const e = new Error(`[${id}] ${method}: RPC error: ${err.message ?? "unknown error"}`, {
        cause: err,
      });
      (e as any).name = err.name ?? "RPCError";
      (e as any).cause = err.cause;
      (e as any).id = id;
      throw e;
    }
    return match.result;
  };

  return new Proxy({} as ClientRPC<T>, {
    get: (_target, prop) => {
      if (typeof prop !== "string") return undefined as any;
      const method = prop;
      return ((args: unknown) => call(method, args)) as any;
    },
  });
}

const fetchRpc = (endpoint: string) => async (body: { id: string; method: string; params: unknown }[]) => {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body[0]), // Server expects single object, not array
  });
  // Wrap in array to match expected response format
  const data = await response.json();
  return JSON.stringify([data]);
};

export const appRpc = createRpcClient<AppRpc>(fetchRpc("/app-rpc"));
export const adminRpc = createRpcClient<AdminRpc>(fetchRpc("/admin-rpc"));
export const apiRpc = createRpcClient<ApiRpc>(fetchRpc("/api-rpc"));
