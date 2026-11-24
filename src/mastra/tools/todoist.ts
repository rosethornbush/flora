import type { Tool } from "@mastra/core/tools";
import type { MCPClient } from "@mastra/mcp";

import { createTodoistClient } from "../todoist-client";

export let todoist: MCPClient | undefined;
export let todoistTools: Record<string, Tool> = {};

export async function refreshTodoistTools() {
  const next = await createTodoistClient();
  const { tools = {}, errors = {}, errorDetails = {} } = (await next?.listToolsWithErrors()) || {};
  if (errors.todoist) {
    const needsAuth =
      next?.getServerAuthState("todoist") === "needs-auth" ||
      errorDetails.todoist?.httpStatus === 401;
    await next?.disconnect();
    if (!needsAuth) throw new Error("Todoist tools are unavailable. Try /todoist connect again.");
    console.warn("Todoist needs authorization. Use /todoist connect in Flora's DMs.");
  }
  await todoist?.disconnect();
  todoist = errors.todoist ? undefined : next;
  todoistTools = errors.todoist ? {} : tools;
  return todoistTools;
}

await refreshTodoistTools();
