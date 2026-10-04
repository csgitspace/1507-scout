// A tiny in-memory stand-in for the parts of Google Apps Script the dashboard
// uses, so the real dashboard/*.js code can run under `npm test`.
// It mimics two Sheets behaviours that matter:
//   - a string starting with "=" becomes a formula (we store a marker)
//   - a leading apostrophe forces plain text and is not part of the value

import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { fieldsJs } from '../../tools/dashboard.js';

const DASH = fileURLToPath(new URL('../../dashboard/', import.meta.url));
export const FORMULA = '#FORMULA!';

class FakeSheet {
  constructor(name) { this.name = name; this.data = []; this.protections = []; }
  getName() { return this.name; }
  getLastRow() {
    for (let r = this.data.length - 1; r >= 0; r--) if (this.data[r].some(v => v !== '' && v !== undefined)) return r + 1;
    return 0;
  }
  getLastColumn() {
    let max = 0;
    for (const row of this.data) for (let c = row.length - 1; c >= 0; c--) if (row[c] !== '' && row[c] !== undefined) { max = Math.max(max, c + 1); break; }
    return max;
  }
  getRange(row, col, numRows = 1, numCols = 1) {
    if (row < 1 || col < 1 || numRows < 1 || numCols < 1) throw new Error(`Bad range ${row},${col},${numRows},${numCols}`);
    const sheet = this;
    return {
      getValues() {
        const out = [];
        for (let r = 0; r < numRows; r++) {
          const src = sheet.data[row - 1 + r] || [];
          const line = [];
          for (let c = 0; c < numCols; c++) line.push(src[col - 1 + c] === undefined ? '' : src[col - 1 + c]);
          out.push(line);
        }
        return out;
      },
      setValues(values) {
        if (values.length !== numRows || values.some(v => v.length !== numCols)) {
          throw new Error(`setValues size mismatch: range ${numRows}x${numCols}, data ${values.length}x${values[0] && values[0].length}`);
        }
        for (let r = 0; r < numRows; r++) {
          const target = sheet.data[row - 1 + r] ||= [];
          for (let c = 0; c < numCols; c++) {
            let v = values[r][c];
            if (typeof v === 'string' && v.startsWith("'")) v = v.slice(1);
            else if (typeof v === 'string' && v.startsWith('=')) v = FORMULA;
            target[col - 1 + c] = v === null || v === undefined ? '' : v;
          }
        }
        for (let r = 0; r < row - 1; r++) sheet.data[r] ||= [];
        return this;
      },
    };
  }
  clearContents() { this.data = []; return this; }
  setFrozenRows() { return this; }
  protect() {
    const p = { description: '', setDescription(d) { this.description = d; return this; }, getEditors: () => [],
      removeEditors() { return this; }, canDomainEdit: () => false, setDomainEdit() { return this; } };
    this.protections.push(p);
    return p;
  }
  getProtections() { return this.protections; }
  /** Test helper: rows as objects keyed by the header row. */
  objects() {
    const [head = [], ...rows] = this.data;
    return rows.filter(r => r.some(v => v !== '')).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] === undefined ? '' : r[i]])));
  }
}

export class FakeSpreadsheet {
  constructor() { this.sheets = new Map(); }
  getSheetByName(name) { return this.sheets.get(name) || null; }
  insertSheet(name) {
    if (this.sheets.has(name)) throw new Error(`Sheet ${name} exists`);
    const s = new FakeSheet(name); this.sheets.set(name, s); return s;
  }
}

/**
 * Loads one Apps Script project (common files + the project's Code.js) into a
 * fresh VM context wired to `ss`. user.email controls Session.getActiveUser().
 */
export function loadProject(project, ss, { sheetId = 'SHEET', token = 'secret-token', user = { email: 'mentor@example.com' } } = {}) {
  const context = vm.createContext({
    console,
    SpreadsheetApp: { openById: () => ss, getActiveSpreadsheet: () => ss, ProtectionType: { SHEET: 'SHEET' } },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (s) => ({ content: s, setMimeType() { return this; }, getContent() { return s; } }),
    },
    Session: { getActiveUser: () => ({ getEmail: () => user.email }), getEffectiveUser: () => ({ getEmail: () => user.email }) },
    HtmlService: {},
  });
  const sources = [
    fieldsJs(),
    `var SHEET_ID = ${JSON.stringify(sheetId)}; var SYNC_TOKEN = ${JSON.stringify(token)};`,
    readFileSync(`${DASH}common/Sheets.js`, 'utf8'),
    readFileSync(`${DASH}common/Summary.js`, 'utf8'),
    readFileSync(`${DASH}${project}/Code.js`, 'utf8'),
  ];
  for (const src of sources) vm.runInContext(src, context);
  return context;
}

/** Values made inside the VM have different prototypes; compare them as plain JSON. */
export const plain = (x) => JSON.parse(JSON.stringify(x));
