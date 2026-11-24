import { mastra } from "../mastra";
import { getJob, getRun, resourceId, save } from "../state";
import { finishQuestion } from "./delivery";

export const active = new Map<string, { controller: AbortController; finished: Promise<void> }>();

export async function cancelRun(id: string) {
  const run = getRun(id);
  if (!run || !["running", "waiting", "cancelled"].includes(run.status)) return false;
  save({ ...run, status: "cancelled", pending: undefined, queuedQuestions: [] });
  active.get(id)?.controller.abort();
  mastra.getAgent("agent").abortRunStream(id);
  try {
    for (const question of [...(run.pending ? [run.pending] : []), ...run.queuedQuestions])
      await finishQuestion(run.channelId, question, false);
  } finally {
    const manager = mastra.backgroundTaskManager;
    if (manager) {
      const { tasks } = await manager.listTasks({ runId: id, resourceId, perPage: 100 });
      for (const task of tasks)
        if (["pending", "running", "suspended"].includes(task.status))
          await manager.cancel(task.id);
    }
  }
  return true;
}

export async function cancelJob(id: string) {
  const job = getJob(id);
  if (!job) throw new Error("Job not found.");
  const cancelled = save({ ...job, status: "cancelled" });
  if (job.runId) await cancelRun(job.runId);
  return cancelled;
}
