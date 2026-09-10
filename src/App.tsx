// @ts-nocheck
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import Papa from 'papaparse';
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
import { ColumnType, Row, ChatMessage, DatasetInfo } from './types';

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

// Type inferring helper checking first 100 rows
const inferColumnTypes = (headers: string[], data: any[]): Record<string, ColumnType> => {
  const types: Record<string, ColumnType> = {};
  
  headers.forEach((col) => {
    let hasNumeric = false;
    let hasText = false;

    // Check up to 100 rows
    const limit = Math.min(data.length, 100);
    for (let i = 0; i < limit; i++) {
      const val = data[i][col];
      if (val === undefined || val === null || val === '') {
        continue;
      }
      
      if (typeof val === 'number') {
        hasNumeric = true;
      } else if (typeof val === 'string') {
        const cleanVal = val.trim();
        // Skip empty strings
        if (cleanVal === '') continue;
        
        // Check if parsing as number succeeds
        // We strip currency and commas first
        const numCandidate = Number(cleanVal.replace(/[^0-9.-]/g, ''));
        if (!isNaN(numCandidate) && cleanVal.match(/\d/)) {
          hasNumeric = true;
        } else {
          hasText = true;
        }
      } else {
        hasText = true;
      }
    }

    // Default to 'string' if no data, or if text exists
    types[col] = (hasNumeric && !hasText) ? 'number' : 'string';
  });
  
  return types;
};

