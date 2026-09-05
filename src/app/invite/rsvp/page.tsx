import { notFound } from "next/navigation";
import { getSiteConfig } from "@/lib/config";

/**
 * Phase 1 stub RSVP form (requirements Section 6.1). Deliberately
 * non-functional — full household RSVP flow (primary registrant, additional
 * guests, bracket tagging, optional food item, returning-visitor
 * detection) is Phase 2 scope (Section 6.2). See src/lib/rsvp/types.ts for
 * the data shape this will submit once built out.
 */
export default function RsvpStubPage() {
  const config = getSiteConfig();
  if (!config.features.invitationModuleEnabled) notFound();

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 px-6 py-24 text-text">
      <h1 className="font-heading text-3xl font-bold uppercase">RSVP</h1>
      <p className="text-muted">
        This is a structural stub only. The full RSVP form arrives in Phase 2.
      </p>
      <form className="flex flex-col gap-3 opacity-50">
        <input
          disabled
          placeholder="First name"
          className="field-input bg-surface px-3 py-2 text-text"
        />
        <input
          disabled
          placeholder="Last name"
          className="field-input bg-surface px-3 py-2 text-text"
        />
        <input
          disabled
          placeholder="Email"
          className="field-input bg-surface px-3 py-2 text-text"
        />
        <button
          disabled
          type="button"
          className="rounded bg-primary px-4 py-2 font-heading font-bold uppercase text-bg"
        >
          Submit (disabled)
        </button>
      </form>
    </main>
  );
}
