import { Command } from "@sapphire/framework";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  InteractionContextType,
  MessageFlags,
  TextDisplayBuilder,
} from "discord.js";

import { mastra } from "../../mastra";
import { resourceId } from "../../state";
import { ownerId } from "../config";
import { textMessage } from "../messages";

export class TasksCommand extends Command {
  override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription("Manage background work.")
        .setContexts(InteractionContextType.BotDM)
        .addSubcommand((command) =>
          command.setName("list").setDescription("List recent background tasks"),
        )
        .addSubcommand((command) =>
          command
            .setName("show")
            .setDescription("Show a task")
            .addStringOption((option) =>
              option.setName("id").setDescription("Task ID").setRequired(true),
            ),
        )
        .addSubcommand((command) =>
          command
            .setName("cancel")
            .setDescription("Cancel a task")
            .addStringOption((option) =>
              option.setName("id").setDescription("Task ID").setRequired(true),
            ),
        ),
    );
  }
  override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    if (interaction.user.id !== ownerId) {
      await interaction.reply(textMessage("This bot is private.", true));
      return;
    }
    await interaction.deferReply();
    const manager = mastra.backgroundTaskManager;
    if (!manager) throw new Error("Background manager unavailable.");
    const action = interaction.options.getSubcommand();
    if (action === "list") {
      const { tasks } = await manager.listTasks({
        resourceId,
        perPage: 20,
        orderDirection: "desc",
      });
      await interaction.editReply(
        textMessage(
          tasks
            .map((task) => `${task.id}: ${task.status}\n${JSON.stringify(task.args).slice(0, 100)}`)
            .join("\n\n")
            .slice(0, 3500) || "No background tasks.",
        ),
      );
      return;
    }
    const id = interaction.options.getString("id", true);
    const task = await manager.getTask(id);
    if (!task || task.resourceId !== resourceId) {
      await interaction.editReply(textMessage("Task not found."));
      return;
    }
    if (action === "cancel") {
      await manager.cancel(id);
      const current = await manager.getTask(id);
      await interaction.editReply(textMessage(`Task ${id}: ${current?.status || task.status}.`));
      return;
    }
    const card = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `Task ${id}\n${task.status}\n${JSON.stringify(task.args).slice(0, 2200)}\n${task.error?.message || ""}`,
      ),
    );
    if (["pending", "running", "suspended"].includes(task.status))
      card.addActionRowComponents(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`flora:task_cancel:${id}`)
            .setLabel("Cancel task")
            .setStyle(ButtonStyle.Danger),
        ),
      );
    await interaction.editReply({ components: [card], flags: MessageFlags.IsComponentsV2 });
  }
}
