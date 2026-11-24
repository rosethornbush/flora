import { Command } from "@sapphire/framework";
import { InteractionContextType } from "discord.js";

import { ownerId } from "../config";
import { textMessage } from "../messages";
import { enqueue, startDmConversation, stopCurrent } from "../runtime";

export class NewCommand extends Command {
  override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription("Start a new DM conversation with Flora.")
        .setContexts(InteractionContextType.BotDM),
    );
  }

  override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    if (interaction.user.id !== ownerId) {
      await interaction.reply(textMessage("This bot is private.", true));
      return;
    }
    await interaction.deferReply();
    await stopCurrent();
    await enqueue(async () => {
      await startDmConversation();
      await interaction.editReply(
        textMessage("New conversation started. I can still recall previous chats."),
      );
    });
  }
}
