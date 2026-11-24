import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import type { Attachment } from "discord.js";

import { MAX_TRANSCRIPTION_BYTES, transcribe } from "../providers/transcribe";

export async function transcribeAudio(attachment: Attachment, signal: AbortSignal) {
  if (attachment.size > 10_000_000) throw new Error("Audio exceeds 10 MB.");
  const response = await fetch(attachment.url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
  });
  if (!response.ok) throw new Error(`Audio download failed (${response.status}).`);
  const directory = await mkdtemp(join(tmpdir(), "flora-audio-"));
  try {
    const source = join(directory, "source");
    const wav = join(directory, "audio.wav");
    await writeFile(source, Buffer.from(await response.arrayBuffer()), { mode: 0o600 });
    await promisify(execFile)(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        source,
        "-ac",
        "1",
        "-ar",
        "24000",
        "-c:a",
        "pcm_s16le",
        "-map_metadata",
        "-1",
        "-fs",
        String(MAX_TRANSCRIPTION_BYTES),
        wav,
      ],
      { signal, timeout: 60_000 },
    );
    if ((await stat(wav)).size >= MAX_TRANSCRIPTION_BYTES)
      throw new Error("Decoded audio exceeds 30 MB.");
    const { stdout } = await promisify(execFile)(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        wav,
      ],
      { signal, timeout: 10_000 },
    );
    const duration = Number(stdout.trim());
    if (!stdout.trim() || !Number.isFinite(duration) || duration <= 0)
      throw new Error("Could not determine audio duration.");
    if (duration > 600) throw new Error("Audio exceeds 10 minutes.");
    return await transcribe(await readFile(wav), signal);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function saveImage(attachment: Attachment, signal?: AbortSignal) {
  const mediaType = attachment.contentType?.split(";")[0];
  if (!mediaType || !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(mediaType))
    throw new Error("Send a PNG, JPEG, WebP, or GIF image.");
  if (attachment.size > 10_000_000) throw new Error("Image exceeds 10 MB.");
  const response = await fetch(attachment.url, {
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
      : AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Image download failed (${response.status}).`);
  const data = Buffer.from(await response.arrayBuffer());
  const directory = resolve(process.env.FLORA_ATTACHMENTS_DIR || ".flora/attachments");
  await mkdir(directory, { recursive: true });
  const path = resolve(directory, randomUUID());
  await writeFile(path, data, { mode: 0o600 });
  return { path, mediaType };
}
