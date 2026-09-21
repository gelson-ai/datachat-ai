// @ts-nocheck
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Upload, 
  Database, 
  MessageSquare, 
  ArrowRight, 
  FileText, 
  ChevronRight, 
  CheckCircle, 
  AlertTriangle, 
  Sparkles, 
  RefreshCw, 
  Eye, 
  CornerDownLeft,
  X,
  Lock,
  Compass,
  FileSpreadsheet,
  AlertCircle,
  Code,
  Trash2
} from 'lucide-react';
import { ColumnType, Row, ChatMessage, DatasetInfo, AnalysisOperation } from './types';
import { runOperation } from './analysis/runOperation';
import DataSummary from './components/DataSummary';
import type { CsvWorkerResponse } from './workers/csvWorker';

/** Maximum accepted upload size. */
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

// --- Session persistence -------------------------------------------------
// The session lives only in this browser's localStorage; nothing is sent to a
// server. Every access is guarded because storage can throw (private mode,
// quota) or hold data written by an older version of the app.
const DATASET_STORAGE_KEY = 'datachat:dataset';
const MESSAGES_STORAGE_KEY = 'datachat:messages';

const readStored = (key: string): any => {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    // Unreadable or corrupt entry — treat it as absent rather than crashing
    return null;
  }
};

const writeStored = (key: string, value: unknown): void => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked or full: persistence is best-effort, never fatal
  }
};

const removeStored = (key: string): void => {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Nothing useful to do if storage is unavailable
  }
};

const clearStoredSession = (): void => {
  removeStored(DATASET_STORAGE_KEY);
  removeStored(MESSAGES_STORAGE_KEY);
};

const loadStoredDataset = (): DatasetInfo | null => {
  const stored = readStored(DATASET_STORAGE_KEY);

  // Only accept a shape we can actually render
  if (!stored || !Array.isArray(stored.headers) || !Array.isArray(stored.rows) || !stored.types) {
    return null;
  }

  return {
    ...stored,
    totalRows: typeof stored.totalRows === 'number' ? stored.totalRows : stored.rows.length
  };
};

const loadStoredMessages = (): ChatMessage[] => {
  const stored = readStored(MESSAGES_STORAGE_KEY);
  if (!Array.isArray(stored)) return [];

  return stored
    .filter((msg) => msg && typeof msg.content === 'string' && (msg.role === 'user' || msg.role === 'assistant'))
    .map((msg) => {
      // JSON stores dates as strings, so revive the timestamp
      const timestamp = new Date(msg.timestamp);
      return { ...msg, timestamp: isNaN(timestamp.getTime()) ? new Date() : timestamp };
    });
};

// Helper to generate IDs safely
const generateId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
};

// Display labels for each inferred column type
const COLUMN_TYPE_LABELS: Record<ColumnType, { short: string; badge: string }> = {
  number: { short: 'num', badge: 'NUMERIC' },
  string: { short: 'text', badge: 'TEXT' },
  date: { short: 'date', badge: 'DATE' },
  boolean: { short: 'bool', badge: 'BOOLEAN' }
};

// Boolean literals we accept when inferring/coercing boolean columns
const parseBoolean = (value: string): boolean | null => {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === 'no') return false;
  return null;
};

// Deliberately stricter than Date.parse so plain strings and numbers are not
// mistaken for dates.
const DATE_PATTERNS = [
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/,
  /^\d{4}\/\d{1,2}\/\d{1,2}([ T]\d{1,2}:\d{2}(:\d{2})?)?$/,
  /^\d{1,2}\/\d{1,2}\/\d{4}$/
];

const isDateLike = (value: string): boolean =>
  DATE_PATTERNS.some((pattern) => pattern.test(value)) && !isNaN(Date.parse(value));

// Numbers may arrive with currency symbols and thousands separators
const isNumericLike = (value: string): boolean =>
  /\d/.test(value) && !isNaN(Number(value.replace(/[^0-9.-]/g, '')));

