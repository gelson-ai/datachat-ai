/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DatasetInfo } from '../types';

/** A single cell value, matching the value union of `Row` in `../types`. */
type CellValue = string | number | boolean | null;

interface DataSummaryProps {
  dataset: DatasetInfo;
}

interface ColumnStats {
  name: string;
  type: string;
  missing: number;
  min: number | null;
  max: number | null;
  average: number | null;
}

const isMissing = (value: CellValue | undefined): boolean => {
  if (value === null || value === undefined) return true;
  return typeof value === 'string' && value.trim() === '';
};

/** Coerce a cell to a finite number, or null when it is not numeric. */
const toNumber = (value: CellValue | undefined): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const formatNumber = (value: number): string =>
  value.toLocaleString(undefined, { maximumFractionDigits: 2 });

export const summarizeColumns = (dataset: DatasetInfo): ColumnStats[] =>
  dataset.headers.map((name) => {
    const type = dataset.types[name] ?? 'string';
    let missing = 0;
    let min: number | null = null;
    let max: number | null = null;
    let total = 0;
    let count = 0;

    for (const row of dataset.rows) {
      const value = row[name];

      if (isMissing(value)) {
        missing += 1;
        continue;
      }

      if (type !== 'number') continue;

      const numeric = toNumber(value);
      if (numeric === null) continue;

      min = min === null ? numeric : Math.min(min, numeric);
      max = max === null ? numeric : Math.max(max, numeric);
      total += numeric;
      count += 1;
    }

    return {
      name,
      type,
      missing,
      min,
      max,
      average: count > 0 ? total / count : null,
    };
  });

const Stat = ({ label, value }: { label: string; value: number | null }) => (
  <div className="bg-[#F7F9FA] border border-[#E4E9EE] rounded-xs px-2 py-1.5 min-w-0">
    <p className="text-[9px] font-bold uppercase tracking-widest text-[#8B95A0]">{label}</p>
    <p className="text-[12px] font-mono font-medium text-[#334155] truncate">
      {value === null ? <span className="text-[#9AA7B4] italic">n/a</span> : formatNumber(value)}
    </p>
  </div>
);

export default function DataSummary({ dataset }: DataSummaryProps) {
  const columns = summarizeColumns(dataset);
  const numericCount = columns.filter((column) => column.type === 'number').length;

  return (
    <div className="bg-white border border-[#D5DBE1] rounded-sm flex flex-col card-shadow overflow-hidden animate-fadeIn">
      <div className="p-3.5 border-b border-[#E4E9EE] flex items-center justify-between bg-[#F7F9FA]">
        <h2 className="text-xs font-bold uppercase tracking-widest text-[#5B6673]">Data Summary</h2>
        <span className="px-2 py-0.5 bg-[#EEF1F4] text-[10px] font-semibold rounded-xs text-[#5B6673] border border-[#D5DBE1]">
          {columns.length} COLUMNS
        </span>
      </div>

      {columns.length === 0 ? (
        <p className="p-4 text-xs text-[#8B95A0] italic">No columns available to summarize.</p>
      ) : (
        <div className="overflow-auto custom-scrollbar max-h-[300px] divide-y divide-[#E4E9EE]">
          {columns.map((column) => (
            <div key={column.name} className="p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-semibold text-[#334155] truncate uppercase">
                  {column.name}
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="px-1.5 py-0.5 bg-[#E4E9EE] text-[9px] font-semibold rounded-xs text-[#5B6673] font-mono lowercase">
                    {column.type}
                  </span>
                  <span
                    className={`px-1.5 py-0.5 text-[9px] font-semibold rounded-xs font-mono ${
                      column.missing > 0
                        ? 'bg-[#FFFAEB] text-[#B54708] border border-[#FEC84B]'
                        : 'bg-[#F4F6F8] text-[#8B95A0] border border-[#E4E9EE]'
                    }`}
                  >
                    {column.missing} missing
                  </span>
                </div>
              </div>

              {column.type === 'number' && (
                <div className="grid grid-cols-3 gap-2">
                  <Stat label="Min" value={column.min} />
                  <Stat label="Max" value={column.max} />
                  <Stat label="Avg" value={column.average} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px] text-[#8B95A0] p-3 text-right italic border-t border-[#EDF0F3]">
        {numericCount > 0
          ? 'Min / max / average exclude missing values.'
          : 'No numeric columns — min / max / average unavailable.'}
      </p>
    </div>
  );
}
