/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AnalysisOperation, AnalysisOperationName, DatasetInfo, Row, RowValue } from '../types';

/**
 * The only operations this interpreter will ever execute. The model is asked to
 * return one of these names; anything else is rejected outright.
 */
export const ANALYSIS_OPERATIONS: readonly AnalysisOperationName[] = [
  'sum',
  'average',
  'count',
  'filter',
  'groupBy',
];

/** How many groups we mention before summarising the remainder. */
const MAX_GROUPS_LISTED = 5;

const formatNumber = (value: number): string =>
  value.toLocaleString(undefined, { maximumFractionDigits: 2 });

const isMissing = (value: RowValue | undefined): boolean => {
  if (value === null || value === undefined) return true;
  return typeof value === 'string' && value.trim() === '';
};

/** Pull the finite numeric values out of a column, skipping blanks. */
const numericValues = (rows: Row[], column: string): number[] => {
  const values: number[] = [];

  for (const row of rows) {
    const value = row[column];
    if (typeof value === 'number' && Number.isFinite(value)) {
      values.push(value);
    } else if (typeof value === 'string') {
      const parsed = Number(value.replace(/[^0-9.-]/g, ''));
      if (!isMissing(value) && Number.isFinite(parsed)) {
        values.push(parsed);
      }
    }
  }

  return values;
};

const matchesFilter = (value: RowValue | undefined, filterValue: string): boolean => {
  if (isMissing(value)) return false;

  if (typeof value === 'number') {
    const numericFilter = Number(filterValue);
    return Number.isFinite(numericFilter) && value === numericFilter;
  }

  return String(value).trim().toLowerCase() === filterValue.trim().toLowerCase();
};

/** Resolve a model-supplied column name against the real headers (case-insensitive). */
const resolveColumn = (dataset: DatasetInfo, requested: string | undefined): string => {
  if (requested === undefined || requested === null || String(requested).trim() === '') {
    throw new Error('The analysis request did not specify a column to analyse.');
  }

  const wanted = String(requested).trim().toLowerCase();
  const match = dataset.headers.find((header) => header.trim().toLowerCase() === wanted);

  if (!match) {
    throw new Error(`The column "${requested}" does not exist in this dataset.`);
  }

  return match;
};

const requireNumericColumn = (dataset: DatasetInfo, column: string): void => {
  if (dataset.types[column] !== 'number') {
    throw new Error(`The "${column}" column holds text, so it cannot be analysed numerically.`);
  }
};

const runCount = (operation: AnalysisOperation, dataset: DatasetInfo): string => {
  if (operation.column === undefined || String(operation.column).trim() === '') {
    return `The dataset contains ${formatNumber(dataset.totalRows)} rows.`;
  }

  const column = resolveColumn(dataset, operation.column);
  const populated = dataset.rows.filter((row) => !isMissing(row[column])).length;

  return `The "${column}" column has ${formatNumber(populated)} non-empty values across ${formatNumber(
    dataset.totalRows,
  )} rows.`;
};

const runSum = (operation: AnalysisOperation, dataset: DatasetInfo): string => {
  const column = resolveColumn(dataset, operation.column);
  requireNumericColumn(dataset, column);

  const values = numericValues(dataset.rows, column);
  if (values.length === 0) {
    return `The "${column}" column has no numeric values to add up.`;
  }

  const total = values.reduce((running, value) => running + value, 0);
  return `The total of "${column}" across ${formatNumber(values.length)} rows is ${formatNumber(total)}.`;
};

const runAverage = (operation: AnalysisOperation, dataset: DatasetInfo): string => {
  const column = resolveColumn(dataset, operation.column);
  requireNumericColumn(dataset, column);

  const values = numericValues(dataset.rows, column);
  if (values.length === 0) {
    return `The "${column}" column has no numeric values to average.`;
  }

  const total = values.reduce((running, value) => running + value, 0);
  const average = total / values.length;
  return `The average "${column}" is ${formatNumber(average)}, based on ${formatNumber(
    values.length,
  )} rows.`;
};

const runFilter = (operation: AnalysisOperation, dataset: DatasetInfo): string => {
  const column = resolveColumn(dataset, operation.column);

  const filterValue =
    operation.filterValue === undefined || operation.filterValue === null
      ? ''
      : String(operation.filterValue).trim();

  if (filterValue === '') {
    throw new Error('A filter value is required to filter the dataset.');
  }

  const matched = dataset.rows.filter((row) => matchesFilter(row[column], filterValue)).length;

  if (matched === 0) {
    return `No rows in "${column}" matched "${filterValue}".`;
  }

  return `Found ${formatNumber(matched)} of ${formatNumber(dataset.totalRows)} rows where "${column}" matches "${filterValue}".`;
};

const runGroupBy = (operation: AnalysisOperation, dataset: DatasetInfo): string => {
  const column = resolveColumn(dataset, operation.column);

  const groups = new Map<string, number>();
  for (const row of dataset.rows) {
    const value = row[column];
    const key = isMissing(value) ? '(empty)' : String(value);
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }

  if (groups.size === 0) {
    return `The "${column}" column has no values to group.`;
  }

  const ranked = [...groups.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );

  const listed = ranked
    .slice(0, MAX_GROUPS_LISTED)
    .map(([key, count]) => `${key} (${formatNumber(count)} rows)`)
    .join(', ');

  const remainder = ranked.length > MAX_GROUPS_LISTED
    ? `, plus ${formatNumber(ranked.length - MAX_GROUPS_LISTED)} more`
    : '';

  return `"${column}" has ${formatNumber(groups.size)} distinct values — the largest groups are ${listed}${remainder}.`;
};

const RUNNERS: Record<AnalysisOperationName, (operation: AnalysisOperation, dataset: DatasetInfo) => string> = {
  count: runCount,
  sum: runSum,
  average: runAverage,
  filter: runFilter,
  groupBy: runGroupBy,
};

/**
 * Execute a single, whitelisted analysis operation against the dataset and
 * return a plain-English sentence. No dynamic code evaluation happens anywhere
 * in this module.
 */
export const runOperation = (operation: AnalysisOperation, dataset: DatasetInfo): string => {
  if (!operation || typeof operation !== 'object') {
    throw new Error('The analysis request was not a valid operation object.');
  }

  const runner = ANALYSIS_OPERATIONS.includes(operation.operation)
    ? RUNNERS[operation.operation]
    : undefined;

  if (!runner) {
    throw new Error(`Unsupported analysis operation: "${operation.operation}".`);
  }

  if (!dataset.rows || dataset.rows.length === 0) {
    return 'There are no rows in this dataset to analyse.';
  }

  return runner(operation, dataset);
};
