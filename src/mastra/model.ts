import { createLanguageModel } from "../providers/codex";

export const model = createLanguageModel(process.env.CODEX_MODEL || "gpt-6-luna");
