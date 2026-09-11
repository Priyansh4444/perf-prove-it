import type { ReactNode } from "react";

export type AgentTask = { _id: string };

export function useAgentTasks() {
  return {
    tasks: [] as AgentTask[],
    tasksForPost: (_postId: string) => [] as AgentTask[],
    dispatch: async (_args: unknown) => {},
  };
}

export function AgentTasksProvider({ children }: { children?: ReactNode }) {
  return children;
}
