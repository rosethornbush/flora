import { randomUUID } from "node:crypto";

import { createTool } from "@mastra/core/tools";
import { CronExpressionParser } from "cron-parser";
import { z } from "zod";

import { cancelJob } from "../../discord/run-control";
import { facts, getJob, jobs, resourceId, save, timezone } from "../../state";
import { needsApproval } from "../agents/judge";

export const trustedContext = z.object({
  resourceId: z.literal(resourceId),
  request: z.string(),
  origin: z.string(),
  channelId: z.string().regex(/^\d{17,20}$/),
  runId: z.uuid(),
});
const jobInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list") }),
  z.object({
    action: z.literal("remind"),
    when: z.iso.datetime({ offset: true }),
    instruction: z.string().min(1).max(2000),
  }),
  z.object({
    action: z.literal("schedule"),
    cron: z.string().min(1).max(100),
    instruction: z.string().min(1).max(2000),
  }),
  z.object({ action: z.literal("cancel"), id: z.string().min(1).max(100) }),
]);
export const manageJobs = createTool({
  id: "manage_jobs",
  description: `Create/list/cancel reminders or recurring jobs. remind: absolute ISO time + offset; schedule: five-field cron, ${timezone}. Clarify ambiguous times; confirm time + ID. Reminders send stored text; recurring jobs run instructions.`,
  inputSchema: jobInput,
  requestContextSchema: trustedContext,
  requireApproval: async (input, context) => {
    if (input.action === "list") return false;
    const trusted = trustedContext.parse(context?.requestContext);
    return needsApproval("manage_jobs", JSON.stringify(input), trusted.request, trusted.runId);
  },
  execute: async (input, context) => {
    const trusted = trustedContext.parse(context.requestContext.all);
    context.abortSignal?.throwIfAborted();
    if (input.action === "list") return jobs();
    if (input.action === "cancel") return cancelJob(input.id);
    if (input.action === "schedule" && input.cron.trim().split(/\s+/).length !== 5)
      throw new Error("Use five-field cron.");
    const nextAt =
      input.action === "remind"
        ? Date.parse(input.when)
        : CronExpressionParser.parse(input.cron, { tz: timezone }).next().getTime();
    if (nextAt <= Date.now()) throw new Error("Reminder time must be in the future.");
    const id = context.agent?.toolCallId || randomUUID();
    const prior = getJob(id);
    if (prior) return prior;
    const job = save({
      kind: "job",
      id,
      channelId: trusted.channelId,
      instruction: input.instruction,
      nextAt,
      cron: input.action === "schedule" ? input.cron : undefined,
      createdAt: Date.now(),
      status: "scheduled",
    });
    return job;
  },
});
const profileInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("show") }),
  z.object({ action: z.literal("remember"), text: z.string().min(1).max(1000) }),
  z.object({
    action: z.literal("correct"),
    id: z.string().min(1),
    text: z.string().min(1).max(1000),
  }),
  z.object({ action: z.literal("forget"), id: z.string().min(1) }),
]);
export const profile = createTool({
  id: "profile",
  description:
    "Show/remember/correct/forget owner profile facts. Show IDs + sources. Corrections outrank inference. Forget suppresses fact; chat history remains.",
  inputSchema: profileInput,
  requestContextSchema: trustedContext,
  execute: async (input, context) => {
    const trusted = trustedContext.parse(context.requestContext.all);
    context.abortSignal?.throwIfAborted();
    if (input.action === "show") return facts().filter((fact) => !fact.forgotten);
    const existing =
      input.action === "remember"
        ? facts().find((fact) => fact.text.toLowerCase() === input.text.toLowerCase())
        : facts().find((fact) => fact.id === input.id);
    if (input.action !== "remember" && !existing) throw new Error("Fact not found.");
    const fact = save({
      kind: "fact",
      id: existing?.id || randomUUID(),
      text: input.action === "forget" ? existing!.text : input.text,
      certainty: "stated",
      source: trusted.origin,
      updatedAt: Date.now(),
      forgotten: input.action === "forget",
    });
    return {
      fact,
      message:
        input.action === "forget"
          ? "Forgotten from profile; chat history is retained."
          : "Profile saved. You can correct or forget it.",
    };
  },
});
