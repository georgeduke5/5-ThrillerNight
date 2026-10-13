"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

interface PrintCheckInCodeProps {
  /** The currently stored token (read fresh, server-side — see /admin/security/print's page.tsx), or null if an admin has never generated one. */
  token: string | null;
}

/**
 * The entire content of /admin/security/print: nothing but a large, bold
 * heading and the current party-presence QR code at a size meant to be
 * printed, posted at the party, and scanned from a few feet away — no admin
 * nav, stats, or Danger Zone, unlike every other /admin page (see that
 * route's page.tsx, which deliberately sits outside the (protected) route
 * group's layout so it skips that shared chrome entirely while still
 * requiring the same admin check).
 *
 * Builds the QR the same way CheckInGate.tsx does (the `qrcode` package,
 * client-side, from the token plus this browser's own origin) so printing
 * works straight off whatever device opened this page, with no dependency
 * on the server knowing its own public URL.
 */
export function PrintCheckInCode({ token }: PrintCheckInCodeProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    QRCode.toDataURL(`${window.location.origin}/?token=${encodeURIComponent(token)}`, { width: 900, margin: 2 })
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

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-white p-8 text-center print:min-h-0">
      <h1 className="font-heading text-5xl font-bold uppercase text-black sm:text-6xl">Check-In QR Code</h1>

      {!token && <p className="text-xl text-black">No code has been generated yet — go back and generate one first.</p>}
      {token && error && <p className="text-xl text-red-600">{error}</p>}
      {token && !error && !qrDataUrl && <p className="text-xl text-black">Loading…</p>}
      {token && qrDataUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- a generated data: URL, not an optimizable local/remote asset
        <img src={qrDataUrl} alt="QR code for tonight's party check-in" width={480} height={480} className="h-auto w-[min(80vw,480px)]" />
      )}

      {token && qrDataUrl && (
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded bg-black px-6 py-3 text-lg font-bold uppercase text-white print:hidden"
        >
          Print
        </button>
      )}
    </div>
  );
}
