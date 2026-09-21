import crypto from 'node:crypto';
import { config } from 'dotenv';
import express, { type Request, type Response } from 'express';
import { requestAnalysisOperation } from './geminiClient.ts';

config({ path: '.env.local' });

const app = express();
const port = 3001;

/** Basic rate limit applied across this process. */
const RATE_LIMIT_MAX_REQUESTS = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

let rateLimitCount = 0;
let rateLimitWindowStartedAt = Date.now();

/**
 * Fixed-window counter over the whole process. Returns 0 when the request is
 * allowed, otherwise the number of milliseconds until the window resets.
 */
const checkRateLimit = (): number => {
  const now = Date.now();

  if (now - rateLimitWindowStartedAt >= RATE_LIMIT_WINDOW_MS) {
    rateLimitWindowStartedAt = now;
    rateLimitCount = 0;
  }

  rateLimitCount += 1;

  if (rateLimitCount <= RATE_LIMIT_MAX_REQUESTS) {
    return 0;
  }

  return RATE_LIMIT_WINDOW_MS - (now - rateLimitWindowStartedAt);
};

app.use(express.json({ limit: '256kb' }));

app.post('/api/chat', async (request: Request, response: Response) => {
  const retryAfterMs = checkRateLimit();
  if (retryAfterMs > 0) {
    const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
    console.warn(`Rate limit reached (${RATE_LIMIT_MAX_REQUESTS} requests/minute) — rejecting request.`);
    response.set('Retry-After', String(retryAfterSeconds));
    response.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
    return;
  }

  const { systemPrompt, question } = request.body ?? {};

  if (typeof systemPrompt !== 'string' || typeof question !== 'string' || !systemPrompt || !question) {
    response.status(400).json({ error: 'Invalid analysis request.' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    response.status(503).json({ error: 'The analysis service is unavailable. Please try again.' });
    return;
  }

  const errorId = crypto.randomUUID();

  const result = await requestAnalysisOperation({
    systemPrompt,
    question,
    apiKey,
    // Left undefined when unset so the client falls back to its own default.
    model: process.env.GEMINI_MODEL,
  });

  if (result.outcome === 'failed') {
    // The full diagnostic stays in the server log; the browser only sees the reference id.
    console.error(`[${errorId}] ${result.detail}`);

    const message =
      result.kind === 'busy'
        ? 'The analysis service is busy. Please wait a moment and try again.'
        : result.kind === 'timeout'
          ? 'The analysis service timed out.'
          : 'The analysis service is unavailable.';

    response.status(result.httpStatus).json({ error: `${message} Reference: ${errorId}` });
    return;
  }

  response.json({ text: result.text });
});

app.listen(port, '127.0.0.1', () => {
  console.log(`API server listening on http://127.0.0.1:${port}`);
});