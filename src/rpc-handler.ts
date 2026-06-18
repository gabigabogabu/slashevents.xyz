import { z } from "zod";
import type { UUID } from "node:crypto";

import { AppError } from "@/lib/app-error";
import { ErrorCode } from "@/lib/errors";

export class RpcError extends AppError {}

class MethodNotDefinedError extends RpcError {
  constructor(method: string) {
    super(ErrorCode.METHOD_NOT_DEFINED, 404, `Method not defined: ${method}`);
  }
}

class InvalidRpcInputError extends RpcError {
  constructor(error: z.ZodError) {
    super(ErrorCode.INVALID_INPUT, 400, error.message);
    this.cause = error;
  }
}

class InvalidRpcOutputError extends RpcError {
  constructor(error: z.ZodError) {
    super(ErrorCode.INTERNAL_SERVER_ERROR, 500, "Invalid RPC output");
    this.cause = error;
  }
}

class AuthenticationError extends RpcError {
  constructor(result: unknown) {
    super(ErrorCode.AUTHENTICATION_ERROR, 401, String(result));
    this.cause = result;
  }
}

class RateLimitError extends RpcError {
  constructor(result: unknown) {
    super(ErrorCode.RATE_LIMIT_EXCEEDED, 429, String(result));
    this.cause = result;
  }
}

type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};

type RpcId = string | null | undefined;
export type RpcMessage = {
  id: UUID;
  payload: string;
};

export type Rpc<ParamsType = unknown> = {
  id?: RpcId;
  method: string;
  params?: ParamsType;
};

type RpcReturnBase = { id: RpcId; messages: RpcMessage[] };
type RpcReturnError = { error: unknown };
type RpcReturnSuccess<R> = { result: R };
export type RpcReturn<R> = Prettify<RpcReturnBase & (RpcReturnError | RpcReturnSuccess<R>)>;

type GuardResult<Meta> = { success: boolean; result: Meta };

type CacheConfig<Result> = {
  get: () => Promise<Result | undefined> | Result | undefined;
  set: (value: Result) => Promise<void> | void;
} | undefined;

type RpcDefInit<ParamsType, AuthMeta = unknown, RateLimitMeta = unknown, ResultType = unknown, Context = unknown> =
  Pick<RpcDef<ParamsType, AuthMeta, RateLimitMeta, ResultType, Context>, "inputValidation" | "handle"> &
  Partial<Pick<RpcDef<ParamsType, AuthMeta, RateLimitMeta, ResultType, Context>, "auth" | "rateLimit" | "cache" | "outputValidation">>;

export const defRpc = <ParamsType, AuthMeta = unknown, RateLimitMeta = unknown, ResultType = unknown, Context = unknown>({
  inputValidation,
  outputValidation,
  handle,
  auth = async () => ({ success: true, result: undefined as AuthMeta }),
  rateLimit = async () => ({ success: true, result: undefined as RateLimitMeta }),
  cache = async () => undefined,
}: RpcDefInit<ParamsType, AuthMeta, RateLimitMeta, ResultType, Context>): RpcDef<ParamsType, AuthMeta, RateLimitMeta, ResultType, Context> => ({
  inputValidation,
  outputValidation,
  auth,
  rateLimit,
  handle,
  cache,
});

export type RpcDef<Params, AuthMeta, RateLimitMeta, Result, Context = unknown> = {
  inputValidation: z.ZodSchema<Params>;
  outputValidation?: z.ZodSchema<Result>;
  auth: (rpc: Rpc<Params>, context: Context) => Promise<GuardResult<AuthMeta>> | GuardResult<AuthMeta>;
  rateLimit: (
    rpc: Rpc<Params>,
    authResult: GuardResult<AuthMeta>,
    context: Context,
  ) => Promise<GuardResult<RateLimitMeta>> | GuardResult<RateLimitMeta>;
  cache: (
    rpc: Rpc<Params>,
    authResult: GuardResult<AuthMeta>,
    rateLimitResult: GuardResult<RateLimitMeta>,
    context: Context,
  ) => Promise<CacheConfig<Result>> | CacheConfig<Result>;
  handle: (
    input: {
      params: Params;
      authResult: GuardResult<AuthMeta>;
      rateLimitResult: GuardResult<RateLimitMeta>;
      context: Context;
    },
  ) => Promise<Result> | Result;
};

type ParamsOf<D> = D extends RpcDef<infer P, any, any, any, any> ? P : never;
type ResultOf<D> = D extends RpcDef<any, any, any, infer R, any> ? R : never;

type ExposedFunctions<RpcMap extends Record<string, RpcDef<any, any, any, any, any>>> = {
  [K in keyof RpcMap]: (args: ParamsOf<RpcMap[K]>) => ResultOf<RpcMap[K]>;
};

type RpcMapOf<H extends RpcHandler<any, any>> = H extends RpcHandler<infer T, any> ? T : never;

export type InferRpc<H extends RpcHandler<any, any>> = ExposedFunctions<RpcMapOf<H>>;

export class RpcHandler<RpcMap extends Record<string, RpcDef<any, any, any, any, any>>, Context = unknown> {
  private static readonly bodySchema = z.object({
    id: z.string().nullable().optional(),
    method: z.string(),
    params: z.unknown().optional(),
  });

  constructor(
    private readonly rpcs: RpcMap,
  ) {}

  getRpcDefs(): RpcMap {
    return this.rpcs;
  }

  async handle(request: unknown, context: Context): Promise<RpcReturn<any>> {
    const validated = RpcHandler.bodySchema.safeParse(request);
    if (!validated.success) throw new InvalidRpcInputError(validated.error);
    const rpc = validated.data;

    try {
      const result = await this.handleSingleRpc(rpc, context);
      return { id: rpc.id, messages: [], result };
    } catch (error) {
      if (error instanceof AppError) {
        return {
          id: rpc.id,
          messages: [],
          error: {
            code: error.name,
            hint: error.hint,
          },
        };
      }
      if (error instanceof Error) {
        return {
          id: rpc.id,
          messages: [],
          error: {
            code: error.name,
            hint: error.message,
          },
        };
      }
      return { id: rpc.id, messages: [], error };
    }
  }

  private async handleSingleRpc(rpc: Rpc<any>, context: Context): Promise<any> {
    const { method, params } = rpc;
    const func = this.rpcs[method] as RpcDef<any, any, any, any, Context> | undefined;
    if (!func) throw new MethodNotDefinedError(method);

    const validatedParams = func.inputValidation.safeParse(params);
    if (!validatedParams.success) throw new InvalidRpcInputError(validatedParams.error);

    const authResult = await func.auth(rpc, context);
    if (!authResult.success) throw new AuthenticationError(authResult.result);

    const rateLimitResult = await func.rateLimit(rpc, authResult, context);
    if (!rateLimitResult.success) throw new RateLimitError(rateLimitResult.result);

    const cacheConfig = await func.cache(rpc, authResult, rateLimitResult, context);
    const cachedValue = await cacheConfig?.get();
    if (cachedValue !== undefined) return cachedValue;

    const result = await func.handle({
      params: validatedParams.data,
      authResult,
      rateLimitResult,
      context,
    });

    if (func.outputValidation) {
      const validatedOutput = func.outputValidation.safeParse(result);
      if (!validatedOutput.success) throw new InvalidRpcOutputError(validatedOutput.error);
      await cacheConfig?.set(validatedOutput.data);
      return validatedOutput.data;
    }

    await cacheConfig?.set(result);
    return result;
  }
}
