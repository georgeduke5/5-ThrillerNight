"use client";

import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import type { Guest } from "@/lib/data-access";
import { PhotoCropModal } from "@/components/PhotoCropModal";
import { PhotoUploadButton } from "@/components/PhotoUploadButton";

interface VerifyIdentityModalProps {
  guests: Guest[];
  onVerified: (guestId: string) => void;
  onCancel: () => void;
  /**
   * When provided, skips the name-search step entirely and immediately runs
   * the same identity-resolution flow as picking this guest from the list
   * (activate fast-path -> passkey ceremony, or the SMS chain when passkey
   * login is off).
   * Used by the walk-in flow (WalkinForm), which already knows who the
   * guest is the moment it creates them and just needs this modal's
   * verification + optional photo-capture steps, not its search UI.
   */
  initialGuest?: Guest;
}

const MAX_MATCHES = 20;

type Step = "name" | "passkey" | "phone" | "code" | "passkeyPhoneCode" | "pendingApproval" | "photo";

/** What the guest is told to do when their passkey can't be made to work at all. */
const PASSKEY_FALLBACK_HINT = "Find George or Sarah and they can cast your vote for you.";

/**
 * The single "identify yourself" flow, reused everywhere this app needs to
 * know who's using it: the home page's "Check In" button, gating vote
 * submission the first time each session, and the "Not you?" affordance on
 * /vote for switching to a different guest. In every case identity ends up
 * living solely in the session cookie (see src/lib/auth/voterSession.ts),
 * never in anything client-supplied — this is the *only* place a guest
 * names themselves.
 *
 * The "Didn't RSVP? Add yourself here" link (to /vote/walkin) only shows
 * once VotingStatus.selfServiceWalkinEnabled is confirmed true — fetched on
 * mount, defaulting to hidden while unknown so it never flashes in and then
 * disappears. /vote/walkin itself independently 404s when this is off, so
 * this is belt-and-suspenders, not the only gate.
 *
 * After picking a name, this first asks the server whether that guest
 * already has a still-valid session on this browser (POST
 * /api/auth/phone/activate) — e.g. they verified earlier tonight, or are
 * switching back to someone who verified before someone else took over on
 * a shared device. If so, it switches to them immediately with no further
 * prompt, whichever strategy is active.
 *
 * Otherwise one of two swappable verification strategies runs, chosen by
 * the admin's "Passkey Login" switch (VotingStatus.passkeyAuthEnabled in
 * VotingStatusToggles.tsx):
 *
 * - **On** — runPasskeyCeremony below takes over: one call to
 *   /api/auth/passkey/begin, which decides server-side — keyed on whether a
 *   Passkeys-sheet row exists for this guestId, never on anything
 *   device-local — between a WebAuthn registration (no row yet) and an
 *   authentication (row exists), then /api/auth/passkey/finish. No phone
 *   number and no SMS are involved at any point, *except* the very first
 *   registration for a guest who has a phone on file: name selection alone
 *   doesn't bind the physical person to that name, so /begin instead
 *   returns `{mode: "phone-required"}` and startPhoneGate/
 *   handleCheckPhoneGateCode below run one on-file-phone code check (no
 *   typed-in number, ever) before the registration ceremony is allowed to
 *   start. A guest with no phone on file skips that check entirely and
 *   registers directly, but /finish then flags them "pending approval"
 *   instead of checked-in (see Guest.pendingApprovalAt and
 *   /admin/check-in) — full site access either way, just not checked-in
 *   until an admin confirms them. A guest whose passkey fails stays on that
 *   step with a retry; if the failure was an authentication (a row exists
 *   but this device doesn't have the matching credential — cleared it, new
 *   phone, etc.), a second button lets them register a fresh one on this
 *   device instead, which replaces the stale row rather than leaving them
 *   stuck on the browser's "no passkey here, try another device" dead end
 *   — this recovery path never re-enters the phone-gate/pending-approval
 *   logic above, which only ever applies to a guest's genuine first
 *   registration. The admin fallback is spelled out too.
 * - **Off** — the original SMS path, entirely unchanged: check
 *   VotingStatus.phoneVerificationEnabled (the Twilio kill switch, for when
 *   Twilio itself is misbehaving); if that's off, POST
 *   /api/auth/phone/skip-verify issues the same session cookie and the same
 *   markGuestCheckedIn as a real verification would, just without a Twilio
 *   round-trip. Only once neither applies does it fall through to the
 *   normal one-time phone verification: phone -> code.
 *
 * Every path converges on the same outcome — the server marks the guest
 * checked in and merges their new session in alongside any others already
 * on this browser, rather than replacing them.
 *
 * After a *fresh* verification completes — a real code check, or the
 * skip-verify kill switch above — a guest with no photoUrl yet on record
 * gets one more optional step offering to take/upload one (reusing
 * PhotoCropModal and POST /api/photos exactly like the admin components
 * do), with a clearly visible "Skip" — verification has already succeeded
 * at that point, so this step can never block completing it. A guest who
 * already has a photo skips straight to onVerified as before. Both
 * completion paths funnel through completeVerification() below so this
 * check happens exactly once, in one place, rather than being duplicated
 * (and, as happened before, silently missed) per path. The "already has a
 * session" activate fast-path deliberately skips this check entirely: that
 * guest already passed through it once during their original verification.
 * Living here rather than in each caller means every entry point into this
 * flow (check-in, the per-vote prompt, "Not you?") gets the same prompt
 * automatically.
 *
 * The walk-in flow (WalkinForm) is the one caller that already knows the
 * guest before this modal opens — it passes that guest as `initialGuest`,
 * which skips straight past the name-search step into this exact same
 * activate/skip-verify/phone chain (and photo step), rather than
 * duplicating any of it.
 */
