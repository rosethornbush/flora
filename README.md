# flora

Rose's personal Discord assistant. Sapphire handles Discord; Mastra runs agents, memory and background research. Codex OAuth uses your subscription with `gpt-6-luna`, including image input.

Only `DISCORD_OWNER_ID` can use Flora. Messages use Discord Components V2. No shell, browser or skill marketplace.

## Use

- DM Flora for one ongoing, open-ended conversation: chat, brainstorm, vent or switch topics. History survives restarts; only `/new` starts a fresh conversation. Attach up to four PNG, JPEG, WebP or GIF images, up to 10 MB each.
- Forward a Discord message and add your instructions. Flora uses forwarded text, embeds and attachment links as context; supported images and audio use the same attachment handling.
- Reply to any message in Flora's DM to include its text, embeds, components and attachment links as context. Referenced images and audio share the four-attachment limit. Replies to pending questions answer that question; replies to other messages continue the conversation.
- Send voice messages or audio attachments; Flora transcribes them through your Codex subscription, then responds in text. Spoken answers work for pending questions too. Each message allows up to four attachments, up to 10 MB each; audio is limited to 10 minutes and 30 MB decoded per file. Longer audio is rejected, not truncated.
- `/ai prompt:...` returns one public answer with temporary context; it keeps no conversation memory or follow-up thread. It works as a server-installed or user-installed command, including in other DMs. It can use web search and weather, without access to your profile or connected personal accounts. PII redaction checks the request and reply; failed privacy checks stop the response.
- The thinking message updates as work progresses and includes **Stop this response**. Tool names appear while running; raw arguments and tool traces stay out of the final reply. Questions use buttons for short single-choice lists, selects for longer or multiple choices, and a **Write answer** modal for free text. You can still answer by text or voice.
- `/new` starts a fresh DM conversation; previous chats remain available for recall.
- Send exactly `stop` to cancel current work, its background tasks and queued follow-ups. Independent background tasks and schedules continue.
- `/steer message:...` interrupts current work and continues with your correction, preserving completed-action records.
- `/status` shows live Codex allowance remaining and reset times alongside active work. Usage covers the whole linked account, including Codex outside Flora. `/tasks list`, `/tasks show id:...` and `/tasks cancel id:...` manage background research.
- `/jobs list`, `/jobs show id:...` and `/jobs cancel id:...` manage reminders and recurring jobs. Cancelling a schedule, through chat or a command, also stops its active occurrence.
- `/help` shows conversation controls, account connections and work commands without needing the model.
- `/google connect` links Google or reconnects an account with `account:email`. With hosted callbacks, authorize in your browser and return to Discord; paused work resumes automatically. Without hosted callbacks, copy the full failed localhost address into `/google complete redirect:...`.
- `/codex connect` shows a sign-in button and device code. It works when Codex is disconnected and refreshes the model credentials and ChatGPT app tools without a restart.
- `/todoist connect` links Todoist through the hosted callback and reloads its tools. Pending Codex and Todoist logins expire after 15 minutes and need a new command after a bot restart.

Ask naturally for weather, web searches, URL reading, background research, reminders, recurring tasks or past conversations. Codex handles web searches, opening pages and finding text server-side through your subscription. Citation annotations become clickable links in Discord. Weather uses wttr.in with wttr.is as a fallback, without an API key. Answer questions with choices, the Write answer modal, or a DM reply. Parallel tool calls keep their questions and approvals separate. Schedule changes pass through a separate tool-free judge. When the judge declines or fails, Flora asks for approval before executing.

Flora searches for Outline, Todoist, Google, directions and enabled ChatGPT app tools when needed, loading up to three matches per search. Mention an app such as `@Target` in your DM to use it. Apps use the ChatGPT account connected through `/codex connect` or `pnpm run codex:login`. Search Service, Shop, Target and GitHub are enabled by default. To add another connected app, add its integration slug to `CHATGPT_APPS` in `.env` (a comma-separated list, e.g. `search_service,shop,target,github,klarna_shopping_search`), then restart Flora. Install or connect apps at chatgpt.com first. App calls not explicitly marked read-only require your approval. Connected apps are unavailable to public `/ai`.

