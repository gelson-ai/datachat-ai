# Code Literacy Walkthrough — `processFile`

## STEP 1 — Scope

| | |
|---|---|
| **File** | `src/App.tsx` |
| **Function** | `processFile` |
| **Line range** | 197–265 (69 lines) |

This function turns a user-supplied CSV file into the in-memory dataset the rest of the app works with. It was chosen because it has real logic (validation, async file I/O, parsing, header collection, type inference, coercion, error handling) while staying self-contained — the only helpers it calls are small, same-file functions whose *intent* is enough to explain.

---

## STEP 2 — Context

### 2.1 Every call site

| Location | Code | Context |
|---|---|---|
| `src/App.tsx:186` | `processFile(files[0]);` | Inside `handleDrop` — fired when a file is dropped on the upload dropzone |
| `src/App.tsx:193` | `processFile(files[0]);` | Inside `handleFileChange` — fired when a file is chosen via the hidden `<input type="file">` |

These are the only two call sites in the codebase. `processFile` is a closure defined inside the `App` component and is not exported.

### 2.2 Parameters

| Parameter | Type | What it represents |
|---|---|---|
| `file` | `File` | A native browser `File` object (Web File API) representing the CSV the user selected or dropped. It is used in two ways: `file.name` (for extension validation and as the stored dataset filename) and passed to `FileReader.readAsText(file)` to read its contents. |

---

## STEP 3 — Line-by-Line Breakdown

