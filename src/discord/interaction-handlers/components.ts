import { InteractionHandler, InteractionHandlerTypes } from "@sapphire/framework";
import {
  LabelBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";

import { mastra } from "../../mastra";
import { getRun, resourceId } from "../../state";
import { ownerId } from "../config";
import { textMessage } from "../messages";
import { cancelRun } from "../run-control";
import { answerRun } from "../runtime";

export class ComponentsHandler extends InteractionHandler {
  constructor(context: InteractionHandler.LoaderContext, options: InteractionHandler.Options) {
    super(context, {
      ...options,
      interactionHandlerType: InteractionHandlerTypes.MessageComponent,
    });
  }
  override parse(interaction: ButtonInteraction | StringSelectMenuInteraction) {
    if (!interaction.customId.startsWith("flora:")) return this.none();
    const [, action, id] = interaction.customId.split(":");
    if (
      !id ||
      !["task_cancel", "stop", "cancel", "approve", "deny", "answer", "choice", "modal"].includes(
        action,
      )
    )
      return this.none();
    return this.some({ action, id });
  }
  override async run(
    interaction: ButtonInteraction | StringSelectMenuInteraction,
    { action, id }: InteractionHandler.ParseResult<this>,
  ) {
    if (interaction.user.id !== ownerId) {
      await interaction.reply(textMessage("This bot is private.", true));
      return;
    }
    if (action === "task_cancel") {
      const task = await mastra.backgroundTaskManager?.getTask(id);
      if (!task || task.resourceId !== resourceId) {
        await interaction.reply(textMessage("Task not found.", true));
        return;
      }
      await interaction.deferUpdate();
      await mastra.backgroundTaskManager!.cancel(id);
      const current = await mastra.backgroundTaskManager!.getTask(id);
      await interaction.editReply(textMessage(`Task ${id}: ${current?.status || task.status}.`));
      return;
    }
    const run = getRun(id);
    if (action === "stop") {
      if (
        !run ||
        !["running", "waiting"].includes(run.status) ||
        run.channelId !== interaction.channelId ||
        run.statusMessageId !== interaction.message.id
      ) {
        await interaction.reply(textMessage("This response has already finished.", true));
        return;
      }
      await interaction.deferUpdate();
      await cancelRun(id);
      await interaction.editReply(textMessage("Stopped."));
      return;
    }
    const question =
      run &&
      [...(run.pending ? [run.pending] : []), ...run.queuedQuestions].find(
        (item) => item.messageId === interaction.message.id,
      );
    if (!run || run.status !== "waiting" || !question || run.channelId !== interaction.channelId) {
      await interaction.reply(textMessage("This control is no longer active.", true));
      return;
    }
    if (action === "modal" && question.kind === "question") {
      await interaction.showModal(
        new ModalBuilder()
          .setCustomId(`flora:modal_submit:${id}:${interaction.message.id}`)
          .setTitle("Answer Flora")
          .addLabelComponents(
            new LabelBuilder()
              .setLabel("Your answer")
              .setTextInputComponent(
                new TextInputBuilder()
                  .setCustomId("answer")
                  .setStyle(TextInputStyle.Paragraph)
                  .setRequired(true)
                  .setMaxLength(4000),
              ),
          ),
      );
      return;
    }
    await interaction.deferUpdate();
    if (action === "cancel") {
      await cancelRun(id);
      return;
    }
    if (action === "approve" || action === "deny") {
      await answerRun(id, action === "approve", question.toolCallId);
      return;
    }
    if (action === "choice" && interaction.isButton() && question.kind === "question") {
      const index = Number(interaction.customId.split(":")[3]);
      const choice = Number.isInteger(index) ? question.options[index] : undefined;
      if (!choice) throw new Error("Invalid choice.");
      await answerRun(id, choice.label, question.toolCallId);
      return;
    }
    if (action !== "answer" || !interaction.isStringSelectMenu() || question.kind !== "question")
      return;
    const answers = interaction.values.map((value) => question.options[Number(value)]?.label);
    if (answers.some((value) => !value)) throw new Error("Invalid choice.");
    await answerRun(
      id,
      question.multiple ? answers.map(String) : String(answers[0]),
      question.toolCallId,
    );
  }
}
