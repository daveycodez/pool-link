import { Button, Card, Input, Label, TextField } from "@heroui/react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Waves } from "lucide-react";
import { useState } from "react";
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
		<main className="flex min-h-dvh items-center justify-center px-5">
			<Card className="w-full max-w-sm p-6 sm:p-8">
				<div className="mb-5 flex items-center justify-center gap-2.5">
					<Waves className="size-6 text-accent" />
					<h1 className="text-xl font-semibold tracking-tight">Pool Link</h1>
				</div>

				<div className="mb-5 space-y-1.5 text-center">
					<h2 className="text-lg font-semibold tracking-tight">
						Connect your pool
					</h2>
					<p className="text-sm text-balance opacity-60">
						Sign in with your iAqualink account
					</p>
				</div>

				<form className="flex flex-col gap-3" onSubmit={submit}>
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
							{loginMutation.error.message}
						</p>
					) : null}

					<Button
						type="submit"
						variant="primary"
						size="lg"
						className="w-full"
						isDisabled={loginMutation.isPending}
					>
						{loginMutation.isPending ? "Connecting…" : "Connect"}
					</Button>
				</form>
			</Card>
		</main>
	);
}
