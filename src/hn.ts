import { FETCH_LIMITS } from "./config.js";
import { type HnItem, type RawDay } from "./types.js";

const FIREBASE_BASE = "https://hacker-news.firebaseio.com/v0";

type FirebaseItem = {
  id: number;
  type?: string;
  by?: string;
  time?: number;
  title?: string;
  url?: string;
  text?: string;
  score?: number;
  descendants?: number;
  kids?: number[];
  parent?: number;
  deleted?: boolean;
  dead?: boolean;
};

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { "user-agent": "hn-ai-sentiment/0.1" },
  });
  if (!response.ok) {
    throw new Error(`GET ${url} failed with ${response.status}`);
  }
  return (await response.json()) as T;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { "user-agent": "hn-ai-sentiment/0.1" },
  });
  if (!response.ok) {
    throw new Error(`GET ${url} failed with ${response.status}`);
  }
  return response.text();
}

export function parseHistoricalFrontPageStoryIds(html: string): number[] {
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const match of html.matchAll(/<tr\b[^>]*>/gi)) {
    const tag = match[0];
    if (!/\bathing\b/i.test(tag) || !/\bsubmission\b/i.test(tag)) continue;
    const idMatch = tag.match(/\bid=(?:"|')?(\d+)(?:"|')?/i);
    if (!idMatch?.[1]) continue;
    const id = Number(idMatch[1]);
    if (!Number.isInteger(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function decodeEntities(value: string): string {
  return value
    .replaceAll("<p>", "\n")
    .replaceAll("<br>", "\n")
    .replaceAll("&#x27;", "'")
    .replaceAll("&#x2F;", "/")
    .replaceAll("&quot;", "\"")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function hnUrl(id: number): string {
  return `https://news.ycombinator.com/item?id=${id}`;
}

function compactItem(input: {
  id: number;
  type: string;
  by?: string | null | undefined;
  time?: number | null | undefined;
  title?: string | null | undefined;
  url?: string | null | undefined;
  text?: string | null | undefined;
  score?: number | null | undefined;
  descendants?: number | null | undefined;
  depth: number;
  parentId?: number | null | undefined;
  storyId: number;
  storyTitle: string;
  storyUrl?: string | null | undefined;
}): HnItem {
  const item: Record<string, unknown> = {
    id: input.id,
    type: input.type,
    depth: input.depth,
    storyId: input.storyId,
    storyTitle: input.storyTitle,
    sourceUrl: hnUrl(input.id),
  };
  for (const key of ["by", "time", "title", "url", "text", "score", "descendants", "parentId", "storyUrl"] as const) {
    if (input[key] !== undefined && input[key] !== null) item[key] = input[key];
  }
  return item as HnItem;
}

async function getFirebaseItem(id: number): Promise<FirebaseItem | null> {
  return fetchJson<FirebaseItem | null>(`${FIREBASE_BASE}/item/${id}.json`);
}

async function fetchFirebaseThread(
  story: FirebaseItem,
  counters: { storyComments: number; dayComments: number },
  options: { commentCutoffUnixSeconds?: number } = {},
): Promise<HnItem[]> {
  if (!story.id || story.deleted || story.dead) return [];
  const storyTitle = story.title ?? `HN item ${story.id}`;
  const storyItem = compactItem({
    id: story.id,
    type: story.type ?? "story",
    by: story.by,
    time: story.time,
    title: story.title,
    url: story.url,
    text: story.text ? decodeEntities(story.text) : undefined,
    score: story.score,
    descendants: story.descendants,
    depth: 0,
    storyId: story.id,
    storyTitle,
    storyUrl: story.url,
  });
  const items = [storyItem];

  async function visit(id: number, depth: number, parentId: number): Promise<void> {
    if (depth > FETCH_LIMITS.maxDepth) return;
    if (counters.storyComments >= FETCH_LIMITS.maxCommentsPerStory) return;
    if (counters.dayComments >= FETCH_LIMITS.maxCommentsPerDay) return;

    const item = await getFirebaseItem(id);
    if (!item || item.deleted || item.dead || !item.id) return;
    if (options.commentCutoffUnixSeconds !== undefined && item.time !== undefined && item.time > options.commentCutoffUnixSeconds) return;

    counters.storyComments += 1;
    counters.dayComments += 1;
    items.push(compactItem({
      id: item.id,
      type: item.type ?? "comment",
      by: item.by,
      time: item.time,
      text: item.text ? decodeEntities(item.text) : undefined,
      depth,
      parentId,
      storyId: story.id,
      storyTitle,
      storyUrl: story.url,
    }));

    for (const childId of item.kids ?? []) {
      await visit(childId, depth + 1, item.id);
    }
  }

  for (const childId of story.kids ?? []) {
    await visit(childId, 1, story.id);
  }

  return items;
}

export async function fetchFrontPage(date: string): Promise<RawDay> {
  const ids = await fetchJson<number[]>(`${FIREBASE_BASE}/topstories.json`);
  const items: HnItem[] = [];
  const counters = { dayComments: 0 };

  for (const id of ids.slice(0, FETCH_LIMITS.topStories)) {
    const story = await getFirebaseItem(id);
    if (!story || story.deleted || story.dead) continue;
    const localCounters = { storyComments: 0, dayComments: counters.dayComments };
    const thread = await fetchFirebaseThread(story, localCounters);
    counters.dayComments = localCounters.dayComments;
    items.push(...thread);
    if (counters.dayComments >= FETCH_LIMITS.maxCommentsPerDay) break;
  }

  return {
    date,
    fetchedAt: new Date().toISOString(),
    samplingMethod: "frontpage_snapshot",
    source: "firebase",
    items,
  };
}

function endOfUtcDateUnixSeconds(date: string): number {
  const endMs = Date.parse(`${date}T23:59:59.999Z`);
  if (!Number.isFinite(endMs)) throw new Error(`Invalid date: ${date}`);
  return Math.floor(endMs / 1000);
}

export async function fetchHistoricalFrontPage(date: string): Promise<RawDay> {
  const html = await fetchText(`https://news.ycombinator.com/front?day=${encodeURIComponent(date)}`);
  const ids = parseHistoricalFrontPageStoryIds(html).slice(0, FETCH_LIMITS.topStories);
  if (ids.length === 0) throw new Error(`No historical HN front-page stories found for ${date}`);

  const items: HnItem[] = [];
  const counters = { dayComments: 0 };
  const commentCutoffUnixSeconds = endOfUtcDateUnixSeconds(date);

  for (const id of ids) {
    const story = await getFirebaseItem(id);
    if (!story || story.deleted || story.dead) continue;
    const localCounters = { storyComments: 0, dayComments: counters.dayComments };
    const thread = await fetchFirebaseThread(story, localCounters, { commentCutoffUnixSeconds });
    counters.dayComments = localCounters.dayComments;
    items.push(...thread);
    if (counters.dayComments >= FETCH_LIMITS.maxCommentsPerDay) break;
  }

  return {
    date,
    fetchedAt: new Date().toISOString(),
    samplingMethod: "historical_frontpage_snapshot",
    source: "hn_front_html_firebase",
    items,
  };
}
