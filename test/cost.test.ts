import { describe, expect, it } from "vitest";
import { calculateRunCost } from "../src/cost.js";
import type { RunFile } from "../src/types.js";

describe("cost calculation", () => {
  it("uses uncached, cached, and output token rates by stage", () => {
    const run: RunFile = {
      date: "2026-04-20",
      samplingMethod: "historical_frontpage_snapshot",
      state: "complete",
      createdAt: "2026-04-20T00:00:00.000Z",
      updatedAt: "2026-04-20T00:00:00.000Z",
      responses: {
        entity: {
          processedCount: 1,
          successCount: 1,
          quarantineCount: 0,
          inputTokens: 1_000_000,
          cachedInputTokens: 200_000,
          outputTokens: 100_000,
          totalTokens: 1_100_000,
        },
        adjudication: {
          processedCount: 1,
          successCount: 1,
          quarantineCount: 0,
          inputTokens: 10_000,
          cachedInputTokens: 0,
          outputTokens: 1_000,
          totalTokens: 11_000,
        },
      },
    };

    const cost = calculateRunCost(run);

    expect(cost.stages.find((stage) => stage.stage === "entity")?.standardUsd).toBeCloseTo(1.065);
    expect(cost.stages.find((stage) => stage.stage === "adjudication")?.standardUsd).toBeCloseTo(0.04);
    expect(cost.batchEstimateUsd).toBeCloseTo(cost.standardUsd * 0.5);
  });
});
