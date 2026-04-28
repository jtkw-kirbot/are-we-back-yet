import { TARGETS, type Target } from "./config.js";
import type { HnItem, Mention } from "./types.js";

const MIN_MENTION_CONFIDENCE = 0.3;
const RESELLER_ASPECTS = new Set(["reseller_billing", "product_ux", "procurement"]);

const SURFACE_OWNERS: Record<string, Target> = {
  bing_copilot: "microsoft_copilot",
  chatgpt: "openai",
  claude: "anthropic",
  claude_code: "anthropic",
  codex: "openai",
  gemini: "google_gemini",
  github_copilot: "microsoft_copilot",
  google_ai_studio: "google_gemini",
  m365_copilot: "microsoft_copilot",
  microsoft_365_copilot: "microsoft_copilot",
  microsoft_copilot: "microsoft_copilot",
  openai_api: "openai",
  anthropic_api: "anthropic",
  gemini_api: "google_gemini",
  windows_copilot: "microsoft_copilot",
};

const SURFACE_PATTERNS: Array<{ owner: Target; patterns: RegExp[] }> = [
  {
    owner: "microsoft_copilot",
    patterns: [
      /\bgithub\s+copilot\b/i,
      /\bmicrosoft\s+copilot\b/i,
      /\bbing\s+copilot\b/i,
      /\bwindows\s+copilot\b/i,
      /\bm365\s+copilot\b/i,
      /\bmicrosoft\s+365\s+copilot\b/i,
    ],
  },
  {
    owner: "openai",
    patterns: [/\bchatgpt\b/i, /\bcodex\b/i, /\bopenai\s+api\b/i],
  },
  {
    owner: "anthropic",
    patterns: [/\bclaude\s+code\b/i, /\bclaude\b/i, /\banthropic\s+api\b/i],
  },
  {
    owner: "google_gemini",
    patterns: [/\bgemini\b/i, /\bgoogle\s+ai\s+studio\b/i, /\bgemini\s+api\b/i],
  },
];

const ROUTING_CONTEXT_PATTERN = /\b(billing|credit|credits|quota|limit|limits|multiplier|multipliers|plan|plans|pricing|price|prices|request|requests|subscription|usage|meter|metered|tax|cost|costs|expensive|annual)\b|[$]\d|\d+x\b/i;

function isTarget(value: string): value is Target {
  return (TARGETS as readonly string[]).includes(value);
}

function normalizeSurface(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function surfaceOwnerTarget(surface: string): Target | undefined {
  const normalized = normalizeSurface(surface);
  return SURFACE_OWNERS[normalized];
}

function trackedSurfaceOwnerFromItem(item: HnItem): Target | undefined {
  const context = [item.storyTitle, item.title, item.storyUrl, item.url].filter(Boolean).join(" ");
  return SURFACE_PATTERNS.find((candidate) => candidate.patterns.some((pattern) => pattern.test(context)))?.owner;
}

function hasRoutingContext(mention: Mention, item?: HnItem): boolean {
  if (RESELLER_ASPECTS.has(mention.aspect)) return true;
  if (!item) return false;
  const context = [mention.text, item.storyTitle, item.title, item.storyUrl, item.url, item.text].filter(Boolean).join(" ");
  return ROUTING_CONTEXT_PATTERN.test(context);
}

export function sentimentTargetsForMentions(mentions: Mention[], item?: HnItem): Target[] {
  const targets = new Set<Target>();
  const itemSurfaceOwner = item ? trackedSurfaceOwnerFromItem(item) : undefined;

  for (const mention of mentions) {
    if (mention.mentionType === "irrelevant" || mention.confidence < MIN_MENTION_CONFIDENCE) continue;

    targets.add(mention.target);

    if (isTarget(mention.sentimentOwner)) {
      targets.add(mention.sentimentOwner);
    }

    const surfaceOwner = surfaceOwnerTarget(mention.surface);
    if (surfaceOwner && surfaceOwner !== mention.target && RESELLER_ASPECTS.has(mention.aspect)) {
      targets.add(surfaceOwner);
    }

    if (itemSurfaceOwner && itemSurfaceOwner !== mention.target && hasRoutingContext(mention, item)) {
      targets.add(itemSurfaceOwner);
    }
  }

  return TARGETS.filter((target) => targets.has(target));
}
