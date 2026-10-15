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
   * (activate fast-path -> straight into verification).
   * Used by the walk-in flow (WalkinForm), which already knows who the
   * guest is the moment it creates them and just needs this modal's
   * verification + optional photo-capture steps, not its search UI — and,
   * deliberately, not the party-presence gate below either: a walk-in guest
   * physically filling out a form at the door is already a different,
   * lower-trust registration path (gated on its own admin toggle,
   * selfServiceWalkinEnabled) that this task doesn't change.
   */
  initialGuest?: Guest;
  /**
   * A photo the walk-in form already collected for initialGuest. It can't be
   * uploaded before verification (POST /api/photos requires a checked-in
   * session), so this modal uploads it once verification completes, in place
   * of its own "Add a costume photo?" prompt. Never uploaded for a pending
   * outcome — that guest can't upload until approved.
   */
  initialPhoto?: Blob | null;
}

const MAX_MATCHES = 20;

/**
 * True once THIS PAGE LOAD has successfully confirmed, via a live
 * /api/votes/status read, that this browser's party-presence gate cookie
 * (see checkInGate.ts) is currently valid. Deliberately module-level
 * rather than this component's own state: this modal fully unmounts on
 * cancel (see CheckInButton/VotingApp/CandyCountApp, which each conditionally
 * render it), so without something that survives that unmount, every
 * reopen re-verifies the gate from scratch over the network — and a guest
 * who has ALREADY proven their cookie is good once (by reaching the
 * name-search step) could get bounced back to the "find the code" screen
 * by nothing more than one slow/flaky /api/votes/status read on a later
 * reopen (e.g. right after canceling a native passkey prompt, a moment
 * when a phone's network stack is often momentarily busy) — even though
 * the cookie itself was never touched. This was the root cause of exactly
 * that bug: canceling never cleared the cookie, but the UI had no memory
 * of its own success and treated every re-open as a cold start, so any
 * hiccup on that one re-check read as "not gated" instead of "network
 * blip." Once true, this never flips back to false on its own for the
 * rest of the page's life — only a real page reload resets it.
 *
 * This is purely a client-side UX nicety, same as the gate check itself
 * (see the "Party-presence gate" paragraph in this file's module doc
 * comment): it only decides which screen renders first. It is never the
 * actual enforcement boundary — every route that actually starts a fresh
 * verification (POST /api/auth/passkey/begin, .../phone-gate/start,
 * /api/auth/auto-check-in) independently re-checks the real gate
 * server-side regardless of this flag, so staying "stuck open" here even
 * in the rare case an admin rotates the token mid-party is a deliberate,
 * safe tradeoff — that guest's next real attempt still gets correctly
 * rejected by the server, just via the failure screen's message instead
 * of this screen.
 */
let gateConfirmedOpenThisPageLoad = false;

/** Test-only: resets the module-level memory above to a fresh-page-load state so tests don't leak into one another. */
export function resetGateConfirmationForTests(): void {
  gateConfirmedOpenThisPageLoad = false;
}

/**
 * A plain, generic "this is a QR code" glyph (three finder-pattern corners
 * plus a scattering of modules in the fourth) for the "locked" step below —
 * not a real, scannable code (see CheckInGate.tsx's actual QR rendering,
 * which encodes the real token via the `qrcode` package), just a visual cue
 * so the screen reads as "go find a QR code" at a glance, not only as a
 * text instruction. Purely decorative: the heading and body text already
 * carry the full meaning, so this is aria-hidden.
 */
function QrCodeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className={className}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="3" height="3" />
      <rect x="18" y="14" width="3" height="3" />
      <rect x="14" y="18" width="3" height="3" />
      <rect x="18" y="18" width="3" height="3" />
    </svg>
  );
}

type Step =
  | "name"
  | "locked"
  | "passkey"
  | "passkeyPhoneCode"
  | "failure"
  | "photo";

/**
 * Which pieces of the flow are currently available, re-read fresh (via
 * /api/votes/status) each time a guest is picked, not once at mount, so a
 * toggle flipped while this modal is sitting on the name-search step still
 * takes effect. Defaults to "everything on" on a fetch/parse failure — fail
 * OPEN on the client, because the server-side routes are the actual
 * boundary and reject independently of what this renders; the worst a
 * stale/failed read does here is attempt a step whose route then
 * (correctly) rejects it.
 */
