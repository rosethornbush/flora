import { InteractionHandler, InteractionHandlerTypes } from "@sapphire/framework";
import type { ModalSubmitInteraction } from "discord.js";

import { getRun } from "../../state";
import { ownerId } from "../config";
import { textMessage } from "../messages";
import { answerRun } from "../runtime";

export class ModalsHandler extends InteractionHandler {
  constructor(context: InteractionHandler.LoaderContext, options: InteractionHandler.Options) {
    super(context, { ...options, interactionHandlerType: InteractionHandlerTypes.ModalSubmit });
  }
  override parse(interaction: ModalSubmitInteraction) {
    if (!interaction.customId.startsWith("flora:modal_submit:")) return this.none();
    const [, , id, messageId] = interaction.customId.split(":");
    return this.some({ id, messageId });
  }
  override async run(
    interaction: ModalSubmitInteraction,
    { id, messageId }: InteractionHandler.ParseResult<this>,
  ) {
    if (interaction.user.id !== ownerId) {
      await interaction.reply(textMessage("This bot is private.", true));
      return;
    }
    const run = getRun(id);
    const question =
      run &&
      [...(run.pending ? [run.pending] : []), ...run.queuedQuestions].find(
        (item) => item.messageId === messageId && item.kind === "question",
      );
    if (!run || run.status !== "waiting" || run.channelId !== interaction.channelId || !question) {
      await interaction.reply(textMessage("This question is no longer active.", true));
      return;
    }
    await interaction.reply(textMessage("Answer received.", true));
    await answerRun(id, interaction.fields.getTextInputValue("answer"), question.toolCallId);
  }
}
