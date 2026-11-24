import { setTimeout as delay } from "node:timers/promises";

import type { BackgroundTask } from "@mastra/core/background-tasks";
import { container } from "@sapphire/framework";
import { z } from "zod";

import { mastra } from "../mastra";
import { getRun, markDelivered, resourceId, wasDelivered } from "../state";
import { deliver } from "./delivery";

const backgroundEventSchema = z.object({
  type: z.string(),
  payload: z.object({ taskId: z.string() }),
});

export function startBackgroundDelivery() {
  const manager = mastra.backgroundTaskManager;
  if (!manager) throw new Error("Background manager unavailable.");
  const controller = new AbortController();
  const { signal } = controller;
  let deliveryPending = Promise.resolve();
  const publish = (task: BackgroundTask) => {
    const next = deliveryPending.then(async () => {
      if (signal.aborted) return;
      if (wasDelivered(task.id)) return;
      const run = getRun(task.runId);
      if (!run) return;
      if (run.status === "cancelled") {
        if (["pending", "running", "suspended"].includes(task.status))
          await manager.cancel(task.id);
        markDelivered(task.id);
        return;
      }
      if (!["completed", "failed", "timed_out"].includes(task.status)) return;
      const result =
        task.status === "completed"
          ? z.object({ text: z.string() }).safeParse(task.result)
          : undefined;
      const text = result?.success
        ? result.data.text
        : task.error?.message || "Background task failed.";
      while (!signal.aborted) {
        if (getRun(task.runId)?.status === "cancelled") {
          markDelivered(task.id);
          return;
        }
        try {
          await deliver(run.channelId, `Task ${task.id}: ${task.status}\n\n${text}`);
          markDelivered(task.id);
          return;
        } catch (error) {
          container.logger.error("Background delivery failed.", error);
          // Completion events aren't replayed live; retry delivery before marking them sent.
          await delay(5000, undefined, { signal });
        }
      }
    });
    deliveryPending = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
  const live = manager.stream({ resourceId, abortSignal: signal }).pipeTo(
    new WritableStream({
      write: async (event) => {
        const { type, payload } = backgroundEventSchema.parse(event);
        if (type === "background-task-output") return;
        const task = await manager.getTask(payload.taskId);
        if (task) await publish(task);
      },
    }),
  );
  void live.catch((error) => {
    if (signal.aborted) return;
    controller.abort();
    container.logger.error("Background event stream failed.", error);
  });
  void (async () => {
    for (let page = 0; ; page++) {
      const { tasks, total } = await manager.listTasks({
        resourceId,
        status: ["pending", "running", "suspended", "completed", "failed", "timed_out"],
        page,
        perPage: 100,
      });
      for (const task of tasks) await publish(task);
      if ((page + 1) * 100 >= total) break;
    }
  })().catch((error) => {
    if (!signal.aborted) container.logger.error("Background recovery delivery failed.", error);
  });
  return () => controller.abort();
}
