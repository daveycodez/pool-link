import { Button } from "@heroui/react";
import { Link } from "@tanstack/react-router";
import { House, Waves } from "lucide-react";

/**
 * Shared app chrome. The wordmark links home, so any sub-page gets a way back
 * for free; `children` are the right-aligned actions each route supplies.
 */
export function AppHeader({
	title,
	children,
}: {
	/** The system's name once signed in; falls back to the app name. */
	title?: string;
	children?: React.ReactNode;
}) {
	return (
		<header className="mb-2 flex items-center justify-between gap-4">
			<Link to="/" className="flex min-w-0 items-center gap-2.5">
				{/* Waves is the app's mark, so it only stands in for the wordmark.
				    Once a system name is showing, the icon names the place. */}
				{title ? (
					<House className="size-5 shrink-0 text-accent" />
				) : (
					<Waves className="size-5 shrink-0 text-accent" />
				)}
				<h1 className="truncate text-lg font-semibold tracking-tight">
					{title || "Pool Link"}
				</h1>
			</Link>
			<div className="flex items-center gap-1">{children}</div>
		</header>
	);
}

export function IconBtn({
	label,
	children,
	onPress,
	disabled,
	to,
}: {
	label: string;
	children: React.ReactNode;
	onPress?: () => void;
	disabled?: boolean;
	to?: string;
}) {
	if (to) {
		return (
			<Button
				isIconOnly
				size="sm"
				variant="ghost"
				aria-label={label}
				// Button renders a <button>; swap in the router Link so the icon
				// button navigates. The cast is needed because the handler props
				// are typed against HTMLButtonElement, not HTMLAnchorElement.
				render={(props) => (
					<Link
						{...(props as unknown as React.ComponentPropsWithoutRef<"a">)}
						to={to}
					/>
				)}
			>
				{children}
			</Button>
		);
	}
	return (
		<Button
			isIconOnly
			size="sm"
			variant="ghost"
			aria-label={label}
			isDisabled={disabled}
			onPress={onPress}
		>
			{children}
		</Button>
	);
}
