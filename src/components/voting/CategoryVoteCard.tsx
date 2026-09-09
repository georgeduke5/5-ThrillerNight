"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import Image from "next/image";
import type { VotingCategory } from "@/lib/config/types";
import type { Nominee } from "./types";

interface CategoryVoteCardProps {
  category: VotingCategory;
  /** 1-based position for the "N. Vote for ..." heading. */
  number: number;
  nominees: Nominee[];
  currentPick?: Nominee;
  onVote: (nominee: Nominee) => Promise<void>;
  /** Extra content rendered next to the heading — e.g. the "Register your group" link. */
  headerExtra?: ReactNode;
  /** config.theme.placeholderImage — shown for a nominee with no photo uploaded. */
  placeholderImage: string;
}

const MAX_SEARCH_MATCHES = 6;

/**
 * One costume category (requirements Section 5.2): nominees are already
 * filtered/shaped by the caller (individual guests for bracket-based
 * categories, Group records for the Couple/Group category — see
 * VotingApp.tsx's Nominee mapping). Nominees are shown as an
 * iPhone-Photos-style swipeable carousel — name above, photo centered,
 * a "Vote for this Costume" button below — rather than a tappable list.
 * The button votes for whichever nominee is currently centered; voting
 * submits immediately, and picking someone else in the same category
 * overwrites the previous pick (DataStore.recordVote is an upsert).
 *
 * The carousel has an intro slide at visual index 0 (not a nominee), then
 * sortedNominees at visual indices 1..N. currentIndex therefore ranges from
 * 0 to sortedNominees.length, and every place that maps between a nominee's
 * position in sortedNominees and its visual index adds or subtracts 1.
 */
