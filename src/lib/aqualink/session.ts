import { del, get, set } from "idb-keyval";

/**
 * Persisted session. The account password is NEVER stored here — we keep the
 * refresh token and mint fresh idTokens from it.
 */
export interface Session {
	email: string;
	/** per-session id used as `sessionID` on every p-api command. */
	clientId: string;
	/** 17-char prm user id (also `userId` for prm endpoints). */
	userId: string;
	idToken: string;
	refreshToken: string;
	appClientId: string;
	country: string;
}

const KEY = "pool-link:session";
const canUseIDB = () => typeof indexedDB !== "undefined";

export async function loadSession(): Promise<Session | null> {
	if (!canUseIDB()) return null;
	return (await get<Session>(KEY)) ?? null;
}

export async function saveSession(session: Session): Promise<void> {
	if (!canUseIDB()) return;
	await set(KEY, session);
}

export async function clearSession(): Promise<void> {
	if (!canUseIDB()) return;
	await del(KEY);
}
