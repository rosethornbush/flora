import {
  auth,
  InMemoryOAuthStorage,
  MCPClient,
  MCPOAuthClientProvider,
  getCallbackUrlCandidates,
} from "@mastra/mcp";
import { z } from "zod";

import { publicOrigin } from "../oauth-config";
import { todoistOAuthStorage } from "../state";
import { needsApproval } from "./agents/judge";

const serverUrl = "https://ai.todoist.net/mcp";
export const todoistLocalRedirectUrl =
  process.env.TODOIST_OAUTH_REDIRECT_URL || "http://127.0.0.1:5533/oauth/callback";
const localRedirect = new URL(todoistLocalRedirectUrl);
if (
  localRedirect.protocol !== "http:" ||
  !["127.0.0.1", "localhost", "[::1]"].includes(localRedirect.hostname) ||
  localRedirect.username ||
  localRedirect.password ||
  localRedirect.search ||
  localRedirect.hash
)
  throw new Error("TODOIST_OAUTH_REDIRECT_URL must be an HTTP loopback callback URL.");
export const todoistRedirectUrl = publicOrigin
  ? `${publicOrigin}/oauth/todoist/callback`
  : todoistLocalRedirectUrl;

function clientMetadata(redirectUrl: string) {
  return {
    client_name: "Flora",
    // Todoist permits 10 redirect URIs; Mastra offers 11 candidate ports.
    redirect_uris: redirectUrl.startsWith("https:")
      ? [redirectUrl]
      : getCallbackUrlCandidates(redirectUrl).slice(0, 10).map(String),
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    scope: "data:read_write data:delete project:delete",
  };
}
const clientSchema = z.object({
  client_id: z.string().min(1),
  client_secret: z.string().optional(),
});

