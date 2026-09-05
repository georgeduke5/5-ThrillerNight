"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Group, Guest, VotingStatus } from "@/lib/data-access";
import type { VotingCategory } from "@/lib/config/types";
import type { Nominee } from "./types";
import { CategoryVoteCard } from "./CategoryVoteCard";
import { GroupPanel } from "./GroupPanel";
import { VerifyIdentityModal } from "./VerifyIdentityModal";

interface VotingAppProps {
  categories: VotingCategory[];
}

type PendingAction =
  | { type: "vote"; categoryId: string; nominee: Nominee }
  | { type: "group" };

function guestToNominee(g: Guest): Nominee {
  return { id: g.id, displayName: `${g.firstName} ${g.lastName}`, photoUrl: g.photoUrl };
}

function groupToNominee(g: Group): Nominee {
  return { id: g.id, displayName: g.name, photoUrl: g.photoUrl };
}

/**
 * Identity model (requirements: browsing is always open; identity comes
 * solely from the phone-verification session cookie, never from a name
 * picked in the UI): guests/groups/status/prior-votes all load up front
 * with no gate. `sessionGuestId` — and therefore `voter` — is only ever
 * set from what GET /api/votes reports the session cookie resolves to, or
 * from VerifyIdentityModal's onVerified after a fresh verification. There
 * is no sessionStorage-based "who did the UI last say I was" anymore.
 */
export function VotingApp({ categories }: VotingAppProps) {
  const [guests, setGuests] = useState<Guest[] | null>(null);
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [status, setStatus] = useState<VotingStatus | null>(null);
  const [sessionGuestId, setSessionGuestId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<string, Nominee | undefined>>({});
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [showGroupPanel, setShowGroupPanel] = useState(false);

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
      setPicks((prev) => ({ ...restored, ...prev }));
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

  const voter = useMemo(
    () => guests?.find((g) => g.id === sessionGuestId) ?? null,
    [guests, sessionGuestId],
  );

  async function handleChangeVoter() {
    await fetch("/api/auth/phone/logout", { method: "POST" }).catch(() => {});
    setSessionGuestId(null);
    setPicks({});
  }

  async function castVote(categoryId: string, nominee: Nominee) {
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
    } else {
      setShowGroupPanel(true);
    }
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
            <span className="font-bold">
              {voter.firstName} {voter.lastName}
            </span>
          </p>
          <button
            type="button"
            onClick={handleChangeVoter}
            className="text-sm text-muted underline hover:text-text"
          >
            Not you?
          </button>
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
        />
      )}
    </div>
  );
}
