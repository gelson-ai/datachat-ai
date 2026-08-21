# Bug Inspection Record

Diagnostic prompt used:

> Inspect app issues across all sources: VS Code terminal output, Browser DevTools Console, and Browser DevTools Network tab. Capture your first 3 errors and complete all required steps.

## 1. Vite default port unavailable

- **Error:** `Port 3000 is in use, trying another one...`
- **Source:** Terminal
- **Root Cause:** Another process already listens on port `3000`.
- **Prompt Used:** Diagnostic prompt above.
- **Fix Applied:** The web app now uses dedicated port `5173` with `strictPort` enabled, so it never silently changes ports. The API server uses localhost-only port `3001`.
- **Status:** Resolved. Verified on `http://localhost:5173`.

## 2. OpenAI request blocked by CORS

- **Error:** `Access to fetch at 'https://api.openai.com/v1/chat/completions' from origin 'http://localhost:3001' has been blocked by CORS policy.`
- **Source:** Browser DevTools Console
- **Root Cause:** [src/App.tsx](src/App.tsx) sent the OpenAI request directly from the browser. OpenAI does not allow this client-side cross-origin request.
- **Prompt Used:** Diagnostic prompt above.
- **Fix Applied:** Added [server.ts](server.ts), a localhost-only Express endpoint that reads `OPENAI_API_KEY` from `.env.local`. The frontend now calls same-origin `/api/chat` through the Vite proxy, and no longer stores an API key in browser session storage.
- **Status:** Resolved. The browser request path was verified with no CORS failure.

## 3. OpenAI request failed before receiving a response

- **Error:** `POST https://api.openai.com/v1/chat/completions` failed with `net::ERR_FAILED`.
- **Source:** Browser DevTools Network tab
- **Root Cause:** The CORS policy failure above prevented the browser from completing the request, so no HTTP response was available to the app.
- **Prompt Used:** Diagnostic prompt above.
- **Fix Applied:** The browser now makes a same-origin request to `/api/chat`; the local API server performs the OpenAI request. Server failures return an HTTP response with an opaque error reference instead of a browser network failure.
- **Status:** Resolved. The browser receives a normal same-origin HTTP response instead of `net::ERR_FAILED`.

## Validation

`npm run lint` completed successfully with no TypeScript errors. A real OpenAI response requires `OPENAI_API_KEY` in `.env.local`; without it, the local API intentionally returns an opaque `503` response.