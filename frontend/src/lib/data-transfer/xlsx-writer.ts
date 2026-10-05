import type { BuiltSheet, CellValue } from './workbook-schema';

type LibCell = import('write-excel-file/browser').Cell;

/** A string value is ALWAYS a string cell (never a number or a formula); a number is a number cell; empty stays empty. */
function toCell(value: CellValue): LibCell {
  if (value === null) return null;
  return typeof value === 'number' ? { value, type: Number } : { value, type: String };
}

/**
 * Builds the .xlsx from already-formatted sheets. The spreadsheet library is loaded with a dynamic
 * import so it ships in its own chunk and only downloads when an export actually runs — it never
 * touches the main bundle (spec/frontend/data-export-import.md §5).
 */
export async function writeWorkbook(sheets: BuiltSheet[]): Promise<Blob> {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  return writeXlsxFile(
    sheets.map((sheet) => ({
      sheet: sheet.name,
      data: [
        sheet.headers.map((header): LibCell => ({ value: header, type: String, fontWeight: 'bold' })),
        ...sheet.rows.map((row) => row.map(toCell)),
      ],
      columns: sheet.widths.map((width) => ({ width })),
      stickyRowsCount: 1,
    }))
  ).toBlob();
}