// Type inferring helper checking first 100 rows
const inferColumnTypes = (headers: string[], data: any[]): Record<string, ColumnType> => {
  const types: Record<string, ColumnType> = {};
  
  headers.forEach((col) => {
    const kinds = new Set<ColumnType>();

    // Check up to 100 rows
    const limit = Math.min(data.length, 100);
    for (let i = 0; i < limit; i++) {
      const val = data[i][col];
      if (val === undefined || val === null || val === '') {
        continue;
      }

      if (typeof val === 'number') {
        kinds.add('number');
        continue;
      }
      if (typeof val === 'boolean') {
        kinds.add('boolean');
        continue;
      }
      if (typeof val !== 'string') {
        kinds.add('string');
        continue;
      }

      const cleanVal = val.trim();
      // Skip empty strings
      if (cleanVal === '') continue;

      // Dates are checked before numbers: a value like "2024-01-05" would
      // otherwise strip to the digits 20240105 and look numeric.
      if (parseBoolean(cleanVal) !== null) {
        kinds.add('boolean');
      } else if (isDateLike(cleanVal)) {
        kinds.add('date');
      } else if (isNumericLike(cleanVal)) {
        kinds.add('number');
      } else {
        kinds.add('string');
      }
    }

    // A column is only given a type when every sampled value agrees on it.
    // Inconsistent columns (and empty ones) fall back to 'string'.
    types[col] = kinds.size === 1 ? Array.from(kinds)[0] : 'string';
  });
  
  return types;
};

// Cleans data and coerces columns to their inferred type
const cleanAndCoerceData = (headers: string[], rawRows: any[], types: Record<string, ColumnType>): Row[] => {
  return rawRows.map((row) => {
    const newRow: Row = {};
    headers.forEach((col) => {
      const val = row[col];
      const type = types[col];
      const isEmpty = val === undefined || val === null || String(val).trim() === '';

      if (type === 'number') {
        if (isEmpty) {
          newRow[col] = null;
        } else if (typeof val === 'number') {
          newRow[col] = val;
        } else {
          // Parse string numbers, stripping currencies/commas
          const cleanVal = String(val).replace(/[^0-9.-]/g, '');
          const num = Number(cleanVal);
          newRow[col] = isNaN(num) ? null : num;
        }
      } else if (type === 'boolean') {
        if (isEmpty) {
          newRow[col] = null;
        } else if (typeof val === 'boolean') {
          newRow[col] = val;
        } else {
          newRow[col] = parseBoolean(String(val));
        }
      } else if (type === 'date') {
        // Dates are kept verbatim so nothing is silently rewritten
        newRow[col] = isEmpty ? '' : String(val).trim();
      } else {
        newRow[col] = val === undefined || val === null ? '' : String(val);
      }
    });
    return newRow;
  });
};

// Component to dynamically highlight numerical outputs in conversational sentences
const FormattedAnswer: React.FC<{ text: string }> = ({ text }) => {
  // Pattern to find currencies, decimals, percentages, and simple numbers
  const regex = /(\$?\b\d+(?:,\d+)*(?:\.\d+)?%?\b)/g;
  const parts = text.split(regex);
  
  if (parts.length <= 1) {
    return <span className="text-[#1F2933] text-[15px] font-medium leading-relaxed">{text}</span>;
  }
  
  return (
    <span className="text-[#1F2933] text-[15px] font-medium leading-relaxed">
      {parts.map((part, index) => {
        const isMatch = regex.test(part);
        regex.lastIndex = 0; // reset
        
        if (isMatch) {
          return (
            <code 
              key={index} 
              className="font-mono bg-[#EEF1F4] text-[#1E3A5F] px-1.5 py-0.5 rounded-xs text-[13px] font-semibold border border-[#D5DBE1]"
            >
              {part}
            </code>
          );
        }
        return part;
      })}
    </span>
  );
};

