import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { Loading } from "#/components/loading";
import { useLogout } from "#/lib/queries";

export const Route = createFileRoute("/sign-out")({
	component: SignOut,
});

/**
 * Signing out clears every query, which would otherwise tear down the page
 * that triggered it mid-render. Doing it on its own route means the spinner is
 * the only thing on screen while the session goes away.
 */
function SignOut() {
	const navigate = useNavigate();
	const logout = useLogout();
	// Mutations are not idempotent and `logout` changes identity every render.
	const fired = useRef(false);

	useEffect(() => {
		if (fired.current) return;
		fired.current = true;
		logout.mutate(undefined, {
			onSettled: () => navigate({ to: "/", replace: true }),
		});
	}, [logout, navigate]);

	return <Loading />;
}
