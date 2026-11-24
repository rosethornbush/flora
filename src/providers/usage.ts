import { z } from "zod";

import { loadCodexCredentials } from "./codex";

const windowSchema = z.object({
  used_percent: z.number(),
  limit_window_seconds: z.number(),
  reset_at: z.number().int(),
});
const rateLimitSchema = z.object({
  primary_window: windowSchema.nullish(),
  secondary_window: windowSchema.nullish(),
});
const usageSchema = z.object({
  plan_type: z.string(),
  rate_limit: rateLimitSchema.nullish(),
  additional_rate_limits: z
    .array(z.object({ limit_name: z.string(), rate_limit: rateLimitSchema.nullish() }))
    .nullish(),
});

export async function getCodexUsage() {
  const credentials = await loadCodexCredentials();
  const headers = {
    Authorization: `Bearer ${credentials.access}`,
    "ChatGPT-Account-Id": credentials.accountId,
    "User-Agent": "codex-cli",
  };
  const response = await fetch("https://chatgpt.com/backend-api/wham/usage", {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Codex usage request failed (${response.status}).`);
  return usageSchema.parse(await response.json());
}
