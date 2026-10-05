import { supabase } from '../lib/supabase-client';
import { extractFunctionErrorMessage } from '../lib/edge-function-error';
import type { ExportTable, Row } from '../lib/data-transfer/workbook-schema';

export interface ExportPage {
  rows: Row[];
  /** Cursor for the next page; `null` once the last (empty) page has been read. */
  next: number | null;
  /** Supabase project ref the data came from (README `source_project`). */
  project_ref: string;
}

/**
 * Data access for REQ-ADMIN-007 (spec/backend/data-export-import.md §4). Reads go through the admin-only
 * `export-data` Edge Function — it can see soft-deleted rows, which RLS hides from a normal client read.
 * Photo bytes are read straight from the private `member-photos` bucket with the admin's own session
 * (the existing storage read policy), never through a function.
 */
export const dataTransferRepository = {
  async exportPage(table: ExportTable, after: number | null, limit: number): Promise<ExportPage> {
    const { data, error } = await supabase.functions.invoke('export-data', { body: { table, after, limit } });
    if (error) throw new Error(await extractFunctionErrorMessage(error));
    return data as ExportPage;
  },

  async downloadPhoto(path: string): Promise<Blob> {
    const { data, error } = await supabase.storage.from('member-photos').download(path);
    if (error || !data) throw new Error(error?.message ?? 'Photo not found');
    return data;
  },
};

export type DataTransferRepository = typeof dataTransferRepository;
