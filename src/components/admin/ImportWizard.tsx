"use client";

import { useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import type { GuestBracket } from "@/lib/config/types";

const BRACKET_OPTIONS: { value: GuestBracket; label: string }[] = [
  { value: "adult-male", label: "Adult Male" },
  { value: "adult-female", label: "Adult Female" },
  { value: "boy", label: "Boy" },
  { value: "girl", label: "Girl" },
];

interface Candidate {
  firstName: string;
  lastName: string;
  bracket: GuestBracket | null;
  raw: Record<string, string>;
  include: boolean;
}

interface ParsedImportResponse {
  mapperId: string;
  mapperLabel: string;
  candidates: Array<{
    firstName: string;
    lastName: string;
    bracket: GuestBracket | null;
    raw: Record<string, string>;
  }>;
}

/**
 * Admin-facing CSV import flow (requirements Section 5.1): upload -> review
 * mapped candidates -> assign a bracket (Evite exports don't include it)
 * -> confirm. The upload step only parses; nothing is written until Confirm.
 */
export function ImportWizard() {
  const router = useRouter();
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [mapperLabel, setMapperLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [importedCount, setImportedCount] = useState<number | null>(null);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    setImportedCount(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/import", { method: "POST", body: formData });
      const body = (await res.json()) as ParsedImportResponse & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Failed to parse CSV.");
      setMapperLabel(body.mapperLabel);
      setCandidates(body.candidates.map((c) => ({ ...c, include: true })));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse CSV.");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  function updateCandidate(index: number, updates: Partial<Candidate>) {
    setCandidates((prev) => prev?.map((c, i) => (i === index ? { ...c, ...updates } : c)) ?? null);
  }

  function markAllRemaining(bracket: GuestBracket) {
    setCandidates((prev) => prev?.map((c) => (c.bracket ? c : { ...c, bracket })) ?? null);
  }

  const included = candidates?.filter((c) => c.include) ?? [];
  const missingBracket = included.some((c) => !c.bracket);

  async function handleConfirm() {
    if (!candidates) return;
    setConfirming(true);
    setError(null);
    try {
      const res = await fetch("/api/import/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guests: included.map((c) => ({
            firstName: c.firstName,
            lastName: c.lastName,
            bracket: c.bracket,
          })),
        }),
      });
      const body = (await res.json()) as { guests?: unknown[]; error?: string };
      if (!res.ok || !body.guests) throw new Error(body.error ?? "Failed to import guests.");
      setImportedCount(body.guests.length);
      setCandidates(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import guests.");
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="surface-panel rounded-lg p-4">
        <label className="block text-sm text-muted">Upload Evite export CSV</label>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={handleFileChange}
          disabled={uploading}
          className="mt-2 text-text"
        />
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {importedCount !== null && (
        <p className="text-sm text-primary">Imported {importedCount} guest(s).</p>
      )}

      {candidates && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-muted">
              Detected format: <strong className="text-text">{mapperLabel}</strong>. Evite
              doesn&rsquo;t include bracket status — assign it below before confirming.
            </p>
            <div className="flex flex-wrap gap-2">
              {BRACKET_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => markAllRemaining(option.value)}
                  className="rounded bg-bg px-3 py-1 text-xs uppercase text-text hover:opacity-80"
                >
                  Mark remaining {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="surface-panel overflow-x-auto rounded-lg">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-bg text-muted">
                  <th className="px-3 py-2">Include</th>
                  <th className="px-3 py-2">First</th>
                  <th className="px-3 py-2">Last</th>
                  <th className="px-3 py-2">Bracket</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c, i) => (
                  <tr
                    key={i}
                    className={`border-b border-bg/50 ${
                      c.include && !c.bracket ? "bg-accent/10" : ""
                    }`}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={c.include}
                        onChange={(e) => updateCandidate(i, { include: e.target.checked })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        value={c.firstName}
                        onChange={(e) => updateCandidate(i, { firstName: e.target.value })}
                        className="w-28 rounded border border-transparent bg-transparent px-1 focus:border-muted focus:bg-bg"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        value={c.lastName}
                        onChange={(e) => updateCandidate(i, { lastName: e.target.value })}
                        className="w-28 rounded border border-transparent bg-transparent px-1 focus:border-muted focus:bg-bg"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={c.bracket ?? ""}
                        onChange={(e) =>
                          updateCandidate(i, {
                            bracket: (e.target.value || null) as GuestBracket | null,
                          })
                        }
                        className="rounded border border-muted bg-bg px-2 py-1 text-text"
                      >
                        <option value="">Choose…</option>
                        {BRACKET_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            onClick={handleConfirm}
            disabled={confirming || missingBracket || included.length === 0}
            className="self-start rounded bg-primary px-6 py-3 font-heading font-bold uppercase text-bg disabled:opacity-50"
          >
            {confirming ? "Importing…" : `Confirm Import (${included.length})`}
          </button>
          {missingBracket && (
            <p className="text-sm text-accent">Assign a bracket to every included row first.</p>
          )}
        </div>
      )}
    </div>
  );
}