async function registerTodoistClient(redirectUrl: string) {
  try {
    const metadata = clientMetadata(redirectUrl);
    const stored = await todoistOAuthStorage.get("registered_client");
    if (
      stored &&
      (await todoistOAuthStorage.get("registered_metadata")) === JSON.stringify(metadata)
    )
      return clientSchema.parse(JSON.parse(stored));
    const response = await fetch("https://todoist.com/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(metadata),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error();
    const client = clientSchema.parse(await response.json());
    await todoistOAuthStorage.set("registered_client", JSON.stringify(client));
    await todoistOAuthStorage.set("registered_metadata", JSON.stringify(metadata));
    return client;
  } catch {
    throw new Error("Todoist registration failed. Try connecting again.");
  }
}

export async function createTodoistClient() {
  const stored = await todoistOAuthStorage.get("client");
  if (!stored) return;
  return new MCPClient({
    id: "flora-todoist",
    servers: {
      todoist: {
        url: new URL(serverUrl),
        protocolVersion: "legacy",
        enableServerLogs: false,
        authProvider: new MCPOAuthClientProvider({
          redirectUrl: todoistRedirectUrl,
          clientMetadata: clientMetadata(todoistRedirectUrl),
          clientInformation: clientSchema.parse(JSON.parse(stored)),
          storage: todoistOAuthStorage,
          onRedirectToAuthorization: () => {
            throw new Error("Todoist needs authorization. Use /todoist connect in Flora's DMs.");
          },
        }),
        requireToolApproval: ({ toolName, args, annotations, requestContext }) => {
          if (annotations?.readOnlyHint) return false;
          const trusted = z
            .object({ request: z.string(), runId: z.uuid() })
            .safeParse(requestContext);
          if (!trusted.success) return true;
          return needsApproval(
            toolName,
            JSON.stringify(args),
            trusted.data.request,
            trusted.data.runId,
          );
        },
      },
    },
  });
}

export async function createTodoistLoginProvider(
  redirectUrl: string,
  onRedirectToAuthorization: (url: URL) => void,
) {
  return new MCPOAuthClientProvider({
    redirectUrl,
    clientMetadata: clientMetadata(redirectUrl),
    clientInformation: await registerTodoistClient(redirectUrl),
    storage: new InMemoryOAuthStorage(),
    onRedirectToAuthorization,
  });
}

export async function saveTodoistLogin(provider: MCPOAuthClientProvider) {
  const clientInformation = provider.clientInformation();
  const tokens = await provider.tokens();
  if (!tokens?.issuer) throw new Error("Todoist did not return valid credentials.");
  const storageProvider = new MCPOAuthClientProvider({
    redirectUrl: provider.redirectUrl,
    clientMetadata: provider.clientMetadata,
    clientInformation,
    storage: todoistOAuthStorage,
    onRedirectToAuthorization: () => {
      throw new Error("Todoist needs authorization.");
    },
  });
  await storageProvider.saveTokens(tokens, { issuer: tokens.issuer });
  await todoistOAuthStorage.set("client", JSON.stringify(clientInformation));
}

const loginDuration = 15 * 60_000;
let startingLogin = false;
let loginController: AbortController | undefined;
let pendingLogin:
  | {
      provider: MCPOAuthClientProvider;
      controller: AbortController;
      timer: NodeJS.Timeout;
      expiresAt: number;
      state: string;
      url: string;
    }
  | undefined;

export function stopTodoistLogin() {
  loginController?.abort();
  if (!pendingLogin) return;
  clearTimeout(pendingLogin.timer);
  pendingLogin.controller.abort();
  pendingLogin.provider.endAuthorizationSession();
  pendingLogin = undefined;
}

export async function beginTodoistLogin(): Promise<{ url: string }> {
  if (!publicOrigin)
    throw new Error(
      "Todoist browser login needs FLORA_PUBLIC_URL. Without it, run pnpm run todoist:login on Flora's host.",
    );
  if (startingLogin) throw new Error("Todoist login is already starting. Try again shortly.");
  if (pendingLogin && pendingLogin.expiresAt > Date.now()) return { url: pendingLogin.url };
  stopTodoistLogin();
  startingLogin = true;
  const controller = new AbortController();
  loginController = controller;
  let provider: MCPOAuthClientProvider | undefined;
  try {
    let url: string | undefined;
    provider = await createTodoistLoginProvider(todoistRedirectUrl, (authorizationUrl) => {
      url = authorizationUrl.toString();
    });
    const state = await provider.beginAuthorizationSession();
    const result = await auth(provider, {
      serverUrl,
      forceReauthorization: true,
      fetchFn: (input, init) =>
        fetch(input, {
          ...init,
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
        }),
    });
    if (result !== "REDIRECT" || !url) throw new Error();
    const timer = setTimeout(stopTodoistLogin, loginDuration);
    timer.unref();
    pendingLogin = {
      provider,
      controller,
      timer,
      expiresAt: Date.now() + loginDuration,
      state,
      url,
    };
    return { url };
  } catch {
    controller.abort();
    provider?.endAuthorizationSession();
    throw new Error("Todoist login could not start. Try /todoist connect again.");
  } finally {
    startingLogin = false;
  }
}

export async function completeTodoistLogin(redirectUrl: string): Promise<void> {
  const session = pendingLogin;
  if (!session || session.expiresAt <= Date.now()) {
    stopTodoistLogin();
    throw new Error("Todoist login expired. Start again with /todoist connect.");
  }
  let callback: URL;
  try {
    callback = new URL(redirectUrl);
    const expected = new URL(todoistRedirectUrl);
    if (
      callback.origin !== expected.origin ||
      callback.pathname !== expected.pathname ||
      callback.username ||
      callback.password ||
      callback.hash ||
      callback.searchParams.getAll("state").length !== 1 ||
      callback.searchParams.get("state") !== session.state ||
      callback.searchParams.getAll("code").length > 1 ||
      callback.searchParams.getAll("iss").length > 1
    )
      throw new Error();
  } catch {
    throw new Error("Invalid Todoist callback. Use the link from /todoist connect.");
  }
  pendingLogin = undefined;
  startingLogin = true;
  try {
    const code = callback.searchParams.get("code");
    if (callback.searchParams.has("error") || !code) throw new Error();
    const result = await auth(session.provider, {
      serverUrl,
      authorizationCode: code,
      iss: callback.searchParams.get("iss") ?? undefined,
      fetchFn: (input, init) =>
        fetch(input, {
          ...init,
          signal: AbortSignal.any([session.controller.signal, AbortSignal.timeout(30_000)]),
        }),
    });
    if (result !== "AUTHORIZED") throw new Error();
    await saveTodoistLogin(session.provider);
  } catch {
    throw new Error("Todoist login did not finish. Start again with /todoist connect.");
  } finally {
    clearTimeout(session.timer);
    session.controller.abort();
    session.provider.endAuthorizationSession();
    startingLogin = false;
  }
}
