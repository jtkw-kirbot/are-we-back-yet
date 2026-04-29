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
  score?: number;
  descendants?: number;
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

function hnUrl(id: number): string {
  return `https://news.ycombinator.com/item?id=${id}`;
}

async function getFirebaseItem(id: number): Promise<FirebaseItem | null> {
  return fetchJson<FirebaseItem | null>(`${FIREBASE_BASE}/item/${id}.json`);
}

function compactStory(story: FirebaseItem, rank: number): HnItem | undefined {
  if (!story.id || story.deleted || story.dead || !story.title) return undefined;
  const item: Record<string, unknown> = {
    id: story.id,
    type: story.type ?? "story",
    title: story.title,
    rank,
    depth: 0,
    storyId: story.id,
    storyTitle: story.title,
    sourceUrl: hnUrl(story.id),
  };
  for (const key of ["by", "time", "url", "score", "descendants"] as const) {
    if (story[key] !== undefined) item[key] = story[key];
  }
  if (story.url !== undefined) item.storyUrl = story.url;
  return item as HnItem;
}

async function fetchStories(ids: number[]): Promise<HnItem[]> {
  const items: HnItem[] = [];
  for (const [index, id] of ids.entries()) {
    const story = await getFirebaseItem(id);
    if (!story) continue;
    const item = compactStory(story, index + 1);
    if (item) items.push(item);
  }
  return items;
}

export async function fetchFrontPage(date: string): Promise<RawDay> {
  const ids = await fetchJson<number[]>(`${FIREBASE_BASE}/topstories.json`);
  const items = await fetchStories(ids.slice(0, FETCH_LIMITS.topStories));

  return {
    date,
    fetchedAt: new Date().toISOString(),
    samplingMethod: "frontpage_title_snapshot",
    source: "firebase",
    items,
  };
}

export async function fetchHistoricalFrontPage(date: string): Promise<RawDay> {
  const html = await fetchText(`https://news.ycombinator.com/front?day=${encodeURIComponent(date)}`);
  const ids = parseHistoricalFrontPageStoryIds(html).slice(0, FETCH_LIMITS.topStories);
  if (ids.length === 0) throw new Error(`No historical HN front-page stories found for ${date}`);
  const items = await fetchStories(ids);

  return {
    date,
    fetchedAt: new Date().toISOString(),
    samplingMethod: "historical_frontpage_title_snapshot",
    source: "hn_front_html_firebase",
    items,
  };
}