interface Availability {
  passkey: boolean;
  phone: boolean;
  inPerson: boolean;
}
const DEFAULT_AVAILABILITY: Availability = { passkey: true, phone: true, inPerson: true };

/**
 * The single "identify yourself" flow, reused everywhere this app needs to
 * know who's using it: the home page's "Check In" button, gating vote
 * submission the first time each session, and the "Not you?" affordance on
 * /vote for switching to a different guest. In every case identity ends up
 * living solely in the session cookie (see src/lib/auth/voterSession.ts),
 * never in anything client-supplied — this is the *only* place a guest
 * names themselves.
 *
 * Party-presence gate: before showing the name-search step at all (unless
 * `initialGuest` is set — see that prop's doc comment), this checks whether
 * the current browser holds a still-valid party-presence token (see
 * checkInGate.ts) via the same /api/votes/status read used for method
 * availability. A guest who hasn't scanned tonight's QR code (or whose
 * token has been superseded by a newly generated one) sees a "find the
 * party code" screen instead of the name search — and even if they bypass
 * this client-side check entirely (e.g. calling the API directly), the
 * routes that actually start a fresh verification (POST
 * /api/auth/passkey/begin, .../phone-gate/start, /api/auth/auto-check-in)
 * independently re-check the same gate server-side. This check never
 * applies to a guest switching to an identity *already* verified on this
 * browser (the activate fast-path below) — the gate only protects starting
 * a brand-new verification, not standing access to one already completed.
 * This modal fully unmounts on cancel and re-runs this check on every
 * reopen, but once it has confirmed the gate open, it stays confirmed for
 * the rest of this page load (see gateConfirmedOpenThisPageLoad below) —
 * canceling out of the modal never re-locks it, even if a later re-check's
 * network request itself hiccups.
 *
 * After picking a name, this first asks the server whether that guest
 * already has a still-valid session on this browser (POST
 * /api/auth/phone/activate) — e.g. they verified earlier tonight, or are
 * switching back to someone who verified before someone else took over on
 * a shared device. If so, it switches to them immediately with no further
 * prompt.
 *
 * Otherwise there is exactly one way to verify — no method picker: a
 * WebAuthn ceremony starts immediately (POST /api/auth/passkey/begin,
 * which decides server-side between a registration and an authentication
 * challenge, keyed on whether a Passkeys-sheet row exists for this
 * guestId), now requiring the device owner to unlock it biometrically or
 * with their PIN (WebAuthn's userVerification, set to "required" — see
 * /begin and /finish). The only exception is the very first registration
 * for a guest who has a phone on file: name selection alone doesn't bind
 * the physical person to that name, so /begin instead returns
 * `{mode: "phone-required"}` and startPhoneGate/handleCheckPhoneGateCode
 * below run one on-file-phone code check (never a typed-in number) before
 * the registration ceremony is allowed to start. A guest with no phone on
 * file skips that check entirely and registers directly, but /finish then
 * flags them "pending approval" instead of checked-in (see
 * Guest.pendingApprovalAt and /admin/check-in) — full site access either
 * way, just not checked-in until an admin confirms them.
 *
 * One passkey per guest, enforced server-side (see
 * GoogleSheetsDataStore.savePasskey): a failed *authentication* (a Passkeys
 * row exists, but this device doesn't have the matching credential —
 * cleared it, new phone, etc.) is never auto-upgraded into a fresh
 * registration; the only way to register a new credential for that guest
 * is an admin removing the existing one first (DELETE
 * /api/guests/[id]/passkey).
 *
 * Any failure along the way — unsupported browser, a cancelled/rejected/
 * failed ceremony, a failed phone-gate send/check, passkey login turned
 * off — lands on one "failure" screen (showFailure()) with a short message
 * and, if VotingStatus.inPersonCheckInEnabled, a button that runs the
 * existing in-person give-up flow (POST
 * /api/auth/passkey/fallback/give-up): the same no-proof-of-identity,
 * pending-approval outcome the self-service walk-in form and a no-phone
 * passkey registration already reach, consistent with the existing
 * in-person approval process. There is no other self-service retry —
 * a failed attempt doesn't offer a different way to type in a phone number.
 *
 * Every path converges on the same outcome — the server marks the guest
 * checked in and merges their new session in alongside any others already
 * on this browser, rather than replacing them.
 *
 * The in-person "give up" never reaches that outcome: it only files a
 * pending-approval request and goes straight to the waiting screen.
 *
 * After a *fresh* verification completes — a real code check or the
 * zero-methods-enabled auto-check-in — a
 * guest with no photoUrl yet on record
 * gets one more optional step offering to take/upload one, with a clearly
 * visible "Skip" — verification has already succeeded at that point, so
 * this step can never block completing it. completeVerification() below
 * is the one place that decides this, so every entry point into this flow
 * gets the same prompt automatically. A pending outcome never reaches this
 * photo step at all: goToPendingLanding() navigates straight to
 * /check-in/pending instead.
 *
 * The walk-in flow (WalkinForm) is the one caller that already knows the
 * guest before this modal opens — see the `initialGuest` prop doc comment
 * above for what that does and doesn't skip.
 */
