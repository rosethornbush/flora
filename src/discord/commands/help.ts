import { Command } from "@sapphire/framework";
import { InteractionContextType } from "discord.js";

import { ownerId } from "../config";
import { textMessage } from "../messages";

export class HelpCommand extends Command {
  override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription("Find conversation controls and account connections.")
        .setContexts(InteractionContextType.BotDM),
    );
  }

  override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    if (interaction.user.id !== ownerId) {
      await interaction.reply(textMessage("This bot is private.", true));
      return;
    }
    await interaction.reply(
      textMessage(
        [
          "Talk normally, send a voice message, or reply to a message to give me context. Our conversation continues across topics and restarts.",
          "**Conversation**\nSend `stop` or use **Stop this response** to interrupt. `/steer` changes direction. `/new` starts a fresh conversation.",
          "**Accounts**\n`/google connect` · Gmail and Calendar\n`/todoist connect` · Todoist\n`/codex connect` · Flora's model and ChatGPT apps\nLogin commands work even when Codex is disconnected.",
          "**Work**\n`/status` · usage and active work\n`/tasks list` · background research\n`/jobs list` · reminders and recurring jobs\nYou can ask for these naturally too.",
          "`/ai` gives a separate public answer without personal accounts or conversation memory.",
        ].join("\n\n"),
        true,
      ),
    );
  }
}
