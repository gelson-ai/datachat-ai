import crypto from 'node:crypto';
import { config } from 'dotenv';
import express, { type Request, type Response } from 'express';

config({ path: '.env.local' });

const app = express();
const port = 3001;

/** How long to wait for OpenAI before giving up on the request. */
const UPSTREAM_TIMEOUT_MS = 15_000;

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

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    response.status(503).json({ error: 'The analysis service is unavailable. Please try again.' });
    return;
  }

  const errorId = crypto.randomUUID();
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: question },
        ],
        response_format: { type: 'json_object' },
      }),
      signal: abortController.signal,
    });

    if (!upstream.ok) {
      console.error(`[${errorId}] OpenAI returned ${upstream.status}: ${await upstream.text()}`);
      response.status(502).json({ error: `The analysis service is unavailable. Reference: ${errorId}` });
      return;
    }

    response.json(await upstream.json());
  } catch (error) {
    if (abortController.signal.aborted) {
      console.error(`[${errorId}] OpenAI request timed out after ${UPSTREAM_TIMEOUT_MS}ms.`);
      response.status(504).json({ error: `The analysis service timed out. Reference: ${errorId}` });
      return;
    }

    console.error(`[${errorId}] OpenAI request failed:`, error);
    response.status(502).json({ error: `The analysis service is unavailable. Reference: ${errorId}` });
  } finally {
    clearTimeout(timeoutId);
  }
});

app.listen(port, '127.0.0.1', () => {
  console.log(`API server listening on http://127.0.0.1:${port}`);
});