export function VerifyIdentityModal({
  guests,
  onVerified,
  onCancel,
  initialGuest,
  initialPhoto,
}: VerifyIdentityModalProps) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("name");
  const [query, setQuery] = useState("");
  const [guestId, setGuestId] = useState<string | null>(initialGuest?.id ?? null);
  const [guestName, setGuestName] = useState(initialGuest ? `${initialGuest.firstName} ${initialGuest.lastName}` : "");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Starts true when initialGuest is set so the (never-visible) "name" step
  // never flashes its search UI while the mount effect below resolves it.
  const [checkingSession, setCheckingSession] = useState(!!initialGuest);
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  // Inline error shown on the SAME step — reserved for a routine wrong/
  // expired code the guest can just retype (the phone-gate's code step).
  // Anything else routes through showFailure's `failureMessage` instead.
  const [error, setError] = useState<string | null>(null);
  // Short plain-text explanation shown on the failure screen — null means
  // "nothing to report," e.g. the guest just arrived here.
  const [failureMessage, setFailureMessage] = useState<string | null>(null);
  // True only while the in-person "find an admin" button's own call is in
  // flight — separate from `submitting`, which belongs to the sub-steps a
  // fresh verification attempt can lead into.
  const [inPersonBusy, setInPersonBusy] = useState(false);
  // null = not yet known — defaults to hidden rather than flashing the
  // link and then pulling it away once the real value arrives.
  const [selfServiceWalkinEnabled, setSelfServiceWalkinEnabled] = useState<boolean | null>(null);
  const [availability, setAvailability] = useState<Availability>(DEFAULT_AVAILABILITY);

  // Identifies the current passkey ceremony attempt so a guest who bails
  // out of a hung native prompt (via showFailure) can't have a *later*-
  // resolving promise from that abandoned attempt turn around and change
  // the step out from under whatever they're doing next — the ceremony
  // itself keeps running in the background (there's no way to cancel a
  // native WebAuthn prompt), but its result is ignored once stale.
  const attemptIdRef = useRef(0);
  function beginAttempt(): number {
    attemptIdRef.current += 1;
    return attemptIdRef.current;
  }
  function isStaleAttempt(attemptId: number): boolean {
    return attemptIdRef.current !== attemptId;
  }

  useEffect(() => {
    // The party-presence gate only protects *starting* a fresh
    // verification — initialGuest (the walk-in flow) never shows the name
    // step at all, so there's nothing to gate here; see that prop's doc
    // comment.
    if (initialGuest) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/votes/status", { cache: "no-store" });
        const body = (await res.json().catch(() => null)) as {
          selfServiceWalkinEnabled?: boolean;
          checkInGateOpen?: boolean;
        } | null;
        if (cancelled) return;
        // Still read fresh every mount — selfServiceWalkinEnabled can
        // genuinely change between opens, and a guest who has NEVER yet
        // confirmed the gate open needs a real, live answer.
        setSelfServiceWalkinEnabled(res.ok ? (body?.selfServiceWalkinEnabled ?? false) : false);
        if (res.ok && body?.checkInGateOpen) {
          gateConfirmedOpenThisPageLoad = true;
        } else if (!gateConfirmedOpenThisPageLoad) {
          // Only ever locks the screen on a closed/failed read if this page
          // load has never confirmed the gate open before — see that flag's
          // doc comment above for why a LATER failed re-check must never
          // undo an EARLIER success.
          setStep("locked");
        }
      } catch {
        if (!cancelled && !gateConfirmedOpenThisPageLoad) {
          setSelfServiceWalkinEnabled(false);
          setStep("locked");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialGuest]);

  /**
   * Reads which parts of the flow are currently enabled, straight from
   * /api/votes/status — never cached across calls, so a toggle flipped
   * between page load and this guest being picked still takes effect.
   * Fails open (see Availability above): the server-side routes are the
   * real boundary regardless of what this renders.
   */
  async function fetchAvailability(): Promise<Availability> {
    try {
      const res = await fetch("/api/votes/status", { cache: "no-store" });
      const body = (await res.json().catch(() => null)) as {
        passkeyAuthEnabled?: boolean;
        phoneVerificationEnabled?: boolean;
        inPersonCheckInEnabled?: boolean;
      } | null;
      if (!res.ok || !body) return DEFAULT_AVAILABILITY;
      return {
        passkey: body.passkeyAuthEnabled ?? true,
        phone: body.phoneVerificationEnabled ?? true,
        inPerson: body.inPersonCheckInEnabled ?? true,
      };
    } catch {
      return DEFAULT_AVAILABILITY;
    }
  }

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return guests
      .filter((g) => `${g.firstName} ${g.lastName}`.toLowerCase().includes(q))
      .slice(0, MAX_MATCHES);
  }, [guests, query]);

  // The one place that decides "are we done, or does this guest still need
  // the optional photo step" — called after *any* path that completes a
  // fresh verification (real code, in-person give-up, or the
  // zero-methods-enabled auto-check-in). Deliberately not used for the
  // "already has a session" activate
  // fast-path above: that guest already passed through here once during
  // their original verification, so re-prompting them every time they
  // reactivate the same session (e.g. switching back via "Not you?") would
  // just be annoying, not "optional."
  function completeVerification(verifiedGuestId: string) {
    const verifiedGuest = guests.find((g) => g.id === verifiedGuestId);
    if (verifiedGuest?.photoUrl) {
      onVerified(verifiedGuestId);
    } else if (initialPhoto && verifiedGuestId === initialGuest?.id) {
      setStep("photo");
      void uploadPhotoFor(verifiedGuestId, initialPhoto);
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
   * The one way to the failure screen from any sub-step — invalidates any
   * still-in-flight attempt (see attemptIdRef above), clears per-step
   * state, and shows a short explanation of what went wrong. There's no
   * "nothing to report" case here (unlike the old method-selection
   * screen's back-navigation): this screen only ever appears because
   * something failed or isn't available.
   */
  function showFailure(message: string) {
    beginAttempt();
    setSubmitting(false);
    setError(null);
    setFailureMessage(message);
    setStep("failure");
  }

  /** Deliberately backing out of an in-flight attempt (the "passkey" or "passkeyPhoneCode" step's own Cancel) — closes the modal outright rather than landing on the failure screen, since nothing has actually failed. */
  function cancelAttempt() {
    beginAttempt();
    onCancel();
  }

  /**
   * The WebAuthn half of the flow — the only automated way to check in.
   * One call to /begin decides server-side whether this guest is
   * registering a passkey for the first time or signing in with one they
   * already have; /finish then issues the same session cookie every other
   * path does. Any failure along the way — unsupported browser, a
   * rejected/failed server call, a cancelled/rejected/failed native
   * ceremony — lands on the failure screen with a short message.
   */
  async function runPasskeyCeremony(targetGuestId: string) {
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
        body: JSON.stringify({ guestId: targetGuestId }),
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
      // A failed sign-in is never auto-upgraded into a registration
      // attempt — one passkey per guest, enforced server-side; only an
      // admin removing the existing credential re-opens registration (see
      // the module doc comment). A guest in this exact situation (a
      // Passkeys row exists, this device just doesn't have the matching
      // credential) gets a specific, actionable message instead of the
      // begin/finish error text, which is written for a developer, not a
      // guest standing at the door.
      const message =
        ceremonyMode === "authentication"
          ? "Passkey didn't work."
          : err instanceof Error
            ? err.message
            : "Passkey check failed.";
      showFailure(message);
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
   * input to fix if the send itself fails, so that bounces to the failure
   * screen rather than leaving them on a dead "send another" step.
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
      showFailure(err instanceof Error ? err.message : "Failed to send verification code.");
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
      // retype it right here rather than bouncing to the failure screen.
      setError(err instanceof Error ? err.message : "Incorrect code.");
      setSubmitting(false);
      return;
    }

    setCode("");
    // The code checked out — continue into the same WebAuthn registration
    // ceremony a direct (no-phone-gate) first-time registration would run.
    // Anything that fails from here on IS a passkey-attempt failure (not a
    // fixable typo), so it goes to the failure screen instead.
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
      showFailure(err instanceof Error ? err.message : "Passkey check failed.");
    } finally {
      if (!isStaleAttempt(attemptId)) setSubmitting(false);
    }
  }

  /**
   * The true last resort: POST /api/auth/passkey/fallback/give-up, no proof
   * of identity at all — so it only ever files a pending-approval request
   * and lands on the waiting screen; it never completes verification (see
   * that route). Reached only
   * from the failure screen's "Check in with an admin" button — consistent
   * with the existing in-person approval process, just no longer an
   * upfront method choice.
   */
  async function handleCheckInWithAdmin() {
    if (!guestId) return;
    setInPersonBusy(true);
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
      // This path only ever files a pending request — never treat a
      // response as "verified," whatever it says.
      if (!body?.pendingApproval) throw new Error("Couldn't check you in.");
      goToPendingLanding();
    } catch (err) {
      setFailureMessage(err instanceof Error ? err.message : "Couldn't check you in.");
    } finally {
      setInPersonBusy(false);
    }
  }

  /**
   * The zero-methods-enabled path: POST /api/auth/auto-check-in, the one
   * server route that can complete a check-in with no proof of identity
   * AND no explicit In-Person "give up" tap — it only succeeds when all
   * three methods are off, which handlePickGuest has already just
   * confirmed. The only way this can still fail is a toggle flipping
   * between that read and this call, in which case it falls back to the
   * failure screen with a message rather than stranding the guest with
   * nothing to do.
   */
  async function handleAutoCheckIn(targetGuestId: string) {
    try {
      const res = await fetch("/api/auth/auto-check-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestId: targetGuestId }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string; pendingApproval?: boolean } | null;
      if (!res.ok) throw new Error(body?.error ?? "Couldn't check you in.");
      if (body?.pendingApproval) {
        goToPendingLanding();
      } else {
        completeVerification(targetGuestId);
      }
    } catch (err) {
      showFailure(err instanceof Error ? err.message : "Couldn't check you in.");
    }
  }

  async function handlePickGuest(guest: Guest) {
    setGuestId(guest.id);
    setGuestName(`${guest.firstName} ${guest.lastName}`);
    setError(null);
    setFailureMessage(null);
    setCheckingSession(true);
    let currentAvailability = DEFAULT_AVAILABILITY;
    try {
      const [activated, freshAvailability] = await Promise.all([
        fetch("/api/auth/phone/activate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ guestId: guest.id }),
        })
          .then(async (res) => ({
            ok: res.ok,
            body: (await res.json().catch(() => null)) as { switched?: boolean; pendingApproval?: boolean } | null,
          }))
          .catch(() => null),
        fetchAvailability(),
      ]);
      currentAvailability = freshAvailability;
      setAvailability(freshAvailability);

      if (activated?.ok && activated.body?.switched) {
        if (activated.body.pendingApproval) {
          goToPendingLanding();
        } else {
          onVerified(guest.id);
        }
        return;
      }
    } finally {
      setCheckingSession(false);
    }

    // No existing session for this guest — start the one automated flow
    // there is, or fall straight to the failure screen if nothing can run.
    if (!currentAvailability.passkey && !currentAvailability.phone && !currentAvailability.inPerson) {
      await handleAutoCheckIn(guest.id);
    } else if (currentAvailability.passkey) {
      await runPasskeyCeremony(guest.id);
    } else {
      showFailure("Verification isn't available right now.");
    }
  }

  useEffect(() => {
    // Runs once on mount only — initialGuest is fixed for this modal instance's lifetime.
    if (initialGuest) handlePickGuest(initialGuest);
  }, []);

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
    await uploadPhotoFor(guestId, blob);
  }

  // Takes the id explicitly rather than reading `guestId` state: the
  // walk-in path calls this from completeVerification, inside an async
  // chain that started before setGuestId's update was visible to it.
  async function uploadPhotoFor(targetGuestId: string, blob: Blob) {
    setUploadingPhoto(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", blob, "photo.jpg");
      formData.append("guestId", targetGuestId);
      const res = await fetch("/api/photos", { method: "POST", body: formData });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? "Failed to upload photo.");
      onVerified(targetGuestId);
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
        submitting || uploadingPhoto || inPersonBusy
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
            <p className="text-base text-muted">Setting up verification for {guestName}.</p>
          </div>
        )}

        {step === "name" && !initialGuest && (
          <div className="flex flex-col gap-3">
            <h2 className="font-heading text-4xl font-bold uppercase leading-tight text-text">
              <label htmlFor="voter-name-search">Search for your name</label>
            </h2>
            <input
              id="voter-name-search"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Start typing your name…"
              className="field-input w-full bg-bg px-4 py-3 text-lg text-text"
              autoFocus
            />
            {query && matches.length === 0 && (
              <div className="flex flex-col gap-1">
                <p className="font-heading text-4xl font-bold uppercase leading-tight text-white">No matches</p>
                {selfServiceWalkinEnabled && (
                  <a
                    href="/vote/walkin"
                    className="font-heading text-4xl font-bold uppercase leading-tight text-sky-400 underline underline-offset-4 hover:text-sky-300"
                  >
                    Add yourself
                  </a>
                )}
              </div>
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

        {step === "locked" && (
          <div className="flex flex-col items-center gap-3 text-center">
            <QrCodeIcon className="h-16 w-16 text-muted" />
            <h2 className="font-heading text-lg font-bold uppercase text-text">Find the Check-In QR Code</h2>
            <p className="text-base text-muted">Scan the code to check in.</p>
            <button
              type="button"
              onClick={onCancel}
              className="text-base text-muted underline hover:text-text"
            >
              Close
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
              onClick={cancelAttempt}
              className="min-h-[56px] w-full rounded-lg bg-bg px-4 py-3 font-heading font-bold uppercase text-text focus-visible:outline focus-visible:outline-4 focus-visible:outline-white"
            >
              Cancel
            </button>
          </div>
        )}

        {step === "passkeyPhoneCode" && (
          <form onSubmit={handleCheckPhoneGateCode} className="flex flex-col gap-3">
            <h2 className="font-heading text-4xl font-bold uppercase leading-tight text-text">
              <label htmlFor="voter-passkey-code">Enter the code we texted you</label>
            </h2>
            <input
              id="voter-passkey-code"
              type="text"
              inputMode="numeric"
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="field-input bg-bg px-4 py-3 text-center text-lg tracking-widest text-text"
            />
            {error && <p className="text-base text-red-400">{error}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={cancelAttempt}
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

        {step === "failure" && (
          <div className="flex flex-col gap-4">
            <h2 className="font-heading text-xl font-bold uppercase text-text">Couldn&rsquo;t check you in</h2>
            {failureMessage && (
              <p role="alert" className="text-base font-semibold text-red-400">
                {failureMessage}
              </p>
            )}
            {availability.inPerson && (
              <button
                type="button"
                onClick={handleCheckInWithAdmin}
                disabled={inPersonBusy}
                className="min-h-[56px] w-full rounded-lg bg-primary px-6 py-4 text-center font-heading text-lg font-bold uppercase text-bg shadow-lg transition-transform hover:scale-[1.02] focus-visible:outline focus-visible:outline-4 focus-visible:outline-white disabled:opacity-60 disabled:hover:scale-100"
              >
                {inPersonBusy ? "One moment…" : "Check in with an admin"}
              </button>
            )}
            {!availability.inPerson && (
              <p className="text-base text-muted">Find George or Sarah for help checking in.</p>
            )}
            {availability.passkey && (
              <button
                type="button"
                onClick={() => guestId && runPasskeyCeremony(guestId)}
                disabled={inPersonBusy}
                className="self-center text-base text-muted underline hover:text-text disabled:opacity-60"
              >
                Try again
              </button>
            )}
            <button
              type="button"
              onClick={onCancel}
              disabled={inPersonBusy}
              className="self-center text-base text-muted underline hover:text-text disabled:opacity-60"
            >
              Cancel
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
            {uploadingPhoto && <p className="text-base text-muted">Uploading…</p>}
            {error && <p className="text-base text-red-400">{error}</p>}
            <button
              type="button"
              onClick={handleSkipPhoto}
              disabled={uploadingPhoto}
              className="self-center text-base text-muted underline hover:text-text disabled:opacity-60"
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
