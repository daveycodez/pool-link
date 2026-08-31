/**
 * JWT helpers for browser-direct use.
 *
 * This was a port of `iaqualink/utils/crypto.py`, which is an HMAC-SHA1 request
 * signer over the public mobile API key. Nothing here ever signed anything —
 * every endpoint this app talks to authenticates with the bearer idToken — and
 * leaving the signer in place invited exactly the wrong conclusion: a reviewer
 * reading it inferred that these endpoints authenticate by signature rather
 * than by account, and built a whole severity assessment on top of that. Dead
 * code that misleads is not free, so it is gone.
 */

/** Decode a JWT payload WITHOUT verifying. We are the client, not a verifier. */
export function decodeJwtClaims(
	token: string | undefined,
): Record<string, unknown> {
	if (!token) return {};
	try {
		const payload = token.split(".")[1];
		if (!payload) return {};
		return JSON.parse(
			atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
		) as Record<string, unknown>;
	} catch {
		return {};
	}
}

export function jwtExpiry(token: string): number | null {
	const exp = decodeJwtClaims(token).exp;
	return typeof exp === "number" ? exp : null;
}
