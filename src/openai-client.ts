import { promises as fs } from "node:fs";
import path from "node:path";
import { MODEL_CONFIG } from "./config.js";

const OPENAI_BASE = "https://api.openai.com/v1";

type OpenAiBatch = {
  id: string;
  status: string;
  input_file_id: string;
  output_file_id?: string;
  error_file_id?: string;
  errors?: unknown;
  created_at?: number;
  completed_at?: number;
};

type BatchLine = {
  custom_id: string;
  response?: {
    status_code: number;
    body: unknown;
  };
  error?: unknown;
};

function apiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is required.");
  return key;
}

async function openAiFetch<T>(pathName: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${OPENAI_BASE}${pathName}`, {
    ...init,
    headers: {
      authorization: `Bearer ${apiKey()}`,
      ...(init.body instanceof FormData ? {} : { "content-type": "application/json" }),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI ${pathName} failed with ${response.status}: ${body}`);
  }
  return (await response.json()) as T;
}

export async function uploadBatchFile(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  const form = new FormData();
  form.append("purpose", "batch");
  form.append("file", new Blob([content], { type: "application/jsonl" }), path.basename(filePath));
  const result = await openAiFetch<{ id: string }>("/files", {
    method: "POST",
    body: form,
  });
  return result.id;
}

export async function createBatch(inputFileId: string, metadata: Record<string, string>): Promise<OpenAiBatch> {
  return openAiFetch<OpenAiBatch>("/batches", {
    method: "POST",
    body: JSON.stringify({
      input_file_id: inputFileId,
      endpoint: "/v1/responses",
      completion_window: "24h",
      metadata,
    }),
  });
}

export async function getBatch(batchId: string): Promise<OpenAiBatch> {
  return openAiFetch<OpenAiBatch>(`/batches/${batchId}`);
}

export async function downloadFile(fileId: string): Promise<string> {
  const response = await fetch(`${OPENAI_BASE}/files/${fileId}/content`, {
    headers: { authorization: `Bearer ${apiKey()}` },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI file download failed with ${response.status}: ${body}`);
  }
  return response.text();
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

export function parseBatchOutput(content: string): Array<{ customId: string; text: string; raw: BatchLine }> {
  return content
    .split(/\n+/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as BatchLine)
    .map((line) => {
      if (line.error) throw new Error(`Batch row ${line.custom_id} failed: ${JSON.stringify(line.error)}`);
      if (!line.response || line.response.status_code >= 400) {
        throw new Error(`Batch row ${line.custom_id} returned ${line.response?.status_code ?? "no response"}`);
      }
      return {
        customId: line.custom_id,
        text: extractResponseText(line.response.body),
        raw: line,
      };
    });
}

export async function createResponse(input: unknown, textFormat: unknown): Promise<string> {
  const response = await openAiFetch<unknown>("/responses", {
    method: "POST",
    body: JSON.stringify({
      model: MODEL_CONFIG.adjudication.model,
      reasoning: { effort: MODEL_CONFIG.adjudication.reasoningEffort },
      input,
      text: { format: textFormat },
      max_output_tokens: 2200,
    }),
  });
  return extractResponseText(response);
}
