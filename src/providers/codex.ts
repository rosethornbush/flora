import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { createOpenAI } from "@ai-sdk/openai";
import { parseJsonEventStream, wrapLanguageModel } from "ai";
import lockfile from "proper-lockfile";
import { z } from "zod";

export const codexAuthFile =
  process.env.CODEX_AUTH_FILE || join(homedir(), ".config", "flora", "oauth.json");

const credentialSchema = z.object({
  type: z.literal("oauth"),
  access: z.string().min(1),
  refresh: z.string().min(1),
  expires: z.number().finite(),
  accountId: z.string().min(1),
});

type OAuthCredentialRecord = z.infer<typeof credentialSchema>;

export class CodexAuthenticationError extends Error {
  readonly code = "CODEX_AUTH_UNAVAILABLE";
}

export interface CodexLoginSession {
  deviceID: string;
  userCode: string;
  interval: number;
  verificationURL: string;
}

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const issuer = "https://auth.openai.com";

const tokenSchema = z
  .object({
    access_token: z.string().min(1),
    refresh_token: z.string().min(1),
    id_token: z.string().optional().catch(undefined),
    expires_in: z.number().positive().optional(),
  })
  .catch(({ error }) => {
    if (error.issues[0]?.path[0] === "expires_in")
      throw new Error("Codex token response has an invalid expiry.");
    throw new Error("Codex token response is missing credentials. Sign in again.");
  });
const claimsSchema = z.object({
  chatgpt_account_id: z.unknown().optional(),
  "https://api.openai.com/auth": z.unknown().optional(),
});
const deviceCodeSchema = z.object({
  device_auth_id: z.string().min(1),
  user_code: z.unknown().optional(),
  usercode: z.unknown().optional(),
  interval: z
    .union([z.number(), z.string()])
    .nullish()
    .transform((value) => Number(value ?? 5))
    .pipe(z.number().positive()),
});
const authorizationSchema = z.object({
  authorization_code: z.string().min(1),
  code_verifier: z.string().min(1),
});

function requireOK(response: Response, action: string) {
  if (response.ok) return;
  if (response.status === 401)
    throw new CodexAuthenticationError(
      `Codex ${action}: authentication expired. Sign in again with /codex connect or pnpm run codex:login.`,
    );
  if (response.status === 429) {
    const retry = response.headers.get("retry-after");
    throw new Error(
      `Codex ${action}: subscription or rate limit reached.${retry ? ` Retry after ${retry}.` : ""}`,
    );
  }
  throw new Error(`Codex ${action} failed (HTTP ${response.status}).`);
}

function accountID(token: string | undefined) {
  if (!token) return;
  const payload = token.split(".")[1];
  if (!payload) return;
  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return;
  }
  const claims = claimsSchema.safeParse(decoded);
  if (!claims.success) return;
  const nested = claimsSchema.safeParse(claims.data["https://api.openai.com/auth"]);
  const id = z
    .string()
    .min(1)
    .safeParse(
      claims.data.chatgpt_account_id ??
        (nested.success ? nested.data.chatgpt_account_id : undefined),
    );
  return id.success ? id.data : undefined;
}

function credentials(
  tokens: z.infer<typeof tokenSchema>,
  previous?: OAuthCredentialRecord,
): OAuthCredentialRecord {
  const accountId =
    accountID(tokens.id_token) ?? accountID(tokens.access_token) ?? previous?.accountId;
  if (!accountId)
    throw new Error("Codex token response is missing the ChatGPT account identifier.");
  return {
    type: "oauth",
    access: tokens.access_token,
    refresh: tokens.refresh_token,
    expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    accountId,
  };
}

export async function startCodexLogin(): Promise<CodexLoginSession> {
  const response = await fetch(`${issuer}/api/accounts/deviceauth/usercode`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "flora" },
    body: JSON.stringify({ client_id: CLIENT_ID, originator: "flora" }),
    signal: AbortSignal.timeout(15_000),
  });
  requireOK(response, "login");
  const data = deviceCodeSchema.parse(await response.json());
  const userCode = z
    .string()
    .min(1)
    .parse(data.user_code ?? data.usercode);
  return {
    deviceID: data.device_auth_id,
    userCode,
    interval: Math.max(1, data.interval) * 1000,
    verificationURL: `${issuer}/codex/device`,
  };
}

