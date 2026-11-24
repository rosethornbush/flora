import { Events, Listener, type ChatInputCommandErrorPayload } from "@sapphire/framework";

import { textMessage } from "../messages";

export class ChatInputCommandErrorListener extends Listener {
  constructor(context: Listener.LoaderContext, options: Listener.Options) {
    super(context, { ...options, event: Events.ChatInputCommandError });
  }

  override async run(error: Error, { interaction }: ChatInputCommandErrorPayload) {
    this.container.logger.error(error);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(textMessage("Could not finish that response. Please try again."));
    }
  }
}