// Cleans data and coerces number columns appropriately
const cleanAndCoerceData = (headers: string[], rawRows: any[], types: Record<string, ColumnType>): Row[] => {
  return rawRows.map((row) => {
    const newRow: Row = {};
    headers.forEach((col) => {
      const val = row[col];
      if (types[col] === 'number') {
        if (val === undefined || val === null || String(val).trim() === '') {
          newRow[col] = null;
        } else if (typeof val === 'number') {
          newRow[col] = val;
        } else {
          // Parse string numbers, stripping currencies/commas
          const cleanVal = String(val).replace(/[^0-9.-]/g, '');
          const num = Number(cleanVal);
          newRow[col] = isNaN(num) ? null : num;
        }
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
    return <span className="text-slate-800 text-[15px] font-medium leading-relaxed">{text}</span>;
  }
  
  return (
    <span className="text-slate-800 text-[15px] font-medium leading-relaxed">
      {parts.map((part, index) => {
        const isMatch = regex.test(part);
        regex.lastIndex = 0; // reset
        
        if (isMatch) {
          return (
            <code 
              key={index} 
              className="font-mono bg-indigo-50/70 text-indigo-600 px-1.5 py-0.5 rounded text-[13px] font-semibold border border-indigo-100/30"
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
  
  // Expanded Javascript code inspection states
  const [expandedCodes, setExpandedCodes] = useState<Record<string, boolean>>({});
  
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto scroll to bottom of chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

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

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      
      Papa.parse(text, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: 'greedy',
        complete: (results) => {
          const rawRows = results.data as any[];
          if (!rawRows || rawRows.length === 0) {
            setUploadError('The selected CSV file appears to be empty.');
            return;
          }

          // Gather complete set of headers
          const headersSet = new Set<string>();
          rawRows.forEach(row => {
            Object.keys(row).forEach(key => headersSet.add(key));
          });
          const headers = Array.from(headersSet);

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
        },
        error: (err) => {
          setUploadError(`Failed parsing CSV file: ${err.message}`);
        }
      });
    };
    
    reader.onerror = () => {
      setUploadError('Error reading CSV file.');
    };
    reader.readAsText(file);
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
  const parseOpenAIResponse = (text: string) => {
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

  // OpenAI Chat completions integration
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
      const systemPrompt = `You are a high-fidelity data analysis code generator.
The user wants to ask a plain-English question about their uploaded CSV dataset.

Instead of answering directly, you must write a clean, vanilla JavaScript function BODY that will be executed on the client-side using \`new Function('data', code)\` to compute the answer.

The function takes a single argument, \`data\`, which is an array of row objects.
Each row object contains the column names as keys, mapped to their values (numbers or strings).

Schema of columns and their types:
${JSON.stringify(dataset.types, null, 2)}

First 3 sample rows for context:
${JSON.stringify(dataset.rows.slice(0, 3), null, 2)}

Your task:
Write a JavaScript function body (just the body, NO "function(data) {" wrapper, and NO outer markdown code block) that computes the answer to the user's question, and returns a single, clear, conversational plain-English sentence (string) stating the answer with brief supporting details.

Example user question: "who has the highest BMI"
Expected Javascript function body:
// Find the row with the maximum BMI
if (!data || data.length === 0) return "There is no data available to calculate the highest BMI.";
let maxRow = data[0];
for (let i = 1; i < data.length; i++) {
  if (data[i]['BMI'] !== null && (maxRow['BMI'] === null || data[i]['BMI'] > maxRow['BMI'])) {
    maxRow = data[i];
  }
}
const name = maxRow['Name'] || maxRow['ID'] || 'Record #' + (data.indexOf(maxRow) + 1);
return name + " has the highest BMI of " + maxRow['BMI'] + ".";

Rules for the JS Code:
1. You must write robust, error-tolerant JavaScript. Handle empty datasets, null/missing values, and division by zero.
2. Only use plain standard ES6+ JavaScript. Do not import or call external libraries or APIs.
3. Keep the return value as a single natural sentence string. Never return a raw object, table, or number.
4. Always reference the actual keys exactly as they appear in the schema. Keys are case-sensitive!
5. Never hardcode the answer values or make up calculations. Always compute them dynamically from the \`data\` parameter.

Return a JSON object in this exact shape:
{
  "code": "<javascript function body as a single properly-escaped string>"
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
      const rawText = resBody.choices?.[0]?.message?.content || '{}';
      const parsedJSON = parseOpenAIResponse(rawText);

      if (!parsedJSON.code) {
        throw new Error("Assistant response JSON did not include a 'code' parameter.");
      }

      // Execute generated code in client-side sandbox
      let outputText = '';
      try {
        const targetFn = new Function('data', parsedJSON.code);
        const codeOutput = targetFn(dataset.rows);
        outputText = codeOutput === undefined || codeOutput === null ? 'No result returned from dataset calculation.' : String(codeOutput);
      } catch (evalErr: any) {
        throw new Error(`Execution Error: ${evalErr.message}\n\nThe computed JS script encountered a runtime issue on your dataset.`);
      }

      const botReply: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: outputText,
        code: parsedJSON.code,
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
    <div className="min-h-screen bg-[#F8FAFC] font-sans flex flex-col text-[#0F172A]">
      
      {/* HEADER SECTION */}
      <header className="w-full bg-white border-b border-slate-200 py-4 px-8 flex flex-col sm:flex-row items-center justify-between gap-4 sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 bg-indigo-500 rounded-full shrink-0"></div>
          <div className="flex items-baseline gap-2">
            <span className="font-bold text-xl tracking-tight text-slate-900">DataChat AI</span>
            <span className="text-[10px] font-semibold px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-md font-mono">
              GPT-4o-Mini
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleClearSession}
          title="Remove the saved dataset and chat from this browser"
          className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 bg-white border border-slate-200 hover:text-red-600 hover:border-red-200 hover:bg-red-50/60 px-3 py-1.5 rounded-lg transition-all cursor-pointer shrink-0"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Clear session
        </button>

      </header>

      {/* MAIN CONTAINER */}
      <main className="flex-grow p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 max-w-[1400px] mx-auto w-full">
        
        {/* LEFT COLUMN: DATA PANEL */}
        <section className="lg:col-span-4 flex flex-col gap-5 h-full">
          
          {/* UPLOAD ZONE */}
          {!dataset ? (
            <div 
              id="dropzone"
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-8 md:p-10 text-center cursor-pointer transition-all duration-300 flex flex-col items-center justify-center gap-4 ${
                isDragging 
                  ? 'border-indigo-500 bg-indigo-50/50 scale-[1.01]' 
                  : 'border-slate-350 bg-white hover:border-indigo-400 hover:bg-slate-50/40'
              }`}
            >
              <input 
                ref={fileInputRef}
                type="file" 
                accept=".csv" 
                onChange={handleFileChange}
                className="hidden"
              />
              <div className={`h-14 w-14 rounded-full flex items-center justify-center transition-all ${
                isDragging ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-500'
              }`}>
                <Upload className="h-7 w-7" />
              </div>
              <div>
                <p className="font-semibold text-slate-800 text-base">Drop your CSV here or click to browse</p>
                <p className="text-sm text-slate-500 mt-1">Numerical data, any number of columns</p>
              </div>
              
              {uploadError && (
                <div className="mt-2 flex items-center gap-2 bg-red-50 border border-red-100 text-red-600 text-xs py-2 px-3.5 rounded-lg text-left max-w-sm">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>{uploadError}</span>
                </div>
              )}
            </div>
          ) : (
            /* COLLAPSED SUCCESS BAR */
            <div className="bg-indigo-50/30 border border-indigo-100 rounded-2xl p-4 flex items-center justify-between card-shadow animate-fadeIn">
              <div className="flex items-center gap-3 overflow-hidden">
                <div className="p-2 bg-indigo-100 rounded-lg text-indigo-600 shrink-0">
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
                className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 bg-white border border-slate-200/80 hover:border-indigo-200 px-3 py-1.5 rounded-lg transition-all shrink-0 cursor-pointer"
              >
                Replace
              </button>
            </div>
          )}

          {/* PREVIEW CONTAINER */}
          {dataset && (
            <div className="bg-white border border-slate-200 rounded-2xl flex flex-col card-shadow overflow-hidden animate-fadeIn">
              <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-white">
                <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400">Data Preview</h2>
                <div className="flex gap-2">
                  <span className="px-2 py-0.5 bg-slate-100 text-[10px] font-semibold rounded-md text-slate-600">
                    {Object.values(dataset.types).filter(t => t === 'number').length} NUMERIC
                  </span>
                  <span className="px-2 py-0.5 bg-slate-100 text-[10px] font-semibold rounded-md text-slate-600">
                    {Object.values(dataset.types).filter(t => t === 'string').length} TEXT
                  </span>
                </div>
              </div>

              {/* TABLE CONTAINER */}
              <div className="overflow-auto custom-scrollbar flex-grow max-h-[300px]">
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 bg-white shadow-xs z-10">
                    <tr className="border-b border-slate-100">
                      {dataset.headers.map((col) => (
                        <th key={col} className="p-3 text-[11px] font-semibold text-slate-500 bg-white">
                          <div className="flex flex-col gap-0.5">
                            <span className="uppercase">{col}</span>
                            <span className="font-normal opacity-60 text-[9px] font-mono lowercase bg-slate-100 px-1 py-0.2 rounded-sm w-fit">
                              {dataset.types[col] === 'number' ? 'num' : 'text'}
                            </span>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white font-mono text-[12px] text-slate-700">
                    {dataset.rows.slice(0, 10).map((row, rowIndex) => (
                      <tr key={rowIndex} className="hover:bg-slate-50/55 even:bg-slate-50/20 transition-all border-b border-slate-50 last:border-b-0">
                        {dataset.headers.map((col) => {
                          const val = row[col];
                          const isNumeric = dataset.types[col] === 'number';
                          return (
                            <td 
                              key={col} 
                              className={`p-3 text-slate-700 font-mono ${
                                isNumeric ? 'text-indigo-600 font-medium' : 'text-slate-600'
                              }`}
                            >
                              {val === null || val === undefined ? (
                                <span className="text-slate-300 italic">null</span>
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
              <p className="text-[11px] text-slate-400 p-3 text-right italic border-t border-slate-50">
                Showing first {Math.min(dataset.rows.length, 10)} rows for context.
              </p>
            </div>
          )}

          {/* SUGGESTED CHIPS */}
          {dataset && (
            <div className="bg-white border border-slate-200 rounded-2xl p-4 card-shadow flex flex-col gap-3 animate-fadeIn">
              <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400">Suggested Queries</h2>
              <div className="flex flex-wrap gap-2 mt-1">
                {getSuggestedQuestions().map((suggestion, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSuggestionClick(suggestion)}
                    className="px-3 py-1.5 border border-slate-200 rounded-full text-xs text-slate-600 hover:border-indigo-300 hover:bg-indigo-50/80 transition-all cursor-pointer font-medium"
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
          <div className="bg-white border border-slate-200 rounded-2xl card-shadow h-[720px] flex flex-col overflow-hidden">
            
            {/* HEADER */}
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-white">
              <h2 className="text-base font-bold text-slate-900">Analysis Chat</h2>
              {dataset && (
                <span className="text-xs font-medium text-slate-400 flex items-center gap-1.5 bg-slate-50 border border-slate-150 px-3 py-1 rounded-full">
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  {dataset.filename} is active
                </span>
              )}
            </div>

            {/* CHAT CHANNELS */}
            <div className="flex-grow overflow-y-auto custom-scrollbar p-6 space-y-6 bg-slate-50/30">
              
              {/* EMPTY STATE */}
              {!dataset && messages.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-center p-8 max-w-sm mx-auto my-auto gap-4">
                  <div className="h-14 w-14 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                    <Database className="h-6 w-6" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-slate-800 text-sm">Upload a CSV to start</h4>
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">
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
                      <div className="max-w-[80%] bg-[#6366F1] text-white rounded-2xl rounded-br-[2px] p-4 card-shadow">
                        <p className="text-sm font-medium leading-relaxed">{msg.content}</p>
                      </div>
                    </div>
                  );
                } else {
                  const hasError = !!msg.error;
                  
                  return (
                    <div key={msg.id} className="flex justify-start animate-fadeIn">
                      <div className={`max-w-[85%] w-full rounded-2xl rounded-bl-[2px] p-5 border transition-all card-shadow ${
                        hasError 
                          ? 'bg-red-50/50 border-red-100 text-red-900' 
                          : 'bg-white border-slate-200 text-slate-900'
                      }`}>
                        
                        {/* Conversational sentence output */}
                        <div className="flex items-start gap-2.5">
                          {!hasError ? (
                            <div className="h-6 w-6 rounded-md bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0 mt-0.5">
                              <Sparkles className="h-3.5 w-3.5" />
                            </div>
                          ) : (
                            <div className="h-6 w-6 rounded-md bg-red-100 text-red-600 flex items-center justify-center shrink-0 mt-0.5">
                              <AlertCircle className="h-3.5 w-3.5" />
                            </div>
                          )}
                          
                          <div className="flex-1">
                            <FormattedAnswer text={msg.content} />
                            
                            {/* CODE INSPECTOR PANEL (only if code compiles and exists) */}
                            {msg.code && (
                              <div className="mt-4 border-t border-slate-100 pt-3">
                                <button
                                  onClick={() => toggleCodeExpansion(msg.id)}
                                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                                >
                                  <ChevronRight className={`h-3.5 w-3.5 transition-transform duration-200 ${expandedCodes[msg.id] ? 'rotate-90' : ''}`} />
                                  {expandedCodes[msg.id] ? 'Hide generated analysis code' : 'View generated analysis code'}
                                </button>
                                
                                {expandedCodes[msg.id] && (
                                  <div className="mt-2 text-[11px] font-mono bg-slate-950 text-indigo-300 rounded-lg p-3.5 overflow-x-auto border border-slate-800 shadow-inner select-all leading-relaxed">
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
            <div className="p-4 bg-white border-t border-slate-100">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleAsk(input);
                }}
                className="flex gap-3 bg-white border border-slate-200 rounded-full p-1.5 pl-6 shadow-xs focus-within:ring-2 focus-within:ring-indigo-500/20 focus-within:border-indigo-500 transition-all"
              >
                <input
                  id="query-input"
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  disabled={!dataset || isLoading}
                  placeholder={dataset ? "Ask about your data..." : "Upload a CSV to start asking..."}
                  className="flex-grow text-sm focus:outline-hidden bg-transparent border-0 placeholder:text-slate-400"
                />
                <button
                  type="submit"
                  disabled={!input.trim() || !dataset || isLoading}
                  className="w-10 h-10 flex items-center justify-center bg-indigo-500 text-white rounded-full hover:bg-indigo-600 transition-colors disabled:bg-slate-100 disabled:text-slate-350 cursor-pointer shadow-xs focus:outline-hidden shrink-0"
                >
                  <ArrowRight className="h-5 w-5" strokeWidth={2.5} />
                </button>
              </form>

              {/* INLINE STATUS WARNINGS */}
              {errorWarning && (
                <div className="flex items-center gap-1.5 text-xs text-amber-600 mt-2.5 px-2.5 animate-fadeIn">
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
