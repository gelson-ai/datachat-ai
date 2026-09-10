/// <reference lib="webworker" />
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CSV parsing worker. PapaParse reads the uploaded File in chunked mode
 * (1 MB at a time) inside this worker, so neither the byte-level read nor the
 * parsing work ever blocks the main thread. Progress is derived from
 * PapaParse's cursor, which reports how far through the file it has read.
 */

import Papa from 'papaparse';

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

/** Size of each chunk handed to PapaParse, in bytes. */
const CHUNK_SIZE_BYTES = 1024 * 1024;

/** Never report more than this until PapaParse has actually finished. */
const MAX_IN_PROGRESS = 99;

export interface CsvWorkerRequest {
  file: File;
}

export type CsvWorkerResponse =
  | { type: 'progress'; progress: number }
  | { type: 'complete'; headers: string[]; rows: Record<string, unknown>[] }
  | { type: 'error'; message: string };

const post = (message: CsvWorkerResponse): void => {
  workerScope.postMessage(message);
};

workerScope.onmessage = (event: MessageEvent<CsvWorkerRequest>) => {
  const file = event.data?.file;

  if (!file) {
    post({ type: 'error', message: 'No file was received by the parser worker.' });
    return;
  }

  const rows: Record<string, unknown>[] = [];
  const headers: string[] = [];
  const seenHeaders = new Set<string>();
  let lastProgress = 0;

  Papa.parse<Record<string, unknown>>(file, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: 'greedy',
    chunkSize: CHUNK_SIZE_BYTES,
    chunk: (results) => {
      for (const row of results.data) {
        rows.push(row);
        for (const key of Object.keys(row)) {
          if (!seenHeaders.has(key)) {
            seenHeaders.add(key);
            headers.push(key);
          }
        }
      }

      if (file.size > 0) {
        const cursor = typeof results.meta.cursor === 'number' ? results.meta.cursor : 0;
        const progress = Math.min(MAX_IN_PROGRESS, Math.round((cursor / file.size) * 100));
        if (progress > lastProgress) {
          lastProgress = progress;
          post({ type: 'progress', progress });
        }
      }
    },
    complete: () => {
      post({ type: 'complete', headers, rows });
    },
    error: (error) => {
      post({ type: 'error', message: error.message });
    },
  });
};
