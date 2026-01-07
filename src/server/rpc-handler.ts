import { z } from "zod";

import { ErrorCode } from "@/lib/errors";

export class RpcError extends Error {
  constructor(
    code: ErrorCode,
    public httpCode: number,
    public hint?: string,
  ) {
    super(code);
    this.name = code;
  }
}

class MethodNotDefinedError extends RpcError {
  constructor(method: string) {
    super(ErrorCode.METHOD_NOT_DEFINED, 404, `Method not defined: ${method}`);
  }
}

class InvalidInputError extends RpcError {
  constructor(error: z.ZodError) {
    super(ErrorCode.INVALID_INPUT, 400, error.message);
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

type _RpcId = string | null | undefined;

// actual call
type Rpc<ParamsType> = {
  id?: _RpcId;
  method: string;
  params?: ParamsType;
}

type _RpcReturnBase = {id: _RpcId}
type _RpcReturnError = {error: unknown}
type _RpcReturnSuccess<R> = {result: R}
type RpcReturn<R> = Prettify<_RpcReturnBase & (_RpcReturnError | _RpcReturnSuccess<R>)>;

type GuardResult<Meta> = {success: boolean; result: Meta}

type CacheConfig<Result> = {
  get: () => Promise<Result | undefined>;
  set: (value: Result) => Promise<void>;
} | undefined;


// optional auth and rateLimit that will be defaulted
type RpcDefInit<ParamsType, AuthMeta = unknown, RateLimitMeta = unknown, ResultType = unknown> =
  Pick<RpcDef<ParamsType, AuthMeta, RateLimitMeta, ResultType>, 'inputValidation' | 'handle'> &
  Partial<Pick<RpcDef<ParamsType, AuthMeta, RateLimitMeta, ResultType>, 'auth' | 'rateLimit' | 'cache'>>;
/**
 * Utility function to define an RPC
 * @param def 
 * @returns def
 */
export const defRpc = <ParamsType, AuthMeta = unknown, RateLimitMeta = unknown, ResultType = unknown>({
  inputValidation,
  handle,
  auth = async () => ({ success: true, result: undefined as unknown as AuthMeta }),
  rateLimit = async () => ({ success: true, result: undefined as unknown as RateLimitMeta }),
  cache = async () => undefined,
}: RpcDefInit<ParamsType, AuthMeta, RateLimitMeta, ResultType>): RpcDef<ParamsType, AuthMeta, RateLimitMeta, ResultType> => ({inputValidation, auth, rateLimit, handle, cache});

type RpcDef<Params, AuthMeta, RateLimitMeta, Result> = {
  inputValidation: z.ZodSchema<Params>;
  auth: (rpc: Rpc<Params>) => Promise<GuardResult<AuthMeta>> | GuardResult<AuthMeta>;
  rateLimit: (rpc: Rpc<Params>, authResult: GuardResult<AuthMeta>) => Promise<GuardResult<RateLimitMeta>> | GuardResult<RateLimitMeta>;
  cache: (rpc: Rpc<Params>, authResult: GuardResult<AuthMeta>, rateLimitResult: GuardResult<RateLimitMeta>) => Promise<CacheConfig<Result>> | CacheConfig<Result>;
  handle: (
    {
      params, 
      authResult, 
      rateLimitResult
    }: {
      params: Params, 
      authResult: GuardResult<AuthMeta>, 
      rateLimitResult: GuardResult<RateLimitMeta>
    }) => Promise<Result>;
}

// type Prettify<T> = {
//   [K in keyof T]: T[K];
// } & {};

type ParamsOf<D> = D extends RpcDef<infer P, any, any, any> ? P : never;
type ResultOf<D> = D extends RpcDef<any, any, any, infer R> ? R : never;

type ExposedFunctions<RpcMap extends Record<string, RpcDef<any, any, any, any>>> = {
  [K in keyof RpcMap]: (args: ParamsOf<RpcMap[K]>) => ResultOf<RpcMap[K]>;
}

type RpcMapOf<H extends RpcHandler<any>> = H extends RpcHandler<infer T> ? T : never;

export type InferRpc<H extends RpcHandler<any>> = ExposedFunctions<RpcMapOf<H>>;

export class RpcHandler<RpcMap extends Record<string, RpcDef<any, any, any, any>>> {
  private static readonly bodySchema = z.object({
    id: z.string().optional(),
    method: z.string(),
    params: z.unknown().optional(),
  });

  private static readonly defaultAuth: (rpc: Rpc<any>) => Promise<GuardResult<any>> = async () => ({ success: true, result: undefined });
  private static readonly defaultRateLimit: (rpc: Rpc<any>, authResult: GuardResult<any>) => Promise<GuardResult<any>> = async () => ({ success: true, result: undefined });
  private static readonly defaultCache: (rpc: Rpc<any>, authResult: GuardResult<any>, rateLimitResult: GuardResult<any>) => Promise<CacheConfig<any>> = async () => undefined;

  /**
   * RPC handler
   * @param rpcs - Record of RPC definitions
   * @param config - Configuration
   * @param config.rpcs - Record of RPC definitions
   * @param config.parallelism - When handling a list of RPCs, the number of RPCs to handle in parallel
   */
  constructor(
    private readonly rpcs: RpcMap,
  ) {}

  async handle(request: unknown): Promise<RpcReturn<any>> {
    const validated = RpcHandler.bodySchema.safeParse(request);
    if (!validated.success) throw new InvalidInputError(validated.error);
    const rpc = validated.data;
    
    try {
      const result = await this._handleSingleRpc(rpc);
      return {id: rpc.id, result};
    } catch (error) {
      if (error instanceof RpcError) {
        return {id: rpc.id, error: {
          code: error.name,
          hint: error.hint,
        }};
      }
      if (error instanceof Error) {
        return {id: rpc.id, error: {
          code: error.name,
          hint: error.message,
        }};
      }
      return {id: rpc.id, error};
    }
  }

  private async _handleSingleRpc(rpc: Rpc<any>): Promise<any> {
    const { method, params } = rpc;
    const func = this.rpcs[method];
    if (!func) throw new MethodNotDefinedError(method);

    const validatedParams = func.inputValidation.safeParse(params);
    if (!validatedParams.success) throw new InvalidInputError(validatedParams.error);

    const authFn = func.auth ?? RpcHandler.defaultAuth;
    const authResult = await authFn(rpc);
    if (!authResult.success) throw new AuthenticationError(authResult.result);    

    const rateLimitFn = func.rateLimit ?? RpcHandler.defaultRateLimit;
    const rateLimitResult = await rateLimitFn(rpc, authResult);
    if (!rateLimitResult.success) throw new RateLimitError(rateLimitResult.result);

    const cacheFn = func.cache ?? RpcHandler.defaultCache;
    const cacheConfig = await cacheFn(rpc, authResult, rateLimitResult);
    const cachedValue = cacheConfig?.get();
    if (cachedValue) return cachedValue;

    const result = await func.handle({params: validatedParams.data, authResult, rateLimitResult});

    cacheConfig?.set(result);
    return result;
  }
}