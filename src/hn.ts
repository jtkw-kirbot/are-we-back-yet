import { BACKFILL_TERMS, FETCH_LIMITS } from "./config.js";
import { utcDateRange } from "./time.js";
import { type HnItem, type RawDay } from "./types.js";

const FIREBASE_BASE = "https://hacker-news.firebaseio.com/v0";
const ALGOLIA_BASE = "https://hn.algolia.com/api/v1";

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

type AlgoliaHit = {
  objectID: string;
  title?: string;
  url?: string;
  author?: string;
  points?: number;
  num_comments?: number;
  created_at_i?: number;
  story_id?: number;
};

type AlgoliaItem = {
  id: number;
  type?: string;
  author?: string;
  created_at_i?: number;
  title?: string;
  url?: string;
  text?: string;
  points?: number;
  children?: AlgoliaItem[];
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
  by?: string | undefined;
  time?: number | undefined;
  title?: string | undefined;
  url?: string | undefined;
  text?: string | undefined;
  score?: number | undefined;
  descendants?: number | undefined;
  depth: number;
  parentId?: number | undefined;
  storyId: number;
  storyTitle: string;
  storyUrl?: string | undefined;
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
    if (input[key] !== undefined) item[key] = input[key];
  }
  return item as HnItem;
}

async function getFirebaseItem(id: number): Promise<FirebaseItem | null> {
  return fetchJson<FirebaseItem | null>(`${FIREBASE_BASE}/item/${id}.json`);
}

async function fetchFirebaseThread(
  story: FirebaseItem,
  counters: { storyComments: number; dayComments: number },
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

function algoliaSearchUrl(term: string, start: number, end: number, page: number): string {
  const params = new URLSearchParams({
    query: term,
    tags: "story",
    numericFilters: `created_at_i>=${start},created_at_i<${end}`,
    hitsPerPage: String(FETCH_LIMITS.backfillHitsPerPage),
    page: String(page),
  });
  return `${ALGOLIA_BASE}/search_by_date?${params.toString()}`;
}

async function searchBackfillStories(date: string): Promise<AlgoliaHit[]> {
  const { start, end } = utcDateRange(date);
  const seen = new Set<string>();
  const hits: AlgoliaHit[] = [];

  for (const term of BACKFILL_TERMS) {
    for (let page = 0; page < FETCH_LIMITS.backfillMaxPagesPerTerm; page += 1) {
      const result = await fetchJson<{ hits: AlgoliaHit[]; nbPages: number }>(algoliaSearchUrl(term, start, end, page));
      for (const hit of result.hits) {
        if (seen.has(hit.objectID)) continue;
        seen.add(hit.objectID);
        hits.push(hit);
      }
      if (page + 1 >= result.nbPages) break;
    }
  }

  return hits.sort((a, b) => Number(a.objectID) - Number(b.objectID));
}

async function fetchAlgoliaThread(id: number): Promise<AlgoliaItem> {
  return fetchJson<AlgoliaItem>(`${ALGOLIA_BASE}/items/${id}`);
}

function normalizeAlgoliaThread(root: AlgoliaItem, counters: { storyComments: number; dayComments: number }): HnItem[] {
  const storyTitle = root.title ?? `HN item ${root.id}`;
  const storyUrl = root.url;
  const items: HnItem[] = [
    compactItem({
      id: root.id,
      type: root.type ?? "story",
      by: root.author,
      time: root.created_at_i,
      title: root.title,
      url: root.url,
      text: root.text ? decodeEntities(root.text) : undefined,
      score: root.points,
      depth: 0,
      storyId: root.id,
      storyTitle,
      storyUrl,
    }),
  ];

  function visit(item: AlgoliaItem, depth: number, parentId: number): void {
    if (depth > FETCH_LIMITS.maxDepth) return;
    if (counters.storyComments >= FETCH_LIMITS.maxCommentsPerStory) return;
    if (counters.dayComments >= FETCH_LIMITS.maxCommentsPerDay) return;
    if (item.type !== "comment") return;

    counters.storyComments += 1;
    counters.dayComments += 1;
    items.push(compactItem({
      id: item.id,
      type: "comment",
      by: item.author,
      time: item.created_at_i,
      text: item.text ? decodeEntities(item.text) : undefined,
      depth,
      parentId,
      storyId: root.id,
      storyTitle,
      storyUrl,
    }));

    for (const child of item.children ?? []) {
      visit(child, depth + 1, item.id);
    }
  }

  for (const child of root.children ?? []) {
    visit(child, 1, root.id);
  }

  return items;
}

export async function backfillDate(date: string): Promise<RawDay> {
  const hits = await searchBackfillStories(date);
  const items: HnItem[] = [];
  const counters = { dayComments: 0 };

  for (const hit of hits) {
    const id = Number(hit.objectID);
    if (!Number.isFinite(id)) continue;
    try {
      const thread = await fetchAlgoliaThread(id);
      const localCounters = { storyComments: 0, dayComments: counters.dayComments };
      items.push(...normalizeAlgoliaThread(thread, localCounters));
      counters.dayComments = localCounters.dayComments;
    } catch {
      const story = await getFirebaseItem(id);
      if (!story) continue;
      const localCounters = { storyComments: 0, dayComments: counters.dayComments };
      const thread = await fetchFirebaseThread(story, localCounters);
      counters.dayComments = localCounters.dayComments;
      items.push(...thread);
    }
    if (counters.dayComments >= FETCH_LIMITS.maxCommentsPerDay) break;
  }

  const unique = new Map<number, HnItem>();
  for (const item of items) unique.set(item.id, item);

  return {
    date,
    fetchedAt: new Date().toISOString(),
    samplingMethod: "algolia_date_search",
    source: "algolia",
    items: [...unique.values()].sort((a, b) => a.id - b.id),
  };
}
