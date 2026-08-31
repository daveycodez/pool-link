import {
	Button,
	Card,
	FieldError,
	Input,
	Label,
	Spinner,
	TextField,
} from "@heroui/react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Waves } from "lucide-react";
import { useState } from "react";
import { ThemeToggle } from "#/components/theme-toggle";
import { useLogin } from "#/lib/queries";

export const Route = createFileRoute("/login")({
	component: LoginScreen,
});

function LoginScreen() {
	const navigate = useNavigate();
	const loginMutation = useLogin();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");

	function submit(e: React.FormEvent) {
		e.preventDefault();
		loginMutation.mutate(
			{ email, password },
			{
				onSuccess: () => navigate({ to: "/", replace: true }),
				// Toasted by the global handler like every other failure. The
				// password goes with it: a rejected one is not worth re-submitting,
				// and leaving it filled invites exactly that.
				onError: () => setPassword(""),
			},
		);
	}

	return (
		<div className="relative flex flex-1 flex-col items-center justify-center gap-6">
			{/* Out of the flow: this column is centred, so a toggle taking part in
			    it would push the card off centre by its own height. The header is
			    hidden on this page — it carries the wordmark, which the card says
			    better — and this is the one control that still has to be reachable
			    before anyone signs in. */}
			<div className="absolute end-0 top-0">
				<ThemeToggle />
			</div>

			<div className="flex items-center gap-2.5">
				<Waves className="size-6 text-accent" />
				<span className="text-xl font-semibold tracking-tight">Pool Link</span>
			</div>

			<Card className="flex w-full max-w-sm flex-col gap-6 p-6">
				<Card.Header className="items-center gap-2 text-center">
					<Card.Title className="text-2xl leading-tight font-semibold tracking-tight">
						Connect your pool
					</Card.Title>
					<Card.Description className="text-balance">
						Sign in with your iAqualink account
					</Card.Description>
				</Card.Header>

				<form className="flex flex-col gap-6" onSubmit={submit}>
					<div className="flex flex-col gap-4">
						<TextField
							fullWidth
							variant="secondary"
							name="email"
							type="email"
							value={email}
							onChange={setEmail}
						>
							<Label>Email</Label>
							<Input
								autoComplete="username"
								inputMode="email"
								placeholder="Email Address"
								required
							/>
							<FieldError />
						</TextField>
						<TextField
							fullWidth
							variant="secondary"
							name="password"
							type="password"
							value={password}
							onChange={setPassword}
						>
							<Label>Password</Label>
							<Input
								autoComplete="current-password"
								placeholder="Password"
								required
							/>
							<FieldError />
						</TextField>
					</div>

					<div className="flex flex-col gap-4">
						<Button
							type="submit"
							variant="primary"
							size="lg"
							className="w-full"
							isPending={loginMutation.isPending}
						>
							{/* Spinner beside an unchanged label, as better-auth-ui has
							    it — a label swap makes the button jump width mid-press. */}
							{({ isPending }) => (
								<>
									{isPending ? <Spinner color="current" size="sm" /> : null}
									Sign in
								</>
							)}
						</Button>
						{/* Reset lives on Zodiac's portal: their endpoint requires a
						    reCAPTCHA token, which is bound to the domain that minted it
						    and so cannot be produced here. */}
						<a
							className="link mx-auto font-normal text-sm"
							href="https://iaqualink.zodiacpoolsystems.com/resetPassword"
							rel="noreferrer"
							target="_blank"
						>
							Forgot password?
						</a>
					</div>
				</form>
			</Card>

			{/* The second sentence is what makes the first one checkable. "Never
			    sent anywhere else" is a promise, and a promise on a login page is
			    worth what the reader's trust in a stranger is worth — where a
			    static site with published source is a fact they can go and verify,
			    and one that explains itself: there is no server here to send a
			    password to. So the two travel together rather than the licence
			    becoming a badge in a footer. */}
			<p className="max-w-sm text-center text-xs text-balance text-muted">
				Your password goes straight to iAqualink. It’s never stored or sent
				anywhere else. Pool Link is{" "}
				{/* Kept to two words on purpose: .link is inline-flex, so it cannot
				    break across lines, and a longer phrase would end a line early in
				    a column this narrow. */}
				<a
					className="link"
					href="https://github.com/daveycodez/pool-link"
					rel="noreferrer"
					target="_blank"
				>
					open source
				</a>{" "}
				and runs as a static site on GitHub Pages, with no server of its own to
				send a password to.
			</p>
		</div>
	);
}
