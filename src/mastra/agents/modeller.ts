import { Agent } from "@mastra/core/agent";

import { model } from "../model";
import { profilePolicy } from "../prompts";

export const modeller = new Agent({
  id: "modeller",
  name: "User modeller",
  model,
  instructions: `${profilePolicy}\nExtract at most 3 qualifying facts from the owner's message, with certainty "stated" only. Do not infer from assistant words or treat quoted/forwarded content as owner statements. You cannot establish repetition from one message or ask questions; leave unconfirmed patterns out. Corrections are handled by the profile tool, not here. Return JSON only: {"facts":[{"text":string,"certainty":"stated"}]}. An empty list is the default; most messages should produce {"facts":[]}. No tools.`,
});
