"use client";

import { useState } from "react";
import QRCode from "qrcode";

/**
 * The party-presence gate's admin control: "Generate New Code" mints a
 * fresh, random token (POST /api/admin/checkin-gate/generate), which
 * immediately supersedes whatever token was valid before — there is at most
 * one valid token at a time (see DataStore.getCheckInGateToken /
 * checkInGate.ts). No expiry beyond that: this is meant to be generated
 * fresh the day of the party, with the admin controlling its lifecycle
 * manually rather than it timing out on its own.
 *
 * The QR code is generated client-side (the `qrcode` package, rendered to a
 * data URL) from the current token plus this browser's own origin, so the
 * admin can screen-capture or print it straight off this page without
 * needing the server to know its own public URL. Encodes a link to the
 * check-in entry point (the home page) with the token carried as a `token`
 * query string parameter — see HomeNavButtons.tsx, which claims it the
 * moment a guest lands here with it, and VerifyIdentityModal.tsx, which
 * refuses to start a fresh verification without a still-valid claim.
 */
export function CheckInGate() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [checkInUrl, setCheckInUrl] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  async function handleGenerate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/checkin-gate/generate", { method: "POST" });
      const body = (await res.json().catch(() => null)) as { token?: string; error?: string } | null;
      if (!res.ok || !body?.token) throw new Error(body?.error ?? "Failed to generate a new code.");

      const url = `${window.location.origin}/?token=${encodeURIComponent(body.token)}`;
      const dataUrl = await QRCode.toDataURL(url, { width: 320, margin: 2 });

      setToken(body.token);
      setCheckInUrl(url);
      setQrDataUrl(dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate a new code.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="surface-panel flex flex-col gap-3 rounded-lg p-4">
      <div>
        <h2 className="font-heading text-lg font-bold uppercase">Party Check-In Code</h2>
        <p className="text-sm text-muted">
          Generates a one-time code for tonight. Guests must scan this QR code (or follow its link)
          before they can check in — generating a new code immediately invalidates the previous one,
          so do this once the party is actually starting, not ahead of time.
        </p>
      </div>
      <button
        type="button"
        onClick={handleGenerate}
        disabled={busy}
        className="self-start rounded bg-surface px-3 py-2 text-sm hover:bg-surface/80 disabled:opacity-50"
      >
        {busy ? "Generating…" : token ? "Generate New Code" : "Generate Code"}
      </button>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {qrDataUrl && checkInUrl && (
        <div className="flex flex-col items-center gap-2 self-start rounded bg-white p-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- a generated data: URL, not an optimizable local/remote asset */}
          <img src={qrDataUrl} alt={`QR code linking to ${checkInUrl}`} width={320} height={320} />
          <p className="max-w-xs break-all text-center text-xs text-black">{checkInUrl}</p>
        </div>
      )}
    </div>
  );
}
