import { Command } from "@sapphire/framework";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  InteractionContextType,
  MessageFlags,
} from "discord.js";

import { mastra } from "../../mastra";
import { chatgptTools, refreshChatgptTools } from "../../mastra/tools/chatgpt";
import {
  codexAuthFile,
  finishCodexLogin,
  saveCodexCredentials,
  startCodexLogin,
  type CodexLoginSession,
} from "../../providers/codex";
import { ownerId } from "../config";
import { textMessage } from "../messages";

let connecting = false;

export class CodexCommand extends Command {
  override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription("Connect or reconnect Codex.")
        .setContexts(InteractionContextType.BotDM)
        .addSubcommand((command) =>
          command.setName("connect").setDescription("Authorize Codex with a device code."),
        ),
    );
  }

  override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    if (interaction.inGuild() || interaction.user.id !== ownerId) {
      await interaction.reply(
        textMessage("This bot is private. Use this command in our DM.", true),
      );
      return;
    }
    if (connecting) {
      await interaction.reply(
        textMessage("A Codex login is already waiting for authorization.", true),
      );
      return;
    }
    connecting = true;
    const signal = AbortSignal.timeout(900_000);
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const session = await startCodexLogin();
      const message = textMessage(
        `Enter code **${session.userCode}** on the Codex sign-in page within 15 minutes. I'll DM you when connected.`,
      );
      await interaction.editReply({
        ...message,
        components: [
          ...message.components,
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setLabel("Sign in to Codex")
              .setStyle(ButtonStyle.Link)
              .setURL(session.verificationURL),
          ),
        ],
      });
      void this.completeLogin(interaction, session, signal).catch((error) =>
        this.container.logger.error("Codex login notification failed.", error),
      );
    } catch (error) {
      connecting = false;
      throw error;
    }
  }

  private async completeLogin(
    interaction: Command.ChatInputCommandInteraction,
    session: CodexLoginSession,
    signal: AbortSignal,
  ) {
    let message;
    try {
      const credentials = await finishCodexLogin(session, signal);
      await saveCodexCredentials(codexAuthFile, credentials);
      message = "Codex connected.";
      try {
        const previous = chatgptTools;
        const tools = await refreshChatgptTools();
        for (const name of Object.keys(previous)) mastra.removeTool(name);
        for (const [name, tool] of Object.entries(tools)) mastra.addTool(tool, name);
      } catch (error) {
        this.container.logger.error(
          "Codex connected, but ChatGPT app tools could not reload.",
          error,
        );
        message = `Codex connected, but ChatGPT app tools could not reload: ${error instanceof Error ? error.message : "unknown error"}`;
      }
    } catch (error) {
      this.container.logger.error("Codex login failed.", error);
      message = signal.aborted
        ? "Codex login timed out. Start again with /codex connect."
        : `Codex login failed: ${error instanceof Error ? error.message : "unknown error"}`;
    } finally {
      connecting = false;
    }
    try {
      await interaction.user.send(textMessage(message));
    } catch (error) {
      this.container.logger.error("Could not DM the Codex login result.", error);
      await interaction.editReply(textMessage(message));
    }
  }
}