App widgets are not rendered in Discord. Target search results expose selected catalog fields to Flora: product IDs, names, descriptions, brands, links, prices and shipping availability. Other widget metadata stays hidden. Other apps may still return widget-only results; an empty tool response does not mean there were no matches.

Discovered tools stay available while their discovery results remain in conversation history, including after a restart. Questions, search, weather, reminders and profile tools remain directly available.

## Setup

Add your Discord bot credentials to `.env`:

```dotenv
DISCORD_TOKEN=your_bot_token
DISCORD_OWNER_ID=your_user_id
CODEX_MODEL=gpt-6-luna
FLORA_TIMEZONE=America/Los_Angeles
```

Invite the bot with `bot` and `applications.commands` scopes. No privileged Message Content intent is needed for DMs. Sapphire registers commands through each command's `registerApplicationCommands` method on startup.

Connect Flora to your Codex subscription with device auth:

```sh
pnpm run codex:login
```

Open the printed URL and enter the device code. Flora saves credentials to `~/.config/flora/oauth.json` (or `CODEX_AUTH_FILE`) with permissions `0600`. Login and token refresh work on Linux and macOS; no Keychain is used.

Start with `pnpm run bot:start`; use `pnpm run bot:dev` for watch mode. Mastra Studio runs separately with `pnpm run dev`.

Voice transcription requires `ffmpeg` and `ffprobe` on PATH (`brew install ffmpeg` installs both on macOS). The Docker image includes both. No separate audio API key is needed. Audio files are temporary and removed after transcription; transcripts become part of conversation history.

Hosted Codex search needs no separate web search API key.

Set `HERE_API_KEY` for driving, public transit, walking and biking directions. No HERE app ID is needed. Flora uses existing profile preferences when you omit a travel mode and asks for an origin when needed. Transit supports departure or arrival times; driving estimates exclude live traffic. Each call makes at most two place lookups and one routing request, without retries. HERE usage is not tracked locally or capped against your monthly free allowance.

Outline connects through MCP when `OUTLINE_API_KEY` is set. Its default endpoint is `https://docs.apt346.casa/mcp`; override with `OUTLINE_MCP_URL`. Flora discovers the available document tools at startup. Read-only tools run directly. The approval judge allows clearly requested edits; uncertain or unrequested changes ask for Discord approval.

For Cloudflare Access, set `OUTLINE_CF_ACCESS_CLIENT_ID` and `OUTLINE_CF_ACCESS_CLIENT_SECRET` to a service token allowed by the application's Service Auth policy. Authelia is Access's identity provider; the service token handles Access without interactive login. Outline authenticates the bearer API key. Without `OUTLINE_API_KEY`, Outline tools are disabled.

With hosted callbacks, use `/todoist connect` in Flora's DM. The browser returns to Flora automatically, and tools reload without restarting. Todoist registers its OAuth client on first connection; no API key is needed. Credentials persist in SQLite.

For local-only use, `pnpm run todoist:login` retains the loopback browser flow. Run it on Flora's host, then restart Flora to reload tools. Before login, Todoist tools are disabled. Read-only tools run directly; writes use the same approval judge as Outline.

For personal Gmail and Google Calendar, enable the Gmail API and Google Calendar API in a Google Cloud project. In Google Auth Platform, configure the audience as External and add every Google account you want to link as a test user. Create a Web application OAuth client with this authorized redirect URI:

