import { container } from "@sapphire/framework";
import { DiscordAPIError } from "discord.js";

import type { Run } from "../state";
import { pendingMessage, splitReply, textMessage } from "./messages";

export async function deliver(channelId: string, text: string, run?: Run) {
  const channel = await container.client.channels.fetch(channelId);
  if (!channel?.isSendable()) throw new Error("Discord channel is unavailable.");
  if (run) return (await channel.send(pendingMessage(run))).id;
  let id = "";
  for (const chunk of splitReply(text)) id = (await channel.send(textMessage(chunk))).id;
  return id;
}
export async function editMessage(channelId: string, messageId: string, text: string) {
  const channel = await container.client.channels.fetch(channelId);
  if (!channel?.isSendable()) throw new Error("Discord channel is unavailable.");
  await channel.messages.edit(messageId, textMessage(text));
}

export async function finishQuestion(
  channelId: string,
  question: NonNullable<Run["pending"]>,
  answered: boolean,
) {
  if (!question.messageId) return;
  const channel = await container.client.channels.fetch(channelId);
  if (!channel?.isSendable()) throw new Error("Discord channel is unavailable.");
  try {
    if (answered && question.kind === "approval") await channel.messages.delete(question.messageId);
    else
      await channel.messages.edit(
        question.messageId,
        textMessage(answered ? "-# Answered." : "Cancelled."),
      );
  } catch (error) {
    if (!(error instanceof DiscordAPIError) || error.code !== 10008) throw error;
  }
}
