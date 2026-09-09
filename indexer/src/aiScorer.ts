/**
 * AI-powered per-transaction scorer using Google Gemini.
 *
 * Calls the Gemini API to estimate the raw credit-worthiness delta for a
 * single DeFi event.  The result feeds an unbounded rawScore accumulator which
 * is then squashed into a 300–850 display score via tanh (see scoreModel.ts).
 *
 * Design notes:
 *   - CIRCUIT_BREAKER (±1000) is a safety clamp only — it should never be
 *     reached under normal operation.  If you see values routinely hitting it,
 *     revisit the prompt, not K.
 *   - temperature: 0 ensures deterministic output for the same event.
 *   - On any parse/network error the function falls back to a flat
 *     POINTS_BY_EVENT value so scoring never silently drops.
 */

import { GoogleGenAI } from "@google/genai";
import { POINTS_BY_EVENT } from "./config.js";

// Initialised lazily so the module can be imported in test environments
// that don't have GEMINI_API_KEY set; the client is only created when
// scoreWithAI() is first called.
let _genai: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!_genai) _genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  return _genai;
}

const MODEL = "gemini-2.5-flash";

/** Maximum absolute rawDelta the AI is allowed to emit — circuit breaker only. */
const CIRCUIT_BREAKER = 1000;

export interface AiScoreResult {
  importance: number;   // 1–10
  reasoning: string;    // one-sentence explanation, ≤300 chars
  rawDelta: number;     // signed, unbounded accumulator delta
}

export async function scoreWithAI(event: {
  eventName: string;
  protocol: string;
  symbol: string;
  humanAmount: string;
}): Promise<AiScoreResult> {
  const prompt = `Estimate the RAW impact this transaction should have on a wallet's \
credit-worthiness accumulator. This is NOT the final score — it feeds an unbounded \
running total that later gets compressed into a 300-850 score via tanh, so don't \
self-limit to a small range.

Transaction: ${event.eventName} of ${event.humanAmount} ${event.symbol} on ${event.protocol}

Respond with ONLY JSON, no other text:
{"importance": <integer 1-10>, "reasoning": "<one sentence, under 200 chars>", "raw_delta": <signed number>}`;

  try {
    const response = await getClient().models.generateContent({
      model: MODEL,
      contents: prompt,
      config: { temperature: 0, maxOutputTokens: 300 },
    });

    const text = response.text ?? "";
    // Strip markdown code fences if the model wraps the JSON in ```json ... ```
    const cleaned = text.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    const parsed = JSON.parse(cleaned);

    const rawDelta = Math.max(
      -CIRCUIT_BREAKER,
      Math.min(CIRCUIT_BREAKER, Number(parsed.raw_delta)),
    );
    const importance = Math.max(1, Math.min(10, Math.round(Number(parsed.importance))));

    if (!Number.isFinite(rawDelta) || !Number.isFinite(importance)) {
      throw new Error("non-numeric AI output");
    }

    return {
      importance,
      reasoning: String(parsed.reasoning ?? "").slice(0, 300),
      rawDelta,
    };
  } catch (err) {
    console.error("[aiScorer] falling back to flat points:", err);
    return {
      importance: 5,
      reasoning: "fallback: AI scoring unavailable",
      rawDelta: POINTS_BY_EVENT[event.eventName] ?? 0,
    };
  }
}
