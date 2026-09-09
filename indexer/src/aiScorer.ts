/**
 * AI-powered per-transaction scorer using Google Gemini.
 *
 * Calls the Gemini API to estimate the raw credit-worthiness delta for one
 * or more DeFi events. The result feeds an unbounded rawScore accumulator
 * which is then squashed into a 300–850 display score via tanh (see
 * scoreModel.ts).
 *
 * Design notes:
 *   - CIRCUIT_BREAKER (±1000) is a safety clamp only — it should never be
 *     reached under normal operation. If you see values routinely hitting it,
 *     revisit the prompt, not K.
 *   - temperature: 0 ensures deterministic output for the same event.
 *   - thinkingConfig: { thinkingBudget: 0 } is intended to disable the
 *     model's default "thinking" mode. Without this, thinking tokens are
 *     deducted from the SAME maxOutputTokens budget as the visible JSON
 *     answer, and can silently consume the whole budget — producing an
 *     empty or truncated response that fails to parse. This was confirmed
 *     behavior on gemini-2.5-flash; NOT yet reverified against the current
 *     MODEL below (gemini-3.5-flash-lite) — if that model rejects or
 *     ignores this field differently, attempt() below auto-retries without
 *     it and logs which one failed, so check logs before assuming this
 *     comment is still accurate.
 *   - On any parse/network error the function falls back to a flat
 *     POINTS_BY_EVENT value so scoring never silently drops.
 */

import { GoogleGenAI } from "@google/genai";
import { POINTS_BY_EVENT } from "./config.js";

// Initialised lazily so the module can be imported in test environments
// that don't have GEMINI_API_KEY set; the client is only created when
// scoreWithAI()/scoreWithAIBatch() is first called.
let _genai: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!_genai) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "[aiScorer] GEMINI_API_KEY is not set. Add it to indexer/.env. " +
        "Get a key at https://aistudio.google.com/apikey"
      );
    }
    // Pass the key explicitly so the SDK never falls back to Application
    // Default Credentials (ADC / gcloud login), which causes invalid_grant errors.
    _genai = new GoogleGenAI({ apiKey });
  }
  return _genai;
}

const MODEL = "gemini-3.5-flash-lite";

/** Maximum absolute rawDelta the AI is allowed to emit — circuit breaker only. */
const CIRCUIT_BREAKER = 1000;

/** Token budget per transaction in a batch call — scales with batch size. */
const TOKENS_PER_TX = 250;

export interface AiScoreResult {
  importance: number;   // 1–10
  reasoning: string;    // one-sentence explanation, ≤300 chars
  rawDelta: number;     // signed, unbounded accumulator delta
}

export interface ScorableEvent {
  eventName: string;
  protocol: string;
  symbol: string;
  humanAmount: string;
}

function fallbackResult(event: ScorableEvent): AiScoreResult {
  console.log(`[aiScorer] Using flat fallback for ${event.eventName}: ${POINTS_BY_EVENT[event.eventName]}`);
  return {
    importance: 5,
    reasoning: "fallback: AI scoring unavailable",
    rawDelta: POINTS_BY_EVENT[event.eventName] ?? 0,
  };
}

function fallbackResultBatch(events: ScorableEvent[]): AiScoreResult[] {
  console.log(`[aiScorer] Using flat fallback for all ${events.length} events`);
  return events.map(fallbackResult);
}

function clampResult(raw: unknown): { rawDelta: number; importance: number; reasoning: string } | null {
  const parsed = raw as { raw_delta?: unknown; importance?: unknown; reasoning?: unknown } | undefined;
  if (!parsed) return null;

  const rawDelta = Math.max(-CIRCUIT_BREAKER, Math.min(CIRCUIT_BREAKER, Number(parsed.raw_delta)));
  const importance = Math.max(1, Math.min(10, Math.round(Number(parsed.importance))));

  if (!Number.isFinite(rawDelta) || !Number.isFinite(importance)) return null;

  return {
    rawDelta,
    importance,
    reasoning: String(parsed.reasoning ?? "").slice(0, 300),
  };
}

/**
 * Pulls every field Google's SDK error object might carry the real reason
 * in — err.message alone is frequently just the generic "Request contains
 * an invalid argument." with no actionable detail.
 */
