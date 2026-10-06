"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
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
   * (activate fast-path -> the method-selection screen).
   * Used by the walk-in flow (WalkinForm), which already knows who the
   * guest is the moment it creates them and just needs this modal's
   * verification + optional photo-capture steps, not its search UI.
   */
  initialGuest?: Guest;
}

const MAX_MATCHES = 20;

type Step =
  | "name"
  | "method"
  | "passkey"
  | "passkeyPhoneCode"
  | "phone"
  | "code"
  | "photo";

/**
 * The single "identify yourself" flow, reused everywhere this app needs to
 * know who's using it: the home page's "Check In" button, gating vote
 * submission the first time each session, and the "Not you?" affordance on
 * /vote for switching to a different guest. In every case identity ends up
 * living solely in the session cookie (see src/lib/auth/voterSession.ts),
 * never in anything client-supplied — this is the *only* place a guest
 * names themselves.
 *
 * After picking a name, this first asks the server whether that guest
 * already has a still-valid session on this browser (POST
 * /api/auth/phone/activate) — e.g. they verified earlier tonight, or are
 * switching back to someone who verified before someone else took over on
 * a shared device. If so, it switches to them immediately with no further
 * prompt — the method-selection screen below is never shown to an
 * already-verified guest.
 *
 * Otherwise the guest lands on one screen with exactly three ways to
 * verify — Passkey (recommended), Phone Number, or In-Person — and picks
 * one themselves (the "method" step below). There is no automatic
 * chaining from one method into another: each button starts only its own
 * method, and any failure (a cancelled/rejected/unsupported passkey
 * ceremony, a failed phone-gate or phone-verification send) brings the
 * guest straight back to this same screen with a short message, via
 * backToMethodSelect(), rather than stranding them on a dead-end error
 * step. The one exception is a routine wrong/expired *code* during either
 * phone flow — that's treated as an ordinary input mistake and stays
 * inline so the guest can just retype it, matching how the SMS flow
 * always worked.
 *
 * - **Passkey** — runPasskeyCeremony: one call to /api/auth/passkey/begin,
 *   which decides server-side — keyed on whether a Passkeys-sheet row
 *   exists for this guestId, never on anything device-local — between a
 *   WebAuthn registration (no row yet) and an authentication (row exists),
 *   then /api/auth/passkey/finish. No phone number and no SMS are involved
 *   at any point, *except* the very first registration for a guest who has
 *   a phone on file: name selection alone doesn't bind the physical person
 *   to that name, so /begin instead returns `{mode: "phone-required"}` and
 *   startPhoneGate/handleCheckPhoneGateCode below run one on-file-phone
 *   code check (no typed-in number, ever) before the registration ceremony
 *   is allowed to start. A guest with no phone on file skips that check
 *   entirely and registers directly, but /finish then flags them "pending
 *   approval" instead of checked-in (see Guest.pendingApprovalAt and
 *   /admin/check-in) — full site access either way, just not checked-in
 *   until an admin confirms them.
 *
 *   A failed *authentication* specifically (a Passkeys row exists, but
 *   this device doesn't have the matching credential — cleared it, new
 *   phone, etc.) sets retryPasskeyAsRegistration, so the *next* tap of the
 *   same "Passkey" button registers a fresh credential on this device
 *   instead of repeating the same failing authentication forever — the
 *   old "no passkey here, try another device" dead end, recovered without
 *   a second button or a new choice; it's still just "starting the Passkey
 *   method" again. A failed *registration* has no such retry — there's
 *   nothing to "register instead of."
 *
 * - **Phone Number** — handleChoosePhone checks
 *   VotingStatus.phoneVerificationEnabled (the Twilio kill switch, for
 *   when Twilio itself is misbehaving) first; if that's off,
 *   POST /api/auth/phone/skip-verify issues the same session cookie and
 *   the same markGuestCheckedIn a real verification would, with no Twilio
 *   round-trip. Otherwise the normal one-time phone verification runs:
 *   phone -> code (handleSendCode / handleCheckCode), prompting for a
 *   number if none is already known to the browser.
 *
 * - **In-Person** — handleChooseInPerson: POST
 *   /api/auth/passkey/fallback/give-up, no proof of identity at all (the
 *   same trust level as the self-service walk-in form). Lands a guest with
 *   no prior status in the exact same pending-approval state a no-phone
 *   passkey registration reaches (see Guest.pendingApprovalAt and
 *   /admin/check-in): full site access except voting, candy guessing, and
 *   photo upload, and nothing but the one waiting screen (see
 *   src/proxy.ts) until George/Sarah approve them in person.
 *
 * Every path converges on the same outcome — the server marks the guest
 * checked in and merges their new session in alongside any others already
 * on this browser, rather than replacing them.
 *
 * After a *fresh* verification completes — a real code check, or the
 * skip-verify kill switch above — a guest with no photoUrl yet on record
 * gets one more optional step offering to take/upload one, with a clearly
 * visible "Skip" — verification has already succeeded at that point, so
 * this step can never block completing it. completeVerification() below
 * is the one place that decides this, so every entry point into this flow
 * gets the same prompt automatically. A pending outcome never reaches this
 * photo step at all: goToPendingLanding() navigates straight to
 * /check-in/pending instead.
 *
 * The walk-in flow (WalkinForm) is the one caller that already knows the
 * guest before this modal opens — it passes that guest as `initialGuest`,
 * which skips straight past the name-search step into this exact same
 * activate/method-selection chain, rather than duplicating any of it.
 */
