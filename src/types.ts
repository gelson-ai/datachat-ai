/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type ColumnType = 'number' | 'string';

export interface Row {
  [key: string]: string | number | boolean | null;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  code?: string;
  error?: string;
  timestamp: Date;
}

export interface DatasetInfo {
  filename: string;
  headers: string[];
  types: Record<string, ColumnType>;
  rows: Row[];
  totalRows: number;
}
