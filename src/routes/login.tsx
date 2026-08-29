import { Button, Card, Input, Label, TextField } from "@heroui/react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { errorMessage } from "#/lib/aqualink/types";
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
			{ onSuccess: () => navigate({ to: "/", replace: true }) },
		);
	}

	return (
		<div className="flex min-h-[70svh] items-center justify-center">
			<Card className="flex w-full max-w-sm flex-col gap-6 p-6">
				<Card.Header className="items-center gap-1.5 text-center">
					<Card.Title className="text-lg leading-tight font-semibold tracking-tight">
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
								placeholder="you@example.com"
							/>
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
							<Input autoComplete="current-password" placeholder="••••••••" />
						</TextField>
						{loginMutation.isError ? (
							<p className="text-sm text-danger" role="alert">
								{errorMessage(loginMutation.error)}
							</p>
						) : null}
					</div>

					<div className="flex flex-col gap-4">
						<Button
							type="submit"
							variant="primary"
							size="lg"
							className="w-full"
							isDisabled={loginMutation.isPending}
						>
							{loginMutation.isPending ? "Signing in…" : "Sign in"}
						</Button>
						<p className="text-center text-xs text-balance text-muted">
							Your password goes straight to iAqualink. It’s never stored or
							sent anywhere else.
						</p>
					</div>
				</form>
			</Card>
		</div>
	);
}
