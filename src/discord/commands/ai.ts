import { Command } from "@sapphire/framework";
import { ApplicationIntegrationType, InteractionContextType } from "discord.js";

import { mastra } from "../../mastra";
import { ownerId } from "../config";
import { splitReply, textMessage } from "../messages";
import { enqueue } from "../runtime";

export class AiCommand extends Command {
  override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription("Ask Flora a one-off question.")
        .setIntegrationTypes(
          ApplicationIntegrationType.GuildInstall,
          ApplicationIntegrationType.UserInstall,
        )
        .setContexts(
          InteractionContextType.Guild,
          InteractionContextType.BotDM,
          InteractionContextType.PrivateChannel,
        )
        .addStringOption((option) =>
          option.setName("prompt").setDescription("What do you want to ask?").setRequired(true),
        ),
    );
  }

  override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    if (interaction.user.id !== ownerId) {
      await interaction.reply(textMessage("This bot is private.", true));
      return;
    }

    await interaction.deferReply();
    const result = await enqueue(async (signal) => {
      const prompt = interaction.options.getString("prompt", true);
      try {
        const response = await mastra.getAgent("publicAgent").generate(prompt, {
          abortSignal: AbortSignal.any([signal, AbortSignal.timeout(600_000)]),
        });
        if (response.tripwire) return "Could not complete the privacy check. Try again.";
        const text = response.text || "No text response returned.";
        const [first, ...rest] = splitReply(text);
        return rest.length ? `${first}...` : first;
      } catch (error) {
        if (signal.aborted) return "Stopped.";
        throw error;
      }
    });
    await interaction.editReply(textMessage(result || "Stopped."));
  }
}
