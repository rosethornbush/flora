import { Command } from "@sapphire/framework";
import { InteractionContextType, MessageFlags } from "discord.js";

import { beginTodoistLogin } from "../../mastra/todoist-client";
import { ownerId } from "../config";
import { textMessage } from "../messages";

export class TodoistCommand extends Command {
  override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription("Connect or reconnect Todoist.")
        .setContexts(InteractionContextType.BotDM)
        .addSubcommand((command) =>
          command.setName("connect").setDescription("Get a Todoist authorization link."),
        ),
    );
  }

  override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    if (interaction.user.id !== ownerId || interaction.guildId) {
      await interaction.reply(
        textMessage("This command is only available to Flora's owner in DMs.", true),
      );
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const { url } = await beginTodoistLogin();
      await interaction.editReply(
        textMessage(
          `[Authorize Todoist](<${url}>). This link expires in 15 minutes. I'll DM you when connected.`,
        ),
      );
    } catch (error) {
      await interaction.editReply(
        textMessage(error instanceof Error ? error.message : "Todoist login could not start."),
      );
    }
  }
}