export function CategoryVoteCard({
  category,
  number,
  nominees,
  currentPick,
  onVote,
  headerExtra,
  placeholderImage,
}: CategoryVoteCardProps) {
  const [query, setQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brokenPhotoIds, setBrokenPhotoIds] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  const sortedNominees = useMemo(
    () =>
      [...nominees].sort((a, b) =>
        a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }),
      ),
    [nominees],
  );

  // Visual index 0 = intro slide; 1..N = sortedNominees[0..N-1].
  const [currentIndex, setCurrentIndex] = useState(0);
  const hasAutoCenteredRef = useRef(false);
  // The nominee ID being shown as of the last render — lets the
  // drift-correction effect tell apart "list changed under a fixed index"
  // (background refresh) from "user moved to a new index on the same list".
  const shownNomineeIdRef = useRef<string | undefined>(undefined);

  // The nominee currently centered, or undefined when on the intro slide.
  const current: Nominee | undefined =
    currentIndex > 0 ? sortedNominees[currentIndex - 1] : undefined;

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return sortedNominees
      .filter((n) => n.displayName.toLowerCase().includes(q))
      .slice(0, MAX_SEARCH_MATCHES);
  }, [sortedNominees, query]);

  const hasPrevious = currentIndex > 0;
  const previousAriaLabel =
    currentIndex > 1
      ? `Previous nominee (${sortedNominees[currentIndex - 2]?.displayName})`
      : "Previous";
  const hasNext = currentIndex < sortedNominees.length;
  const nextAriaLabel = sortedNominees[currentIndex]?.displayName
    ? `Next nominee (${sortedNominees[currentIndex].displayName})`
    : "Next";

  // Center the carousel on the voter's existing pick for this category, if
  // any. VotingApp fetches prior votes asynchronously (they may not be
  // known yet at mount), so this reacts to currentPick arriving rather
  // than only checking once at mount. Guarded to fire only once so it
  // doesn't yank the view away from wherever the voter has since swiped to.
  useEffect(() => {
    if (hasAutoCenteredRef.current || !currentPick) return;
    const idx = sortedNominees.findIndex((n) => n.id === currentPick.id);
    if (idx === -1) return;
    hasAutoCenteredRef.current = true;
    const visualIdx = idx + 1; // +1 for the intro slide at position 0
    setCurrentIndex(visualIdx);
    scrollRef.current?.scrollTo({
      left: visualIdx * (scrollRef.current.clientWidth || 0),
      behavior: "auto",
    });
  }, [currentPick, sortedNominees]);

  // VotingApp polls every 30s so newly added guests/photos show up without
  // a manual reload, which gives `nominees` (and so `sortedNominees`) a new
  // array reference on every poll even when nothing actually changed. If
  // someone whose name sorts earlier gets added while a category is mid-
  // browse, that alone would silently shift who sits at the still-unchanged
  // `currentIndex` — this re-locates whoever was actually being shown and
  // snaps back to them (no scroll animation, so it's invisible when nothing
  // really moved) rather than letting the carousel display a different
  // nominee with no user action. If that nominee is gone entirely (e.g.
  // deleted), leaves currentIndex where it is rather than guessing.
  //
  // Deliberately keyed only on sortedNominees, not currentIndex: this must
  // fire when the *list* changes under a fixed index (a background refresh),
  // not when the user swipes to a new index on the same list — reading
  // currentIndex without depending on it is intentional here.
  useEffect(() => {
    const expectedId = shownNomineeIdRef.current;
    if (expectedId === undefined) return; // on intro slide — nothing to correct
    const currentNomineeId =
      currentIndex > 0 ? sortedNominees[currentIndex - 1]?.id : undefined;
    if (currentNomineeId === expectedId) return;
    const newNomineeIdx = sortedNominees.findIndex((n) => n.id === expectedId);
    if (newNomineeIdx === -1) return;
    const newVisualIdx = newNomineeIdx + 1; // +1 for intro slide
    setCurrentIndex(newVisualIdx);
    scrollRef.current?.scrollTo({
      left: newVisualIdx * (scrollRef.current.clientWidth || 0),
      behavior: "auto",
    });
  }, [sortedNominees]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    shownNomineeIdRef.current =
      currentIndex > 0 ? sortedNominees[currentIndex - 1]?.id : undefined;
  }, [sortedNominees, currentIndex]);

  function markPhotoBroken(nomineeId: string) {
    setBrokenPhotoIds((prev) => (prev.has(nomineeId) ? prev : new Set(prev).add(nomineeId)));
  }

  function handleScroll() {
    const el = scrollRef.current;
    if (!el || el.clientWidth === 0) return;
    const index = Math.round(el.scrollLeft / el.clientWidth);
    // Total visual slots = 1 (intro) + sortedNominees.length
    setCurrentIndex(Math.min(Math.max(index, 0), sortedNominees.length));
  }

  function jumpTo(visualIndex: number) {
    setCurrentIndex(visualIndex);
    setQuery("");
    scrollRef.current?.scrollTo({
      left: visualIndex * scrollRef.current.clientWidth,
      behavior: "smooth",
    });
  }

  function goToPrevious() {
    if (currentIndex > 0) jumpTo(currentIndex - 1);
  }

  function goToNext() {
    if (currentIndex < sortedNominees.length) jumpTo(currentIndex + 1);
  }

  // Desktop/non-touch navigation: mobile swipe (scroll-snap) keeps working
  // exactly as before — this is purely additive on top of it.
  function handleCarouselKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      goToPrevious();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      goToNext();
    }
  }

  async function handleVote() {
    if (!current) return;
    setSubmitting(true);
    setError(null);
    try {
      await onVote(current);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit vote.");
    } finally {
      setSubmitting(false);
    }
  }

  const isCurrentPick = !!current && currentPick?.id === current.id;

  return (
    <section className="surface-panel rounded-lg p-4">
      <div className="mb-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-heading text-2xl font-bold uppercase text-text">
            {number}. Vote for {category.label}
          </h2>
          {headerExtra}
        </div>
        {currentPick && <p className="text-sm text-primary">Your pick: {currentPick.displayName}</p>}
      </div>

      {sortedNominees.length === 0 ? (
        <p className="text-muted">No eligible guests yet.</p>
      ) : (
        <>
          <div className="relative mb-3">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search names…"
              aria-label={`Search nominees for ${category.label}`}
              className="field-input w-full bg-bg px-4 py-2 text-text"
            />
            {matches.length > 0 && (
              <ul className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded border border-muted/30 bg-surface shadow-lg">
                {matches.map((nominee) => (
                  <li key={nominee.id}>
                    <button
                      type="button"
                      onClick={() => jumpTo(sortedNominees.indexOf(nominee) + 1)}
                      className="block w-full px-4 py-2 text-left text-text hover:bg-bg"
                    >
                      {nominee.displayName}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="mb-2 text-center font-heading text-base font-bold uppercase text-text">
            {current?.displayName}
          </p>

          <div className="relative">
            <div
              ref={scrollRef}
              onScroll={handleScroll}
              onKeyDown={handleCarouselKeyDown}
              tabIndex={0}
              role="group"
              aria-label={`${category.label} nominee photos, use left and right arrow keys to browse`}
              className="flex snap-x snap-mandatory items-center overflow-x-auto scroll-smooth rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-scrollbar]:hidden"
              style={{ scrollbarWidth: "none" }}
            >
              {/* Intro slide — visual index 0, not a nominee */}
              <div
                aria-hidden="true"
                className="relative aspect-[4/5] w-full shrink-0 snap-center overflow-hidden bg-surface flex flex-col items-center justify-center gap-6 px-6 text-center"
              >
                <span className="select-none text-[14rem] leading-none text-primary animate-pulse">‹‹‹</span>
                <p className="font-heading text-4xl font-bold uppercase leading-snug">
                  <span className="text-primary">Swipe</span>
                  <span className="text-text"> left to vote for</span>
                  <br />
                  <span className="text-text">{category.label}</span>
                </p>
              </div>

              {sortedNominees.map((nominee) => {
                const hasPhoto = !!nominee.photoUrl && !brokenPhotoIds.has(nominee.id);
                return (
                  <div
                    key={nominee.id}
                    className="relative aspect-[4/5] w-full shrink-0 snap-center overflow-hidden bg-bg"
                  >
                    <Image
                      src={hasPhoto ? (nominee.photoUrl as string) : placeholderImage}
                      alt={
                        hasPhoto
                          ? `${nominee.displayName}'s costume`
                          : `${nominee.displayName} (no photo yet)`
                      }
                      fill
                      className="object-cover"
                      unoptimized
                      onError={hasPhoto ? () => markPhotoBroken(nominee.id) : undefined}
                    />
                  </div>
                );
              })}
            </div>
{/*
            {hasPrevious && (
              <button
                type="button"
                onClick={goToPrevious}
                aria-label={previousAriaLabel}
                className="absolute left-2 top-1/2 flex h-20 w-20 -translate-y-1/2 items-center justify-center rounded-full text-9xl text-text hover:bg-bg"
              >
                ‹
              </button>
            )}
            {hasNext && (
              <button
                type="button"
                onClick={goToNext}
                aria-label={nextAriaLabel}
                className="absolute right-2 top-1/2 flex h-20 w-20 -translate-y-1/2 items-center justify-center rounded-full text-9xl text-text hover:bg-bg"
              >
                ›
              </button>
            )}*/}
          </div>

          <p className="mt-1 text-center text-xs text-muted">
            {currentIndex > 0
              ? `${currentIndex} of ${sortedNominees.length} — swipe, click the arrows, or use ← →`
              : `${sortedNominees.length} nominee${sortedNominees.length === 1 ? "" : "s"} — swipe left or click › to start`}
          </p>

          <button
            type="button"
            onClick={handleVote}
            disabled={submitting || !current}
            className={`vote-button mt-2 w-full rounded px-4 py-3 font-heading font-bold uppercase disabled:opacity-60 ${
              isCurrentPick ? "vote-button-voted" : ""
            }`}
          >
            {submitting ? (
              "Submitting…"
            ) : isCurrentPick ? (
              <>
                <span aria-hidden="true" className="mr-2 text-2xl align-middle">
                  ✓
                </span>
                Voted for this Costume
              </>
            ) : (
              "Vote for this Costume"
            )}
          </button>
        </>
      )}

      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </section>
  );
}
