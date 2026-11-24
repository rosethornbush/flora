import { z } from "zod";

export const webSearch = {
  type: "provider-defined" as const,
  id: "openai.web_search",
  description: "Search web, open URLs, find page text. Codex hosted tool.",
  args: {},
  inputSchema: z.object({}).passthrough(),
};
