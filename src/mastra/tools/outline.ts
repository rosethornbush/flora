import { MCPClient } from "@mastra/mcp";
import { z } from "zod";

import { needsApproval } from "../agents/judge";

const headers = new Headers({
  Authorization: `Bearer ${process.env.OUTLINE_API_KEY}`,
});
if (process.env.OUTLINE_CF_ACCESS_CLIENT_ID)
  headers.set("CF-Access-Client-Id", process.env.OUTLINE_CF_ACCESS_CLIENT_ID);
if (process.env.OUTLINE_CF_ACCESS_CLIENT_SECRET)
  headers.set("CF-Access-Client-Secret", process.env.OUTLINE_CF_ACCESS_CLIENT_SECRET);

export const outline = process.env.OUTLINE_API_KEY
  ? new MCPClient({
      id: "flora-outline",
      servers: {
        outline: {
          url: new URL(process.env.OUTLINE_MCP_URL || "https://docs.apt346.casa/mcp"),
          requestInit: { headers },
          requireToolApproval: ({ annotations }) => annotations?.readOnlyHint !== true,
        },
      },
    })
  : undefined;

export const outlineTools = (await outline?.listTools()) || {};
for (const [name, tool] of Object.entries(outlineTools)) {
  if (!tool.requireApproval) continue;
  const requireApproval = tool.requireApproval;
  tool.requireApproval = async (input, context) => {
    if (requireApproval !== true && !(await requireApproval(input, context))) return false;
    const trusted = z
      .object({ request: z.string(), runId: z.uuid() })
      .safeParse(context?.requestContext);
    if (!trusted.success) return true;
    return needsApproval(name, JSON.stringify(input), trusted.data.request, trusted.data.runId);
  };
}
