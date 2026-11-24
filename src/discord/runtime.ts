import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import type { MessageListInput } from "@mastra/core/agent/message-list";
import { RequestContext } from "@mastra/core/request-context";
import type { ChunkType } from "@mastra/core/stream";
import type { ToolAfterHookContext } from "@mastra/core/tools";
import { container } from "@sapphire/framework";
import { z } from "zod";

import { mastra } from "../mastra";
import { memory } from "../mastra/memory";
import { chatgptTools } from "../mastra/tools/chatgpt";
import { outlineTools } from "../mastra/tools/outline";
import { todoistTools } from "../mastra/tools/todoist";
import { facts, getRun, resourceId, runs, save, userContext, type Run } from "../state";
import { deliver, editMessage, finishQuestion } from "./delivery";
import { progressMessage, splitReply, textMessage } from "./messages";
import { active, cancelRun } from "./run-control";

const agent = mastra.getAgent("agent");
let pending: Promise<unknown> = Promise.resolve();
let queueVersion = 0;
let currentId: string | undefined;
let queuedController: AbortController | undefined;
let profilePending = Promise.resolve();
let profileController = new AbortController();

export function stopProfileLearning() {
  profileController.abort();
  profileController = new AbortController();
  return profilePending;
}

export function enqueue<T>(task: (signal: AbortSignal) => Promise<T>) {
  const version = queueVersion;
  const result = pending.then(async () => {
    if (version !== queueVersion) return;
    const controller = new AbortController();
    queuedController = controller;
    try {
      return await task(controller.signal);
    } finally {
      if (queuedController === controller) queuedController = undefined;
    }
  });
  pending = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
export function startDmConversation() {
  return memory.createThread({
    threadId: randomUUID(),
    resourceId,
    metadata: { source: "discord-dm" },
  });
}
export async function getDmConversation() {
  const { threads } = await memory.listThreads({
    filter: { resourceId, metadata: { source: "discord-dm" } },
    orderBy: { field: "createdAt", direction: "DESC" },
    perPage: 1,
  });
  return threads[0] || startDmConversation();
}
export async function stopCurrent() {
  queueVersion++;
  queuedController?.abort();
  void stopProfileLearning();
  if (currentId) await cancelRun(currentId);
  for (const run of runs().filter(
    (item) => item.status === "waiting" && item.origin !== "scheduler",
  ))
    await cancelRun(run.id);
}
export async function steer(message: string, channelId: string) {
  const previous =
    (currentId ? getRun(currentId) : undefined) ||
    runs().find((item) => item.status === "waiting" && item.channelId === channelId);
  if (!previous)
    return enqueue(async () => {
      const thread = await getDmConversation();
      return runTurn(message, thread.id, channelId, "steer");
    });
  const finished = active.get(previous.id)?.finished;
  await cancelRun(previous.id);
  await finished;
  const completedActions = getRun(previous.id)?.completedActions || previous.completedActions;
  return enqueue(() =>
    runTurn(
      `Original request: ${previous.prompt}\nCorrection: ${message}\nCompleted actions, do not repeat:\n${completedActions.join("\n")}`,
      previous.threadId,
      channelId,
      "steer",
      { images: previous.images, completedActions },
    ),
  );
}

export async function runTurn(
  prompt: string,
  threadId: string,
  channelId: string,
  origin: string,
  {
    images = [],
    completedActions = [],
    id = randomUUID(),
    foreground = true,
  }: {
    images?: Run["images"];
    completedActions?: Run["completedActions"];
    id?: string;
    foreground?: boolean;
  } = {},
) {
  const run: Run = {
    kind: "run",
    id,
    threadId,
    channelId,
    prompt,
    origin,
    images,
    createdAt: Date.now(),
    status: "running",
    completedActions,
    toolCalls: [],
    queuedQuestions: [],
    responseText: "",
  };
  save(run);
  return execute(run, undefined, foreground);
}

export async function answerRun(
  id: string,
  answer: string | string[] | boolean,
  toolCallId?: string,
) {
  return enqueue((signal) => resumeAnswer(id, answer, signal, toolCallId));
}

export async function resumeGoogleRuns(channelId: string) {
  return enqueue(async (signal) => {
    const waiting = runs().flatMap((run) =>
      run.status === "waiting" && run.channelId === channelId
        ? [run.pending, ...run.queuedQuestions]
            .filter((question) => question?.kind === "google-oauth")
            .map((question) => ({ id: run.id, toolCallId: question!.toolCallId }))
        : [],
    );
    for (const question of waiting) {
      if (signal.aborted) return;
      const run = getRun(question.id);
      if (
        run?.status !== "waiting" ||
        ![run.pending, ...run.queuedQuestions].some(
          (pending) => pending?.toolCallId === question.toolCallId,
        )
      )
        continue;
      await resumeAnswer(question.id, "Google connected.", signal, question.toolCallId);
    }
  });
}

export async function resumeAnswer(
  id: string,
  answer: string | string[] | boolean,
  signal?: AbortSignal,
  toolCallId?: string,
) {
  // A visible prompt can arrive before Mastra finishes persisting its suspended snapshot.
  await active.get(id)?.finished;
  if (signal?.aborted) return "Stopped.";
  const stored = getRun(id);
  if (!stored?.pending || stored.status !== "waiting")
    throw new Error("This question is no longer active.");
  const questions = [stored.pending, ...stored.queuedQuestions];
  const selected = toolCallId
    ? questions.find((question) => question.toolCallId === toolCallId)
    : stored.pending;
  if (!selected) throw new Error("This question is no longer active.");
  const run = { ...stored, pending: selected };
  const approval = run.pending.kind === "approval";
  if (approval && !(answer === true || answer === false))
    throw new Error("Use the approval buttons.");
  if (!approval && (answer === true || answer === false))
    throw new Error("Supply a question answer.");
  await finishQuestion(run.channelId, run.pending, true);
  if (signal?.aborted || getRun(id)?.status === "cancelled") return "Stopped.";
  const remaining = questions.filter((question) => question !== selected);
  save({ ...run, status: "running", pending: remaining[0], queuedQuestions: remaining.slice(1) });
  return execute(run, answer, run.origin !== "scheduler");
}

async function execute(run: Run, answer?: string | string[] | boolean, foreground = true) {
  const controller = new AbortController();
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  active.set(run.id, { controller, finished });
  if (foreground) currentId = run.id;
  const requestContext = new RequestContext();
  for (const [key, value] of Object.entries({
    resourceId,
    request: run.prompt,
    origin: run.origin,
    channelId: run.channelId,
    runId: run.id,
  }))
    requestContext.set(key, value);
  const options = {
    runId: run.id,
    memory: { thread: run.threadId, resource: resourceId },
    requestContext,
    abortSignal: AbortSignal.any([controller.signal, AbortSignal.timeout(600_000)]),
    hooks: {
      afterToolCall: ({ toolName, input, output, error }: ToolAfterHookContext) => {
        if (error !== undefined || output === undefined) return;
        if (z.object({ isError: z.literal(true) }).safeParse(output).success) return;
        const remoteTool =
          chatgptTools[toolName] || outlineTools[toolName] || todoistTools[toolName];
        const action = z.object({ action: z.string() }).safeParse(input);
        const mutates =
          (toolName === "google_calendar" &&
            action.success &&
            ["create", "update", "delete"].includes(action.data.action)) ||
          (toolName === "manage_jobs" && action.success && action.data.action !== "list") ||
          (toolName === "profile" && action.success && action.data.action !== "show") ||
          (remoteTool &&
            (remoteTool.mcp?.annotations?.readOnlyHint !== true ||
              remoteTool.mcp?.annotations?.destructiveHint === true));
        if (!mutates) return;
        const completed = JSON.stringify(
          { tool: toolName, args: input, result: output },
          (key, value) => (key === "__mastraMetadata" || key === "_meta" ? undefined : value),
        );
        const latest = getRun(run.id);
        if (latest && !latest.completedActions.includes(completed))
          save({ ...latest, completedActions: [...latest.completedActions, completed] });
      },
    },
  };
  const calls = new Map<string, Run["toolCalls"][number]>(
    run.toolCalls.map((call) => [call.id, call]),
  );
  if (answer !== undefined && run.pending) {
    const call = calls.get(run.pending.toolCallId);
    if (call) {
      call.status = answer === false ? "Declined" : "Running";
      if (run.pending.kind === "approval") call.approved = answer === true;
    }
  }
  let phase = "Thinking...";
  let progressId = run.statusMessageId;
  let responseText = run.responseText;
  let stepText = "";
  const stepSources = new Map<string, string>();
  let finalDisplayed = false;
  let lastProgress = "";
  let progressPending: Promise<unknown> = Promise.resolve();
  const updateProgress = () => {
    const text = [
      responseText || phase,
      ...[...calls.values()]
        .filter((call) => !["Done", "Declined", "Awaiting approval"].includes(call.status))
        .slice(-8)
        .map((call) => `-# ${call.status}: ${call.label.split("(")[0].replaceAll("_", " ")}`),
    ].join("\n");
    if (finalDisplayed || text === lastProgress) return progressPending;
    lastProgress = text;
    progressPending = progressPending
      .then(async () => {
        const preview = text.slice(-3500);
        const channel = await container.client.channels.fetch(run.channelId);
        if (!channel?.isSendable()) throw new Error("Discord channel is unavailable.");
        const current = getRun(run.id);
        const message =
          current && ["running", "waiting"].includes(current.status)
            ? progressMessage(preview, run.id)
            : textMessage(preview);
        if (progressId) return channel.messages.edit(progressId, message);
        progressId = (await channel.send(message)).id;
        const latest = getRun(run.id);
        if (latest) save({ ...latest, statusMessageId: progressId });
      })
      .catch((error) => container.logger.error(error));
    return progressPending;
  };
  const typing = async () => {
    const channel = await container.client.channels.fetch(run.channelId);
    if (channel?.isSendable()) await channel.sendTyping();
  };
  const typingTimer = setInterval(
    () => void typing().catch((error) => container.logger.error(error)),
    8000,
  );
  const onChunk = async (chunk: ChunkType) => {
    if (controller.signal.aborted) return;
    if (chunk.type === "tool-call-input-streaming-start" && chunk.payload.providerExecuted) {
      const { toolCallId, toolName } = chunk.payload;
      calls.set(toolCallId, { id: toolCallId, label: `${toolName}(…)`, status: "Running" });
      const latest = getRun(run.id);
      if (latest) save({ ...latest, toolCalls: [...calls.values()] });
      await updateProgress();
      return;
    }
    if (chunk.type === "text-delta") {
      stepText += chunk.payload.text;
      return;
    }
    if (chunk.type === "source" && chunk.payload.sourceType === "url" && chunk.payload.url) {
      stepSources.set(chunk.payload.url, chunk.payload.title);
      return;
    }
    if (chunk.type === "step-finish") {
      if (stepText) {
        for (const [url, title] of stepSources) {
          if (!stepText.includes(url))
            stepText += `\n[${title.replace(/[[\]]/g, "") || url}](<${url}>)`;
        }
        responseText += (responseText ? "\n\n" : "") + stepText;
        stepText = "";
        await updateProgress();
      }
      stepSources.clear();
    }
    if (
      chunk.type === "tool-call" ||
      chunk.type === "tool-result" ||
      chunk.type === "tool-error" ||
      chunk.type === "tool-output-denied" ||
      chunk.type === "tool-call-approval" ||
      chunk.type === "tool-call-suspended" ||
      chunk.type === "tool-call-resumed"
    ) {
      const { toolCallId, toolName, args } = chunk.payload;
      const preview = JSON.stringify(args ?? {}, (key, value) =>
        key === "__mastraMetadata" ? undefined : value,
      );
      const label =
        (chunk.type === "tool-call" ? undefined : calls.get(toolCallId)?.label) ||
        `${toolName}(${preview.length > 250 ? preview.slice(0, 250) + "..." : preview})`.replaceAll(
          "`",
          "'",
        );
      let status = "Done";
      if (chunk.type === "tool-call" || chunk.type === "tool-call-resumed") status = "Running";
      else if (
        chunk.type === "tool-error" ||
        (chunk.type === "tool-result" && chunk.payload.isError)
      )
        status = "Failed";
      else if (chunk.type === "tool-output-denied") status = "Declined";
      else if (chunk.type === "tool-call-approval") status = "Awaiting approval";
      else if (chunk.type === "tool-call-suspended") status = "Awaiting answer";
      calls.set(toolCallId, { ...calls.get(toolCallId), id: toolCallId, label, status });
      const latest = getRun(run.id);
      if (latest) save({ ...latest, toolCalls: [...calls.values()] });
      await updateProgress();
    }
    if (chunk.type !== "tool-call-approval" && chunk.type !== "tool-call-suspended") return;
    const payload = z
      .object({
        toolCallId: z.string(),
        toolName: z.string().optional(),
        args: z.unknown().optional(),
        suspendPayload: z.unknown().optional(),
      })
      .parse(chunk.payload);
    const approval = chunk.type === "tool-call-approval";
    const proposed = approval
      ? JSON.stringify(payload.args ?? {}, (key, value) =>
          key === "__mastraMetadata" ? undefined : value,
        ).replaceAll("`", "'")
      : "";
    const question = approval
      ? undefined
      : z
          .object({
            question: z.string(),
            options: z
              .array(z.object({ label: z.string(), description: z.string().optional() }))
              .optional(),
            selectionMode: z.string().optional(),
            googleOAuth: z.boolean().optional(),
          })
          .parse(payload.suspendPayload);
    const latest = getRun(run.id);
    if (!latest || latest.status === "cancelled") return;
    const decision: NonNullable<Run["pending"]> = {
      kind: approval ? "approval" : question?.googleOAuth ? "google-oauth" : "question",
      toolCallId: payload.toolCallId,
      question: approval
        ? `**Approve action?**\n\`${payload.toolName}(${proposed})\`\n\n-# ${latest.approvalReason || "Owner approval required."}`
        : question!.question,
      options: question?.options || [],
      multiple: question?.selectionMode === "multi_select",
    };
    const questions = [...(latest.pending ? [latest.pending] : []), ...latest.queuedQuestions];
    if (questions.some((item) => item.toolCallId === decision.toolCallId)) return;
    questions.push(decision);
    const waiting = save({
      ...latest,
      status: "waiting",
      pending: questions[0],
      queuedQuestions: questions.slice(1),
    });
    const messageId = await deliver(run.channelId, "", { ...waiting, pending: decision });
    const current = getRun(run.id);
    if (current?.status === "waiting") {
      const updated = [current.pending!, ...current.queuedQuestions].map((item) =>
        item.toolCallId === decision.toolCallId ? { ...item, messageId } : item,
      );
      save({ ...current, pending: updated[0], queuedQuestions: updated.slice(1) });
    }
  };
  try {
    await updateProgress();
    await typing();
    let input: MessageListInput = run.prompt;
    if (run.images.length) {
      const imageParts = await Promise.all(
        run.images.map(async (image) => ({
          type: "image" as const,
          image: `data:${image.mediaType};base64,${(await readFile(image.path)).toString("base64")}`,
          mimeType: image.mediaType,
        })),
      );
      input = [{ role: "user", content: [{ type: "text", text: run.prompt }, ...imageParts] }];
    }
    let stream;
    if (answer === undefined) stream = await agent.stream(input, options);
    else if (run.pending?.kind !== "approval")
      stream = await agent.resumeStream(answer, {
        ...options,
        toolCallId: run.pending?.toolCallId,
      });
    else if (answer === true)
      stream = await agent.approveToolCall({ ...options, toolCallId: run.pending.toolCallId });
    else
      stream = await agent.declineToolCall({
        ...options,
        toolCallId: run.pending.toolCallId,
        reason: "Owner declined this action.",
      });
    for await (const chunk of stream.fullStream) await onChunk(chunk);
    const result = await stream.getFullOutput();
    if (result.error) throw result.error;
    if (controller.signal.aborted || getRun(run.id)?.status === "cancelled") return "Stopped.";
    if (result.finishReason === "suspended" || getRun(run.id)?.pending) {
      save({ ...(getRun(run.id) || run), status: "waiting", responseText });
      return "Waiting for your answer.";
    }
    const latest = getRun(run.id) || run;
    save({ ...latest, status: "completed", pending: undefined, queuedQuestions: [], responseText });
    const text = responseText.trim() || result.text || "No text response returned.";
    finalDisplayed = true;
    clearInterval(typingTimer);
    await progressPending;
    const [first, ...rest] = splitReply(text);
    if (progressId) await editMessage(run.channelId, progressId, first);
    else await deliver(run.channelId, first);
    for (const part of rest) await deliver(run.channelId, part);
    if (foreground) {
      const signal = AbortSignal.any([controller.signal, profileController.signal]);
      profilePending = profilePending.then(() => learnProfile(run, signal));
    }
    return text;
  } catch (error) {
    if (controller.signal.aborted || getRun(run.id)?.status === "cancelled") return "Stopped.";
    const message = error instanceof Error ? error.message : "Unknown failure";
    save({
      ...(getRun(run.id) || run),
      status: "failed",
      pending: undefined,
      queuedQuestions: [],
      error: message,
    });
    await deliver(run.channelId, `Could not finish: ${message.slice(0, 1500)}`);
    throw error;
  } finally {
    clearInterval(typingTimer);
    const status = getRun(run.id)?.status;
    phase = "Failed.";
    if (status === "completed") phase = "Done.";
    else if (status === "waiting") phase = "Paused for your answer.";
    else if (status === "cancelled" || controller.signal.aborted) {
      phase = "Stopped.";
      if (responseText.trim()) responseText = `${responseText.trim()}\n\nStopped.`;
    }
    for (const call of calls.values()) if (call.status === "Running") call.status = phase;
    const latest = getRun(run.id);
    if (latest) save({ ...latest, toolCalls: [...calls.values()] });
    if (status === "completed") calls.clear();
    await updateProgress();
    active.delete(run.id);
    finish();
    if (currentId === run.id) currentId = undefined;
  }
}

async function learnProfile(run: Run, signal: AbortSignal) {
  if (signal.aborted) return;
  try {
    const result = await mastra
      .getAgent("modeller")
      .generate(JSON.stringify({ message: run.prompt, existingProfile: userContext() }), {
        maxSteps: 1,
        abortSignal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      });
    const extracted = z
      .object({
        facts: z
          .array(
            z.object({
              text: z.string().min(1).max(1000),
              certainty: z.enum(["stated", "tentative"]),
            }),
          )
          .max(3),
      })
      .parse(JSON.parse(result.text));
    signal.throwIfAborted();
    const added: string[] = [];
    for (const fact of extracted.facts) {
      if (facts().some((item) => item.text.toLowerCase() === fact.text.toLowerCase())) continue;
      save({
        kind: "fact",
        id: randomUUID(),
        ...fact,
        source: run.origin,
        updatedAt: Date.now(),
        forgotten: false,
      });
      added.push(`[${fact.certainty}] ${fact.text}`);
    }
    if (added.length)
      await deliver(
        run.channelId,
        `Remembered:\n${added.join("\n")}\nYou can ask me to correct or forget these.`,
      );
  } catch (error) {
    if (!signal.aborted) console.error("User profile extraction failed.", error);
  }
}

export function recoverForeground() {
  for (const run of runs())
    if (run.status === "running")
      save({
        ...run,
        status: "interrupted",
        error:
          "Bot restarted before this turn finished. Ask to retry; completed actions were retained.",
      });
}
