import type { GuestBracket } from "@/lib/config/types";

/** One fully validated guest row from an import CSV, ready to write. */
export interface ImportedGuest {
  firstName: string;
  lastName: string;
  bracket: GuestBracket;
  phone: string;
}

/** A problem with one row of the file, numbered the way a spreadsheet app shows it (the first line of the file is row 1). */
export interface ImportRowError {
  row: number;
  message: string;
}
