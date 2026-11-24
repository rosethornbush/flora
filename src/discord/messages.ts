import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
} from "discord.js";

import type { Run } from "../state";

export function splitReply(text: string) {
  const chunks: string[] = [];
  while (text.length > 3500) {
    let end = text.lastIndexOf("\n", 3500);
    if (end < 1500) end = 3500;
    if (/[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    chunks.push(text.slice(0, end));
    text = text.slice(end);
  }
  if (text) chunks.push(text);
  return chunks;
}

export function textMessage(text: string, ephemeral = false) {
  return {
    components: [new TextDisplayBuilder().setContent(text || "No text response returned.")],
    flags: ephemeral
      ? MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
      : MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

export function progressMessage(text: string, runId: string) {
  const message = textMessage(text);
  return {
    ...message,
    components: [
      ...message.components,
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`flora:stop:${runId}`)
          .setLabel("Stop this response")
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

export function pendingMessage(run: Run) {
  const pending = run.pending;
  if (!pending) throw new Error("No pending question.");
  const card = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(pending.question.slice(0, 3500)),
  );
  if (pending.kind === "approval") {
    card.addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`flora:approve:${run.id}`)
          .setLabel("Approve")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`flora:deny:${run.id}`)
          .setLabel("Deny")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`flora:cancel:${run.id}`)
          .setLabel("Cancel run")
          .setStyle(ButtonStyle.Secondary),
      ),
    );
  } else if (
    pending.kind === "question" &&
    pending.options.length > 0 &&
    pending.options.length <= 4 &&
    !pending.multiple
  ) {
    card.addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        pending.options.map((option, index) =>
          new ButtonBuilder()
            .setCustomId(`flora:choice:${run.id}:${index}`)
            .setLabel(option.label.slice(0, 80))
            .setStyle(ButtonStyle.Secondary),
        ),
      ),
    );
  } else if (pending.options.length) {
    const choices = pending.options.slice(0, 25);
    card.addActionRowComponents(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`flora:answer:${run.id}`)
          .setPlaceholder("Choose or reply in this DM")
          .setMinValues(1)
          .setMaxValues(pending.multiple ? choices.length : 1)
          .addOptions(
            choices.map((option, index) => ({
              label: option.label.slice(0, 100),
              value: String(index),
              description: option.description?.slice(0, 100),
            })),
          ),
      ),
    );
  }
  if (pending.kind === "question")
    card.addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`flora:modal:${run.id}`)
          .setLabel("Write answer")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`flora:cancel:${run.id}`)
          .setLabel("Cancel this work")
          .setStyle(ButtonStyle.Secondary),
      ),
    );
  if (pending.kind === "google-oauth")
    card.addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`flora:cancel:${run.id}`)
          .setLabel("Cancel this work")
          .setStyle(ButtonStyle.Secondary),
      ),
    );
  return {
    components: [card],
    flags: MessageFlags.IsComponentsV2 as const,
    allowedMentions: { parse: [] },
  };
}
