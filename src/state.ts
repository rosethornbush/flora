import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import type { OAuthStorage } from "@mastra/mcp";
import { z } from "zod";

export const resourceId = `discord:${process.env.DISCORD_OWNER_ID || "studio"}`;
export const timezone = process.env.FLORA_TIMEZONE || "America/Los_Angeles";
new Intl.DateTimeFormat("en", { timeZone: timezone });
export const databaseUrl = process.env.FLORA_DATABASE_URL || "file:./mastra.db";
if (!databaseUrl.startsWith("file:")) throw new Error("Flora requires a local SQLite database.");
const databasePath = databaseUrl.startsWith("file://")
  ? fileURLToPath(databaseUrl)
  : resolve(databaseUrl.slice(5));
mkdirSync(dirname(databasePath), { recursive: true });
const db = new DatabaseSync(databasePath);
db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
db.exec(`CREATE TABLE IF NOT EXISTS flora_state (
  kind TEXT NOT NULL, id TEXT NOT NULL, owner TEXT NOT NULL, data TEXT NOT NULL,
  PRIMARY KEY (kind, id, owner)
)`);
db.exec(
  "CREATE TABLE IF NOT EXISTS flora_todoist_oauth (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
);
export const todoistOAuthStorage: OAuthStorage = {
  get(key) {
    const row = db.prepare("SELECT value FROM flora_todoist_oauth WHERE key=?").get(key);
    return row ? String(row.value) : undefined;
  },
  set(key, value) {
    db.prepare("INSERT OR REPLACE INTO flora_todoist_oauth (key,value) VALUES (?,?)").run(
      key,
      value,
    );
  },
  delete(key) {
    db.prepare("DELETE FROM flora_todoist_oauth WHERE key=?").run(key);
  },
};
db.exec(
  "CREATE TABLE IF NOT EXISTS flora_google_oauth (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
);
export const googleOAuthStorage = {
  accounts() {
    return db
      .prepare("SELECT key FROM flora_google_oauth WHERE key != 'tokens'")
      .all()
      .map((row) => String(row.key));
  },
  get(key: string) {
    const row = db.prepare("SELECT value FROM flora_google_oauth WHERE key=?").get(key);
    return row ? String(row.value) : undefined;
  },
  set(key: string, value: string) {
    db.prepare("INSERT OR REPLACE INTO flora_google_oauth (key,value) VALUES (?,?)").run(
      key,
      value,
    );
  },
  delete(key: string) {
    db.prepare("DELETE FROM flora_google_oauth WHERE key=?").run(key);
  },
};
db.exec(`CREATE TABLE IF NOT EXISTS flora_google_login_sessions (
  state TEXT PRIMARY KEY, data TEXT NOT NULL, expires_at INTEGER NOT NULL
)`);
export const googleLoginSessions = {
  create(state: string, data: string, expiresAt: number) {
    db.prepare("DELETE FROM flora_google_login_sessions WHERE expires_at <= ?").run(Date.now());
    db.prepare(
      "INSERT INTO flora_google_login_sessions (state,data,expires_at) VALUES (?,?,?)",
    ).run(state, data, expiresAt);
  },
  consume(state: string) {
    const row = db
      .prepare("DELETE FROM flora_google_login_sessions WHERE state=? RETURNING data,expires_at")
      .get(state);
    return row && Number(row.expires_at) > Date.now() ? String(row.data) : undefined;
  },
};

