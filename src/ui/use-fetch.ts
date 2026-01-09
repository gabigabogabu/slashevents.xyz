import { useEffect, useRef, useState } from "react";
import type { DependencyList } from "react";

type UseFetchResult<TData> = {
  isLoading: boolean;
  data: TData | null;
  error: Error | null;
};

type UseFetchParams<TData> = {
  init?: RequestInit;
  enabled?: boolean;
  deps?: DependencyList;
  parse?: (res: Response) => Promise<TData>;
};

function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  return new Error(typeof err === "string" ? err : "Unknown error");
}

export function useFetch<TData>(
  url: string | URL | null,
  params: UseFetchParams<TData> = {}
): UseFetchResult<TData> {
  const { init, enabled = true, deps = [], parse } = params;

  const [data, setData] = useState<TData | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!enabled || url === null) {
      setIsLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    const controller = new AbortController();

    setIsLoading(true);
    setError(null);

    const run = async () => {
      try {
        const res = await fetch(url, { ...init, signal: controller.signal });
        if (!res.ok) {
          throw new Error(`Request failed: ${res.status} ${res.statusText}`.trim());
        }
        const parsed =
          parse ?? (async (r: Response) => (await r.json()) as TData);
        const nextData = await parsed(res);
        if (requestIdRef.current !== requestId) return;
        setData(nextData);
      } catch (e) {
        if (controller.signal.aborted) return;
        if (requestIdRef.current !== requestId) return;
        setError(toError(e));
      } finally {
        if (requestIdRef.current !== requestId) return;
        setIsLoading(false);
      }
    };

    void run();

    return () => {
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, enabled, ...deps]);

  return { isLoading, data, error };
}

