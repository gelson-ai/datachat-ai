/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type ColumnType = 'number' | 'string';

/**
 * The complete, fixed set of analysis operations the client-side interpreter
 * understands. Nothing outside this list is ever executed.
 */
export type AnalysisOperationName = 'sum' | 'average' | 'count' | 'filter' | 'groupBy';

/**
 * A small, declarative description of the analysis to run. The model returns
 * this shape instead of executable JavaScript, and `runOperation` interprets it
 * against the dataset rows.
 */
export interface AnalysisOperation {
  operation: AnalysisOperationName;
  /** Column to analyse / group by. Optional for a whole-dataset `count`. */
  column?: string;
  /** Value to match for the `filter` operation. */
  filterValue?: string;
}

export type RowValue = string | number | boolean | null;

export interface Row {
  [key: string]: RowValue;
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
