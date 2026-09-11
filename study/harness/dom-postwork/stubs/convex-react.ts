export function useQuery(..._args: unknown[]) {
  return undefined;
}

export function useMutation(..._args: unknown[]) {
  return async () => undefined;
}

export function useAction(..._args: unknown[]) {
  return async () => undefined;
}

export function usePaginatedQuery(..._args: unknown[]) {
  return { results: [], status: "Exhausted", loadMore: null };
}

export function useConvex() {
  return {};
}

export function ConvexProvider({ children }: { children?: unknown }) {
  return children;
}

export class ConvexReactClient {
  constructor(..._args: unknown[]) {}
}
