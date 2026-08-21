# DataChat AI

DataChat AI is a single-page web app that lets you upload a CSV file and ask natural-language questions about it. The app parses and previews the data in the browser, then sends your question (with the relevant dataset context) through a lightweight local API server to the OpenAI API and displays the answer. It's a self-contained prototype for exploring how conversational interfaces can make datasets easier to understand.

## Features

- Drag-and-drop CSV upload with automatic column-type detection and a data preview.
- Natural-language questions answered by the OpenAI API (`gpt-4o-mini`).
- Your API key stays on the server — it is never sent to or stored in the browser.

## Setup

**Prerequisites:** Node.js 22 or later, npm, and an OpenAI API key.

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a `.env.local` file in the project root and add your OpenAI API key:

   ```bash
   OPENAI_API_KEY=sk-your-key-here
   ```

   Keep `.env.local` out of source control. An example template is available in `.env.example`.

## Run locally

Start the web app and the local API server together:

```bash
npm run dev
```

Then open `http://localhost:5173`.

- The Vite dev server serves the app on port `5173`.
- A local Express API server listens on `127.0.0.1:3001` and forwards requests to the OpenAI API.

## Status & scope

- Single-page prototype built as part of a training exercise.
- Frontend and API server are separate, but both start with a single `npm run dev` command.
- CORS issues are avoided by routing all API calls through Vite's `/api` proxy, so the OpenAI key never leaves the server.
