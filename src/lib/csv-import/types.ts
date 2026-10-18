import type { GuestBracket } from "@/lib/config/types";

/** One fully validated guest row from an import CSV, ready to write. */
export interface ImportedGuest {
  firstName: string;
  lastName: string;
  bracket: GuestBracket;
  /** A real 10-digit number, or null when the row had none (blank, a placeholder like "n/a", or anything else that isn't one). */
  phone: string | null;
}

/** A problem with one row of the file, numbered the way a spreadsheet app shows it (the first line of the file is row 1). */
export interface ImportRowError {
  row: number;
  message: string;
}

/** Something worth a look on a row that's still imported, such as a missing name or no phone on file. Numbered like ImportRowError. */
export interface ImportRowWarning {
  row: number;
  message: string;
}