| Line | Code | What it does & why |
|---|---|---|
| 197 | `const processFile = (file: File) => {` | Declares the function that turns one user-supplied file into a dataset. It takes the browser's native `File` object, and everything below is asynchronous because reading a file and parsing CSV both happen off the main thread. |
| 198 | `setUploadError(null);` | Clears any previous upload error so the user isn't shown a stale message while the new file processes. |
| 199 | `if (!file.name.toLowerCase().endsWith('.csv')) {` | Validates the extension before doing any work. Lowercasing first makes `.CSV` and `.Csv` pass too. |
| 200 | `setUploadError('Unsupported file type. Please upload a valid CSV file.');` | Sets a human-readable error message for the invalid type. |
| 201 | `return;` | Exits early — we never touch the file if it isn't a CSV. Early returns keep the happy path flat instead of deeply nested. |
| 202 | `}` | Closes the extension guard. |
| 203 | *(blank line)* | Visual separation between the validation guard and the async file-read setup. |
| 204 | `const reader = new FileReader();` | Creates the browser's `FileReader` — the API that reads local file contents asynchronously without blocking the UI. |
| 205 | `reader.onload = (event) => {` | Registers the success callback. It fires later, once the file has been fully read into memory. |
| 206 | `const text = event.target?.result as string;` | Pulls the file's raw text out of the load event. Optional chaining guards against a missing target, and the cast tells TypeScript we expect a string. |
| 207 | *(blank line)* | Separates reading the text from parsing it. |
| 208 | `Papa.parse(text, {` | Hands the raw CSV text to PapaParse — a CSV-parsing library — along with configuration options. |
| 209 | `header: true,` | Tells PapaParse to treat the first row as column names, so each result becomes an object keyed by header. |
| 210 | `dynamicTyping: true,` | Lets PapaParse auto-convert values that look like numbers or booleans to their JS types, rather than leaving everything as strings. |
| 211 | `skipEmptyLines: 'greedy',` | Skips blank lines aggressively so empty trailing rows don't produce garbage records. |
| 212 | `complete: (results) => {` | Registers the callback that runs when parsing finishes successfully. |
| 213 | `const rawRows = results.data as any[];` | Extracts the parsed row array from PapaParse's result object, casting to `any[]` because the shape is dynamic. |
| 214 | `if (!rawRows || rawRows.length === 0) {` | Guards against an empty file or a parse that produced zero rows. |
| 215 | `setUploadError('The selected CSV file appears to be empty.');` | Reports the specific failure to the user. |
| 216 | `return;` | Bails out before any dataset state is touched. |
| 217 | `}` | Closes the empty-data guard. |
| 218 | *(blank line)* | Separates the empty check from header collection. |
| 219 | `// Gather complete set of headers` | Comment marking the next step: collecting column names. |
| 220 | `const headersSet = new Set<string>();` | Starts a `Set` to collect every unique column name — a `Set` deduplicates automatically. |
| 221 | `rawRows.forEach(row => {` | Iterates over every parsed row. |
| 222 | `Object.keys(row).forEach(key => headersSet.add(key));` | Adds each row's keys to the set. This handles ragged rows where some records are missing columns. |
| 223 | `});` | Ends the row iteration. |
| 224 | `const headers = Array.from(headersSet);` | Converts the `Set` into an ordered array so downstream code can index columns predictably. |
| 225 | *(blank line)* | Separates header collection from the next validation. |
| 226 | `if (headers.length === 0) {` | Guards against the case where no headers were found at all. |
| 227 | `setUploadError('No valid headers or columns found in the CSV.');` | Tells the user the file has no valid columns. |
| 228 | `return;` | Stops processing — there's nothing useful to build a dataset from. |
| 229 | `}` | Closes the no-headers guard. |
| 230 | *(blank line)* | Separates validation from type inference. |
| 231 | `// Infer types of each column` | Comment marking the type-inference step. |
| 232 | `const types = inferColumnTypes(headers, rawRows);` | Calls our helper to classify each column as `'number'` or `'string'` by sampling up to 100 rows. Only its result matters here — not its internals. |
| 233 | *(blank line)* | Separates inference from the numeric-column guard. |
| 234 | `// Guard: Verify there is at least one numeric column` | Comment marking the next validation. |
| 235 | `const numericCols = Object.keys(types).filter(col => types[col] === 'number');` | Builds a list of column names that were classified as numeric. |
| 236 | `if (numericCols.length === 0) {` | Guards for the app's core requirement: this tool can only analyze numerical data. |
| 237 | `setUploadError('This file has no numerical data — please upload a CSV with number columns');` | Rejects the file with a clear message when no column is numeric. |
| 238 | `return;` | Stops processing before committing a useless dataset. |
| 239 | `}` | Closes the numeric-column guard. |
| 240 | *(blank line)* | Separates validation from data cleaning. |
| 241 | `// Clean, coerce, and structure dataset` | Comment marking the cleaning step. |
| 242 | `const cleanedRows = cleanAndCoerceData(headers, rawRows, types);` | Runs each raw row through our cleaning helper: number columns become real numbers (or `null`), strings become strings, producing a uniform `Row[]`. Again, only the intent matters. |
| 243 | *(blank line)* | Separates cleaning from state commit. |
| 244 | `setDataset({` | Commits the fully processed dataset to React state — this single update is what re-renders the app with the new data. |
| 245 | `filename: file.name,` | Keeps the original filename for display. |
| 246 | `headers,` | Shorthand for `headers: headers` — the collected column names. |
| 247 | `types,` | Shorthand for `types: types` — the inferred column types. |
| 248 | `rows: cleanedRows,` | The cleaned row objects. |
| 249 | `totalRows: cleanedRows.length` | The row count, derived from the cleaned array. |
| 250 | `});` | Closes the `setDataset` call. |
| 251 | *(blank line)* | Separates the dataset commit from chat cleanup. |
| 252 | `// Clear any active chat logs when uploading a new CSV` | Comment explaining the next step's purpose. |
| 253 | `setMessages([]);` | Wipes chat history so old answers about a previous dataset don't appear next to the new one. |
| 254 | `},` | Closes the `complete` callback. |
| 255 | `error: (err) => {` | Registers PapaParse's failure callback, for when the CSV itself is malformed. |
| 256 | ``setUploadError(`Failed parsing CSV file: ${err.message}`);`` | Surfaces the parser's specific error to the user, so a malformed CSV gets a precise message instead of a silent failure. |
| 257 | `}` | Closes the error callback. |
| 258 | `});` | Closes the `Papa.parse` call. |
| 259 | `};` | Closes the `reader.onload` callback. |
| 260 | *(blank line)* | Separates the load handler from the error handler. |
| 261 | `reader.onerror = () => {` | Registers `FileReader`'s own error callback, for cases where the file can't be read at all (permissions, disk issues). |
| 262 | `setUploadError('Error reading CSV file.');` | Reports a generic read failure to the user. |
| 263 | `};` | Closes the `onerror` callback. |
| 264 | `reader.readAsText(file);` | Kicks off the actual read. This triggers `onload` (or `onerror`) asynchronously — it's deliberately last so both handlers are attached before reading starts. |
| 265 | `};` | Closes `processFile`. |