```text
http://127.0.0.1:5534/oauth/callback
```

Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`. Use `/google connect` in Flora's DM and authorize in your browser. With `FLORA_PUBLIC_URL` configured, Google returns to Flora and paused work resumes automatically. Without it, submit the full localhost redirect address with `/google complete redirect:...`. Missing or expired Google authorization pauses the tool and shows a login link. Ordinary conversation can continue while login is pending. Links expire after 15 minutes; use `/google connect` for a new one.

The terminal alternative remains `pnpm run google:login`. Without hosted callbacks, open its link on the bot's machine; with hosted callbacks, the running bot finishes login. Calendar scopes allow event reading/writing and calendar listing; Gmail uses only `gmail.readonly`. Calendar changes use the approval judge. Email tools search messages and read messages/threads without sending, modifying or marking mail read.

Connect once per account, choosing a different account at Google sign-in. Credentials are stored by email; logging into one account preserves the others. Discord login updates the running bot without a restart. A reconnect link for a specific account must authorize that same account. Gmail searches and calendar lists search all linked accounts by default and label results with the account email. Flora can list linked accounts or target one email. Message/event reads and calendar writes require a target account when several are linked. Page tokens belong to their originating account. Existing single-account credentials migrate on first Google tool use.

Google refresh tokens persist in SQLite; the SDK refreshes access tokens automatically. Keep both the database and Google client credentials when deploying in Docker. Google OAuth apps in Testing expire these refresh tokens after seven days; [Google's OAuth documentation](https://developers.google.com/identity/protocols/oauth2) explains publishing status and token expiration. [Google's setup guide](https://developers.google.com/workspace/gmail/api/quickstart/nodejs) covers enabling the API and configuring consent.

## VPS with Docker

The multi-stage `Dockerfile` runs Node 24 Alpine as a non-root user. Only production dependencies enter the final image; pnpm and development tools stay in the build stage. `ffmpeg` supports voice messages, and timezone data supports configured local times.

1. Copy `.env.example` to `.env` and set the Discord credentials and Google client credentials.
2. Create a [remotely managed Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/). Put its token in `CLOUDFLARE_TUNNEL_TOKEN`.
3. Choose a stable hostname and set `FLORA_PUBLIC_URL=https://flora.example.com`. In the tunnel dashboard, route that hostname to `http://flora:8080`. Flora serves only OAuth callback routes and `/healthz`, not Studio or an agent API. No VPS ports are published.
4. Add `https://flora.example.com/oauth/google/callback` as an authorized redirect URI on the Google Web application client. Keep the localhost URI too if you still use local login.
5. Run `docker compose up -d --build`. In Discord, use `/codex connect`, `/google connect`, and `/todoist connect`. The login commands do not call the model.

Compose keeps SQLite, images and Codex credentials in the `flora-data` volume at `/data`. Back it up; `docker compose down -v` deletes it. A new volume starts with no previous conversation or accounts. To keep an existing installation, stop it and migrate its database, attachments and Codex credentials before switching hosts.

Google login sessions persist across restarts. Codex and Todoist login sessions do not; request a new link/code after restarting. Callback responses are not cached and do not load third-party resources. Avoid debug request logging at the tunnel or proxy because OAuth callback URLs contain short-lived authorization codes.

## Local data

Conversations, user profile, pending decisions, schedules and background task state persist in SQLite. Resource memory follows your Discord user ID across chats. Mastra observational memory compacts long conversations; recall retrieves original messages. Ask Flora to show, correct or forget profile facts. Inferred patterns are marked tentative. Forgetting profile facts retains conversation history. Profile learning runs separately from the conversation; your next message does not wait for it.

Default database: `file:./mastra.db`. Set `FLORA_DATABASE_URL=file:/absolute/path/mastra.db` so Studio and the bot share the same file. Images persist in `.flora/attachments`; override with `FLORA_ATTACHMENTS_DIR`.

Questions and approvals survive restarts. Deleted question cards do not prevent answering in chat or stopping work. Interrupted foreground work is marked interrupted instead of replaying writes. Background research uses Mastra's durable task manager. Unstarted overdue reminders send once after startup; unstarted recurring jobs catch up once and then schedule their next future occurrence. An interrupted occurrence with uncertain actions or delivery is marked failed for review, never replayed automatically.

Keep the database, attachments and OAuth credentials when moving hosts or deploying in Docker. Credentials default to `~/.config/flora/oauth.json`; override with `CODEX_AUTH_FILE`. Codex uses the official OpenAI Responses SDK. Token refresh is locked across processes. If authentication expires, reconnect with `/codex connect`; the terminal alternative is `pnpm run codex:login`.

## Checks

`pnpm run lint`, `pnpm run fmt:check`, `pnpm exec tsc --noEmit`, `pnpm run build`.