export function VerifyIdentityModal({ guests, onVerified, onCancel, initialGuest }: VerifyIdentityModalProps) {
  const [step, setStep] = useState<Step>("name");
  const [query, setQuery] = useState("");
  const [guestId, setGuestId] = useState<string | null>(initialGuest?.id ?? null);
  const [guestName, setGuestName] = useState(initialGuest ? `${initialGuest.firstName} ${initialGuest.lastName}` : "");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Starts true when initialGuest is set so the (never-visible) "name" step
  // never flashes its search UI while the mount effect below resolves it.
  const [checkingSession, setCheckingSession] = useState(!!initialGuest);
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which ceremony the most recent passkey attempt actually was — set as
  // soon as /begin responds, so it's known even if the WebAuthn call itself
  // then throws. Only "authentication" ever gets a "register instead"
  // recovery option offered (see the passkey error UI below); a failed
  // registration has no analogous fallback.
  const [lastPasskeyMode, setLastPasskeyMode] = useState<"registration" | "authentication" | null>(null);
  // null = not yet known — defaults to hidden rather than flashing the
  // link and then pulling it away once the real value arrives.
  const [selfServiceWalkinEnabled, setSelfServiceWalkinEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/votes/status", { cache: "no-store" });
        const body = (await res.json().catch(() => null)) as {
          selfServiceWalkinEnabled?: boolean;
        } | null;
        if (!cancelled) setSelfServiceWalkinEnabled(res.ok ? (body?.selfServiceWalkinEnabled ?? false) : false);
      } catch {
        if (!cancelled) setSelfServiceWalkinEnabled(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return guests
      .filter((g) => `${g.firstName} ${g.lastName}`.toLowerCase().includes(q))
      .slice(0, MAX_MATCHES);
  }, [guests, query]);

  // The one place that decides "are we done, or does this guest still need
  // the optional photo step" — called after *any* path that completes a
  // fresh verification (real code, or the admin's skip-verify kill switch).
  // Deliberately not used for the "already has a session" activate
  // fast-path above: that guest already passed through here once during
  // their original verification, so re-prompting them every time they
  // reactivate the same session (e.g. switching back via "Not you?") would
  // just be annoying, not "optional."
  function completeVerification(verifiedGuestId: string) {
    const verifiedGuest = guests.find((g) => g.id === verifiedGuestId);
    if (verifiedGuest?.photoUrl) {
      onVerified(verifiedGuestId);
    } else {
      setStep("photo");
    }
  }

  /**
   * The WebAuthn half of the flow, used in place of phone/code whenever the
   * admin's "Passkey Login" switch is on. One call to /begin decides
   * server-side whether this guest is registering a passkey for the first
   * time or signing in with one they already have, so there's nothing for
   * the client to choose; /finish then issues the same session cookie the
   * SMS path would have.
   *
   * `retryAsRegistration` is the recovery path for a guest whose device
   * doesn't have the credential the Passkeys sheet still lists for them
   * (cleared their device's passkeys, got a new phone, etc.) — without it,
   * /begin would keep offering the same broken authentication forever,
   * which on iOS/Android surfaces as "no passkey found, use another
   * device," a dead end at a party where guests only have one phone. It's
   * only ever set by the "Register a new passkey on this device" button
   * below, shown after a failed *authentication* attempt specifically.
   */
  async function runPasskeyCeremony(targetGuestId: string, retryAsRegistration = false) {
    setStep("passkey");
    setSubmitting(true);
    setError(null);
    try {
      if (!browserSupportsWebAuthn()) {
        throw new Error(`This browser can't use passkeys. ${PASSKEY_FALLBACK_HINT}`);
      }

      const beginRes = await fetch("/api/auth/passkey/begin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestId: targetGuestId, retryAsRegistration }),
      });
      const beginBody = (await beginRes.json().catch(() => null)) as {
        mode?: "registration" | "authentication" | "phone-required";
        options?: PublicKeyCredentialCreationOptionsJSON & PublicKeyCredentialRequestOptionsJSON;
        error?: string;
      } | null;
      if (!beginRes.ok || !beginBody?.mode) {
        throw new Error(beginBody?.error ?? "Couldn't start passkey setup.");
      }

      // First-time registration only, and only when this guest has a phone
      // on file: /begin has withheld registration options and instead needs
      // this device to prove it's really them via a code sent to that
      // on-file number (see Guest.pendingApprovalAt) before any WebAuthn
      // ceremony starts.
      if (beginBody.mode === "phone-required") {
        await startPhoneGate(targetGuestId);
        return;
      }

      if (!beginBody.options) {
        throw new Error(beginBody?.error ?? "Couldn't start passkey setup.");
      }
      // Recorded before the WebAuthn call itself, which is the one that can
      // actually throw — so the error UI still knows which ceremony this
      // was even when startAuthentication/startRegistration never resolves.
      setLastPasskeyMode(beginBody.mode);

      const ceremonyResponse =
        beginBody.mode === "registration"
          ? await startRegistration({
              optionsJSON: beginBody.options as PublicKeyCredentialCreationOptionsJSON,
            })
          : await startAuthentication({
              optionsJSON: beginBody.options as PublicKeyCredentialRequestOptionsJSON,
            });

      await finishPasskeyCeremony(targetGuestId, ceremonyResponse);
    } catch (err) {
      // Covers the guest dismissing the OS prompt (a DOMException from
      // startRegistration/startAuthentication) as well as any server-side
      // rejection. They stay on this step with a retry button rather than
      // being dropped back to the name list, and the admin fallback is
      // spelled out right there — a failed passkey must never be a dead end
      // at the party.
      setError(err instanceof Error ? err.message : "Passkey check failed.");
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * POST /api/auth/passkey/finish, shared by both the direct WebAuthn path
   * above and the phone-gated registration path below — the one place that
   * decides what a successful ceremony means for this guest's checked-in
   * status. A no-phone first-time registration comes back with
   * `pendingApproval: true`: the guest is fully verified and gets the
   * normal session cookie, but /admin/check-in — not this modal — is what
   * marks them checked in, so a short interstitial explains that before
   * continuing to the same optional-photo step everyone else gets.
   */
  async function finishPasskeyCeremony(targetGuestId: string, ceremonyResponse: PublicKeyCredentialJSON) {
    const finishRes = await fetch("/api/auth/passkey/finish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response: ceremonyResponse }),
    });
    const finishBody = (await finishRes.json().catch(() => null)) as {
      error?: string;
      pendingApproval?: boolean;
    } | null;
    if (!finishRes.ok) throw new Error(finishBody?.error ?? "Passkey check failed.");

    if (finishBody?.pendingApproval) {
      setStep("pendingApproval");
    } else {
      completeVerification(targetGuestId);
    }
  }

  /**
   * Sends the on-file-phone verification code for a first-time registration
   * (POST .../phone-gate/start) and moves to the code-entry step. The guest
   * is never asked to type a phone number here — /begin already confirmed
   * one is on file, and the code goes straight to it.
   */
  async function startPhoneGate(targetGuestId: string) {
    setStep("passkeyPhoneCode");
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/passkey/phone-gate/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestId: targetGuestId }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? "Failed to send verification code.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send verification code.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCheckPhoneGateCode(event: FormEvent) {
    event.preventDefault();
    if (!guestId) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/passkey/phone-gate/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestId, code }),
      });
      const body = (await res.json().catch(() => null)) as {
        options?: PublicKeyCredentialCreationOptionsJSON;
        error?: string;
      } | null;
      if (!res.ok || !body?.options) throw new Error(body?.error ?? "Incorrect code.");
      setCode("");

      // The code checked out — continue into the same WebAuthn registration
      // ceremony a direct (no-phone-gate) first-time registration would run.
      setStep("passkey");
      setLastPasskeyMode("registration");
      const ceremonyResponse = await startRegistration({ optionsJSON: body.options });
      await finishPasskeyCeremony(guestId, ceremonyResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Incorrect code.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePickGuest(guest: Guest) {
    setGuestId(guest.id);
    setGuestName(`${guest.firstName} ${guest.lastName}`);
    setError(null);
    setCheckingSession(true);
    let usePasskey = false;
    try {
      const res = await fetch("/api/auth/phone/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestId: guest.id }),
      });
      const body = (await res.json().catch(() => null)) as { switched?: boolean } | null;
      if (res.ok && body?.switched) {
        onVerified(guest.id);
        return;
      }

      // No existing session for this guest. Which verification strategy runs
      // next is the admin's call: "Passkey Login" replaces the SMS flow
      // outright, otherwise the Twilio kill switch ("Phone Verification")
      // decides between skip-verify and a real phone/code round-trip.
      const statusRes = await fetch("/api/votes/status", { cache: "no-store" });
      const statusBody = (await statusRes.json().catch(() => null)) as {
        phoneVerificationEnabled?: boolean;
        passkeyAuthEnabled?: boolean;
      } | null;
      if (statusRes.ok && statusBody?.passkeyAuthEnabled === true) {
        // Deliberately not returning from inside the try: the ceremony is
        // kicked off after `finally` clears the spinner, below.
        usePasskey = true;
      } else if (statusRes.ok && statusBody?.phoneVerificationEnabled === false) {
        const skipRes = await fetch("/api/auth/phone/skip-verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ guestId: guest.id }),
        });
        if (skipRes.ok) {
          completeVerification(guest.id);
          return;
        }
        // Falls through to the normal flow below if skip-verify somehow
        // fails (e.g. an admin re-enabled it between these two requests).
      }
    } catch {
      // Fall through to the normal phone/code flow if any check here fails.
    } finally {
      setCheckingSession(false);
    }
    // Started after the spinner clears so the passkey step renders its own
    // state rather than sitting behind "Checking…".
    if (usePasskey) {
      runPasskeyCeremony(guest.id);
      return;
    }
    setStep("phone");
  }

  useEffect(() => {
    // Runs once on mount only — initialGuest is fixed for this modal instance's lifetime.
    if (initialGuest) handlePickGuest(initialGuest);
  }, []);

  async function handleSendCode(event: FormEvent) {
    event.preventDefault();
    if (!guestId) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/phone/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestId, phone }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? "Failed to send verification code.");
      setStep("code");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send verification code.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCheckCode(event: FormEvent) {
    event.preventDefault();
    if (!guestId) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/phone/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestId, phone, code }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? "Incorrect code.");
      // Verification has already succeeded server-side at this point —
      // the photo step below is purely optional and must never block
      // completing the flow (see handleSkipPhoto and the backdrop-click
      // guard further down).
      completeVerification(guestId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Incorrect code.");
    } finally {
      setSubmitting(false);
    }
  }

  function handlePhotoFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);
    setPendingPhoto(file);
  }

  async function handlePhotoCropped(blob: Blob) {
    if (!guestId) return;
    setPendingPhoto(null);
    setUploadingPhoto(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", blob, "photo.jpg");
      formData.append("guestId", guestId);
      const res = await fetch("/api/photos", { method: "POST", body: formData });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? "Failed to upload photo.");
      onVerified(guestId);
    } catch (err) {
      // Leave them on this step so they can retry or just tap Skip —
      // an upload failure is never a reason to block finishing verification.
      setError(err instanceof Error ? err.message : "Failed to upload photo.");
    } finally {
      setUploadingPhoto(false);
    }
  }

  function handleSkipPhoto() {
    if (!guestId) return;
    onVerified(guestId);
  }

  // Registration already succeeded by this point (pendingApproval only ever
  // follows a *successful* finish) — dismissing here must continue the flow
  // into the normal optional-photo step, same as handleSkipPhoto above,
  // never abandon it.
  function handleContinueFromPendingApproval() {
    if (!guestId) return;
    completeVerification(guestId);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Verify your identity"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={
        submitting || uploadingPhoto
          ? undefined
          : step === "photo"
            ? handleSkipPhoto // already verified by this point — dismissing must still finish the flow, not abandon it
            : step === "pendingApproval"
              ? handleContinueFromPendingApproval
              : onCancel
      }
    >
      <div
        className="w-full max-w-sm rounded-lg bg-surface p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {step === "name" && initialGuest && (
          <div className="flex flex-col gap-3">
            <h2 className="font-heading text-lg font-bold uppercase text-text">One moment…</h2>
            <p className="text-sm text-muted">Setting up verification for {guestName}.</p>
          </div>
        )}

        {step === "name" && !initialGuest && (
          <div className="flex flex-col gap-3">
            <h2 className="font-heading text-lg font-bold uppercase text-text">Who are you?</h2>
            <p className="text-sm text-muted">We need to know who&rsquo;s voting before you can cast a vote.</p>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Start typing your name…"
              className="field-input w-full bg-bg px-4 py-3 text-lg text-text"
              autoFocus
            />
            {query && matches.length === 0 && (
              <p className="text-muted">
                No match.
                {selfServiceWalkinEnabled && (
                  <>
                    {" "}
                    <a href="/vote/walkin" className="text-primary underline">
                      Didn&rsquo;t RSVP? Add yourself here
                    </a>
                    .
                  </>
                )}
              </p>
            )}
            <ul className="flex max-h-60 flex-col gap-1 overflow-y-auto">
              {matches.map((guest) => (
                <li key={guest.id}>
                  <button
                    type="button"
                    onClick={() => handlePickGuest(guest)}
                    disabled={checkingSession}
                    className="w-full rounded px-4 py-2 text-left text-text hover:bg-bg disabled:opacity-60"
                  >
                    {checkingSession && guest.id === guestId
                      ? "Checking…"
                      : `${guest.firstName} ${guest.lastName}`}
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={onCancel}
              disabled={checkingSession}
              className="self-start text-sm text-muted underline hover:text-text disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        )}

        {step === "passkey" && (
          <div className="flex flex-col gap-3">
            <h2 className="font-heading text-lg font-bold uppercase text-text">
              {submitting ? "Confirm it's you" : "Passkey didn't work"}
            </h2>
            {submitting && (
              <p className="text-sm text-muted">
                Hi {guestName}! Use Face ID, your fingerprint, or your screen lock to confirm
                it&rsquo;s really you. No codes, no texts.
              </p>
            )}
            {error && (
              <>
                <p className="text-sm text-red-400">{error}</p>
                {lastPasskeyMode !== "authentication" && (
                  <p className="text-sm text-muted">{PASSKEY_FALLBACK_HINT}</p>
                )}
              </>
            )}
            {!submitting && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onCancel}
                  className="flex-1 rounded bg-bg px-4 py-3 font-heading font-bold uppercase text-text"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => guestId && runPasskeyCeremony(guestId)}
                  className="flex-1 rounded bg-primary px-4 py-3 font-heading font-bold uppercase text-bg"
                >
                  Try again
                </button>
              </div>
            )}
            {/*
             * Only offered after a failed AUTHENTICATION — the scenario
             * where the Passkeys sheet has a credential this device doesn't
             * (device wiped, new phone, etc.), which otherwise dead-ends on
             * the browser's "no passkey here, try another device" UI. A
             * failed registration has no equivalent fallback: there's
             * nothing to "register instead of."
             */}
            {!submitting && error && lastPasskeyMode === "authentication" && (
              <div className="flex flex-col gap-2 border-t border-muted/20 pt-3">
                <p className="text-sm text-muted">
                  Passkey not on this device? Set up a new one here instead.
                </p>
                <button
                  type="button"
                  onClick={() => guestId && runPasskeyCeremony(guestId, true)}
                  className="rounded bg-bg px-4 py-3 font-heading font-bold uppercase text-primary"
                >
                  Register a New Passkey on This Device
                </button>
              </div>
            )}
          </div>
        )}

        {step === "phone" && (
          <form onSubmit={handleSendCode} className="flex flex-col gap-3">
            <h2 className="font-heading text-lg font-bold uppercase text-text">Verify your phone</h2>
            <p className="text-sm text-muted">
              Hi {guestName}! We need a quick one-time phone check before continuing.
            </p>
            <label htmlFor="voter-phone" className="text-sm text-muted">
              Phone number
            </label>
            <input
              id="voter-phone"
              type="tel"
              required
              autoFocus
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 555-5555"
              className="field-input bg-bg px-4 py-3 text-text"
            />
            {error && <p className="text-sm text-red-400">{error}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setStep("name");
                  setError(null);
                }}
                className="flex-1 rounded bg-bg px-4 py-3 font-heading font-bold uppercase text-text"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={submitting || !phone}
                className="flex-1 rounded bg-primary px-4 py-3 font-heading font-bold uppercase text-bg disabled:opacity-60"
              >
                {submitting ? "Sending…" : "Send code"}
              </button>
            </div>
          </form>
        )}

        {step === "code" && (
          <form onSubmit={handleCheckCode} className="flex flex-col gap-3">
            <h2 className="font-heading text-lg font-bold uppercase text-text">Enter code</h2>
            <label htmlFor="voter-code" className="text-sm text-muted">
              Enter the code sent to {phone}
            </label>
            <input
              id="voter-code"
              type="text"
              inputMode="numeric"
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              className="field-input bg-bg px-4 py-3 text-center text-lg tracking-widest text-text"
            />
            {error && <p className="text-sm text-red-400">{error}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setStep("phone");
                  setError(null);
                }}
                className="flex-1 rounded bg-bg px-4 py-3 font-heading font-bold uppercase text-text"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={submitting || !code}
                className="flex-1 rounded bg-primary px-4 py-3 font-heading font-bold uppercase text-bg disabled:opacity-60"
              >
                {submitting ? "Verifying…" : "Verify"}
              </button>
            </div>
          </form>
        )}

        {step === "passkeyPhoneCode" && (
          <form onSubmit={handleCheckPhoneGateCode} className="flex flex-col gap-3">
            <h2 className="font-heading text-lg font-bold uppercase text-text">Verify your phone</h2>
            <p className="text-sm text-muted">
              Hi {guestName}! Since this is a new device, we texted a code to the phone number we
              have on file to confirm it&rsquo;s really you before setting up your passkey.
            </p>
            <label htmlFor="voter-passkey-code" className="text-sm text-muted">
              Enter the code we sent
            </label>
            <input
              id="voter-passkey-code"
              type="text"
              inputMode="numeric"
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              className="field-input bg-bg px-4 py-3 text-center text-lg tracking-widest text-text"
            />
            {error && <p className="text-sm text-red-400">{error}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onCancel}
                disabled={submitting}
                className="flex-1 rounded bg-bg px-4 py-3 font-heading font-bold uppercase text-text disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !code}
                className="flex-1 rounded bg-primary px-4 py-3 font-heading font-bold uppercase text-bg disabled:opacity-60"
              >
                {submitting ? "Verifying…" : "Verify"}
              </button>
            </div>
            <button
              type="button"
              onClick={() => guestId && startPhoneGate(guestId)}
              disabled={submitting}
              className="self-center text-sm text-muted underline hover:text-text disabled:opacity-60"
            >
              Didn&rsquo;t get a code? Send another
            </button>
          </form>
        )}

        {step === "pendingApproval" && (
          <div className="flex flex-col gap-3">
            <h2 className="font-heading text-lg font-bold uppercase text-text">You&rsquo;re all set!</h2>
            <p className="text-sm text-muted">
              Your passkey is registered, {guestName}. George or Sarah will check you in shortly —
              until then you have full access to browse the site and upload a costume photo.
            </p>
            <button
              type="button"
              onClick={handleContinueFromPendingApproval}
              className="rounded bg-primary px-4 py-3 font-heading font-bold uppercase text-bg"
            >
              Continue
            </button>
          </div>
        )}

        {step === "photo" && (
          <div className="flex flex-col gap-3 items-center">
            <h2 className="font-heading text-lg font-bold uppercase text-text">Add a costume photo</h2>
            
            <PhotoUploadButton
              label="Take or Choose Photo"
              onChange={handlePhotoFileChange}
              accept="image/*"
              disabled={uploadingPhoto}
              className="font-heading font-bold uppercase px-4 py-3 text-xl"
            />
            {uploadingPhoto && <p className="text-sm text-muted">Uploading…</p>}
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              type="button"
              onClick={handleSkipPhoto}
              disabled={uploadingPhoto}
              className="self-center text-sm text-muted underline hover:text-text disabled:opacity-60"
            >
              Skip for now
            </button>
          </div>
        )}
      </div>

      {pendingPhoto && (
        <PhotoCropModal
          file={pendingPhoto}
          onCancel={() => setPendingPhoto(null)}
          onCropped={handlePhotoCropped}
        />
      )}
    </div>
  );
}
