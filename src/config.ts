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
  evidenceDetection: {
    model: "gpt-5.4-2026-03-05",
    reasoningEffort: "medium",
  },
  dailySummary: {
    model: "gpt-5.4-mini-2026-03-17",
    reasoningEffort: "low",
  },
} as const;

export const METHOD_VERSION = {
  evidenceDetectionPrompt: "evidence-annotation-v1",
  dailySummaryPrompt: "cited-summary-v1",
  aggregation: "deterministic-auditable-v1",
  schema: "daily-v4",
} as const;

export const FETCH_LIMITS = {
  topStories: 30,
  topCommentsPerStory: 10,
} as const;

export const NEW_METHOD_START_DATE = "2026-01-01";

export const SAMPLING_METHOD = "frontpage_day_query_story_comment_snapshot" as const;
export const RAW_SOURCE = "hn_front_day_query_firebase" as const;

export const TARGET_ALIAS_HINTS: Record<Target, string[]> = {
  openai: [
    "OpenAI",
    "ChatGPT",
    "GPT",
    "GPT-*",
    "Codex",
    "Sora",
    "OpenAI API",
    "named OpenAI model families",
  ],
  anthropic: [
    "Anthropic",
    "Claude",
    "Claude Code",
    "Sonnet",
    "Opus",
    "Haiku",
    "named Anthropic model families",
  ],
  google_gemini: [
    "Google Gemini",
    "Gemini",
    "Gemini Nano",
    "Google AI Studio",
    "Google AI model names where clearly Gemini-family",
  ],
  microsoft_copilot: [
    "Microsoft Copilot",
    "GitHub Copilot",
    "Bing Copilot",
    "Windows Copilot",
    "M365 Copilot",
    "Copilot+",
  ],
};

export const DETERMINISTIC_AUDIT_ALIASES: Record<Target, string[]> = {
  openai: [
    "\\bopenai\\b",
    "\\bchatgpt\\b",
    "\\bgpt[-\\s]?[0-9][\\w.-]*\\b",
    "\\bgpt\\b",
    "\\bcodex\\b",
    "\\bsora\\b",
    "\\bo[0-9](?:[-\\s]?pro)?\\b",
  ],
  anthropic: [
    "\\banthropic\\b",
    "\\bclaude\\b",
    "\\bclaude\\s+code\\b",
    "\\bsonnet\\b",
    "\\bopus\\b",
    "\\bhaiku\\b",
  ],
  google_gemini: [
    "\\bgemini\\b",
    "\\bgemini\\s+nano\\b",
    "\\bgoogle\\s+ai\\s+studio\\b",
  ],
  microsoft_copilot: [
    "\\bcopilot\\b",
    "\\bgithub\\s+copilot\\b",
    "\\bbing\\s+copilot\\b",
    "\\bwindows\\s+copilot\\b",
    "\\bm365\\s+copilot\\b",
    "\\bcopilot\\+\\b",
  ],
};

export const AGGREGATION_CONFIG = {
  titleWeight: 2,
  commentWeight: 1,
  relevanceMultipliers: {
    central: 1,
    direct: 0.75,
    incidental: 0.35,
  },
  perStoryTargetCap: 3,
  shrinkageConstant: 2,
  tieThreshold: 0.2,
  buckets: {
    stronglyNegativeMax: -1.25,
    negativeMax: -0.35,
    positiveMin: 0.35,
    stronglyPositiveMin: 1.25,
  },
  primarySignalNeutralThreshold: 0.35,
} as const;

export const LOS_ANGELES_TZ = "America/Los_Angeles";
