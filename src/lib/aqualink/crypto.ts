/** Port of `iaqualink/utils/crypto.py` plus JWT helpers for browser-direct use. */

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

/** HMAC-SHA1 hexdigest over `parts` joined by "," (port of `sign()`). */
export async function sign(parts: string[], secret: string): Promise<string> {
	const message = parts.join(",");
	return hmacSha1Hex(secret, message);
}

async function hmacSha1Hex(secret: string, message: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-1" },
		false,
		["sign"],
	);
	const mac = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(message),
	);
	return Array.from(new Uint8Array(mac))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}
