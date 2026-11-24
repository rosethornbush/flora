import { ToolSearchProcessor, type ToolSearchProcessorOptions } from "@mastra/core/processors";

import { chatgptTools } from "../tools/chatgpt";
import { directions } from "../tools/directions";
import { googleTools } from "../tools/google";
import { outlineTools } from "../tools/outline";
import { todoistTools } from "../tools/todoist";

let cached:
  | {
      chatgptTools: ToolSearchProcessorOptions["tools"];
      todoistTools: ToolSearchProcessorOptions["tools"];
      processor: ToolSearchProcessor;
    }
  | undefined;

export function getToolSearch() {
  if (cached?.chatgptTools === chatgptTools && cached.todoistTools === todoistTools)
    return cached.processor;
  const processor = new ToolSearchProcessor({
    // SAFETY: Mastra loads original tools with the run's context; the catalog type omits typed contexts.
    tools: {
      directions,
      ...chatgptTools,
      ...outlineTools,
      ...todoistTools,
      ...googleTools,
    } as ToolSearchProcessorOptions["tools"],
    search: { topK: 3, autoLoad: true },
    storage: "context",
  });
  cached = { chatgptTools, todoistTools, processor };
  return processor;
}