export function VerifyIdentityModal({ guests, onVerified, onCancel, initialGuest }: VerifyIdentityModalProps) {
  const router = useRouter();
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
  // Inline error shown on the SAME step — reserved for a routine wrong/
  // expired code the guest can just retype (phone's own code step, and the
  // passkey flow's phone-gate code step). Anything else routes through
  // backToMethodSelect's `methodMessage` instead.
  const [error, setError] = useState<string | null>(null);
  // Set when a passkey AUTHENTICATION attempt fails — consumed (and reset)
  // by the very next tap of "Passkey" on the method screen, which then
  // requests a fresh registration instead of repeating the same failing
  // authentication. See the big doc comment above.
  const [retryPasskeyAsRegistration, setRetryPasskeyAsRegistration] = useState(false);
  // Short plain-text explanation shown on the method-selection screen after
  // a method fails/is cancelled/is unsupported — null means "nothing to
  // report," e.g. the guest just arrived here or backed out deliberately.
  const [methodMessage, setMethodMessage] = useState<string | null>(null);
  // True only while a method button's own quick pre-check/call is in
  // flight (the phone-verification-enabled check, or the in-person call) —
  // separate from `submitting`, which belongs to the sub-steps a method can
  // lead into.
  const [methodBusy, setMethodBusy] = useState(false);
  // null = not yet known — defaults to hidden rather than flashing the
  // link and then pulling it away once the real value arrives.
  const [selfServiceWalkinEnabled, setSelfServiceWalkinEnabled] = useState<boolean | null>(null);

  // Identifies the current passkey ceremony attempt so a guest who bails
  // out of a hung native prompt (via backToMethodSelect) can't have a
  // *later*-resolving promise from that abandoned attempt turn around and
  // change the step out from under whatever they're doing next — the
  // ceremony itself keeps running in the background (there's no way to
  // cancel a native WebAuthn prompt), but its result is ignored once stale.
  const attemptIdRef = useRef(0);
  function beginAttempt(): number {
    attemptIdRef.current += 1;
    return attemptIdRef.current;
  }
  function isStaleAttempt(attemptId: number): boolean {
    return attemptIdRef.current !== attemptId;
  }

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
   * The single place a pending outcome leaves this modal entirely: a
   * pending guest gets nothing but the one waiting screen (see
   * src/proxy.ts, which redirects every other gated page back here for as
   * long as Guest.pendingApprovalAt is set), so there's no in-modal
   * interstitial to show and no "Continue" to wait for — navigate there
   * immediately.
   */
  function goToPendingLanding() {
    router.push("/check-in/pending");
  }

  /**
   * The one way back to the three-option screen from any sub-step —
   * invalidates any still-in-flight attempt (see attemptIdRef above),
   * clears per-step state, and optionally shows a short explanation of
   * what just happened. Pass no message for a deliberate "Cancel"/"Back"
   * tap; pass one for an actual failure.
   */
  function backToMethodSelect(message: string | null = null) {
    beginAttempt();
    setSubmitting(false);
    setError(null);
    setMethodMessage(message);
    setStep("method");
  }

  /**
   * The WebAuthn half of the flow, started only by tapping "Option 1:
   * Passkey" on the method screen. One call to /begin decides server-side
   * whether this guest is registering a passkey for the first time or
   * signing in with one they already have; /finish then issues the same
   * session cookie the phone path would have. Any failure along the way —
   * unsupported browser, a rejected/failed server call, a
   * cancelled/rejected/failed native ceremony — bounces straight back to
   * the method screen with a short message; see the module doc comment for
   * what a failed *authentication* specifically sets up for next time.
   */
  async function runPasskeyCeremony(targetGuestId: string, retryAsRegistration = false) {
    const attemptId = beginAttempt();
    setStep("passkey");
    setSubmitting(true);
    setError(null);
    let ceremonyMode: "registration" | "authentication" | null = null;
    try {
      if (!browserSupportsWebAuthn()) {
        throw new Error("This browser doesn't support passkeys.");
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
        if (isStaleAttempt(attemptId)) return;
        await startPhoneGate(targetGuestId);
        return;
      }

      if (!beginBody.options) {
        throw new Error(beginBody?.error ?? "Couldn't start passkey setup.");
      }
      ceremonyMode = beginBody.mode;

      let ceremonyResponse;
      try {
        ceremonyResponse =
          ceremonyMode === "registration"
            ? await startRegistration({
                optionsJSON: beginBody.options as PublicKeyCredentialCreationOptionsJSON,
              })
            : await startAuthentication({
                optionsJSON: beginBody.options as PublicKeyCredentialRequestOptionsJSON,
              });
      } catch (err) {
        // The browser/OS's own WebAuthn error (e.g. a DOMException like
        // "The request is not allowed by the user agent...") is logged for
        // debugging but never shown to the guest — it's not written for
        // them and explains nothing actionable.
        console.error("WebAuthn ceremony failed:", err);
        throw new Error("Passkey check failed.");
      }

      if (isStaleAttempt(attemptId)) return;
      await finishPasskeyCeremony(targetGuestId, ceremonyResponse, attemptId);
    } catch (err) {
      if (isStaleAttempt(attemptId)) return;
      setRetryPasskeyAsRegistration(ceremonyMode === "authentication");
      backToMethodSelect(err instanceof Error ? err.message : "Passkey check failed.");
    } finally {
      if (!isStaleAttempt(attemptId)) setSubmitting(false);
    }
  }

  /**
   * POST /api/auth/passkey/finish, shared by both the direct WebAuthn path
   * above and the phone-gated registration path below — the one place that
   * decides what a successful ceremony means for this guest's checked-in
   * status. A no-phone first-time registration comes back with
   * `pendingApproval: true`, same as a guest who was already pending and
   * just re-authenticated — either way they're sent straight to the
   * waiting screen, never the optional-photo step everyone else gets.
   */
  async function finishPasskeyCeremony(
    targetGuestId: string,
    ceremonyResponse: PublicKeyCredentialJSON,
    attemptId: number,
  ) {
    const finishRes = await fetch("/api/auth/passkey/finish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response: ceremonyResponse }),
    });
    const finishBody = (await finishRes.json().catch(() => null)) as {
      error?: string;
      pendingApproval?: boolean;
    } | null;
    if (isStaleAttempt(attemptId)) return;
    if (!finishRes.ok) throw new Error(finishBody?.error ?? "Passkey check failed.");

    if (finishBody?.pendingApproval) {
      goToPendingLanding();
    } else {
      completeVerification(targetGuestId);
    }
  }

  /**
   * Sends the on-file-phone verification code for a first-time registration
   * (POST .../phone-gate/start) and moves to the code-entry step. The guest
   * is never asked to type a phone number here — /begin already confirmed
   * one is on file, and the code goes straight to it. There's no guest
   * input to fix if the send itself fails, so that bounces back to the
   * method screen rather than leaving them on a dead "send another" step.
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
      backToMethodSelect(err instanceof Error ? err.message : "Failed to send verification code.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCheckPhoneGateCode(event: FormEvent) {
    event.preventDefault();
    if (!guestId) return;
    setSubmitting(true);
    setError(null);

    let options: PublicKeyCredentialCreationOptionsJSON;
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
      options = body.options;
    } catch (err) {
      // A wrong (or expired) code is a routine input mistake — let them
      // retype it right here rather than bouncing all the way back.
      setError(err instanceof Error ? err.message : "Incorrect code.");
      setSubmitting(false);
      return;
    }

    setCode("");
    // The code checked out — continue into the same WebAuthn registration
    // ceremony a direct (no-phone-gate) first-time registration would run.
    // Anything that fails from here on IS a passkey-attempt failure (not a
    // fixable typo), so it bounces back to the method screen instead.
    setStep("passkey");
    const attemptId = beginAttempt();
    try {
      let ceremonyResponse;
      try {
        ceremonyResponse = await startRegistration({ optionsJSON: options });
      } catch (err) {
        console.error("WebAuthn ceremony failed:", err);
        throw new Error("Passkey check failed.");
      }
      if (isStaleAttempt(attemptId)) return;
      await finishPasskeyCeremony(guestId, ceremonyResponse, attemptId);
    } catch (err) {
      if (isStaleAttempt(attemptId)) return;
      backToMethodSelect(err instanceof Error ? err.message : "Passkey check failed.");
    } finally {
      if (!isStaleAttempt(attemptId)) setSubmitting(false);
    }
  }

  /**
   * The true last resort: POST /api/auth/passkey/fallback/give-up, no proof
   * of identity at all — see that route for exactly what this grants (never
   * more than a no-phone passkey registration already gets). Started only
   * by tapping "Option 3: In-Person" on the method screen; a failure here
   * leaves the guest right where they are (the method screen already) with
   * a short message, rather than navigating anywhere.
   */
  async function handleChooseInPerson() {
    if (!guestId) return;
    setRetryPasskeyAsRegistration(false);
    setMethodMessage(null);
    setMethodBusy(true);
    try {
      const res = await fetch("/api/auth/passkey/fallback/give-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestId }),
      });
      const body = (await res.json().catch(() => null)) as {
        error?: string;
        pendingApproval?: boolean;
      } | null;
      if (!res.ok) throw new Error(body?.error ?? "Couldn't check you in.");
      if (body?.pendingApproval) {
        goToPendingLanding();
      } else {
        completeVerification(guestId);
      }
    } catch (err) {
      setMethodMessage(err instanceof Error ? err.message : "Couldn't check you in.");
    } finally {
      setMethodBusy(false);
    }
  }

  /** Starts (or resumes, via retryPasskeyAsRegistration) the Passkey method — see the module doc comment. */
  function handleChoosePasskey() {
    if (!guestId) return;
    const retry = retryPasskeyAsRegistration;
    setRetryPasskeyAsRegistration(false);
    setMethodMessage(null);
    runPasskeyCeremony(guestId, retry);
  }

  /**
   * Starts the Phone Number method: re-checks the Twilio kill switch fresh
   * (never trusted from an earlier snapshot) and either completes
   * immediately via skip-verify or moves to the phone-number step to
   * prompt for a number. Any failure in the kill-switch check itself just
   * falls through to the normal phone step rather than blocking the guest.
   */
  async function handleChoosePhone() {
    if (!guestId) return;
    setRetryPasskeyAsRegistration(false);
    setMethodMessage(null);
    setMethodBusy(true);
    try {
      const statusRes = await fetch("/api/votes/status", { cache: "no-store" });
      const statusBody = (await statusRes.json().catch(() => null)) as {
        phoneVerificationEnabled?: boolean;
      } | null;
      if (statusRes.ok && statusBody?.phoneVerificationEnabled === false) {
        const skipRes = await fetch("/api/auth/phone/skip-verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ guestId }),
        });
        const skipBody = (await skipRes.json().catch(() => null)) as { pendingApproval?: boolean } | null;
        if (skipRes.ok) {
          if (skipBody?.pendingApproval) {
            goToPendingLanding();
          } else {
            completeVerification(guestId);
          }
          return;
        }
        // Falls through to the normal flow below if skip-verify somehow
        // fails (e.g. an admin re-enabled it between these two requests).
      }
    } catch {
      // Fall through to the normal phone/code flow if the status check itself fails.
    } finally {
      setMethodBusy(false);
    }
    setStep("phone");
  }

  async function handlePickGuest(guest: Guest) {
    setGuestId(guest.id);
    setGuestName(`${guest.firstName} ${guest.lastName}`);
    setError(null);
    setMethodMessage(null);
    setRetryPasskeyAsRegistration(false);
    setCheckingSession(true);
    try {
      const res = await fetch("/api/auth/phone/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestId: guest.id }),
      });
      const body = (await res.json().catch(() => null)) as { switched?: boolean; pendingApproval?: boolean } | null;
      if (res.ok && body?.switched) {
        if (body.pendingApproval) {
          goToPendingLanding();
        } else {
          onVerified(guest.id);
        }
        return;
      }
    } catch {
      // Fall through to method selection if the activate check itself fails.
    } finally {
      setCheckingSession(false);
    }
    // No existing session for this guest — let them choose how to verify.
    setStep("method");
  }

  useEffect(() => {
    // Runs once on mount only — initialGuest is fixed for this modal instance's lifetime.
    if (initialGuest) handlePickGuest(initialGuest);
  }, []);

  /** Standalone Phone Number method, stage one — a send failure (bad number, Twilio down, etc.) bounces back to the method screen; there's no "resend" to retry inline the way a wrong code has. */
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
      setSubmitting(false);
    } catch (err) {
      backToMethodSelect(err instanceof Error ? err.message : "Failed to send verification code.");
    }
  }

  /** Standalone Phone Number method, stage two — a wrong code is a routine typo, so it stays on this step for a retype rather than bouncing back. */
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
      const body = (await res.json().catch(() => null)) as { error?: string; pendingApproval?: boolean } | null;
      if (!res.ok) throw new Error(body?.error ?? "Incorrect code.");
      if (body?.pendingApproval) {
        goToPendingLanding();
        return;
      }
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Verify your identity"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={
        submitting || uploadingPhoto || methodBusy
          ? undefined
          : step === "photo"
            ? handleSkipPhoto // already verified by this point — dismissing must still finish the flow, not abandon it
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

        {step === "method" && (
          <div className="flex flex-col gap-4">
            <h2 className="font-heading text-2xl font-bold uppercase leading-tight text-text">
              How do you want to check in?
            </h2>
            <p className="text-lg text-muted">Hi {guestName}! Pick one.</p>
            {methodMessage && (
              <p role="alert" className="text-base font-semibold text-red-400">
                {methodMessage}
              </p>
            )}
            <button
              type="button"
              onClick={handleChoosePasskey}
              disabled={methodBusy}
              className="flex min-h-[56px] w-full flex-col items-center justify-center gap-1 rounded-lg bg-primary px-6 py-4 text-center font-heading text-xl font-bold uppercase text-bg shadow-lg transition-transform hover:scale-[1.02] focus-visible:outline focus-visible:outline-4 focus-visible:outline-white disabled:opacity-60 disabled:hover:scale-100"
            >
              <span>Option 1: Passkey</span>
              <span className="rounded-full bg-bg px-3 py-1 text-xs font-bold uppercase tracking-wide text-primary">
                Recommended
              </span>
            </button>
            <button
              type="button"
              onClick={handleChoosePhone}
              disabled={methodBusy}
              className="min-h-[56px] w-full rounded-lg bg-bg px-6 py-4 text-center font-heading text-xl font-bold uppercase text-text shadow-lg transition-transform hover:scale-[1.02] focus-visible:outline focus-visible:outline-4 focus-visible:outline-white disabled:opacity-60 disabled:hover:scale-100"
            >
              Option 2: Phone Number
            </button>
            <button
              type="button"
              onClick={handleChooseInPerson}
              disabled={methodBusy}
              className="min-h-[56px] w-full rounded-lg bg-bg px-6 py-4 text-center font-heading text-xl font-bold uppercase text-text shadow-lg transition-transform hover:scale-[1.02] focus-visible:outline focus-visible:outline-4 focus-visible:outline-white disabled:opacity-60 disabled:hover:scale-100"
            >
              Option 3: In-Person
            </button>
            {methodBusy && <p className="text-center text-sm text-muted">One moment…</p>}
            <button
              type="button"
              onClick={onCancel}
              disabled={methodBusy}
              className="self-center text-sm text-muted underline hover:text-text disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        )}

        {step === "passkey" && (
          <div className="flex flex-col items-center gap-4 text-center">
            <h2 className="font-heading text-xl font-bold uppercase text-text">Confirm it&rsquo;s you</h2>
            <p className="text-base text-muted">
              Hi {guestName}! Use Face ID, your fingerprint, or your screen lock to confirm it&rsquo;s
              really you. No codes, no texts.
            </p>
            <button
              type="button"
              onClick={() => backToMethodSelect()}
              className="min-h-[56px] w-full rounded-lg bg-bg px-4 py-3 font-heading font-bold uppercase text-text focus-visible:outline focus-visible:outline-4 focus-visible:outline-white"
            >
              Cancel
            </button>
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
                onClick={() => backToMethodSelect()}
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
                onClick={() => backToMethodSelect()}
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
