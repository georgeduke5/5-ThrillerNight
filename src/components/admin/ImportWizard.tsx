"use client";

import { useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import type { GuestBracket } from "@/lib/config/types";
import type { ImportedGuest, ImportRowError } from "@/lib/csv-import/types";
import { PhotoUploadButton } from "@/components/PhotoUploadButton";

const BRACKET_LABELS: Record<GuestBracket, string> = {
  "adult-male": "Adult Male",
  "adult-female": "Adult Female",
  boy: "Boy",
  girl: "Girl",
};

interface ParsedImportResponse {
  guests?: ImportedGuest[];
  error?: string;
  rowErrors?: ImportRowError[];
}

/**
 * Admin-facing CSV import flow: upload -> review the validated rows ->
 * confirm. The file's own Category column sets each guest's bracket, so
 * there's nothing to assign here. The upload step only parses and
 * validates; a file with any bad row is rejected outright with every
 * problem listed by row number, and nothing is written until Confirm.
 */
export function ImportWizard() {
  const router = useRouter();
  const [guests, setGuests] = useState<ImportedGuest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<ImportRowError[]>([]);
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [importedCount, setImportedCount] = useState<number | null>(null);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    setRowErrors([]);
    setGuests(null);
    setImportedCount(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/import", { method: "POST", body: formData });
      const body = (await res.json().catch(() => ({}))) as ParsedImportResponse;
      if (!res.ok || !body.guests) {
        setRowErrors(body.rowErrors ?? []);
        throw new Error(body.error ?? "Failed to parse CSV.");
      }
      setGuests(body.guests);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse CSV.");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  async function handleConfirm() {
    if (!guests) return;
    setConfirming(true);
    setError(null);
    try {
      const res = await fetch("/api/import/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guests: guests.map((g) => ({
            firstName: g.firstName,
            lastName: g.lastName,
            category: BRACKET_LABELS[g.bracket],
            phone: g.phone,
          })),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { guests?: unknown[]; error?: string };
      if (!res.ok || !body.guests) throw new Error(body.error ?? "Failed to import guests.");
      setImportedCount(body.guests.length);
      setGuests(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import guests.");
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="surface-panel flex flex-col gap-3 rounded-lg p-4">
        <p className="text-text">
          <strong>CSV format:</strong> First Name, Last Name, Category, Phone Number.
          <br />
          Category must be one of: Adult Male, Adult Female, Boy, Girl.
        </p>
        <p className="text-sm text-muted">
          One guest per row, columns in that order. A header row is optional. Every field is required.
        </p>
        <div>
          <PhotoUploadButton
            label={uploading ? "Checking file…" : "Choose CSV File"}
            onChange={handleFileChange}
            accept=".csv,text/csv"
            disabled={uploading || confirming}
          />
        </div>
      </div>

      {error && (
        <div role="alert" className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-red-400">{error}</p>
          {rowErrors.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm text-red-400">
              {rowErrors.map((e) => (
                <li key={e.row}>
                  <strong>Row {e.row}:</strong> {e.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {importedCount !== null && (
        <p className="text-sm text-primary">Imported {importedCount} guest(s).</p>
      )}

      {guests && (
        <div className="flex flex-col gap-4">
          <p className="text-muted">
            All {guests.length} row(s) look good. Review them, then confirm to import.
          </p>

          <div className="surface-panel overflow-x-auto rounded-lg">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-bg text-muted">
                  <th className="px-3 py-2">First Name</th>
                  <th className="px-3 py-2">Last Name</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Phone Number</th>
                </tr>
              </thead>
              <tbody>
                {guests.map((g, i) => (
                  <tr key={i} className="border-b border-bg/50">
                    <td className="px-3 py-2">{g.firstName}</td>
                    <td className="px-3 py-2">{g.lastName}</td>
                    <td className="px-3 py-2">{BRACKET_LABELS[g.bracket]}</td>
                    <td className="px-3 py-2">{g.phone}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleConfirm}
              disabled={confirming}
              className="rounded bg-primary px-6 py-3 font-heading font-bold uppercase text-bg disabled:opacity-50"
            >
              {confirming ? "Importing…" : `Confirm Import (${guests.length})`}
            </button>
            <button
              type="button"
              onClick={() => setGuests(null)}
              disabled={confirming}
              className="rounded bg-bg px-6 py-3 font-heading font-bold uppercase text-text disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
