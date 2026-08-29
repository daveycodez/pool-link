import { Link } from "@tanstack/react-router";
import { Waves } from "lucide-react";

/**
 * Shared app chrome. The wordmark links home, so any sub-page gets a way back
 * for free; `children` are the right-aligned actions each route supplies.
 */
export function AppHeader({ children }: { children?: React.ReactNode }) {
	return (
		<header className="mb-4 flex items-center justify-between">
			<Link to="/" className="flex items-center gap-2.5">
				<Waves className="size-5 text-accent" />
				<h1 className="text-lg font-semibold tracking-tight">Pool Link</h1>
			</Link>
			<div className="flex items-center gap-1">{children}</div>
		</header>
	);
}

const BTN =
	"flex size-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-secondary hover:text-foreground disabled:opacity-50";

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
			<Link to={to as string} aria-label={label} title={label} className={BTN}>
				{children}
			</Link>
		);
	}
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			disabled={disabled}
			onClick={onPress}
			className={BTN}
		>
			{children}
		</button>
	);
}
