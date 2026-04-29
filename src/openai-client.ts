const OPENAI_BASE = "https://api.openai.com/v1";

export type OpenAiUsage = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
};

export type OpenAiResponseResult = {
  id: string | undefined;
  status: string | undefined;
  incompleteReason: string | undefined;
  text: string;
  usage: OpenAiUsage | undefined;
  raw: unknown;
};

export class OpenAiStatusError extends Error {
  readonly status: number;
  readonly body: string;
  readonly retryAfter: number | undefined;

  constructor(pathName: string, status: number, body: string, retryAfter?: number) {
    super(`OpenAI ${pathName} failed with ${status}: ${body}`);
    this.status = status;
    this.body = body;
    this.retryAfter = retryAfter;
  }
}

function apiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is required.");
  return key;
}

function retryAfterSeconds(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) return Math.max(0, Math.ceil((dateMs - Date.now()) / 1000));
  return undefined;
}

async function openAiFetch<T>(pathName: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${OPENAI_BASE}${pathName}`, {
    ...init,
    headers: {
      authorization: `Bearer ${apiKey()}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new OpenAiStatusError(pathName, response.status, body, retryAfterSeconds(response.headers.get("retry-after")));
  }
  return (await response.json()) as T;
}

export function extractResponseText(body: unknown): string {
  if (typeof body !== "object" || body === null) return "";
  const maybe = body as Record<string, unknown>;
  if (typeof maybe.output_text === "string") return maybe.output_text;
  const output = maybe.output;
  if (!Array.isArray(output)) return "";
  const chunks: string[] = [];
  for (const entry of output) {
    if (typeof entry !== "object" || entry === null) continue;
    const content = (entry as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (typeof part !== "object" || part === null) continue;
      const record = part as Record<string, unknown>;
      if (typeof record.text === "string") chunks.push(record.text);
      if (typeof record.output_text === "string") chunks.push(record.output_text);
    }
  }
  return chunks.join("\n");
}

export async function createResponse(body: unknown): Promise<OpenAiResponseResult> {
  const response = await openAiFetch<unknown>("/responses", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const record = typeof response === "object" && response !== null ? response as Record<string, unknown> : {};
  const incompleteDetails = typeof record.incomplete_details === "object" && record.incomplete_details !== null
    ? record.incomplete_details as Record<string, unknown>
    : {};
  return {
    id: typeof record.id === "string" ? record.id : undefined,
    status: typeof record.status === "string" ? record.status : undefined,
    incompleteReason: typeof incompleteDetails.reason === "string" ? incompleteDetails.reason : undefined,
    text: extractResponseText(response),
    usage: typeof record.usage === "object" && record.usage !== null ? record.usage as OpenAiUsage : undefined,
    raw: response,
  };
}
