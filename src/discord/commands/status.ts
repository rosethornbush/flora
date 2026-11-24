import { Command } from "@sapphire/framework";
import { InteractionContextType } from "discord.js";

import { mastra } from "../../mastra";
import { CodexAuthenticationError } from "../../providers/codex";
import { getCodexUsage } from "../../providers/usage";
import { jobs, resourceId, runs } from "../../state";
import { ownerId } from "../config";
import { textMessage } from "../messages";

export class StatusCommand extends Command {
  override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription("See Codex usage limits, current work, and scheduled jobs.")
        .setContexts(InteractionContextType.BotDM),
    );
  }
  override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    if (interaction.user.id !== ownerId) {
      await interaction.reply(textMessage("This bot is private.", true));
      return;
    }
    await interaction.deferReply();
    let usageText: string;
    try {
      const usage = await getCodexUsage();
      const limits = [
        { limit_name: "", rate_limit: usage.rate_limit },
        ...(usage.additional_rate_limits || []),
      ];
      const windows = limits.flatMap((limit) =>
        [limit.rate_limit?.primary_window, limit.rate_limit?.secondary_window]
          .filter((window) => window != null)
          .map((window) => {
            const duration =
              window.limit_window_seconds === 604800
                ? "Weekly"
                : `${window.limit_window_seconds / 3600}-hour`;
            const label = limit.limit_name ? `${limit.limit_name} · ${duration}` : duration;
            return `**${label}:** ${Math.max(0, 100 - window.used_percent)}% remaining · ${window.used_percent}% used\n-# Resets <t:${window.reset_at}:f> (<t:${window.reset_at}:R>)`;
          }),
      );
      usageText = [
        `**Codex usage · ${usage.plan_type}**`,
        windows.join("\n") || "No usage windows reported.",
        "-# Shared account allowance across Flora and Codex.",
      ].join("\n");
    } catch (error) {
      this.container.logger.error(error);
      usageText =
        error instanceof CodexAuthenticationError
          ? "Codex is disconnected. Use /codex connect to sign in here."
          : "Codex usage unavailable. Try /status again later.";
    }
    const { tasks = [] } =
      (await mastra.backgroundTaskManager?.listTasks({
        resourceId,
        status: ["pending", "running", "suspended"],
        perPage: 20,
      })) || {};
    const current = runs().filter((run) => ["running", "waiting"].includes(run.status));
    const recentJobs = jobs();
    const scheduled = recentJobs.filter((job) => job.status === "scheduled");
    const failed = recentJobs.filter((job) => job.status === "failed");
    const text = [
      usageText,
      "",
      "Flora status",
      ...current.map((run) => `${run.status}: ${run.prompt.slice(0, 120)} (${run.id})`),
      `${tasks.length} background tasks; ${scheduled.length} scheduled jobs; ${failed.length} failed jobs.`,
      "Use /tasks list or /jobs list for details. Send stop to cancel current work.",
    ].join("\n");
    await interaction.editReply(textMessage(text.slice(0, 3500)));
  }
}