export const questionSchema = z.object({
  kind: z.enum(["question", "approval", "google-oauth"]),
  toolCallId: z.string(),
  question: z.string(),
  options: z.array(z.object({ label: z.string(), description: z.string().optional() })).default([]),
  multiple: z.boolean().default(false),
  messageId: z.string().optional(),
});
export const runSchema = z.object({
  kind: z.literal("run"),
  id: z.string(),
  threadId: z.string(),
  channelId: z.string(),
  prompt: z.string(),
  origin: z.string(),
  createdAt: z.number(),
  status: z.enum(["running", "waiting", "completed", "cancelled", "failed", "interrupted"]),
  pending: questionSchema.optional(),
  queuedQuestions: z.array(questionSchema).default([]),
  statusMessageId: z.string().optional(),
  responseText: z.string().default(""),
  error: z.string().optional(),
  completedActions: z.array(z.string()).default([]),
  toolCalls: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        status: z.string(),
        approved: z.boolean().optional(),
      }),
    )
    .default([]),
  images: z.array(z.object({ path: z.string(), mediaType: z.string() })).default([]),
  approvalReason: z.string().optional(),
});
export const jobSchema = z.object({
  kind: z.literal("job"),
  id: z.string(),
  channelId: z.string(),
  instruction: z.string(),
  nextAt: z.number(),
  cron: z.string().optional(),
  createdAt: z.number(),
  status: z.enum(["scheduled", "running", "completed", "cancelled", "failed"]),
  lastRun: z.number().optional(),
  error: z.string().optional(),
  runId: z.string().optional(),
});
export const factSchema = z.object({
  kind: z.literal("fact"),
  id: z.string(),
  text: z.string(),
  certainty: z.enum(["stated", "tentative"]),
  source: z.string(),
  updatedAt: z.number(),
  forgotten: z.boolean().default(false),
});
const recordSchema = z.discriminatedUnion("kind", [runSchema, jobSchema, factSchema]);
export type Run = z.infer<typeof runSchema>;
export type Job = z.infer<typeof jobSchema>;
export type Fact = z.infer<typeof factSchema>;
type RecordValue = z.infer<typeof recordSchema>;

export function save(value: Run): Run;
export function save(value: Job): Job;
export function save(value: Fact): Fact;
export function save(value: RecordValue) {
  db.prepare("INSERT OR REPLACE INTO flora_state (kind,id,owner,data) VALUES (?,?,?,?)").run(
    value.kind,
    value.id,
    resourceId,
    JSON.stringify(value),
  );
  return value;
}

db.exec(
  "CREATE TABLE IF NOT EXISTS flora_deliveries (id TEXT PRIMARY KEY, sent_at INTEGER NOT NULL)",
);
export function wasDelivered(id: string) {
  return Boolean(db.prepare("SELECT id FROM flora_deliveries WHERE id=?").get(id));
}
export function markDelivered(id: string) {
  db.prepare("INSERT OR IGNORE INTO flora_deliveries (id,sent_at) VALUES (?,?)").run(
    id,
    Date.now(),
  );
}

function records(kind: RecordValue["kind"]) {
  return db
    .prepare("SELECT data FROM flora_state WHERE kind=? AND owner=? ORDER BY rowid DESC")
    .all(kind, resourceId)
    .map((row) => recordSchema.parse(JSON.parse(String(row.data))));
}

export function runs() {
  return records("run").filter((row) => row.kind === "run");
}
export function jobs() {
  return records("job").filter((row) => row.kind === "job");
}
export function facts() {
  return records("fact").filter((row) => row.kind === "fact");
}
export function getRun(id: string) {
  const row = db
    .prepare("SELECT data FROM flora_state WHERE kind=? AND id=? AND owner=?")
    .get("run", id, resourceId);
  return row ? runSchema.parse(JSON.parse(String(row.data))) : undefined;
}
export function getJob(id: string) {
  const row = db
    .prepare("SELECT data FROM flora_state WHERE kind=? AND id=? AND owner=?")
    .get("job", id, resourceId);
  return row ? jobSchema.parse(JSON.parse(String(row.data))) : undefined;
}
export function userContext() {
  return facts()
    .map((fact) =>
      fact.forgotten
        ? `Do not infer or restore this forgotten fact from history: ${fact.text}`
        : `[${fact.id}; ${fact.certainty}; source ${fact.source}] ${fact.text}`,
    )
    .join("\n");
}
