import { once } from "node:events";

import { SapphireClient } from "@sapphire/framework";
import { Events, GatewayIntentBits, Partials } from "discord.js";

import { mastra } from "../mastra";
import { completeGoogleLogin } from "../mastra/google-client";
import { completeTodoistLogin, stopTodoistLogin } from "../mastra/todoist-client";
import { chatgpt } from "../mastra/tools/chatgpt";
import { outline } from "../mastra/tools/outline";
import { todoist, todoistTools, refreshTodoistTools } from "../mastra/tools/todoist";
import { startBackgroundDelivery } from "./background";
import { ownerId, token } from "./config";
import { textMessage } from "./messages";
import { startOAuthServer } from "./oauth-server";
import { recoverForeground, resumeGoogleRuns, stopProfileLearning } from "./runtime";
import { startScheduler } from "./scheduler";

await mastra.getStorage()!.init();

const client = new SapphireClient({
  baseUserDirectory: new URL(".", import.meta.url),
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel],
  allowedMentions: { parse: [], repliedUser: false },
});

recoverForeground();
await client.login(token);
if (!client.isReady()) await once(client, Events.ClientReady);
client.logger.info(`Flora ready as ${client.user!.tag}`);
const stopOAuthServer = await startOAuthServer({
  google: completeGoogleLogin,
  todoist: completeTodoistLogin,
  connected: async (provider, account) => {
    const owner = await client.users.fetch(ownerId!);
    const channel = await owner.createDM();
    if (provider === "Todoist") {
      try {
        const previous = Object.keys(todoistTools);
        const tools = await refreshTodoistTools();
        for (const name of previous) mastra.removeTool(name);
        for (const [name, tool] of Object.entries(tools)) mastra.addTool(tool, name);
      } catch {
        await channel.send(
          textMessage(
            "Todoist connected, but its tools couldn't reload. Try /todoist connect again.",
          ),
        );
        throw new Error("Todoist tool reload failed.");
      }
    }
    await channel.send(
      textMessage(`${provider}${account ? ` account ${account}` : ""} connected.`),
    );
    if (provider === "Google") await resumeGoogleRuns(channel.id);
  },
  reportError: (message) => client.logger.error(message),
});
const stopBackgroundDelivery = startBackgroundDelivery();
const scheduler = await startScheduler();
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, async () => {
    stopTodoistLogin();
    await stopOAuthServer?.();
    stopBackgroundDelivery();
    clearInterval(scheduler);
    await stopProfileLearning();
    await mastra.shutdown();
    await chatgpt.disconnect();
    await outline?.disconnect();
    await todoist?.disconnect();
    await client.destroy();
    process.exit(0);
  });
