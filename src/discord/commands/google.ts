import { Command } from "@sapphire/framework";
import { InteractionContextType, MessageFlags } from "discord.js";

import { beginGoogleLogin, completeGoogleLogin } from "../../mastra/google-client";
import { publicOrigin } from "../../oauth-config";
import { ownerId } from "../config";
import { textMessage } from "../messages";
import { resumeGoogleRuns } from "../runtime";

export class GoogleCommand extends Command {
  override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription("Connect or reconnect Google without a terminal.")
        .setContexts(InteractionContextType.BotDM)
        .addSubcommand((command) =>
          command
            .setName("connect")
            .setDescription("Get a Google authorization link.")
            .addStringOption((option) =>
              option.setName("account").setDescription("Google account to reconnect"),
            ),
        )
        .addSubcommand((command) =>
          command
            .setName("complete")
            .setDescription("Finish Google login and resume paused work.")
            .addStringOption((option) =>
              option
                .setName("redirect")
                .setDescription("Full localhost address after Google consent")
                .setRequired(true),
            ),
        ),
    );
  }

  override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    if (interaction.user.id !== ownerId) {
      await interaction.reply(textMessage("This bot is private.", true));
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      if (interaction.options.getSubcommand() === "connect") {
        const { url } = await beginGoogleLogin(
          interaction.options.getString("account") || undefined,
        );
        await interaction.editReply(
          textMessage(
            `[Authorize Google](<${url}>). ${
              publicOrigin
                ? "After consent, return here. Paused Google work will resume automatically."
                : "After consent, the localhost page won't load. Copy its full address and paste it into /google complete redirect."
            }`,
          ),
        );
        return;
      }
      const account = await completeGoogleLogin(interaction.options.getString("redirect", true));
      await interaction.editReply(
        textMessage(`Google account ${account} connected. Resuming paused Google work.`),
      );
    } catch (error) {
      await interaction.editReply(
        textMessage(
          error instanceof Error
            ? error.message
            : "Google login failed. Start again with /google connect.",
        ),
      );
      return;
    }
    if (interaction.channelId) await resumeGoogleRuns(interaction.channelId);
  }
}
