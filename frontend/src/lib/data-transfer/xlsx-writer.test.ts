import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { writeWorkbook } from './xlsx-writer';
import { buildReadme, buildSheets, EXPORT_TABLES, type BuiltSheet, type ExportData, type Row } from './workbook-schema';

// These run the REAL spreadsheet library and read the produced .xlsx back at the XML level, because the guarantees
// that matter (a string stays a string, a formula-looking value is never a formula, empty stays empty) are about what
// is physically in the file — not about what we asked the library to do.

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

async function openXlsx(sheets: BuiltSheet[]) {
  const files = unzipSync(await bytesOf(await writeWorkbook(sheets)));
  const text = (name: string) => strFromU8(files[name]);
  const sheetNames = [...text('xl/workbook.xml').matchAll(/<sheet [^>]*name="([^"]+)"/g)].map((m) => m[1]);
  const shared = [...text('xl/sharedStrings.xml').matchAll(/<si><t[^>]*>([\s\S]*?)<\/t><\/si>/g)].map((m) =>
    m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  );
  return { files, sheetNames, shared, sheetXml: (index: number) => text(`xl/worksheets/sheet${index}.xml`) };
}

const sample: BuiltSheet = {
  name: 'Members',
  headers: ['phone', 'weight_kg', 'note'],
  rows: [
    ['0987654321', 62.5, '=HYPERLINK("http://evil")'],
    [null, 7, 'a & <b> "quoted"'],
    ['+919999999999', 0, '@SUM(A1)'],
  ],
  widths: [14, 10, 30],
};

describe('writeWorkbook (real library, inspected at the XML level)', () => {
  it('produces a zip with one worksheet per sheet, named and ordered as given', async () => {
    const { sheetNames, files } = await openXlsx([
      { name: 'README', headers: ['item', 'value'], rows: [], widths: [10, 10] },
      sample,
      { name: 'AuditLog_2', headers: ['id'], rows: [[1]], widths: [8] },
    ]);
    expect(sheetNames).toEqual(['README', 'Members', 'AuditLog_2']);
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet3.xml']));
  });

  it('stores text values as STRING cells — leading zeros and a leading + survive', async () => {
    const { sheetXml, shared } = await openXlsx([sample]);
    const xml = sheetXml(1);
    expect(shared).toEqual(expect.arrayContaining(['0987654321', '+919999999999']));
    // A1 header, A2 = the phone: both shared-string cells (t="s"), not numeric cells.
    expect(xml).toMatch(/<c r="A2"[^>]*t="s"/);
    expect(xml).toMatch(/<c r="A4"[^>]*t="s"/);
  });

  it('stores numbers as NUMERIC cells (no t attribute) and keeps zero', async () => {
    const xml = (await openXlsx([sample])).sheetXml(1);
    expect(xml).toMatch(/<c r="B2"><v>62\.5<\/v><\/c>/);
    expect(xml).toMatch(/<c r="B4"><v>0<\/v><\/c>/);
  });

  it('never creates a formula — text that looks like one is kept as plain text and the sheet has no <f> element', async () => {
    const { sheetXml, shared } = await openXlsx([sample]);
    expect(shared).toEqual(expect.arrayContaining(['=HYPERLINK("http://evil")', '@SUM(A1)']));
    expect(sheetXml(1)).not.toMatch(/<f[ >]/);
    expect(sheetXml(1)).toMatch(/<c r="C2"[^>]*t="s"/);
  });

  it('leaves null cells out entirely and escapes XML-special characters in text', async () => {
    const { sheetXml, shared } = await openXlsx([sample]);
    expect(sheetXml(1)).not.toMatch(/r="A3"/);
    expect(shared).toContain('a & <b> "quoted"');
  });

  it('makes the header row bold and frozen, and applies the column widths', async () => {
    const xml = (await openXlsx([sample])).sheetXml(1);
    expect(xml).toMatch(/<pane ySplit="1"[^>]*state="frozen"/);
    expect(xml).toMatch(/<c r="A1" s="1" t="s">/);
    expect(xml).toMatch(/<col min="1" max="1" width="14"/);
    expect(xml).toMatch(/<col min="3" max="3" width="30"/);
  });

  it('writes a full export built from the schema: every sheet present, README first', async () => {
    const data = Object.fromEntries(EXPORT_TABLES.map((t) => [t, [] as Row[]])) as ExportData;
    data.members = [
      {
        id: 1, name: 'Meera', phone: '0987654321', date_of_birth: '1990-05-01', date_of_joining: '2026-01-15', gender: 'Female',
        weight_kg: 60, height_cm: 160, under_doctor_care: false, emergency_contact_name: 'R', emergency_contact_phone: '0123456789',
        emergency_contact_relationship: 'Spouse', branch_id: 1, member_number: 'MUM-2026-0001',
      },
    ];
    const built = buildSheets(data, { includeAuditLog: true, photoFiles: new Map() });
    const readme = buildReadme({
      exportedAt: '2026-10-06T00:00:00.000Z', exportedBy: 'a@b.c', sourceProject: 'p', includeAuditLog: true, photoParts: 0,
      counts: built.counts, truncatedCells: 0, cleanedCells: 0, warnings: [],
    });
    const { sheetNames, shared } = await openXlsx([readme, ...built.sheets]);
    expect(sheetNames).toEqual(['README', ...built.sheets.map((s) => s.name)]);
    expect(sheetNames).toHaveLength(12);
    expect(shared).toEqual(expect.arrayContaining(['schema_version', '0987654321', 'MUM-2026-0001']));
  });

  it('copes with a sheet that has headers but no rows', async () => {
    const { sheetNames } = await openXlsx([{ name: 'Branches', headers: ['id', 'name'], rows: [], widths: [8, 20] }]);
    expect(sheetNames).toEqual(['Branches']);
  });
});
