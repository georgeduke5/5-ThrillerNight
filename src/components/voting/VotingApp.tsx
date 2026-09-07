"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Group, Guest, VotingStatus } from "@/lib/data-access";
import type { VotingCategory } from "@/lib/config/types";
import type { Nominee } from "./types";
import { CategoryVoteCard } from "./CategoryVoteCard";
import { GroupPanel } from "./GroupPanel";
import { VerifyIdentityModal } from "./VerifyIdentityModal";
import { GuestUpdateInfoModal, type GuestEdits } from "@/components/GuestUpdateInfoModal";

interface VotingAppProps {
  categories: VotingCategory[];
  /** config.theme.placeholderImage — threaded down to every nominee/group photo spot. */
  placeholderImage: string;
}

type PendingAction =
  | { type: "vote"; categoryId: string; nominee: Nominee }
  | { type: "group" }
  | { type: "switch" };

function guestToNominee(g: Guest): Nominee {
  return { id: g.id, displayName: `${g.firstName} ${g.lastName}`, photoUrl: g.photoUrl };
}

function groupToNominee(g: Group): Nominee {
  return { id: g.id, displayName: g.name, photoUrl: g.photoUrl };
}

// So newly uploaded photos and newly added guests show up on their own
// without a manual reload.
const BACKGROUND_REFRESH_INTERVAL_MS = 30_000;

/**
 * Identity model (requirements: browsing is always open; identity comes
 * solely from the phone-verification session cookie, never from a name
 * picked in the UI): guests/groups/status/prior-votes all load up front
 * with no gate. `sessionGuestId` — and therefore `voter` — is only ever
 * set from what GET /api/votes reports the session cookie resolves to, or
 * from VerifyIdentityModal's onVerified after a fresh verification. There
 * is no sessionStorage-based "who did the UI last say I was" anymore.
 */
