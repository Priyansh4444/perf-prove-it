import type { ReactNode } from "react";

export const isLocalId = (id: string) => id.startsWith("local_");

export function useStore() {
  return {
    mode: "demo" as const,
    editReply: async (_args: { replyId: string; body: string }) => {},
    deleteReply: async (_args: { replyId: string }) => {},
  };
}

export function StoreProvider({ children }: { children?: ReactNode }) {
  return children;
}
