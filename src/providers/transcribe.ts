import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { request } from "node:https";
import { text } from "node:stream/consumers";

import { z } from "zod";

import { loadCodexCredentials } from "./codex";

export const MAX_TRANSCRIPTION_BYTES = 30_000_000;

export async function transcribe(audio: Uint8Array, signal: AbortSignal) {
  if (audio.byteLength > MAX_TRANSCRIPTION_BYTES) throw new Error("Decoded audio exceeds 30 MB.");
  const credentials = await loadCodexCredentials();
  const boundary = randomUUID();
  const prefix = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n`,
  );
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
  // This endpoint challenges modern Node fetch requests; native HTTPS succeeds.
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const req = request(
      "https://chatgpt.com/backend-api/transcribe",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credentials.access}`,
          "ChatGPT-Account-Id": credentials.accountId,
          "User-Agent": "codex_cli_rs/0.160.0",
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": prefix.byteLength + audio.byteLength + suffix.byteLength,
        },
        signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
      },
      resolve,
    );
    req.on("error", reject);
    req.write(prefix);
    req.write(audio);
    req.end(suffix);
  });
  const result = await text(response);
  if (response.headers["cf-mitigated"] === "challenge")
    throw new Error("Transcription blocked by Cloudflare (403). Try again later.");
  if (response.statusCode !== 200) {
    const detail = response.headers["content-type"]?.includes("application/json")
      ? `: ${result.slice(0, 1000)}`
      : "";
    throw new Error(`Transcription failed (${response.statusCode})${detail}`);
  }
  return z.object({ text: z.string().trim().min(1) }).parse(JSON.parse(result)).text;
}
