import { defineConfig } from "oxfmt";

export default defineConfig({
  sortImports: true,
  ignorePatterns: [
    ".agent/**",
    ".agents/**",
    ".claude/**",
    ".codex/**",
    ".continue/**",
    ".cursor/**",
    ".gemini/**",
    ".opencode/**",
    ".pi/**",
    ".roo/**",
    ".windsurf/**",
    ".mastra/**",
    "dist/**",
    "oxlint/anti-slop/**",
    "types/**",
  ],
});
