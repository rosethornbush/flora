import { once } from "node:events";
import { createServer } from "node:http";
import { promisify } from "node:util";

import { oauthPort, publicOrigin } from "../oauth-config";

export async function startOAuthServer({
  google,
  todoist,
  connected,
  reportError,
}: {
  google: (redirectUrl: string) => Promise<string>;
  todoist: (redirectUrl: string) => Promise<void>;
  connected: (provider: "Google" | "Todoist", account?: string) => Promise<void>;
  reportError: (message: string) => void;
}) {
  if (!publicOrigin) return;
  const server = createServer({ maxHeaderSize: 8192 }, (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    if (request.method !== "GET") {
      response.writeHead(405, { Allow: "GET" }).end("Method not allowed.");
      return;
    }
    let redirect: URL;
    try {
      redirect = new URL(request.url || "/", publicOrigin);
    } catch {
      response.writeHead(400).end("Invalid callback.");
      return;
    }
    if (redirect.origin !== publicOrigin) {
      response.writeHead(400).end("Invalid callback.");
      return;
    }
    if (redirect.pathname === "/healthz") {
      response.end("OK");
      return;
    }
    const provider =
      redirect.pathname === "/oauth/google/callback"
        ? "Google"
        : redirect.pathname === "/oauth/todoist/callback"
          ? "Todoist"
          : undefined;
    if (!provider) {
      response.writeHead(404).end("Not found.");
      return;
    }
    void (async () => {
      let account: string | undefined;
      try {
        if (provider === "Google") account = await google(redirect.toString());
        else await todoist(redirect.toString());
      } catch {
        response
          .writeHead(400)
          .end(
            `Could not connect ${provider}. Return to Flora and start /${provider.toLowerCase()} connect again.`,
          );
        return;
      }
      response.end(`${provider} connected. You can close this page and return to Flora.`);
      try {
        await connected(provider, account);
      } catch {
        reportError(
          `${provider} connected, but Discord confirmation or paused-work resumption failed.`,
        );
      }
    })();
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.listen(oauthPort, "0.0.0.0");
  await once(server, "listening");
  return async () => {
    const closed = promisify(server.close.bind(server))();
    server.closeIdleConnections();
    await closed;
  };
}
