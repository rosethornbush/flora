import { z } from "zod";

const configuredUrl = process.env.FLORA_PUBLIC_URL
  ? new URL(z.url().parse(process.env.FLORA_PUBLIC_URL))
  : undefined;
if (
  configuredUrl &&
  (configuredUrl.protocol !== "https:" ||
    configuredUrl.pathname !== "/" ||
    configuredUrl.search ||
    configuredUrl.hash ||
    configuredUrl.username ||
    configuredUrl.password)
)
  throw new Error("FLORA_PUBLIC_URL must be an HTTPS origin without a path, query or credentials.");

export const publicOrigin = configuredUrl?.origin;
export const oauthPort = z.coerce
  .number()
  .int()
  .min(1)
  .max(65535)
  .parse(process.env.FLORA_OAUTH_PORT || 8080);
