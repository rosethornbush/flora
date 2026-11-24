import { Memory } from "@mastra/memory";

import { model } from "./model";
import { storage } from "./storage";

export const memory = new Memory({
  storage,
  options: {
    lastMessages: 20,
    generateTitle: true,
    observationalMemory: { model, scope: "thread", retrieval: { scope: "resource" } },
  },
});
