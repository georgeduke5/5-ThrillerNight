import { NextResponse } from "next/server";
import { ResetInProgressError } from "@/lib/errors";

/** A 503 carrying ResetInProgressError's message, or null for any other error (which the caller should rethrow). */
export function resetInProgressResponse(err: unknown): NextResponse | null {
  return err instanceof ResetInProgressError
    ? NextResponse.json({ error: err.message }, { status: 503 })
    : null;
}