export async function finishCodexLogin(session: CodexLoginSession, signal: AbortSignal) {
  while (true) {
    signal.throwIfAborted();
    await delay(session.interval, undefined, { signal });
    const response = await fetch(`${issuer}/api/accounts/deviceauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "flora" },
      body: JSON.stringify({ device_auth_id: session.deviceID, user_code: session.userCode }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    });
    if (response.status === 403 || response.status === 404) continue;
    requireOK(response, "login");
    const data = authorizationSchema.parse(await response.json());
    const token = await fetch(`${issuer}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: CLIENT_ID,
        code: data.authorization_code,
        code_verifier: data.code_verifier,
        redirect_uri: `${issuer}/deviceauth/callback`,
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    });
    requireOK(token, "token exchange");
    return credentials(tokenSchema.parse(await token.json()));
  }
}

async function refreshOpenAICodexCredentials(
  previous: OAuthCredentialRecord,
): Promise<OAuthCredentialRecord> {
  const response = await fetch(`${issuer}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: previous.refresh,
      client_id: CLIENT_ID,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 400) {
    const result = z
      .object({
        error: z.union([
          z.string(),
          z.object({ code: z.string() }).transform((error) => error.code),
        ]),
      })
      .safeParse(
        await response
          .clone()
          .json()
          .catch(() => undefined),
      );
    const code = result.success ? result.data.error : undefined;
    if (
      code &&
      [
        "invalid_grant",
        "refresh_token_expired",
        "refresh_token_reused",
        "refresh_token_invalidated",
      ].includes(code)
    )
      throw new CodexAuthenticationError(
        "Codex authentication expired. Sign in again with /codex connect or pnpm run codex:login.",
      );
  }
  requireOK(response, "token refresh");
  return credentials(tokenSchema.parse(await response.json()), previous);
}

export async function saveCodexCredentials(authFile: string, credentials: OAuthCredentialRecord) {
  mkdirSync(dirname(authFile), { recursive: true, mode: 0o700 });
  const release = await lockfile.lock(authFile, {
    realpath: false,
    retries: { retries: 10, factor: 2, minTimeout: 50, maxTimeout: 2000, randomize: true },
    stale: 30_000,
  });
  try {
    const data = existsSync(authFile)
      ? z.record(z.string(), z.unknown()).parse(JSON.parse(readFileSync(authFile, "utf8")))
      : {};
    writeFileSync(authFile, JSON.stringify({ ...data, "openai-codex": credentials }, null, 2), {
      mode: 0o600,
    });
    chmodSync(authFile, 0o600);
  } finally {
    await release();
  }
}

export async function loadCodexCredentials(
  authFile = codexAuthFile,
): Promise<OAuthCredentialRecord> {
  if (!existsSync(authFile))
    throw new CodexAuthenticationError(
      "No stored Codex credentials. Use /codex connect or pnpm run codex:login.",
    );
  const release = await lockfile.lock(authFile, {
    realpath: false,
    retries: { retries: 10, factor: 2, minTimeout: 50, maxTimeout: 2000, randomize: true },
    stale: 30_000,
  });
  try {
    const data = z
      .looseObject({ "openai-codex": credentialSchema.optional() })
      .parse(JSON.parse(readFileSync(authFile, "utf8")));
    const current = data["openai-codex"];
    if (!current)
      throw new CodexAuthenticationError(
        "No stored OAuth credentials for Codex. Use /codex connect or pnpm run codex:login.",
      );
    if (current.expires > Date.now() + 30_000) return current;
    const refreshed = await refreshOpenAICodexCredentials(current);
    data["openai-codex"] = { ...current, ...refreshed };
    writeFileSync(authFile, JSON.stringify(data, null, 2), { mode: 0o600 });
    chmodSync(authFile, 0o600);
    return data["openai-codex"];
  } finally {
    await release();
  }
}

const inferenceSchema = z.looseObject({
  stream: z.boolean().optional(),
  instructions: z.string().nullish(),
});
const outputItemSchema = z.looseObject({ type: z.string() });
const responseSchema = z.looseObject({
  output: z.array(outputItemSchema),
  error: z.object({ message: z.string() }).nullish(),
});
const responseEventSchema = z.object({
  type: z.string(),
  response: responseSchema.optional(),
  output_index: z.number().int().optional(),
  item: outputItemSchema.optional(),
  message: z.string().optional(),
});

export function createLanguageModel(modelId: string, authFile = codexAuthFile) {
  const provider = createOpenAI({
    apiKey: "codex-oauth",
    baseURL: "https://chatgpt.com/backend-api/codex",
    fetch: async (input, init) => {
      const request = new Request(input, init);
      request.signal.throwIfAborted();
      const body = inferenceSchema.parse(JSON.parse(await request.text()));
      const streaming = body.stream === true;
      body.stream = true;
      body.store = false;
      body.instructions ||=
        "Follow the user's instructions. Use tools when needed. Report failures accurately.";
      for (const key of [
        "max_output_tokens",
        "max_tokens",
        "temperature",
        "top_p",
        "frequency_penalty",
        "presence_penalty",
      ])
        delete body[key];
      const credentials = await loadCodexCredentials(authFile);
      request.signal.throwIfAborted();
      const headers = new Headers(request.headers);
      headers.delete("x-api-key");
      headers.set("Authorization", `Bearer ${credentials.access}`);
      headers.set("ChatGPT-Account-ID", credentials.accountId);
      headers.set("originator", "flora");
      headers.set("User-Agent", "flora/1.0.0 (Codex-compatible 0.160.0)");
      const response = await fetch(request.url, {
        method: request.method,
        headers,
        body: JSON.stringify(body),
        signal: request.signal,
      });
      if (streaming || !response.ok) return response;
      if (!response.body) throw new Error("Codex returned an empty response.");
      // Mastra's generate callers need JSON; Codex only accepts streaming requests.
      const reader = parseJsonEventStream({
        stream: response.body,
        schema: responseEventSchema,
      }).getReader();
      const output = new Map<number, z.infer<typeof outputItemSchema>>();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) throw new Error("Codex call completed without a final response.");
          if (!value.success) throw value.error;
          const event = value.value;
          // Codex can omit streamed output items from its final response object.
          if (event.type === "response.output_item.done")
            output.set(
              z.number().int().parse(event.output_index),
              outputItemSchema.parse(event.item),
            );
          if (event.type === "error" || event.type === "response.failed")
            throw new Error(
              event.response?.error?.message ?? event.message ?? "Codex inference failed.",
            );
          if (event.type === "response.completed" || event.type === "response.incomplete") {
            const headers = new Headers(response.headers);
            headers.set("Content-Type", "application/json");
            headers.delete("content-length");
            headers.delete("content-encoding");
            const completed = responseSchema.parse(event.response);
            return new Response(
              JSON.stringify({
                ...completed,
                output: output.size
                  ? [...output].sort(([a], [b]) => a - b).map(([, item]) => item)
                  : completed.output,
              }),
              {
                headers,
              },
            );
          }
        }
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
    },
  });
  return wrapLanguageModel({
    model: provider.responses(modelId),
    middleware: {
      specificationVersion: "v4",
      transformParams: async ({ params }) => ({
        ...params,
        // Object unions and intersections omit the root type required by Codex function tools.
        tools: params.tools?.map((tool) =>
          tool.type === "function"
            ? { ...tool, inputSchema: { type: "object", ...tool.inputSchema } }
            : tool,
        ),
        // Disable stored-item references before the provider converts history.
        providerOptions: {
          ...params.providerOptions,
          openai: { ...params.providerOptions?.openai, store: false, parallelToolCalls: true },
        },
      }),
    },
  });
}
