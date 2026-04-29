export const TARGETS = [
  "openai",
  "anthropic",
  "google_gemini",
  "microsoft_copilot",
] as const;

export type Target = (typeof TARGETS)[number];

export const TARGET_LABELS: Record<Target, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google_gemini: "Google Gemini",
  microsoft_copilot: "Microsoft Copilot",
};

export const TARGET_COLORS: Record<Target, string> = {
  openai: "#2ea043",
  anthropic: "#d97706",
  google_gemini: "#2563eb",
  microsoft_copilot: "#7c3aed",
};

export const MODEL_CONFIG = {
  titleAnalysis: {
    model: "gpt-5.4-2026-03-05",
    reasoningEffort: "medium",
  },
} as const;

export const METHOD_VERSION = {
  titleAnalysisPrompt: "model-owned-story-comments-v1",
  aggregation: "model-owned-rollup-v1",
  schema: "daily-v3",
} as const;

export const FETCH_LIMITS = {
  topStories: 30,
  topCommentsPerStory: 5,
} as const;

export const LOS_ANGELES_TZ = "America/Los_Angeles";
