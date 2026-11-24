import { randomUUID } from "node:crypto";

import { CronExpressionParser } from "cron-parser";

import { getJob, getRun, jobs, save, timezone, type Job } from "../state";
import { deliver } from "./delivery";
import { runTurn } from "./runtime";

const executing = new Set<string>();
async function runJob(job: Job) {
  executing.add(job.id);
  const runId = job.cron ? randomUUID() : undefined;
  save({ ...job, status: "running", lastRun: Date.now(), error: undefined, runId });
  try {
    if (job.cron) {
      await runTurn(job.instruction, randomUUID(), job.channelId, "scheduler", {
        foreground: false,
        id: runId,
      });
      if (getRun(runId!)?.status === "waiting") return;
    } else {
      const late = Date.now() - job.nextAt > 60_000;
      await deliver(
        job.channelId,
        `${late ? "Late reminder" : "Reminder"}: ${job.instruction}\nScheduled for ${new Date(job.nextAt).toLocaleString("en-US", { timeZone: timezone })} (${timezone}).`,
      );
    }
    const current = getJob(job.id);
    if (!current || current.status === "cancelled") return;
    const nextAt = job.cron
      ? CronExpressionParser.parse(job.cron, { tz: timezone, currentDate: new Date() })
          .next()
          .getTime()
      : job.nextAt;
    save({ ...current, status: job.cron ? "scheduled" : "completed", nextAt });
  } catch (error) {
    const current = getJob(job.id);
    if (current?.status === "cancelled") return;
    const message = error instanceof Error ? error.message : "Unknown scheduler failure";
    save({ ...job, status: "failed", error: message });
    console.error(`Job ${job.id} failed:`, error);
  } finally {
    executing.delete(job.id);
  }
}

export async function startScheduler() {
  for (const job of jobs()) {
    // Never replay an uncertain occurrence; expose it for review.
    if (job.status !== "running") continue;
    const run = job.runId ? getRun(job.runId) : undefined;
    if (run?.status === "waiting") continue;
    if (job.cron && run?.status === "completed") {
      save({
        ...job,
        status: "scheduled",
        nextAt: CronExpressionParser.parse(job.cron, { tz: timezone }).next().getTime(),
      });
      continue;
    }
    save({
      ...job,
      status: "failed",
      error:
        "Interrupted by restart; actions or delivery may have happened. Review before retrying.",
    });
  }
  const tick = () => {
    for (const job of jobs()) {
      if (job.status !== "running" || executing.has(job.id) || !job.runId || !job.cron) continue;
      const run = getRun(job.runId);
      if (run?.status === "completed")
        save({
          ...job,
          status: "scheduled",
          nextAt: CronExpressionParser.parse(job.cron, { tz: timezone }).next().getTime(),
        });
      else if (run && ["failed", "interrupted", "cancelled"].includes(run.status))
        save({ ...job, status: "failed", error: run.error || `Run ${run.status}.` });
    }
    for (const job of jobs())
      if (job.status === "scheduled" && job.nextAt <= Date.now() && !executing.has(job.id))
        void runJob(job);
  };
  tick();
  return setInterval(tick, 5000);
}