function describeApiError(err: unknown): string {
  const e = err as any;
  const parts = [
    e?.status !== undefined ? `status=${e.status}` : null,
    e?.message,
    e?.error?.message,
    e?.error?.status,
    e?.error?.details ? `details=${JSON.stringify(e.error.details)}` : null,
    e?.response?.data ? `response=${JSON.stringify(e.response.data)}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" | ") : String(err);
}

/** True for the 400/INVALID_ARGUMENT shape Google returns for malformed
 *  request bodies — as opposed to network errors, auth errors, etc. */
function isInvalidArgument(err: unknown): boolean {
  const e = err as any;
  return e?.status === 400 || e?.error?.status === "INVALID_ARGUMENT";
}

/** Scores a single transaction. Kept for manual/one-off use; the indexer's
 *  hot path uses scoreWithAIBatch via the BatchQueue in store.ts instead. */
export async function scoreWithAI(event: ScorableEvent): Promise<AiScoreResult> {
  const prompt = `Estimate the RAW impact this transaction should have on a wallet's \
credit-worthiness accumulator. This is NOT the final score — it feeds an unbounded \
running total that later gets compressed into a 300-850 score via tanh, so don't \
self-limit to a small range.

Transaction: ${event.eventName} of ${event.humanAmount} ${event.symbol} on ${event.protocol}

Respond with ONLY JSON, no other text:
{"importance": <integer 1-10>, "reasoning": "<one sentence, under 200 chars>", "raw_delta": <signed number>}`;

  const baseConfig = {
    temperature: 0,
    maxOutputTokens: TOKENS_PER_TX,
  };

  const attempt = (withThinkingConfig: boolean) =>
    getClient().models.generateContent({
      model: MODEL,
      contents: prompt,
      config: withThinkingConfig
        ? { ...baseConfig, thinkingConfig: { thinkingBudget: 0 } }
        : baseConfig,
    });

  try {
    let response;
    let usedThinkingConfig = true;
    try {
      response = await attempt(true);
    } catch (err) {
      if (isInvalidArgument(err)) {
        console.error(`[aiScorer] call rejected (${describeApiError(err)}), retrying without thinkingConfig`);
        response = await attempt(false);
        usedThinkingConfig = false;
      } else {
        throw err;
      }
    }

    const text = response.text ?? "";
    const cleaned = text.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    const parsed = JSON.parse(cleaned);

    const clamped = clampResult(parsed);
    if (!clamped) throw new Error("non-numeric AI output");

    console.log(`[aiScorer] AI scoring successful for ${event.eventName} (thinkingConfig=${usedThinkingConfig})`);
    return clamped;
  } catch (err) {
    console.error("[aiScorer] falling back to flat points:", describeApiError(err));
    return fallbackResult(event);
  }
}

/**
 * Scores multiple transactions in a single Gemini call. Results are keyed
 * by index in the response JSON (not a positional array) so a missing or
 * malformed entry only degrades that one transaction, not the whole batch.
 */
export async function scoreWithAIBatch(events: ScorableEvent[]): Promise<AiScoreResult[]> {
  if (events.length === 0) return [];

  const txList = events
    .map((e, i) => `${i}: ${e.eventName} of ${e.humanAmount} ${e.symbol} on ${e.protocol}`)
    .join("\n");

  const prompt = `Estimate the RAW impact each of these ${events.length} transactions should have \
on a wallet's credit-worthiness accumulator. This is NOT the final score — each feeds an \
unbounded running total later compressed via tanh, so don't self-limit to a small range. \
Score each transaction independently, on its own merits, regardless of the others in this list.

Transactions:
${txList}

Respond with ONLY a JSON object mapping each index (as a string) to its result, no other text:
{"0": {"importance": <integer 1-10>, "reasoning": "<one sentence, under 200 chars>", "raw_delta": <signed number>}, "1": {...}, ...}`;

  const baseConfig = {
    temperature: 0,
    maxOutputTokens: TOKENS_PER_TX * events.length,
  };

  const attempt = (withThinkingConfig: boolean) =>
    getClient().models.generateContent({
      model: MODEL,
      contents: prompt,
      config: withThinkingConfig
        ? { ...baseConfig, thinkingConfig: { thinkingBudget: 0 } }
        : baseConfig,
    });

  try {
    let response;
    let usedThinkingConfig = true;
    try {
      response = await attempt(true);
    } catch (err) {
      if (isInvalidArgument(err)) {
        console.error(`[aiScorer] batch call rejected (${describeApiError(err)}), retrying without thinkingConfig`);
        response = await attempt(false);
        usedThinkingConfig = false;
      } else {
        throw err;
      }
    }

    const text = response.text ?? "";
    const cleaned = text.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;

    const results = events.map((event, i) => {
      const clamped = clampResult(parsed[String(i)]);
      if (!clamped) {
        console.error(`[aiScorer] batch entry ${i} missing/invalid, falling back for this item`);
        return fallbackResult(event);
      }
      return clamped;
    });
    
    console.log(`[aiScorer] AI batch scoring successful for ${events.length} events (thinkingConfig=${usedThinkingConfig})`);
    return results;
  } catch (err) {
    console.error("[aiScorer] batch call failed entirely, falling back for all items:", describeApiError(err));
    return fallbackResultBatch(events);
  }
}