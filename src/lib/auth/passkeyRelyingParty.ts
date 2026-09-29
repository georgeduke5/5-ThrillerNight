import "server-only";
import type { NextRequest } from "next/server";
import { getSiteConfig } from "@/lib/config";

export interface PasskeyRelyingParty {
  rpName: string;
  /** Registrable domain the credential is bound to — no scheme, no port. */
  rpId: string;
  /** Every origin a ceremony may legitimately be completed from. */
  origins: string[];
}

/**
 * Resolves the WebAuthn relying-party identity for one request.
 *
 * Config wins when set (auth.passkey.rpId / auth.passkey.origins, either
 * from site.config.json or SITE_PASSKEY_RP_ID / SITE_PASSKEY_ORIGINS);
 * otherwise both are derived from the request's own host. That fallback is
 * what lets a single build serve local dev and the production Vercel domain
 * without either being hardcoded — each request verifies against the host
 * it actually arrived on.
 *
 * The derived origin is always included even when origins *are* configured,
 * so adding a new preview/production domain can't lock everyone out before
 * someone remembers to update the list. That's safe because the browser
 * itself sets the origin from the real page URL — it can't be spoofed by
 * request-body content — and the rpId check below still pins which domain a
 * credential belongs to.
 */
export function resolvePasskeyRelyingParty(request: NextRequest): PasskeyRelyingParty {
  const configured = getSiteConfig().auth.passkey;

  // x-forwarded-* is what actually reflects the browser-visible URL behind
  // Vercel's proxy; the bare host header there is the internal one.
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost ?? request.headers.get("host") ?? request.nextUrl.host;
  const proto =
    request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "") ?? "https";

  // rpId is a bare domain: strip the port a host header carries in dev.
  const derivedRpId = host.split(":")[0] ?? "";
  const derivedOrigin = `${proto}://${host}`;

  const origins = Array.from(new Set([...configured.origins, derivedOrigin].filter(Boolean)));

  return {
    rpName: configured.rpName,
    rpId: configured.rpId || derivedRpId,
    origins,
  };
}
