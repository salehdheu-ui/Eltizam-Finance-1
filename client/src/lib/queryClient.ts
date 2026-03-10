import { QueryClient, QueryFunction } from "@tanstack/react-query";

export class ApiError extends Error {
  status: number;
  queueWaitMs?: number;

  constructor(message: string, status: number, queueWaitMs?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.queueWaitMs = queueWaitMs;
  }
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const rawText = (await res.text()) || res.statusText;
    const queueWaitHeader = res.headers.get("X-Write-Queue-Wait-Ms");
    const queueWaitMs = queueWaitHeader ? Number(queueWaitHeader) : undefined;
    let message = rawText;

    try {
      const parsed = JSON.parse(rawText) as { message?: string };
      message = parsed.message || rawText;
    } catch {
      message = rawText;
    }

    throw new ApiError(message, res.status, queueWaitMs);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "returnNull" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
