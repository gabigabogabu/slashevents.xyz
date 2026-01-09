import { useCallback, useEffect, useRef, useState } from "react";
import type { DependencyList } from "react";
import { getErrorMessage } from "@/lib/errors";

type UseRpcResult<TData> = {
  isLoading: boolean;
  data: TData | null;
  error: string | null;
  refetch: () => void;
};

type UseRpcParams = {
  enabled?: boolean;
  deps?: DependencyList;
};

/**
 * Runs an async RPC call (or any Promise-returning function) and exposes
 * `{ isLoading, data, error, refetch }`, handling error mapping + stale request protection.
 */
export function useRpc<TData>(
  fn: (() => Promise<TData>) | null,
  params: UseRpcParams = {}
): UseRpcResult<TData> {
  const { enabled = true, deps = [] } = params;
  const hasFn = fn !== null;

  const [data, setData] = useState<TData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(() => enabled && hasFn);
  const [refreshToken, setRefreshToken] = useState(0);

  const requestIdRef = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled || fnRef.current === null) {
      setIsLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);

    const run = async () => {
      try {
        const next = await fnRef.current?.();
        if (requestIdRef.current !== requestId) return;
        setData(next ?? null);
      } catch (err) {
        if (requestIdRef.current !== requestId) return;
        setError(getErrorMessage(err));
      } finally {
        if (requestIdRef.current !== requestId) return;
        setIsLoading(false);
      }
    };

    void run();

    return () => {
      // Invalidate any in-flight request for this effect.
      requestIdRef.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, hasFn, refreshToken, ...deps]);

  const refetch = useCallback(() => {
    setRefreshToken((v) => v + 1);
  }, []);

  return { isLoading, data, error, refetch };
}

type UseRpcMutationResult<TData, TArgs extends unknown[]> = {
  mutate: (...args: TArgs) => Promise<TData | null>;
  isLoading: boolean;
  data: TData | null;
  error: string | null;
  reset: () => void;
};

type UseRpcMutationParams<TData> = {
  onSuccess?: (data: TData) => void;
  onError?: (error: string) => void;
};

/**
 * Runs an async RPC call on-demand (e.g. form submit) and exposes
 * `{ isLoading, data, error }`.
 */
export function useRpcMutation<TArgs extends unknown[], TData>(
  fn: (...args: TArgs) => Promise<TData>,
  params: UseRpcMutationParams<TData> = {}
): UseRpcMutationResult<TData, TArgs> {
  const { onSuccess, onError } = params;

  const [data, setData] = useState<TData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const requestIdRef = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    return () => {
      requestIdRef.current++;
    };
  }, []);

  const mutate = useCallback(
    async (...args: TArgs) => {
      const requestId = ++requestIdRef.current;
      setIsLoading(true);
      setError(null);

      try {
        const next = await fnRef.current(...args);
        if (requestIdRef.current !== requestId) return null;
        setData(next ?? null);
        onSuccess?.(next);
        return next ?? null;
      } catch (err) {
        if (requestIdRef.current !== requestId) return null;
        const message = getErrorMessage(err);
        setError(message);
        onError?.(message);
        return null;
      } finally {
        if (requestIdRef.current !== requestId) return null;
        setIsLoading(false);
      }
    },
    [onError, onSuccess]
  );

  const reset = useCallback(() => {
    requestIdRef.current++;
    setIsLoading(false);
    setError(null);
    setData(null);
  }, []);

  return { mutate, isLoading, data, error, reset };
}

