/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * Isolated Gemini client.
 *
 * Deliberately free of Express types and of module-level mutable state, so the
 * entire request/response cycle can be exercised in a test by injecting
 * `fetchImpl` instead of reaching the network. `server.ts` owns configuration
 * (environment variables), rate limiting and HTTP status mapping; this module
 * owns talking to Gemini and classifying what came back.
 */

/** Model used when the caller does not supply one. */
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

/** How long to wait for Gemini before giving up on a request. */
export const DEFAULT_TIMEOUT_MS = 15_000;

/** The subset of the `generateContent` response this app relies on. */
export type GeminiResponse = {
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string }> };
  }>;
};

/**
 * How a call failed. `httpStatus` on the failure result is the HTTP code the
 * route should surface for that kind, so the mapping lives with the classification.
 */
export type GeminiFailureKind = 'busy' | 'timeout' | 'empty' | 'upstream' | 'transport';

/**
 * A discriminated result. `outcome` is a string literal rather than a boolean
 * because this project compiles without `strictNullChecks`, where truthiness
 * checks on a boolean discriminant do not narrow the union.
 */
export type GeminiAnalysisResult =
  | { outcome: 'ok'; text: string }
  | { outcome: 'failed'; kind: GeminiFailureKind; httpStatus: number; detail: string };

export type GeminiAnalysisOptions = {
  /** Dataset schema, allowed operations and output contract. */
  systemPrompt: string;
  /** The user's plain-English question. */
  question: string;
  apiKey: string;
  /** Falls back to `DEFAULT_GEMINI_MODEL` when omitted or undefined. */
  model?: string;
  /** Falls back to `DEFAULT_TIMEOUT_MS` when omitted or undefined. */
  timeoutMs?: number;
  /** Injected for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
};

/** Build the generateContent endpoint for a model. */
export const buildEndpoint = (model: string): string =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

/** The exact request body sent upstream. Exported so tests can assert on it. */
export const buildRequestBody = (systemPrompt: string, question: string) => ({
  systemInstruction: { parts: [{ text: systemPrompt }] },
  contents: [{ role: 'user', parts: [{ text: question }] }],
  generationConfig: {
    responseMimeType: 'application/json',
    temperature: 0
  }
});

/** Join every text part of the first candidate; empty string when there is none. */
export const extractCandidateText = (payload: GeminiResponse): string =>
  payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';

/** Why the model stopped, for logging when it produced no text. */
export const extractFinishReason = (payload: GeminiResponse): string =>
  payload.candidates?.[0]?.finishReason ?? 'unknown';

/** Keep the stack trace for the server log rather than a bare message. */
const describeError = (error: unknown): string =>
  error instanceof Error ? (error.stack ?? error.message) : String(error);

/**
 * Ask Gemini to plan a single analysis operation.
 *
 * Never throws. Every failure is returned as a discriminated result carrying
 * the HTTP status the caller should surface plus a `detail` string intended for
 * the server log only — the client must never receive it verbatim.
 */
export const requestAnalysisOperation = async (
  options: GeminiAnalysisOptions
): Promise<GeminiAnalysisResult> => {
  const {
    systemPrompt,
    question,
    apiKey,
    model = DEFAULT_GEMINI_MODEL,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = fetch
  } = options;

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

  try {
    const upstream = await fetchImpl(buildEndpoint(model), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify(buildRequestBody(systemPrompt, question)),
      signal: abortController.signal
    });

    if (!upstream.ok) {
      const body = await upstream.text().catch(() => '');

      if (upstream.status === 429) {
        return {
          outcome: 'failed',
          kind: 'busy',
          httpStatus: 429,
          detail: `Gemini returned 429: ${body}`
        };
      }

      return {
        outcome: 'failed',
        kind: 'upstream',
        httpStatus: 502,
        detail: `Gemini returned ${upstream.status}: ${body}`
      };
    }

    const payload = (await upstream.json()) as GeminiResponse;
    const text = extractCandidateText(payload);

    if (!text) {
      return {
        outcome: 'failed',
        kind: 'empty',
        httpStatus: 502,
        detail: `Gemini returned no text. finishReason=${extractFinishReason(payload)}`
      };
    }

    return { outcome: 'ok', text };
  } catch (error) {
    if (abortController.signal.aborted) {
      return {
        outcome: 'failed',
        kind: 'timeout',
        httpStatus: 504,
        detail: `Gemini request timed out after ${timeoutMs}ms.`
      };
    }

    return {
      outcome: 'failed',
      kind: 'transport',
      httpStatus: 502,
      detail: `Gemini request failed: ${describeError(error)}`
    };
  } finally {
    clearTimeout(timeoutId);
  }
};
