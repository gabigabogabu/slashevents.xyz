// Auto-generated clients with inferred types from server
import type { AppRpc, AdminRpc, ApiRpc } from "../server";
import { ErrorCode } from "./errors";

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

// Type that removes jwt from args for authenticated RPC calls
type OmitJwtToken<T> = T extends { jwt: string } ? Omit<T, "jwt"> : T;
type AuthenticatedClientRPC<T> = {
  [K in keyof T]: T[K] extends (args: infer A) => infer R
    ? IsUndefined<A> extends true
      ? () => Promise<R>
      : IsEmptyObject<OmitJwtToken<A>> extends true
        ? (args?: OmitJwtToken<A>) => Promise<R>
        : (args: OmitJwtToken<A>) => Promise<R>
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
      const e = new Error(err.code ?? "UNKNOWN_ERROR", { cause: err });
      (e as any).name = err.code ?? "UNKNOWN_ERROR";
      (e as any).hint = err.hint;
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

// Create an authenticated RPC client that automatically injects JWT token
// If an AUTHENTICATION_ERROR is returned, the onAuthError callback is called (typically to logout)
export function createAuthenticatedAppRpc(
  getToken: () => string | null,
  onAuthError?: () => void
): AuthenticatedClientRPC<AppRpc> {
  return new Proxy({} as AuthenticatedClientRPC<AppRpc>, {
    get: (_target, prop) => {
      if (typeof prop !== "string") return undefined;
      const method = prop as keyof AppRpc;
      return async (args: Record<string, unknown> = {}) => {
        const token = getToken();
        if (!token) {
          throw new Error("Not authenticated");
        }
        // Type assertion needed because we're dynamically calling methods
        const rpcMethod = appRpc[method] as (args: Record<string, unknown>) => Promise<unknown>;
        try {
          return await rpcMethod({ ...args, jwt: token });
        } catch (error) {
          // Auto-logout on authentication errors (e.g., user no longer exists)
          if (error instanceof Error && error.name === ErrorCode.AUTHENTICATION_ERROR) {
            onAuthError?.();
          }
          throw error;
        }
      };
    },
  });
}
