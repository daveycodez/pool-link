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

			<p className="max-w-sm text-center text-xs text-balance text-muted">
				Your password goes straight to iAqualink. It’s never stored or sent
				anywhere else.
			</p>

			{/* Out of the flow, like the theme toggle above: the column is centred
			    on the card, so a footer taking part in it would push the card up by
			    its own height. */}
			<div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-2 text-center text-xs text-muted">
				<span>Pool Link is open source, hosted on GitHub Pages.</span>
				<a
					className="link gap-1 font-normal"
					href="https://github.com/daveycodez/pool-link"
					rel="noreferrer"
					target="_blank"
				>
					<GitHubMark className="size-3.5" />
					GitHub
				</a>
			</div>
		</div>
	);
}

/**
 * The GitHub mark, inline because lucide dropped its brand icons — there is no
 * Github export to import any more. `currentColor` so it takes the link's own
 * colour through every state the class already handles.
 */
function GitHubMark({ className }: { className?: string }) {
	return (
		<svg
			aria-hidden="true"
			className={className}
			fill="currentColor"
			viewBox="0 0 24 24"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
		</svg>
	);
}
