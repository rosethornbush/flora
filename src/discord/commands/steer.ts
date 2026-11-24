import { Command } from "@sapphire/framework";
import { InteractionContextType } from "discord.js";

import { ownerId } from "../config";
import { textMessage } from "../messages";
import { steer } from "../runtime";

export class SteerCommand extends Command {
  override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription("Redirect current work.")
        .setContexts(InteractionContextType.BotDM)
        .addStringOption((option) =>
          option.setName("message").setDescription("Correction or new direction").setRequired(true),
        ),
    );
  }
  override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    if (interaction.user.id !== ownerId) {
      await interaction.reply(textMessage("This bot is private.", true));
      return;
    }
    if (!interaction.channelId) throw new Error("DM channel required.");
    await interaction.reply(textMessage("Updating direction."));
    await steer(interaction.options.getString("message", true), interaction.channelId);
  }
}