export function VotingApp({ categories, placeholderImage }: VotingAppProps) {
  const [guests, setGuests] = useState<Guest[] | null>(null);
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [status, setStatus] = useState<VotingStatus | null>(null);
  const [sessionGuestId, setSessionGuestId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<string, Nominee | undefined>>({});
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [showGroupPanel, setShowGroupPanel] = useState(false);
  const [showUpdateInfoModal, setShowUpdateInfoModal] = useState(false);
  // Guards the 30s background refresh below from racing an in-flight vote
  // submission — see castVote and the polling effect.
  const voteInFlightRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const [guestsRes, groupsRes, statusRes, votesRes] = await Promise.all([
        fetch("/api/guests", { cache: "no-store" }),
        fetch("/api/groups", { cache: "no-store" }),
        fetch("/api/votes/status", { cache: "no-store" }),
        fetch("/api/votes", { cache: "no-store" }),
      ]);
      if (!guestsRes.ok || !groupsRes.ok || !statusRes.ok || !votesRes.ok) {
        throw new Error("Failed to load voting data.");
      }
      const guestsBody = (await guestsRes.json()) as { guests: Guest[] };
      const groupsBody = (await groupsRes.json()) as { groups: Group[] };
      const statusBody = (await statusRes.json()) as VotingStatus;
      const votesBody = (await votesRes.json()) as {
        voterGuestId: string | null;
        votes: { category: string; nomineeId: string }[];
      };

      setGuests(guestsBody.guests);
      setGroups(groupsBody.groups);
      setStatus(statusBody);
      setSessionGuestId(votesBody.voterGuestId);

      const guestsById = new Map(guestsBody.guests.map((g) => [g.id, g]));
      const groupsById = new Map(groupsBody.groups.map((g) => [g.id, g]));
      const categoriesById = new Map(categories.map((c) => [c.id, c]));
      const restored: Record<string, Nominee | undefined> = {};
      for (const vote of votesBody.votes) {
        const category = categoriesById.get(vote.category);
        if (!category) continue;
        if ((category.nomineeType ?? "guest") === "group") {
          const group = groupsById.get(vote.nomineeId);
          if (group) restored[vote.category] = groupToNominee(group);
        } else {
          const guest = guestsById.get(vote.nomineeId);
          if (guest) restored[vote.category] = guestToNominee(guest);
        }
      }
      // Always trust this fresh fetch fully rather than merging with
      // whatever's already in local state: picks is only ever populated
      // from a prior restored fetch or from castVote's own success branch
      // (itself only reached after a confirmed 200 from POST /api/votes),
      // so there's never a local pick that isn't already reflected here.
      // Merging in stale local state would be actively wrong after
      // switching to a different guest (see handleChangeVoter) — their
      // predecessor's picks must not bleed into the newly active guest's.
      setPicks(restored);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load voting data.");
    }
  }, [categories]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!cancelled) await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  // Background refresh so a newly uploaded photo or a newly added guest
  // shows up on its own. load() fully replaces guests/groups/status/picks
  // from the server every call, but that's safe here: picks is re-derived
  // to the exact same values when nothing's actually changed (see load()'s
  // own comment on why it never merges with stale local state), an open
  // modal (VerifyIdentityModal/GroupPanel) is untouched since load() never
  // sets pendingAction/showGroupPanel, and CategoryVoteCard's carousel
  // position tracks the nominee it's showing (not just a numeric index),
  // so it isn't knocked off place merely because the nominees array got a
  // new reference. Skipped entirely while a vote is mid-submission so a
  // refresh that started just before a vote can't land after it and make
  // the pick flash back to "not voted" before castVote's own update lands.
  useEffect(() => {
    const intervalId = setInterval(() => {
      if (voteInFlightRef.current) return;
      load();
    }, BACKGROUND_REFRESH_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [load]);

  const voter = useMemo(
    () => guests?.find((g) => g.id === sessionGuestId) ?? null,
    [guests, sessionGuestId],
  );

  function handleChangeVoter() {
    // Non-destructive: this only opens the same identify-yourself modal
    // used for check-in/voting, letting the guest pick a different name.
    // The active session doesn't actually change unless they complete that
    // (either instantly, if the picked guest already has a valid session
    // on this browser, or after a fresh phone verification) — canceling
    // leaves the current session untouched rather than stranding the guest
    // logged out with no way to proceed.
    setPendingAction({ type: "switch" });
  }

  async function castVote(categoryId: string, nominee: Nominee) {
    voteInFlightRef.current = true;
    try {
      const res = await fetch("/api/votes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selections: [{ category: categoryId, nomineeId: nominee.id }] }),
      });
      if (res.status === 401) {
        const body = (await res.json().catch(() => null)) as { requiresVerification?: boolean } | null;
        if (body?.requiresVerification) {
          setPendingAction({ type: "vote", categoryId, nominee });
          return; // swallow — VerifyIdentityModal's onVerified will retry
        }
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Failed to submit your vote.");
      }
      setPicks((prev) => ({ ...prev, [categoryId]: nominee }));
    } finally {
      voteInFlightRef.current = false;
    }
  }

  function handleOpenGroupPanel() {
    if (!voter) {
      setPendingAction({ type: "group" });
      return;
    }
    setShowGroupPanel(true);
  }

  async function handleVerified(guestId: string) {
    setSessionGuestId(guestId);
    const action = pendingAction;
    setPendingAction(null);
    // Re-fetch now that the session cookie identifies this guest: load()
    // restores every category's prior pick from the server's vote list, not
    // just whichever one triggered verification — without this, a guest who
    // re-verifies after their session expires only ever sees the one vote
    // they're about to (re)cast, with all their earlier picks in other
    // categories looking as if they'd never voted.
    await load();
    if (!action) return;
    if (action.type === "vote") {
      castVote(action.categoryId, action.nominee).catch(() => {
        // Surfaced to the user via the category card's own error state on retry.
      });
    } else if (action.type === "group") {
      setShowGroupPanel(true);
    }
    // "switch" needs nothing further — load() above already refreshed
    // identity and picks for whichever guest is now active.
  }

  async function handleSaveGuestInfo(id: string, updates: GuestEdits) {
    const res = await fetch(`/api/guests/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    const body = (await res.json().catch(() => null)) as { guest?: Guest; error?: string } | null;
    if (!res.ok || !body?.guest) throw new Error(body?.error ?? "Failed to update your info.");
    const savedGuest = body.guest;
    setGuests((prev) => prev?.map((g) => (g.id === id ? savedGuest : g)) ?? prev);
  }

  async function handleSaveGuestPhoto(id: string, blob: Blob) {
    const formData = new FormData();
    formData.append("file", blob, "photo.jpg");
    formData.append("guestId", id);
    const res = await fetch("/api/photos", { method: "POST", body: formData });
    const body = (await res.json().catch(() => null)) as
      | { photoUrl?: string; photoRef?: string; error?: string }
      | null;
    if (!res.ok || !body?.photoUrl) throw new Error(body?.error ?? "Failed to upload photo.");
    setGuests(
      (prev) =>
        prev?.map((g) =>
          g.id === id ? { ...g, photoUrl: body.photoUrl as string, photoRef: body.photoRef ?? null } : g,
        ) ?? prev,
    );
  }

  if (loadError) {
    return <p className="surface-panel rounded p-4 text-center text-red-400">{loadError}</p>;
  }

  if (!guests || !groups || !status) {
    return <p className="text-center text-muted">Loading…</p>;
  }

  if (!status.isOpen) {
    return (
      <div className="surface-panel rounded-lg p-8 text-center">
        <p className="font-heading text-xl font-bold uppercase text-text">Voting is currently closed</p>
        <p className="mt-2 text-muted">Check back once the hosts open voting.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="surface-panel flex flex-col gap-2 rounded-lg px-4 py-6 text-left">
        <p className="font-heading text-5xl font-extrabold uppercase leading-tight text-text sm:text-6xl">
          1. Swipe
        </p>
        <p className="font-heading text-5xl font-extrabold uppercase leading-tight text-text sm:text-6xl">
          2. Vote
        </p>
        <p className="font-heading text-5xl font-extrabold uppercase leading-tight text-text sm:text-6xl">
          3. Repeat
        </p>
      </div>

      {voter && (
        <div className="surface-panel flex items-center justify-between rounded-lg px-4 py-3">
          <p className="text-text">
            Voting as{" "}
            <button
              type="button"
              onClick={() => setShowUpdateInfoModal(true)}
              className="font-bold underline decoration-dotted underline-offset-4"
            >
              {voter.firstName} {voter.lastName}
            </button>
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowUpdateInfoModal(true)}
              className="text-sm text-muted underline hover:text-text"
            >
              Update my info
            </button>
            <button
              type="button"
              onClick={handleChangeVoter}
              className="text-sm text-muted underline hover:text-text"
            >
              Not you?
            </button>
          </div>
        </div>
      )}

      {categories.map((category, index) => {
        const nomineeType = category.nomineeType ?? "guest";
        const nominees: Nominee[] =
          nomineeType === "group"
            ? groups.map(groupToNominee)
            : (category.bracket === null
                ? guests
                : guests.filter((g) => g.bracket === category.bracket)
              ).map(guestToNominee);

        return (
          <CategoryVoteCard
            key={category.id}
            category={category}
            number={index + 1}
            nominees={nominees}
            currentPick={picks[category.id]}
            onVote={(nominee) => castVote(category.id, nominee)}
            placeholderImage={placeholderImage}
            headerExtra={
              nomineeType === "group" ? (
                <button
                  type="button"
                  onClick={handleOpenGroupPanel}
                  className="text-sm text-primary underline"
                >
                  Register your group
                </button>
              ) : undefined
            }
          />
        );
      })}

      {pendingAction && (
        <VerifyIdentityModal
          guests={guests}
          onVerified={handleVerified}
          onCancel={() => setPendingAction(null)}
        />
      )}

      {showGroupPanel && voter && (
        <GroupPanel
          voter={voter}
          guests={guests}
          groups={groups}
          onChanged={load}
          onClose={() => setShowGroupPanel(false)}
          placeholderImage={placeholderImage}
        />
      )}

      {showUpdateInfoModal && voter && (
        <GuestUpdateInfoModal
          guest={voter}
          placeholderImage={placeholderImage}
          onSave={(updates) => handleSaveGuestInfo(voter.id, updates)}
          onPhotoCropped={(blob) => handleSaveGuestPhoto(voter.id, blob)}
          onClose={() => setShowUpdateInfoModal(false)}
        />
      )}
    </div>
  );
}
