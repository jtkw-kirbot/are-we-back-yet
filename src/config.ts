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
  entity: {
    model: "gpt-5.4-mini-2026-03-17",
    reasoningEffort: "low",
  },
  sentiment: {
    model: "gpt-5.4-mini-2026-03-17",
    reasoningEffort: "medium",
  },
  adjudication: {
    model: "gpt-5.5-2026-04-23",
    reasoningEffort: "medium",
  },
} as const;

export const METHOD_VERSION = {
  entityPrompt: "entity-v3",
  sentimentPrompt: "sentiment-v3",
  adjudicationPrompt: "adjudication-v1",
  aggregation: "winner-v1",
  schema: "daily-v1",
} as const;

export const FETCH_LIMITS = {
  topStories: 30,
  maxCommentsPerStory: 500,
  maxDepth: 6,
  maxCommentsPerDay: 5000,
  backfillHitsPerPage: 100,
  backfillMaxPagesPerTerm: 5,
} as const;

export const BACKFILL_TERMS = [
  "OpenAI",
  "ChatGPT",
  "GPT",
  "Sora",
  "Anthropic",
  "Claude",
  "Gemini",
  "Google AI",
  "DeepMind",
  "Microsoft Copilot",
  "GitHub Copilot",
  "Bing Copilot",
  "Windows Copilot",
  "M365 Copilot",
] as const;

export const LOS_ANGELES_TZ = "America/Los_Angeles";
