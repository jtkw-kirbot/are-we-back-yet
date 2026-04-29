import { FETCH_LIMITS, RAW_SOURCE, SAMPLING_METHOD } from "./config.js";
import { endOfLocalDateUnixSeconds } from "./time.js";
import { type HnComment, type HnItem, type RawDay } from "./types.js";

const FIREBASE_BASE = "https://hacker-news.firebaseio.com/v0";
const MAX_HN_FETCH_ATTEMPTS = 5;

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
  deleted?: boolean;
  dead?: boolean;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return undefined;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

async function fetchWithRetry(url: string): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_HN_FETCH_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { "user-agent": "are-we-back-yet/0.1" },
      });
    } catch (error) {
      lastError = error;
      if (attempt === MAX_HN_FETCH_ATTEMPTS) break;
      await sleep(2 ** attempt * 1000);
      continue;
    }
    if (response.ok) return response;
    if (!isRetryableStatus(response.status) || attempt === MAX_HN_FETCH_ATTEMPTS) {
      throw new Error(`GET ${url} failed with ${response.status}`);
    }
    await sleep(retryAfterMs(response.headers.get("retry-after")) ?? 2 ** attempt * 1000);
  }
  throw lastError instanceof Error ? lastError : new Error(`GET ${url} failed`);
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetchWithRetry(url);
  return (await response.json()) as T;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetchWithRetry(url);
  return response.text();
}

export function historicalFetchDelayMs(date: string): number {
  const match = date.match(/-(\d{2})$/);
  const day = match?.[1] ? Number(match[1]) : 0;
  return Number.isFinite(day) ? (day % 10) * 350 : 0;
}

async function fetchHistoricalFrontPageHtml(date: string): Promise<string> {
  await sleep(historicalFetchDelayMs(date));
  return fetchText(`https://news.ycombinator.com/front?day=${encodeURIComponent(date)}`);
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

async function getFirebaseItem(id: number): Promise<FirebaseItem | null> {
  return fetchJson<FirebaseItem | null>(`${FIREBASE_BASE}/item/${id}.json`);
}

function compactComment(comment: FirebaseItem): HnComment | undefined {
  if (!comment.id || comment.deleted || comment.dead || !comment.text) return undefined;
  const item: Record<string, unknown> = {
    id: comment.id,
    text: decodeEntities(comment.text),
    sourceUrl: hnUrl(comment.id),
  };
  for (const key of ["by", "time"] as const) {
    if (comment[key] !== undefined) item[key] = comment[key];
  }
  return item as HnComment;
}

async function fetchTopComments(
  story: FirebaseItem,
  options: { commentCutoffUnixSeconds?: number } = {},
): Promise<HnComment[]> {
  const comments: HnComment[] = [];
  for (const id of story.kids ?? []) {
    if (comments.length >= FETCH_LIMITS.topCommentsPerStory) break;
    const comment = await getFirebaseItem(id);
    if (!comment) continue;
    if (options.commentCutoffUnixSeconds !== undefined && comment.time !== undefined && comment.time > options.commentCutoffUnixSeconds) {
      continue;
    }
    const compact = compactComment(comment);
    if (compact) comments.push(compact);
  }
  return comments;
}

async function compactStory(
  story: FirebaseItem,
  rank: number,
  options: { commentCutoffUnixSeconds?: number } = {},
): Promise<HnItem | undefined> {
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
    topComments: await fetchTopComments(story, options),
  };
  for (const key of ["by", "time", "url", "score", "descendants"] as const) {
    if (story[key] !== undefined) item[key] = story[key];
  }
  if (story.url !== undefined) item.storyUrl = story.url;
  return item as HnItem;
}

async function fetchStories(ids: number[], options: { commentCutoffUnixSeconds?: number } = {}): Promise<HnItem[]> {
  const items: HnItem[] = [];
  for (const [index, id] of ids.entries()) {
    const story = await getFirebaseItem(id);
    if (!story) continue;
    const item = await compactStory(story, index + 1, options);
    if (item) items.push(item);
  }
  return items;
}

export async function fetchFrontPageStoryIdsForDate(date: string): Promise<number[]> {
  const html = await fetchHistoricalFrontPageHtml(date);
  return parseHistoricalFrontPageStoryIds(html).slice(0, FETCH_LIMITS.topStories);
}

export async function fetchFrontPageForDate(date: string, options: { allowEmpty?: boolean } = {}): Promise<RawDay> {
  const ids = await fetchFrontPageStoryIdsForDate(date);
  if (ids.length === 0 && !options.allowEmpty) {
    throw new Error(`No HN front-page stories found for ${date}`);
  }
  const items = await fetchStories(ids, { commentCutoffUnixSeconds: endOfLocalDateUnixSeconds(date) });

  return {
    date,
    fetchedAt: new Date().toISOString(),
    samplingMethod: SAMPLING_METHOD,
    source: RAW_SOURCE,
    items,
  };
}

export async function fetchFrontPage(date: string): Promise<RawDay> {
  return fetchFrontPageForDate(date);
}

export async function fetchHistoricalFrontPage(date: string): Promise<RawDay> {
  return fetchFrontPageForDate(date);
}