export default function App() {
  // Restore the previous session on load, then keep it in sync below
  const [dataset, setDataset] = useState<DatasetInfo | null>(loadStoredDataset);
  const [messages, setMessages] = useState<ChatMessage[]>(loadStoredMessages);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [input, setInput] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  
  // Errors and feedback
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [errorWarning, setErrorWarning] = useState<string | null>(null);
  
  // CSV parsing progress (null while idle) and the active parsing worker
  const [parseProgress, setParseProgress] = useState<number | null>(null);
  const parseWorkerRef = useRef<Worker | null>(null);
  
  // Expanded Javascript code inspection states
  const [expandedCodes, setExpandedCodes] = useState<Record<string, boolean>>({});
  
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto scroll to bottom of chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Stop any in-flight parsing worker when the app unmounts
  useEffect(() => {
    return () => {
      parseWorkerRef.current?.terminate();
      parseWorkerRef.current = null;
    };
  }, []);

  // Tear down the current parsing worker and hide the progress indicator
  const stopParsingWorker = () => {
    parseWorkerRef.current?.terminate();
    parseWorkerRef.current = null;
    setParseProgress(null);
  };

  // Persist the dataset and the transcript whenever either changes
  useEffect(() => {
    if (dataset) {
      writeStored(DATASET_STORAGE_KEY, dataset);
    } else {
      removeStored(DATASET_STORAGE_KEY);
    }
  }, [dataset]);

  useEffect(() => {
    if (messages.length > 0) {
      writeStored(MESSAGES_STORAGE_KEY, messages);
    } else {
      removeStored(MESSAGES_STORAGE_KEY);
    }
  }, [messages]);

  // Reset current dataset and clean screen
  const handleResetDataset = () => {
    stopParsingWorker();
    setDataset(null);
    setMessages([]);
    setUploadError(null);
    setErrorWarning(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Wipe the whole saved session: state first, then the stored copy
  const handleClearSession = () => {
    setDataset(null);
    setMessages([]);
    setUploadError(null);
    setErrorWarning(null);
    setExpandedCodes({});
    clearStoredSession();
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Drag and drop mechanics
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      processFile(files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      processFile(files[0]);
    }
  };

  const processFile = (file: File) => {
    setUploadError(null);

    if (!file.name.toLowerCase().endsWith('.csv')) {
      setUploadError('Unsupported file type. Please upload a valid CSV file.');
      return;
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setUploadError(
        `That file is ${(file.size / (1024 * 1024)).toFixed(1)}MB. The maximum supported size is 10MB — please upload a smaller CSV.`
      );
      return;
    }

    // Drop any previously running parse before starting a new one
    stopParsingWorker();
    setParseProgress(0);

    let worker: Worker;
    try {
      worker = new Worker(new URL('./workers/csvWorker.ts', import.meta.url), { type: 'module' });
    } catch (workerErr: any) {
      setParseProgress(null);
      setUploadError('Failed parsing CSV file: the background parser could not be started.');
      return;
    }
    parseWorkerRef.current = worker;

    // Tear the worker down and hide the progress indicator
    const finishParsing = () => {
      worker.terminate();
      if (parseWorkerRef.current === worker) {
        parseWorkerRef.current = null;
      }
      setParseProgress(null);
    };

    const acceptParsedRows = (
      rawRows: any[],
      headers: string[],
      renamedHeaders?: Record<string, string>,
      parseErrors: Array<{ type?: string; code?: string; row?: number }> = []
    ) => {
      if (!rawRows || rawRows.length === 0) {
        setUploadError('The selected CSV file appears to be empty.');
        return;
      }

      if (renamedHeaders && Object.keys(renamedHeaders).length > 0) {
        const duplicates = Array.from(new Set(Object.values(renamedHeaders)));
        setUploadError(
          `Duplicate column headers found: ${duplicates.map((name) => `"${name}"`).join(', ')}. ` +
          'Every column needs a unique name — please rename the duplicates and upload again.'
        );
        return;
      }

      const fieldMismatches = parseErrors.filter(
        (error) => error.type === 'FieldMismatch' || error.code === 'TooFewFields' || error.code === 'TooManyFields'
      );
      if (fieldMismatches.length > 0) {
        const rowNumbers = fieldMismatches
          .slice(0, 5)
          .map((error) => (typeof error.row === 'number' ? error.row + 1 : '?'));
        const extra = fieldMismatches.length > rowNumbers.length
          ? ` and ${fieldMismatches.length - rowNumbers.length} more`
          : '';
        setUploadError(
          `Malformed CSV: ${fieldMismatches.length} row${fieldMismatches.length === 1 ? '' : 's'} ` +
          `(${rowNumbers.join(', ')}${extra}) do${fieldMismatches.length === 1 ? 'es' : ''} not match the header. ` +
          `Every row must have exactly the same number of columns — please fix the file and upload again.`
        );
        return;
      }

      if (headers.length === 0) {
        setUploadError('No valid headers or columns found in the CSV.');
        return;
      }

      // Infer types of each column
      const types = inferColumnTypes(headers, rawRows);

      // Guard: Verify there is at least one numeric column
      const numericCols = Object.keys(types).filter(col => types[col] === 'number');
      if (numericCols.length === 0) {
        setUploadError('This file has no numerical data — please upload a CSV with number columns');
        return;
      }

      // Clean, coerce, and structure dataset
      const cleanedRows = cleanAndCoerceData(headers, rawRows, types);

      setDataset({
        filename: file.name,
        headers,
        types,
        rows: cleanedRows,
        totalRows: cleanedRows.length
      });

      // Clear any active chat logs when uploading a new CSV
      setMessages([]);
    };

    worker.onmessage = (event: MessageEvent<CsvWorkerResponse>) => {
      const message = event.data;

      if (message.type === 'progress') {
        setParseProgress(message.progress);
        return;
      }

      finishParsing();

      if (message.type === 'error') {
        setUploadError(`Failed parsing CSV file: ${message.message}`);
        return;
      }

      acceptParsedRows(message.rows, message.headers, message.renamedHeaders, message.errors);
    };

    worker.onerror = () => {
      finishParsing();
      setUploadError('Failed parsing CSV file: the background parser stopped unexpectedly.');
    };

    worker.postMessage({ file });
  };

  // Dynamic suggested questions generator
  const getSuggestedQuestions = (): string[] => {
    if (!dataset) return [];
    
    const numericCols = dataset.headers.filter(h => dataset.types[h] === 'number');
    const stringCols = dataset.headers.filter(h => dataset.types[h] === 'string');
    
    const suggestions: string[] = [];
    
    if (numericCols.length > 0) {
      const mainNum = numericCols[0];
      const secondNum = numericCols[1] || numericCols[0];
      
      suggestions.push(`What's the average ${mainNum}?`);
      
      if (stringCols.length > 0) {
        suggestions.push(`Who has the highest ${mainNum}?`);
      } else {
        suggestions.push(`What is the maximum value of ${mainNum}?`);
      }
      
      if (numericCols.length > 1) {
        suggestions.push(`Find the top 3 with the highest ${secondNum}`);
      } else {
        suggestions.push(`Who has the lowest ${mainNum}?`);
      }
    }
    
    suggestions.push(`How many rows are in the dataset in total?`);
    return suggestions.slice(0, 4);
  };

  const handleSuggestionClick = (suggestion: string) => {
    setInput(suggestion);
    handleAsk(suggestion);
  };

  // Parsing helper to handle API response and strip potential markdown wrappers
  const parseModelResponse = (text: string) => {
    let cleanText = text.trim();
    if (cleanText.startsWith('```')) {
      const lines = cleanText.split('\n');
      if (lines[0].startsWith('```json') || lines[0].startsWith('```')) {
        lines.shift();
      }
      if (lines[lines.length - 1].startsWith('```')) {
        lines.pop();
      }
      cleanText = lines.join('\n').trim();
    }
    
    try {
      return JSON.parse(cleanText);
    } catch (e) {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch (innerErr) {
          throw new Error("Invalid JSON format returned from assistant.");
        }
      }
      throw new Error("Could not parse assistant output as JSON. Output: " + text);
    }
  };

  // Gemini generateContent integration (proxied through the local API server)
  const handleAsk = async (questionText: string) => {
    const trimmedQuestion = questionText.trim();
    if (!trimmedQuestion) return;
    setErrorWarning(null);

    if (!dataset) {
      setErrorWarning('Please upload a CSV first');
      return;
    }

    // Append User message
    const userMsg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: trimmedQuestion,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      // Build system prompt detailing dataset schema, inferred column types, and sample rows
      const systemPrompt = `You are a data analysis planner for an uploaded CSV dataset.
The user asks a plain-English question, and you reply with a small JSON object describing ONE analysis operation. A client-side interpreter then runs that operation against the dataset — no code, scripts or expressions are ever generated or executed, so you must never return code.

The complete list of allowed operations:
- "sum": add up every numeric value in "column".
- "average": calculate the mean of every numeric value in "column".
- "count": count the rows. Omit "column" to count the whole dataset, or set it to count the non-empty values of that column.
- "filter": count the rows where "column" equals "filterValue". Both fields are required.
- "groupBy": count how many rows share each distinct value of "column".

Schema of columns and their types:
${JSON.stringify(dataset.types, null, 2)}

First 3 sample rows for context:
${JSON.stringify(dataset.rows.slice(0, 3), null, 2)}

Rules:
1. Choose the single operation that best answers the user's question. Never combine operations.
2. Always reference column names exactly as they appear in the schema. Names are case-sensitive!
3. "sum" and "average" may only target columns typed "number".
4. For "filter", copy the comparison value from the user's question into "filterValue".
5. Never invent operations, columns or values, and never attempt to compute the answer yourself — the interpreter does the maths.

Return a JSON object in this exact shape, with no extra keys and no markdown fences:
{
  "operation": "sum" | "average" | "count" | "filter" | "groupBy",
  "column": "<exact column name, omit only for a whole-dataset count>",
  "filterValue": "<value to match, only for the filter operation>"
}`;

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          systemPrompt,
          question: trimmedQuestion
        })
      });

      if (!response.ok) {
        const errPayload = await response.json().catch(() => null);
        throw new Error(errPayload?.error || `HTTP server error ${response.status}`);
      }

      const resBody = await response.json();
      const rawText = resBody.text || '{}';
      const parsedJSON = parseModelResponse(rawText);

      if (!parsedJSON.operation) {
        throw new Error("Assistant response JSON did not include an 'operation' parameter.");
      }

      const operation = parsedJSON as AnalysisOperation;

      // Interpret the requested operation safely — no dynamic code execution
      let outputText = '';
      try {
        outputText = runOperation(operation, dataset);
      } catch (opErr: any) {
        throw new Error(`Execution Error: ${opErr.message}\n\nThe requested operation could not be applied to your dataset.`);
      }

      const botReply: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: outputText,
        code: JSON.stringify(operation, null, 2),
        timestamp: new Date()
      };
      
      setMessages(prev => [...prev, botReply]);
    } catch (err: any) {
      const errReply: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: "Couldn't compute that — try rephrasing your question",
        error: err.message || String(err),
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errReply]);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleCodeExpansion = (id: string) => {
    setExpandedCodes(prev => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="min-h-screen bg-[#EDF0F3] font-sans flex flex-col text-[#1F2933]">
      
      {/* HEADER SECTION */}
      <header className="relative w-full bg-[#16283C] border-b border-[#0F1E2E] py-2.5 px-6 md:px-8 flex flex-col sm:flex-row items-center justify-between gap-3 sticky top-0 z-50 shadow-[0_1px_3px_rgba(16,24,40,0.18)]">
        <div className="absolute inset-x-0 top-0 h-[3px] bg-[#2E4A66]"></div>
        <div className="flex items-center gap-2.5">
          <div className="w-2.5 h-2.5 bg-[#7C93AB] rounded-full shrink-0"></div>
          <div className="flex items-center gap-3">
            <span className="font-serif font-bold text-lg tracking-tight text-white">DataChat AI</span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] px-2 py-1 bg-[#0F1E2E] text-[#B9C7D4] border border-[#2E4A66] rounded-xs font-mono">
              Gemini 2.5 Flash
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleClearSession}
          title="Remove the saved dataset and chat from this browser"
          className="flex items-center gap-1.5 text-xs font-semibold text-[#B9C7D4] bg-transparent border border-[#3B5871] hover:text-red-300 hover:border-red-400/60 hover:bg-red-500/10 px-2.5 py-1.5 rounded-xs transition-colors cursor-pointer shrink-0"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Clear session
        </button>

      </header>

      {/* MAIN CONTAINER */}
      <main className="flex-grow p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-5 max-w-[1400px] mx-auto w-full">
        
        {/* LEFT COLUMN: DATA PANEL */}
        <section className="lg:col-span-4 flex flex-col gap-4 h-full">
          
          {/* UPLOAD ZONE */}
          {!dataset ? (
            <div 
              id="dropzone"
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border border-solid rounded-sm p-8 md:p-10 text-center cursor-pointer transition-colors duration-200 flex flex-col items-center justify-center gap-4 min-h-[240px] ${
                isDragging 
                  ? 'border-[#334155] bg-[#E4E9EE]' 
                  : 'border-[#C3CBD3] bg-[#F7F9FA] hover:border-[#8B95A0] hover:bg-[#F1F4F6]'
              }`}
            >
              <input 
                ref={fileInputRef}
                type="file" 
                accept=".csv" 
                onChange={handleFileChange}
                className="hidden"
              />
              <div className={`h-12 w-12 rounded-sm border flex items-center justify-center transition-colors ${
                isDragging ? 'bg-[#DCE2E8] border-[#8B95A0] text-[#1E3A5F]' : 'bg-white border-[#D5DBE1] text-[#4A5560]'
              }`}>
                <Upload className="h-6 w-6" />
              </div>
              <div>
                <p className="font-serif font-semibold text-[#1F2933] text-base">Drop your CSV here or click to browse</p>
                <p className="text-sm text-[#5B6673] mt-1">Numerical data, any number of columns</p>
              </div>

              {/* PARSING PROGRESS */}
              {parseProgress !== null && (
                <div className="w-full max-w-xs mt-1 animate-fadeIn">
                  <div className="flex items-center justify-between text-[11px] font-semibold text-[#5B6673] mb-1.5">
                    <span className="flex items-center gap-1.5">
                      <RefreshCw className="h-3 w-3 animate-spin text-[#334155]" />
                      Parsing CSV in background...
                    </span>
                    <span className="font-mono text-[#1E3A5F]">{parseProgress}%</span>
                  </div>
                  <div
                    role="progressbar"
                    aria-valuenow={parseProgress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    className="h-1.5 w-full bg-[#E4E9EE] rounded-xs overflow-hidden"
                  >
                    <div
                      className="h-full bg-[#334155] rounded-xs transition-all duration-200"
                      style={{ width: `${parseProgress}%` }}
                    />
                  </div>
                </div>
              )}
              
              {uploadError && (
                <div className="mt-2 flex items-center gap-2 bg-[#FEF3F2] border border-[#FDA29B] text-[#B42318] text-xs py-2 px-3.5 rounded-xs text-left max-w-sm">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>{uploadError}</span>
                </div>
              )}
            </div>
          ) : (
            /* COLLAPSED SUCCESS BAR */
            <div className="bg-[#F4F6F8] border border-[#D5DBE1] rounded-sm p-4 flex items-center justify-between card-shadow animate-fadeIn">
              <div className="flex items-center gap-3 overflow-hidden">
                <div className="p-2 bg-[#E4E9EE] rounded-xs text-[#334155] shrink-0">
                  <FileText className="h-5 w-5" />
                </div>
                <div className="overflow-hidden">
                  <p className="text-sm font-semibold text-slate-900 truncate">{dataset.filename}</p>
                  <p className="text-xs text-slate-500 font-mono mt-0.5">
                    {dataset.totalRows.toLocaleString()} rows • {dataset.headers.length} columns
                  </p>
                </div>
              </div>
              <button
                onClick={handleResetDataset}
                className="text-xs font-semibold text-[#334155] hover:text-[#1E293B] bg-white border border-[#D5DBE1] hover:border-[#8B95A0] px-3 py-1.5 rounded-xs transition-colors shrink-0 cursor-pointer"
              >
                Replace
              </button>
            </div>
          )}

          {/* PREVIEW CONTAINER */}
          {dataset && (
            <div className="bg-white border border-[#D5DBE1] rounded-sm flex flex-col card-shadow overflow-hidden animate-fadeIn">
              <div className="p-3.5 border-b border-[#E4E9EE] flex items-center justify-between bg-[#F7F9FA]">
                <h2 className="text-xs font-bold uppercase tracking-widest text-[#5B6673]">Data Preview</h2>
                <div className="flex gap-2">
                  {(['number', 'date', 'boolean', 'string'] as ColumnType[]).map((type) => {
                    const count = Object.values(dataset.types).filter(t => t === type).length;
                    if (count === 0) return null;
                    return (
                      <span key={type} className="px-2 py-0.5 bg-[#EEF1F4] text-[10px] font-semibold rounded-xs text-[#5B6673] border border-[#D5DBE1]">
                        {count} {COLUMN_TYPE_LABELS[type].badge}
                      </span>
                    );
                  })}
                </div>
              </div>

              {/* TABLE CONTAINER */}
              <div className="overflow-auto custom-scrollbar flex-grow max-h-[300px]">
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 bg-[#F7F9FA] shadow-xs z-10">
                    <tr className="border-b border-[#E4E9EE]">
                      {dataset.headers.map((col) => (
                        <th key={col} className="p-3 text-[11px] font-semibold text-[#5B6673] bg-[#F7F9FA]">
                          <div className="flex flex-col gap-0.5">
                            <span className="uppercase">{col}</span>
                            <span className="font-normal opacity-60 text-[9px] font-mono lowercase bg-[#E4E9EE] px-1 py-0.2 rounded-xs w-fit">
                              {COLUMN_TYPE_LABELS[dataset.types[col]]?.short ?? 'text'}
                            </span>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E4E9EE] bg-white font-mono text-[12px] text-[#3A4753]">
                    {dataset.rows.slice(0, 10).map((row, rowIndex) => (
                      <tr key={rowIndex} className="hover:bg-[#F7F9FA] even:bg-[#FAFBFC] transition-colors border-b border-[#EDF0F3] last:border-b-0">
                        {dataset.headers.map((col) => {
                          const val = row[col];
                          const isNumeric = dataset.types[col] === 'number';
                          return (
                            <td 
                              key={col} 
                              className={`p-3 text-[#3A4753] font-mono ${
                                isNumeric ? 'text-[#1E3A5F] font-medium' : 'text-[#4A5560]'
                              }`}
                            >
                              {val === null || val === undefined ? (
                                <span className="text-[#9AA7B4] italic">null</span>
                              ) : (
                                String(val)
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-[#8B95A0] p-3 text-right italic border-t border-[#EDF0F3]">
                Showing first {Math.min(dataset.rows.length, 10)} rows for context.
              </p>
            </div>
          )}

          {/* DATA SUMMARY PANEL */}
          {dataset && <DataSummary dataset={dataset} />}

          {/* SUGGESTED CHIPS */}
          {dataset && (
            <div className="bg-white border border-[#D5DBE1] rounded-sm p-4 card-shadow flex flex-col gap-3 animate-fadeIn">
              <h2 className="text-xs font-bold uppercase tracking-widest text-[#5B6673]">Suggested Queries</h2>
              <div className="flex flex-wrap gap-2 mt-1">
                {getSuggestedQuestions().map((suggestion, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSuggestionClick(suggestion)}
                    className="px-2.5 py-1.5 border border-[#D5DBE1] rounded-xs text-xs text-[#4A5560] hover:border-[#8B95A0] hover:bg-[#EEF1F4] transition-colors cursor-pointer font-medium"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* RIGHT COLUMN: CHAT PANEL */}
        <section className="lg:col-span-8 h-full">
          <div className="bg-white border border-[#D5DBE1] rounded-sm card-shadow h-[720px] flex flex-col overflow-hidden">
            
            {/* HEADER */}
            <div className="px-5 py-3.5 border-b border-[#E4E9EE] flex items-center justify-between bg-[#F7F9FA]">
              <h2 className="font-serif text-base font-bold text-[#1F2933]">Analysis Chat</h2>
              {dataset && (
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[#5B6673] flex items-center gap-1.5 bg-[#EEF1F4] border border-[#D5DBE1] px-2.5 py-1 rounded-xs">
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  {dataset.filename} is active
                </span>
              )}
            </div>

            {/* CHAT CHANNELS */}
            <div className="flex-grow overflow-y-auto custom-scrollbar p-6 space-y-6 bg-[#F4F6F8]">
              
              {/* EMPTY STATE */}
              {!dataset && messages.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-center p-8 max-w-sm mx-auto my-auto gap-4">
                  <div className="h-14 w-14 rounded-sm bg-[#EEF1F4] border border-[#D5DBE1] flex items-center justify-center text-[#4A5560]">
                    <Database className="h-6 w-6" />
                  </div>
                  <div>
                    <h4 className="font-serif font-semibold text-[#1F2933] text-base">Upload a CSV to start</h4>
                    <p className="text-xs text-[#5B6673] mt-2 leading-relaxed">
                      Once you upload a numerical dataset on the left, you can ask plain English questions and get immediate mathematical answers computed locally.
                    </p>
                  </div>
                </div>
              )}

              {/* MESSAGE LIST */}
              {messages.map((msg) => {
                const isUser = msg.role === 'user';
                
                if (isUser) {
                  return (
                    <div key={msg.id} className="flex justify-end animate-fadeIn">
                      <div className="max-w-[80%] bg-[#334155] text-white rounded-sm rounded-br-none p-4 card-shadow">
                        <p className="text-sm font-medium leading-relaxed">{msg.content}</p>
                      </div>
                    </div>
                  );
                } else {
                  const hasError = !!msg.error;
                  
                  return (
                    <div key={msg.id} className="flex justify-start animate-fadeIn">
                      <div className={`max-w-[85%] w-full rounded-sm rounded-bl-none p-5 border transition-all card-shadow ${
                        hasError 
                          ? 'bg-red-50/50 border-red-100 text-red-900' 
                          : 'bg-white border-slate-200 text-slate-900'
                      }`}>
                        
                        {/* Conversational sentence output */}
                        <div className="flex items-start gap-2.5">
                          {!hasError ? (
                            <div className="h-6 w-6 rounded-xs bg-[#EEF1F4] text-[#334155] flex items-center justify-center shrink-0 mt-0.5">
                              <Sparkles className="h-3.5 w-3.5" />
                            </div>
                          ) : (
                            <div className="h-6 w-6 rounded-md bg-red-100 text-red-600 flex items-center justify-center shrink-0 mt-0.5">
                              <AlertCircle className="h-3.5 w-3.5" />
                            </div>
                          )}
                          
                          <div className="flex-1">
                            <FormattedAnswer text={msg.content} />
                            
                            {/* OPERATION INSPECTOR PANEL (only if an operation was requested) */}
                            {msg.code && (
                              <div className="mt-4 border-t border-slate-100 pt-3">
                                <button
                                  onClick={() => toggleCodeExpansion(msg.id)}
                                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                                >
                                  <ChevronRight className={`h-3.5 w-3.5 transition-transform duration-200 ${expandedCodes[msg.id] ? 'rotate-90' : ''}`} />
                                  {expandedCodes[msg.id] ? 'Hide analysis operation' : 'View analysis operation'}
                                </button>
                                
                                {expandedCodes[msg.id] && (
                                  <div className="mt-2 text-[11px] font-mono bg-[#10161D] text-[#9FB3C8] rounded-xs p-3.5 overflow-x-auto border border-[#2A3440] shadow-inner select-all leading-relaxed">
                                    <pre className="whitespace-pre">{msg.code}</pre>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Technical debug error collapse */}
                            {hasError && msg.error && (
                              <div className="mt-2 border-t border-red-100/70 pt-2">
                                <p className="text-[11px] font-mono text-red-700 bg-red-50 border border-red-100/50 rounded-lg p-2.5 overflow-x-auto leading-relaxed whitespace-pre-wrap">
                                  {msg.error}
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }
              })}

              {/* THINKING ANIMATION */}
              {isLoading && (
                <div className="flex justify-start animate-fadeIn">
                  <div className="flex items-center gap-3 text-slate-400">
                    <div className="flex gap-1">
                      <div className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                      <div className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                      <div className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce"></div>
                    </div>
                    <span className="text-xs italic">DataChat is thinking...</span>
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>

            {/* INPUT BAR */}
            <div className="p-4 bg-[#F7F9FA] border-t border-[#E4E9EE]">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleAsk(input);
                }}
                className="flex gap-2 bg-white border border-[#C3CBD3] rounded-sm p-1.5 pl-4 focus-within:ring-2 focus-within:ring-[#334155]/20 focus-within:border-[#334155] transition-all"
              >
                <input
                  id="query-input"
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  disabled={!dataset || isLoading}
                  placeholder={dataset ? "Ask about your data..." : "Upload a CSV to start asking..."}
                  className="flex-grow text-sm text-[#1F2933] focus:outline-hidden bg-transparent border-0 placeholder:text-[#8B95A0]"
                />
                <button
                  type="submit"
                  disabled={!input.trim() || !dataset || isLoading}
                  className="w-10 h-10 flex items-center justify-center bg-[#334155] text-white rounded-sm hover:bg-[#1E293B] transition-colors disabled:bg-[#E4E9EE] disabled:text-[#9AA7B4] cursor-pointer focus:outline-hidden shrink-0"
                >
                  <ArrowRight className="h-5 w-5" strokeWidth={2.5} />
                </button>
              </form>

              {/* INLINE STATUS WARNINGS */}
              {errorWarning && (
                <div className="flex items-center gap-1.5 text-xs text-[#B54708] mt-2.5 px-2.5 animate-fadeIn">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span>{errorWarning}</span>
                </div>
              )}
            </div>
          </div>
        </section>

      </main>
    </div>
  );
}
