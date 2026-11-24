import { sanitizeToolId, type Tool } from "@mastra/core/tools";
import { getMcpCallToolMeta, MCPClient } from "@mastra/mcp";
import { z } from "zod";

import { CodexAuthenticationError, loadCodexCredentials } from "../../providers/codex";

const enabledApps = new Set(
  (process.env.CHATGPT_APPS ?? "search_service,shop,target,github")
    .split(",")
    .map((app) => app.trim())
    .filter(Boolean),
);
const requestSchema = z.object({ method: z.string().optional() });
const catalogSchema = z.looseObject({
  result: z.looseObject({
    tools: z.array(
      z.looseObject({
        name: z.string(),
        _meta: z
          .looseObject({
            "openai/visibility": z.string().optional(),
            ui: z.looseObject({ visibility: z.array(z.string()).optional() }).optional(),
          })
          .optional(),
        outputSchema: z
          .looseObject({
            type: z.string().optional(),
            anyOf: z.array(z.looseObject({ type: z.string().optional() })).optional(),
          })
          .optional(),
      }),
    ),
  }),
});

// Widget metadata can contain secrets; expose only these Target catalog fields.
const targetSearchSchema = z.object({
  search_items_response: z.object({
    errors: z.array(z.object({ message: z.string() })).optional(),
    data: z.object({
      search: z.object({
        search_response: z
          .object({
            metadata: z.object({
              total_results: z.number().optional(),
              current_page: z.number().optional(),
              total_pages: z.number().optional(),
            }),
          })
          .optional(),
        products: z.array(
          z.object({
            tcin: z.string(),
            item: z.object({
              product_description: z.object({
                title: z.string(),
                bullet_descriptions: z.array(z.string()).optional(),
              }),
              primary_brand: z.object({ name: z.string() }).optional(),
              enrichment: z.object({ buy_url: z.url({ protocol: /^https?$/ }) }).optional(),
            }),
            price: z
              .object({
                current_retail: z.number().optional(),
                formatted_current_price: z.string().optional(),
                reg_retail: z.number().optional(),
              })
              .optional(),
            fulfillment: z
              .object({
                sold_out: z.boolean().optional(),
                shipping_options: z
                  .object({ availability_status: z.string().optional() })
                  .optional(),
              })
              .optional(),
          }),
        ),
      }),
    }),
  }),
});

export const chatgpt = new MCPClient({
  id: "flora-chatgpt-apps",
  servers: {
    chatgpt: {
      url: new URL("https://chatgpt.com/backend-api/ps/mcp"),
      protocolVersion: "legacy",
      connectTimeout: 30_000,
      allowedHosts: ["chatgpt.com"],
      requireToolApproval: ({ annotations }) =>
        annotations?.readOnlyHint !== true || annotations.destructiveHint === true,
      fetch: async (url, init) => {
        const request = new Request(url, init);
        const method =
          request.method === "POST"
            ? requestSchema.parse(await request.clone().json()).method
            : undefined;
        const credentials = await loadCodexCredentials();
        const headers = new Headers(request.headers);
        headers.set("Authorization", `Bearer ${credentials.access}`);
        headers.set("ChatGPT-Account-ID", credentials.accountId);
        headers.set("X-OpenAI-Product-Sku", "codex");
        const response = await fetch(request, { headers, redirect: "error" });
        if (
          method !== "tools/list" ||
          !response.ok ||
          !response.headers.get("content-type")?.includes("application/json")
        )
          return response;
        const catalog = catalogSchema.safeParse(await response.clone().json());
        if (!catalog.success) return response;
        const tools = catalog.data.result.tools
          .filter((tool) => {
            const meta = tool._meta;
            return (
              meta?.["openai/visibility"] !== "private" &&
              (!meta?.ui?.visibility || meta.ui.visibility.includes("model"))
            );
          })
          .map((tool) => {
            const schema = tool.outputSchema;
            if (schema?.type || !schema?.anyOf?.every((option) => option.type === "object"))
              return tool;
            // The gateway omits the object root required by legacy MCP on object-only unions.
            return { ...tool, outputSchema: { ...schema, type: "object" } };
          });
        const resultHeaders = new Headers(response.headers);
        resultHeaders.delete("content-length");
        resultHeaders.delete("content-encoding");
        return new Response(
          JSON.stringify({
            ...catalog.data,
            result: { ...catalog.data.result, tools },
          }),
          { status: response.status, headers: resultHeaders },
        );
      },
    },
  },
});

async function discoverChatgptTools(allowMissingAuth = false): Promise<Record<string, Tool>> {
  if (!enabledApps.size) return {};
  try {
    await loadCodexCredentials();
  } catch (error) {
    if (!allowMissingAuth || !(error instanceof CodexAuthenticationError)) throw error;
    console.warn("ChatGPT apps need authentication. Use /codex connect to restore them.");
    return {};
  }
  const { tools, errors, errorDetails } = await chatgpt.listToolsWithErrors();
  if (errors.chatgpt) {
    const details = errorDetails.chatgpt;
    if (
      allowMissingAuth &&
      (details?.httpStatus === 401 || details?.code === "CODEX_AUTH_UNAVAILABLE")
    ) {
      console.warn("ChatGPT apps need authentication. Use /codex connect to restore them.");
      return {};
    }
    throw new Error(`ChatGPT apps unavailable: ${errors.chatgpt}`);
  }

  const ids = new Set<string>();
  return Object.fromEntries(
    Object.entries(tools)
      .filter(([name]) => enabledApps.has(name.slice("chatgpt_".length).split(".")[0]!))
      .map(([name, tool]) => {
        const id = sanitizeToolId(name);
        if (ids.has(id)) throw new Error(`ChatGPT app tool name collision: ${id}`);
        ids.add(id);
        // Keep Mastra's native execution closure, which calls the original dotted MCP name.
        tool.id = id;
        if (
          name === "chatgpt_target.searchItems" ||
          name === "chatgpt_target.multiCategorySearchItems"
        ) {
          const toModelOutput = tool.toModelOutput;
          tool.toModelOutput = (output) => {
            const response = getMcpCallToolMeta(output)?.response;
            if (response === undefined)
              return toModelOutput?.(output) ?? { type: "json", value: output };
            const search = targetSearchSchema.parse(response).search_items_response;
            return { type: "json", value: search };
          };
        }
        return [id, tool];
      }),
  );
}

export let chatgptTools = await discoverChatgptTools(true);

export async function refreshChatgptTools() {
  chatgptTools = await discoverChatgptTools();
  return chatgptTools;
}
