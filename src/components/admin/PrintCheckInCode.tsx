"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

interface PrintCheckInCodeProps {
  /** The currently stored token (read fresh, server-side — see /admin/security/print's page.tsx), or null if an admin has never generated one. */
  token: string | null;
}

/** In the order a guest actually does them — see Guest.pendingApprovalAt/photoUrl for what "create your passkey" and "take your costume photo" correspond to in the real check-in flow (VerifyIdentityModal). */
const INSTRUCTIONS = [
  "Scan the code",
  "Enter the code we texted",
  "Create your passkey",
  "Take your costume photo",
];

/**
 * The entire content of /admin/security/print: a large, bold heading, the
 * current party-presence QR code, and a short numbered how-to list — meant
 * to be printed on a single US Letter page, posted at the party, and
 * scanned/read from a few feet away. No admin nav, stats, or Danger Zone,
 * unlike every other /admin page (see that route's page.tsx, which
 * deliberately sits outside the (protected) route group's layout so it
 * skips that shared chrome entirely while still requiring the same admin
 * check).
 *
 * The `@page` rule below pins the print output to Letter, portrait, with a
 * fixed margin; every element's print-time size (`print:` variants) is a
 * physical unit (in/pt), not a viewport-relative one, specifically so the
 * total height is predictable across browsers' print engines and never
 * spills onto a second page — the screen-facing sizes (no `print:` prefix)
 * are free to stay responsive/viewport-based since a second page doesn't
 * matter there.
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
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-white p-8 text-center print:min-h-0 print:justify-start print:gap-[0.3in] print:p-0">
      {/*
        A plain, unscoped <style> tag — this page has no other stylesheet of
        its own to hang a print rule off of, and `@page` has no Tailwind
        utility equivalent. Fixing the page size/margin here (rather than
        trusting whatever default the browser's print dialog happens to be
        set to) is what makes "fits on one Letter page" a property of this
        page itself, not of the admin's printer settings. React removes this
        tag the moment this component unmounts, so its effect never leaks
        onto any other route — unlike `print:` Tailwind variants elsewhere
        in this file, this one rule (hiding the site-wide footer every page
        gets from the root layout — see SiteFooter.tsx) can't be expressed
        as a className on an element this component doesn't render, so it
        has to live here instead.
      */}
      <style>{`
        @page {
          size: letter portrait;
          margin: 0.5in;
        }
        @media print {
          footer {
            display: none !important;
          }
        }
      `}</style>

      <h1 className="font-heading text-5xl font-bold uppercase text-black sm:text-6xl print:text-[48pt]">
        Check-In
      </h1>

      {!token && <p className="text-xl text-black">No code has been generated yet — go back and generate one first.</p>}
      {token && error && <p className="text-xl text-red-600">{error}</p>}
      {token && !error && !qrDataUrl && <p className="text-xl text-black">Loading…</p>}
      {token && qrDataUrl && (
        // Shares one fixed width between the QR image and the instruction
        // list below it, and left-aligns both within it (items-start) — the
        // outer container above is items-center, which only centers this
        // whole block as a unit on the page; without this wrapper the QR
        // and the list would each size/center independently (the list
        // stretching to the full flex width while the QR stayed at its own
        // fixed width), which is what produced the original "not aligned
        // or sized correctly under the QR code" bug.
        <div className="flex w-[min(80vw,480px)] flex-col items-start gap-4 print:w-[4in] print:gap-[0.2in]">
          {/* eslint-disable-next-line @next/next/no-img-element -- a generated data: URL, not an optimizable local/remote asset */}
          <img
            src={qrDataUrl}
            alt="QR code for tonight's party check-in"
            width={480}
            height={480}
            className="h-auto w-full"
          />

          {/*
            list-inside (not the default list-outside) is the fix for the
            actual root cause of the missing numbers: Tailwind's preflight
            reset sets `ol { padding: 0; list-style: none }`, and the
            `list-decimal` utility only restores list-style-TYPE, not the
            left padding list-style-position:outside (the browser default)
            needs to reserve room for the marker. With zero padding and
            "outside" position, each number was being laid out in that
            now-nonexistent gutter and rendered off the printable content
            entirely — invisible, not just misstyled. list-inside instead
            renders each marker as part of the <li>'s own content box, which
            needs no reserved padding at all, so it's never at the mercy of
            a reset elsewhere zeroing it out.
          */}
          <ol className="w-full list-inside list-decimal space-y-2 text-left text-2xl font-semibold text-black marker:font-bold print:space-y-1 print:text-[20pt]">
            {INSTRUCTIONS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
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
