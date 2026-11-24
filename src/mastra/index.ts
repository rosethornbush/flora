import { Mastra } from "@mastra/core/mastra";
import { askUserTool } from "@mastra/core/tools";

import { agent } from "./agents/agent";
import { judge } from "./agents/judge";
import { modeller } from "./agents/modeller";
import { publicAgent } from "./agents/public";
import { researcher } from "./agents/researcher";
import { storage } from "./storage";
import { chatgptTools } from "./tools/chatgpt";
import { directions } from "./tools/directions";
import { googleTools } from "./tools/google";
import { outlineTools } from "./tools/outline";
import { manageJobs, profile } from "./tools/personal";
import { todoistTools } from "./tools/todoist";
import { weather } from "./tools/weather";
import { webSearch } from "./tools/web";

export const mastra = new Mastra({
  agents: { agent, judge, researcher, modeller, publicAgent },
  tools: {
    directions,
    ask_user: askUserTool,
    web_search: webSearch,
    weather,
    manage_jobs: manageJobs,
    profile,
    ...chatgptTools,
    ...outlineTools,
    ...todoistTools,
    ...googleTools,
  },
  backgroundTasks: {
    enabled: true,
    globalConcurrency: 2,
    perAgentConcurrency: 2,
    backpressure: "queue",
  },
  storage,
});
