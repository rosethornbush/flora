import { createOAuthCallbackServer } from "@mastra/mcp";

import { beginGoogleLogin, completeGoogleLogin, googleRedirectUrl } from "./mastra/google-client";
import { publicOrigin } from "./oauth-config";

const { state, url } = await beginGoogleLogin();
console.log(`Authorize Google: ${url}`);
if (publicOrigin) {
  console.log("Flora's running callback server will finish login and confirm in Discord.");
} else {
  const callback = await createOAuthCallbackServer({ redirectUrl: googleRedirectUrl, state });
  try {
    if (callback.url.toString() !== googleRedirectUrl)
      throw new Error("Google login needs port 5534. Free that port, then retry.");
    const result = await callback.waitForCode({ timeoutMs: 15 * 60_000 });
    const redirect = new URL(googleRedirectUrl);
    redirect.searchParams.set("code", result.code);
    redirect.searchParams.set("state", result.state);
    const account = await completeGoogleLogin(redirect.toString());
    console.log(`Google account ${account} connected.`);
  } finally {
    await callback.close();
  }
}
