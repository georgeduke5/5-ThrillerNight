"use client";

import { useState } from "react";

/**
 * One-time manual step after deploying field-level phone encryption (see
 * PRODUCTION_DEPLOY.md): encrypts any guest phone numbers still sitting in
 * plaintext in the Sheet from before this existed. Safe to click more than
 * once — already-encrypted rows are skipped and reported separately, so
 * there's no harm in running it again "just in case."
 */
export function MigratePhoneEncryptionButton() {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/admin/migrate-phone-encryption", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setStatus(body.error ?? "Migration failed.");
        return;
      }
      setStatus(
        `Encrypted ${body.migrated} phone number(s). ${body.alreadyEncrypted} were already encrypted, ${body.skippedEmpty} had none on file.`,
      );
    } catch {
      setStatus("Migration failed — check the server logs.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="surface-panel flex flex-col gap-2 rounded-lg p-4">
      <p className="text-sm text-muted">
        Encrypt any guest phone numbers still stored as plaintext from before field-level
        encryption existed. Safe to run more than once.
      </p>
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className="self-start rounded bg-surface px-3 py-2 text-sm hover:bg-surface/80 disabled:opacity-50"
      >
        {busy ? "Encrypting…" : "Encrypt legacy phone numbers"}
      </button>
      {status && <p className="text-sm text-accent">{status}</p>}
    </div>
  );
}
