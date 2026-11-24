import { Command } from "@sapphire/framework";
import { InteractionContextType } from "discord.js";

import { getJob, jobs, timezone } from "../../state";
import { ownerId } from "../config";
import { textMessage } from "../messages";
import { cancelJob } from "../run-control";

export class JobsCommand extends Command {
  override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription("Manage reminders and recurring schedules.")
        .setContexts(InteractionContextType.BotDM)
        .addSubcommand((command) =>
          command.setName("list").setDescription("List recent reminders/jobs"),
        )
        .addSubcommand((command) =>
          command
            .setName("show")
            .setDescription("Show a job")
            .addStringOption((option) =>
              option.setName("id").setDescription("Job ID").setRequired(true),
            ),
        )
        .addSubcommand((command) =>
          command
            .setName("cancel")
            .setDescription("Cancel future occurrences")
            .addStringOption((option) =>
              option.setName("id").setDescription("Job ID").setRequired(true),
            ),
        ),
    );
  }
  override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    if (interaction.user.id !== ownerId) {
      await interaction.reply(textMessage("This bot is private.", true));
      return;
    }
    const action = interaction.options.getSubcommand();
    if (action === "list") {
      await interaction.reply(
        textMessage(
          jobs()
            .slice(0, 20)
            .map(
              (job) =>
                `${job.id}: ${job.status}\n${job.instruction.slice(0, 100)}\n${new Date(job.nextAt).toLocaleString("en-US", { timeZone: timezone })} ${timezone}`,
            )
            .join("\n\n")
            .slice(0, 3500) || "No reminders/jobs.",
        ),
      );
      return;
    }
    const job = getJob(interaction.options.getString("id", true));
    if (!job) {
      await interaction.reply(textMessage("Job not found."));
      return;
    }
    if (action === "cancel") {
      await interaction.deferReply();
      await cancelJob(job.id);
      await interaction.editReply(textMessage("Schedule cancelled."));
      return;
    }
    await interaction.reply(
      textMessage(
        `${job.id}: ${job.status}\n${job.instruction.slice(0, 2500)}\nNext: ${new Date(job.nextAt).toLocaleString("en-US", { timeZone: timezone })} ${timezone}\n${job.cron ? `Cron: ${job.cron}` : "One-shot reminder"}\n${job.runId ? `Run: ${job.runId}` : ""}\n${job.error || ""}`,
      ),
    );
  }
}
