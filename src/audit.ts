import { DETERMINISTIC_AUDIT_ALIASES, TARGETS } from "./config.js";
import type { Evidence, RawDay, Target } from "./types.js";

export type AuditHit = {
  target: Target;
  storyId: number;
  commentId?: number;
  sourceType: "title" | "comment";
  alias: string;
};

export type DeterministicAuditResult = {
  hits: AuditHit[];
  missed: AuditHit[];
};

function compilePatterns(): Array<{ target: Target; pattern: RegExp; alias: string }> {
  return TARGETS.flatMap((target) => (
    DETERMINISTIC_AUDIT_ALIASES[target].map((alias) => ({
      target,
      alias,
      pattern: new RegExp(alias, "i"),
    }))
  ));
}

const PATTERNS = compilePatterns();

function uniqueHits(hits: AuditHit[]): AuditHit[] {
  const seen = new Set<string>();
  const out: AuditHit[] = [];
  for (const hit of hits) {
    const key = `${hit.target}:${hit.sourceType}:${hit.storyId}:${hit.commentId ?? ""}:${hit.alias}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
  }
  return out;
}

function isCovered(hit: AuditHit, evidence: Evidence[]): boolean {
  return evidence.some((item) => (
    item.storyId === hit.storyId &&
    item.sourceType === hit.sourceType &&
    (hit.sourceType === "title" || item.commentId === hit.commentId) &&
    item.annotations.some((annotation) => annotation.target === hit.target)
  ));
}

export function runDeterministicAudit(day: RawDay, evidence: Evidence[]): DeterministicAuditResult {
  const hits: AuditHit[] = [];
  for (const story of day.items) {
    for (const pattern of PATTERNS) {
      if (pattern.pattern.test(story.title)) {
        hits.push({
          target: pattern.target,
          storyId: story.id,
          sourceType: "title",
          alias: pattern.alias,
        });
      }
    }
    for (const comment of story.topComments) {
      for (const pattern of PATTERNS) {
        if (pattern.pattern.test(comment.text)) {
          hits.push({
            target: pattern.target,
            storyId: story.id,
            commentId: comment.id,
            sourceType: "comment",
            alias: pattern.alias,
          });
        }
      }
    }
  }

  const unique = uniqueHits(hits);
  return {
    hits: unique,
    missed: unique.filter((hit) => !isCovered(hit, evidence)),
  };
}
