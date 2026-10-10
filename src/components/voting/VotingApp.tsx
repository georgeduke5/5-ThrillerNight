"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import type { Group, Guest, VotingStatus } from "@/lib/data-access";
import type { VotingCategory } from "@/lib/config/types";
import type { Nominee } from "./types";
import { CategoryVoteCard } from "./CategoryVoteCard";
import { VotingCategoriesHub } from "./VotingCategoriesHub";
import { GroupPanel } from "./GroupPanel";
import { VerifyIdentityModal } from "./VerifyIdentityModal";
import { GuestUpdateInfoModal, type GuestEdits } from "@/components/GuestUpdateInfoModal";
import { VoterIdentityBar } from "@/components/VoterIdentityBar";

interface VotingAppProps {
  categories: VotingCategory[];
  /** config.theme.placeholderImage — threaded down to every nominee/group photo spot. */
  placeholderImage: string;
  /**
   * config.voting.prizeImage — rendered only on the "Voting Categories" hub
   * (never while a category screen is active), so the prize photo never
   * competes with the swipeable nominee card for attention while a guest is
   * actively voting. Optional; omitted entirely when unset, same as before.
   */
  prizeImage?: string;
  /**
   * The event logo (EventLogo), pre-rendered by the Server Component page
   * and handed down as an element rather than built here — EventLogo reads
   * site config via a server-only path, so it can't be imported into this
   * "use client" file directly. Rendered only on the "Voting Categories"
   * hub, never on an active category's own screen: the logo was pushing
   * the swipeable nominee card down far enough to need scrolling to see
   * it, so the category screen drops it entirely rather than just
   * shrinking it further.
   */
  logo?: ReactNode;
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
 *
 * Two-level navigation (requirements: a "Voting Categories" hub listing
 * every category, each leading to that category's own screen): purely a
 * client-side view state (`activeCategoryId`), not a route change — every
 * category's nominees, the current picks, and the voter's identity are
 * already loaded up front regardless of which "screen" is showing, so
 * switching between them is just a render branch, never a re-fetch. The
 * category screen renders exactly one CategoryVoteCard — the gallery
 * component itself, and everything about how it looks/behaves, is
 * untouched — plus a "Back to Voting Categories" button that clears
 * `activeCategoryId`. The hub (VotingCategoriesHub) always lists every
 * category regardless of vote status; "Voted" is advisory only, never a
 * gate, since re-entering a category to change a pick is explicitly
 * allowed (DataStore.recordVote overwrites, never double-counts).
 */
export function VotingApp({ categories, placeholderImage, prizeImage, logo }: VotingAppProps) {
  const [guests, setGuests] = useState<Guest[] | null>(null);
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [status, setStatus] = useState<VotingStatus | null>(null);
  const [sessionGuestId, setSessionGuestId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<string, Nominee | undefined>>({});
  // null = on the "Voting Categories" hub; otherwise the id of the
  // category screen currently showing. Not persisted anywhere — a reload
  // always lands back on the hub, same as every other client-only view
  // state in this app.
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
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

  const activeCategory = categories.find((c) => c.id === activeCategoryId) ?? null;
  const votedCategoryIds = new Set(
    Object.entries(picks)
      .filter(([, nominee]) => !!nominee)
      .map(([categoryId]) => categoryId),
  );

  // Computed inline rather than via a nested helper function: TS can't
  // carry the `guests`/`groups` non-null narrowing from the early returns
  // above across a function boundary, so this stays a plain expression in
  // the same control-flow scope that narrowed them.
  const activeNominees: Nominee[] = !activeCategory
    ? []
    : (activeCategory.nomineeType ?? "guest") === "group"
      ? groups.map(groupToNominee)
      : (activeCategory.bracket === null
          ? guests
          : guests.filter((g) => g.bracket === activeCategory.bracket)
        ).map(guestToNominee);

  return (
    <div className="flex flex-col gap-6">
      {activeCategory ? (
        // No logo/header renders above this (see the `logo` prop doc
        // comment), and <main> contributes no top padding either (that
        // only applies inside the hub branch below) — so this screen's
        // content is otherwise flush at the very top of the viewport,
        // rather than centered with slack above it (a prior centering
        // treatment was dropped for exactly this reason — the two aren't
        // compatible, and "flush at the top" is the explicit, more
        // specific ask). pt-14 is the one exception: just enough to clear
        // the fixed, always-top-left HomeLink (see src/components/
        // HomeLink.tsx) so it never sits on top of this heading's text —
        // every other guest page has enough natural top content that this
        // never comes up. Deliberately no items-center: CategoryVoteCard's
        // carousel measures/sizes its slides off its own full-width box
        // (see scrollToVisualIndex in CategoryVoteCard.tsx) — a cross-axis
        // "stretch" (the flex default) keeps that width correct;
        // items-center would shrink it to its widest child's natural
        // (unconstrained) content width instead.
        <div className="flex w-full flex-col gap-3 pt-14">
          <CategoryVoteCard
            key={activeCategory.id}
            category={activeCategory}
            number={1}
            nominees={activeNominees}
            currentPick={picks[activeCategory.id]}
            onVote={(nominee) => castVote(activeCategory.id, nominee)}
            placeholderImage={placeholderImage}
            headerExtra={
              (activeCategory.nomineeType ?? "guest") === "group" ? (
                <button
                  type="button"
                  onClick={handleOpenGroupPanel}
                  className="text-base text-primary underline"
                >
                  Register your group
                </button>
              ) : undefined
            }
          />
          <button
            type="button"
            onClick={() => setActiveCategoryId(null)}
            className="flex min-h-[56px] w-full items-center justify-center gap-3 rounded-lg bg-bg px-6 py-3 font-heading text-xl font-bold uppercase text-text shadow-lg transition-transform hover:scale-[1.02]"
          >
            <span aria-hidden="true" className="text-3xl leading-none">
              ←
            </span>
            Back to Voting Categories
          </button>
        </div>
      ) : (
        // pt-3 here (rather than on <main>, which also wraps the
        // activeCategory branch above) is deliberately hub-only: the
        // category screen has no top padding of its own at all, so its
        // content starts flush at the very top of the viewport.
        <div className="flex flex-col gap-6 pt-3">
          {logo}

          {voter && (
            <VoterIdentityBar
              label="Voting as"
              voter={voter}
              onUpdateInfo={() => setShowUpdateInfoModal(true)}
              onChangeVoter={handleChangeVoter}
            />
          )}

          <VotingCategoriesHub
            categories={categories}
            votedCategoryIds={votedCategoryIds}
            onSelectCategory={setActiveCategoryId}
          />

          {prizeImage && (
            <div className="surface-panel flex flex-col items-center gap-4 rounded-lg p-6 text-center">
              <p className="font-heading text-2xl font-bold uppercase text-text">
                This is the prize you could win!
              </p>
              <div className="relative h-80 w-full max-w-sm overflow-hidden rounded-lg sm:h-96">
                <Image
                  src={prizeImage}
                  alt="Costume contest prize"
                  fill
                  // Deliberately NOT unoptimized, unlike the Google-Drive
                  // guest/nominee photos elsewhere: this file is local
                  // (public/), so Next's built-in optimizer can resize +
                  // re-encode it to whatever this ~384px-wide box actually
                  // needs, instead of shipping the source file's full
                  // resolution/format.
                  className="object-contain"
                  sizes="(min-width: 640px) 24rem, 100vw"
                />
              </div>
            </div>
          )}
        </div>
      )}

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
