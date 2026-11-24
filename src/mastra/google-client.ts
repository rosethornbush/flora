import { randomBytes } from "node:crypto";

import { gmail } from "@googleapis/gmail";
import { CodeChallengeMethod, OAuth2Client, type Credentials } from "google-auth-library";
import { z } from "zod";

import { publicOrigin } from "../oauth-config";
import { googleLoginSessions, googleOAuthStorage } from "../state";

export const googleScopes = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
];
export const googleRedirectUrl = publicOrigin
  ? `${publicOrigin}/oauth/google/callback`
  : "http://127.0.0.1:5534/oauth/callback";
export const googleClientOptions = {
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  redirectUri: googleRedirectUrl,
};
const credentialsSchema = z.object({
  access_token: z.string().nullish(),
  refresh_token: z.string().nullish(),
  expiry_date: z.number().nullish(),
  token_type: z.string().nullish(),
  scope: z.string().optional(),
});
const clients = new Map<string, OAuth2Client>();
const storedCredentials = new Map<string, string>();
const loginSessionSchema = z.object({
  codeVerifier: z.string(),
  account: z.email().optional(),
});

export class GoogleLoginRequiredError extends Error {
  constructor(public readonly account?: string) {
    super(
      account
        ? `Google account ${account} is not linked. Connect it with /google connect.`
        : "No Google accounts linked. Connect one with /google connect.",
    );
  }
}

export async function beginGoogleLogin(account?: string): Promise<{ url: string; state: string }> {
  if (!googleClientOptions.clientId || !googleClientOptions.clientSecret)
    throw new Error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET before connecting Google.");
  const email = account ? z.email().parse(account).toLowerCase() : undefined;
  const auth = new OAuth2Client(googleClientOptions);
  const verifier = await auth.generateCodeVerifierAsync();
  const state = randomBytes(32).toString("base64url");
  googleLoginSessions.create(
    state,
    JSON.stringify({ codeVerifier: verifier.codeVerifier, account: email }),
    Date.now() + 15 * 60_000,
  );
  return {
    state,
    url: auth.generateAuthUrl({
      access_type: "offline",
      prompt: "select_account consent",
      scope: googleScopes,
      state,
      login_hint: email,
      code_challenge: verifier.codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
    }),
  };
}

export async function completeGoogleLogin(redirectUrl: string): Promise<string> {
  let redirect: URL;
  try {
    redirect = new URL(redirectUrl);
  } catch {
    throw new Error("Paste the full Google loopback redirect URL into /google complete.");
  }
  const expected = new URL(googleRedirectUrl);
  if (
    redirect.origin !== expected.origin ||
    redirect.pathname !== expected.pathname ||
    redirect.username ||
    redirect.password ||
    redirect.hash
  )
    throw new Error(`Google redirect must use ${googleRedirectUrl}.`);
  const code = redirect.searchParams.get("code");
  const state = redirect.searchParams.get("state");
  if (
    redirect.searchParams.has("error") ||
    !code ||
    !state ||
    redirect.searchParams.getAll("code").length !== 1 ||
    redirect.searchParams.getAll("state").length !== 1
  )
    throw new Error(
      "Google authorization was denied or the redirect is incomplete. Connect again.",
    );
  // Consume before exchanging the code so concurrent completions cannot reuse a session.
  const saved = googleLoginSessions.consume(state);
  if (!saved)
    throw new Error("Google login expired or was already used. Start /google connect again.");
  const session = loginSessionSchema.parse(JSON.parse(saved));
  const auth = new OAuth2Client(googleClientOptions);
  let tokens: Credentials;
  let email: string;
  try {
    ({ tokens } = await auth.getToken({ code, codeVerifier: session.codeVerifier }));
    auth.setCredentials(tokens);
    const { data } = await gmail({ version: "v1", auth }).users.getProfile({ userId: "me" });
    email = z.email().parse(data.emailAddress).toLowerCase();
  } catch {
    // Provider errors can contain the authorization code or tokens.
    throw new Error("Google authorization could not be completed. Start /google connect again.");
  }
  if (session.account && email !== session.account)
    throw new Error(
      `Choose ${session.account} when reconnecting Google. Existing credentials were not changed.`,
    );
  if (!tokens.refresh_token)
    throw new Error("Google did not issue offline access. Connect again and grant consent.");
  const serialized = JSON.stringify(tokens);
  googleOAuthStorage.set(email, serialized);
  clients.set(email, createAccountClient(email, tokens));
  storedCredentials.set(email, serialized);
  return email;
}
function createAccountClient(account: string, tokens: Credentials) {
  const auth = new OAuth2Client(googleClientOptions);
  auth.setCredentials(tokens);
  auth.on("tokens", (refreshed) => {
    if (clients.get(account) !== auth) return;
    const serialized = JSON.stringify({ ...auth.credentials, ...refreshed });
    googleOAuthStorage.set(account, serialized);
    storedCredentials.set(account, serialized);
  });
  return auth;
}
export async function getGoogleAccounts(account?: string) {
  for (const email of googleOAuthStorage.accounts()) {
    const serialized = googleOAuthStorage.get(email)!;
    if (storedCredentials.get(email) === serialized) continue;
    clients.set(email, createAccountClient(email, credentialsSchema.parse(JSON.parse(serialized))));
    storedCredentials.set(email, serialized);
  }
  if (!clients.size) {
    const legacy = googleOAuthStorage.get("tokens");
    if (legacy) {
      const auth = new OAuth2Client(googleClientOptions);
      auth.setCredentials(credentialsSchema.parse(JSON.parse(legacy)));
      const { data } = await gmail({ version: "v1", auth }).users.getProfile({ userId: "me" });
      const email = z.email().parse(data.emailAddress).toLowerCase();
      const serialized = JSON.stringify(auth.credentials);
      googleOAuthStorage.set(email, serialized);
      clients.set(email, createAccountClient(email, auth.credentials));
      storedCredentials.set(email, serialized);
      googleOAuthStorage.delete("tokens");
    }
  }
  if (!clients.size) throw new GoogleLoginRequiredError(account);
  if (!account) return [...clients].map(([email, auth]) => ({ account: email, auth }));
  const email = account.toLowerCase();
  const auth = clients.get(email);
  if (!auth) throw new GoogleLoginRequiredError(email);
  return [{ account: email, auth }];
}
