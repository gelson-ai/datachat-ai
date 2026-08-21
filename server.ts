import crypto from 'node:crypto';
import { config } from 'dotenv';
import express, { type Request, type Response } from 'express';

config({ path: '.env.local' });

const app = express();
const port = 3001;

app.use(express.json({ limit: '256kb' }));

app.post('/api/chat', async (request: Request, response: Response) => {
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
    });

    if (!upstream.ok) {
      console.error(`[${errorId}] OpenAI returned ${upstream.status}: ${await upstream.text()}`);
      response.status(502).json({ error: `The analysis service is unavailable. Reference: ${errorId}` });
      return;
    }

    response.json(await upstream.json());
  } catch (error) {
    console.error(`[${errorId}] OpenAI request failed:`, error);
    response.status(502).json({ error: `The analysis service is unavailable. Reference: ${errorId}` });
  }
});

app.listen(port, '127.0.0.1', () => {
  console.log(`API server listening on http://127.0.0.1:${port}`);
});