import { MCPClient } from "@mastra/mcp";

import {
  createTodoistLoginProvider,
  saveTodoistLogin,
  todoistLocalRedirectUrl,
} from "./mastra/todoist-client";

let todoist: MCPClient | undefined;
try {
  const provider = await createTodoistLoginProvider(todoistLocalRedirectUrl, (url) => {
    console.log(`Authorize Todoist: ${url}`);
  });
  todoist = new MCPClient({
    id: "flora-todoist-login",
    servers: {
      todoist: {
        url: new URL("https://ai.todoist.net/mcp"),
        protocolVersion: "legacy",
        enableServerLogs: false,
        authProvider: provider,
      },
    },
  });
  await todoist.authenticate("todoist", { timeoutMs: 15 * 60_000 });
  await saveTodoistLogin(provider);
  console.log("Todoist connected. Restart Flora to load its tools.");
} catch {
  console.error("Todoist login failed. Run pnpm run todoist:login to try again.");
  process.exitCode = 1;
} finally {
  await todoist?.disconnect();
}
