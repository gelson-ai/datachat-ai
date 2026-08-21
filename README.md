<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# DataChat AI

## Run Locally

**Prerequisites:** Node.js 22 or later and an OpenAI API key.

1. Install dependencies:
   `npm install`
2. Create `.env.local` from `.env.example` and set `OPENAI_API_KEY` to your OpenAI API key. Keep this file out of source control.
3. Run the web app and local API server:
   `npm run dev`
4. Open `http://localhost:5173`.

The browser calls the local API server through Vite's `/api` proxy. Your OpenAI API key remains on the server and is never stored in browser storage.
