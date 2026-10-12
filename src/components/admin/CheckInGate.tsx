"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

interface CheckInGateProps {
  /** The currently stored token (read fresh, server-side — see /admin/security's page.tsx), or null if an admin has never generated one. */
  initialToken: string | null;
}

/**
 * The party-presence gate's admin control: renders the QR code for
 * whichever token is CURRENTLY stored every time this page loads — not only
 * right after tapping "Generate New Code" — by starting from the
 * server-provided `initialToken` (a fresh, uncached read; see
 * DataStore.getCheckInGateToken). "Generate New Code" mints a fresh random
 * token (POST /api/admin/checkin-gate/generate), which immediately
 * supersedes whatever token was valid before — there is at most one valid
 * token at a time (see checkInGate.ts). No expiry beyond that: this is
 * meant to be generated fresh the day of the party, with the admin
 * controlling its lifecycle manually rather than it timing out on its own.
 *
 * The QR code is generated client-side (the `qrcode` package, rendered to a
 * data URL) from the current token plus this browser's own origin, so the
 * admin can screen-capture or print it straight off this page without
 * needing the server to know its own public URL. Encodes a link to the
 * check-in entry point (the home page) with the token carried as a `token`
 * query string parameter — see HomeNavButtons.tsx, which claims it the
 * moment a guest lands here with it, and VerifyIdentityModal.tsx, which
 * refuses to start a fresh verification without a still-valid claim.
 *
 * The full link (and the token it carries) is never shown on this page
 * except behind the "Show link" toggle below, which starts collapsed on
 * every load — never in an alt attribute, a title attribute, hidden text,
 * or a console log. See /admin/security's page.tsx for the force-dynamic
 * export that keeps this whole page (and the token in it) off any cache.
 */
export function CheckInGate({ initialToken }: CheckInGateProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(initialToken);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [showLink, setShowLink] = useState(false);
  const [copied, setCopied] = useState(false);

  // Regenerates the QR whenever the token changes — on mount (from the
  // server-provided current token) and again right after "Generate New
  // Code" updates `token` below.
  useEffect(() => {
    if (!token) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(checkInUrlFor(token), { width: 320, margin: 2 })
      .then((dataUrl) => {
        if (!cancelled) setQrDataUrl(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setError("Failed to render the QR code.");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  function checkInUrlFor(t: string): string {
    return `${window.location.origin}/?token=${encodeURIComponent(t)}`;
  }

  async function handleGenerate() {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const res = await fetch("/api/admin/checkin-gate/generate", { method: "POST" });
      const body = (await res.json().catch(() => null)) as { token?: string; error?: string } | null;
      if (!res.ok || !body?.token) throw new Error(body?.error ?? "Failed to generate a new code.");
      setToken(body.token);
      setShowLink(false); // a freshly generated code starts hidden again, same as on page load
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate a new code.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy() {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(checkInUrlFor(token));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy — select the text and copy it manually.");
    }
  }

  return (
    <div className="surface-panel flex flex-col gap-3 rounded-lg p-4">
      <div>
        <h2 className="font-heading text-lg font-bold uppercase">Party Check-In Code</h2>
        <p className="text-sm text-muted">
          Guests must scan this QR code (or follow its link) before they can check in — generating a
          new code immediately invalidates the previous one, so do this once the party is actually
          starting, not ahead of time.
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

      {!token && <p className="text-sm text-muted">No code generated yet.</p>}

      {token && qrDataUrl && (
        <div className="flex flex-col items-center gap-2 self-start rounded bg-white p-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- a generated data: URL, not an optimizable local/remote asset */}
          <img src={qrDataUrl} alt="QR code for tonight's party check-in" width={320} height={320} />
        </div>
      )}

      {token && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => {
              setShowLink((v) => !v);
              setCopied(false);
            }}
            className="self-start text-sm text-muted underline hover:text-text"
          >
            {showLink ? "Hide link" : "Show link"}
          </button>
          {showLink && (
            <div className="flex flex-col gap-2">
              <textarea
                readOnly
                value={checkInUrlFor(token)}
                rows={2}
                onFocus={(e) => e.currentTarget.select()}
                className="field-input w-full resize-none bg-bg px-3 py-2 text-sm text-text"
              />
              <button
                type="button"
                onClick={handleCopy}
                className="self-start rounded bg-surface px-3 py-2 text-sm hover:bg-surface/80"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
