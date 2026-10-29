/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DatasetTargetDietary } from '../images/types.js';

export interface DatasetTargetImportRow {
  sourceId?: string;
  name: string;
  category: string;
  dietary: DatasetTargetDietary;
  region?: string;
  notes?: string;
}

const MAX_IMPORT_ROWS = 25_000;

function parseDelimitedRows(input: string, delimiter: ',' | '\t'): string[][] {
  const text = input.replace(/^\uFEFF/u, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field.trim() === '') {
      field = '';
      quoted = true;
    } else if (char === delimiter) {
      row.push(field.trim());
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index++;
      row.push(field.trim());
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (quoted) throw new Error('CSV contains an unfinished quoted value. Check the file and try again.');
  row.push(field.trim());
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/gu, '');
}

function detectDelimiter(firstLine: string): ',' | '\t' {
  let quoted = false;
  let commas = 0;
  let tabs = 0;
  for (let index = 0; index < firstLine.length; index++) {
    const char = firstLine[index];
    if (char === '"' && firstLine[index + 1] === '"' && quoted) {
      index++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === ',') {
      commas++;
    } else if (!quoted && char === '\t') {
      tabs++;
    }
  }
  return tabs > commas ? '\t' : ',';
}

function columnIndex(headers: string[], aliases: string[]): number {
  return headers.findIndex((header) => aliases.includes(normalizeHeader(header)));
}

function valueAt(row: string[], index: number): string {
  return index >= 0 ? (row[index] ?? '').trim() : '';
}

function parseDietary(primary: string, vegetarian: string, rowNumber: number): DatasetTargetDietary {
  const value = (primary || vegetarian).toLowerCase().replace(/[^a-z]/gu, '');
  if (!value || ['unknown', 'unspecified', 'na', 'notspecified'].includes(value)) return 'unknown';
  if (['veg', 'vegetarian', 'yes', 'true', '1'].includes(value)) return 'veg';
  if (['vegan'].includes(value)) return 'vegan';
  if (['nonveg', 'nonvegetarian', 'no', 'false', '0'].includes(value)) return 'non-veg';
  if (['egg', 'eggetarian'].includes(value)) return 'egg';
  if (['mixed', 'checkingredients', 'vegetarianornonvegetarian'].includes(value)) return 'mixed';
  throw new Error(`Row ${rowNumber}: unsupported dietary value “${primary || vegetarian}”.`);
}

/** Parse a header-based CSV/TSV or the legacy Name,Category,Dietary,Region,Notes row format. */
export function parseDatasetTargetImport(input: string): DatasetTargetImportRow[] {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error('Choose a non-empty CSV/TSV file or paste spreadsheet rows.');
  }

  const firstLine = input.replace(/^\uFEFF/u, '').split(/\r?\n/u).find((line) => line.trim()) ?? '';
  const delimiter = detectDelimiter(firstLine);
  const rows = parseDelimitedRows(input, delimiter);
  if (rows.length < 2) throw new Error('The file must include a header row and at least one dish row.');

  const headers = rows[0];
  const nameColumn = columnIndex(headers, ['name', 'dishname', 'itemname', 'foodname', 'title']);
  const categoryColumn = columnIndex(headers, ['category', 'menucategory', 'course']);
  const hasHeader = nameColumn >= 0 && categoryColumn >= 0;
  const header = hasHeader ? headers : [];
  const startAt = hasHeader ? 1 : 0;
  const nameIndex = hasHeader ? columnIndex(header, ['name', 'dishname', 'itemname', 'foodname', 'title']) : 0;
  const categoryIndex = hasHeader ? columnIndex(header, ['category', 'menucategory', 'course']) : 1;
  const dietIndex = hasHeader ? columnIndex(header, ['diet', 'dietary', 'diettype', 'foodtype']) : 2;
  const vegetarianIndex = hasHeader ? columnIndex(header, ['isvegetarian', 'vegetarian', 'isveg']) : -1;
  const regionIndex = hasHeader ? columnIndex(header, ['region', 'cuisine', 'origin']) : 3;
  const notesIndex = hasHeader ? columnIndex(header, ['notes', 'description', 'details']) : 4;
  const sourceIdIndex = hasHeader ? columnIndex(header, ['itemid', 'id', 'sourceid']) : -1;

  if (nameIndex < 0 || categoryIndex < 0) {
    throw new Error('Could not find dish name and category columns. Expected headers such as item_name and menu_category.');
  }

  const parsed: DatasetTargetImportRow[] = [];
  for (let index = startAt; index < rows.length; index++) {
    const row = rows[index];
    const name = valueAt(row, nameIndex);
    const category = valueAt(row, categoryIndex);
    const sourceRow = index + 1;
    if (!name && !category && row.every((cell) => !cell)) continue;
    if (!name) throw new Error(`Row ${sourceRow}: dish name is required.`);
    if (!category) throw new Error(`Row ${sourceRow}: category is required.`);

    const primaryDiet = valueAt(row, dietIndex);
    const vegetarian = valueAt(row, vegetarianIndex);
    parsed.push({
      sourceId: valueAt(row, sourceIdIndex) || undefined,
      name,
      category,
      dietary: parseDietary(primaryDiet, vegetarian, sourceRow),
      region: valueAt(row, regionIndex) || undefined,
      notes: valueAt(row, notesIndex) || undefined,
    });
    if (parsed.length > MAX_IMPORT_ROWS) {
      throw new Error(`Import is limited to ${MAX_IMPORT_ROWS.toLocaleString()} rows at a time.`);
    }
  }

  if (parsed.length === 0) throw new Error('No dish rows were found in the file.');
  return parsed;
}
