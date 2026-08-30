import { Button, Dropdown, Label } from "@heroui/react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

/** The three choices, shared with the settings row so they cannot drift. */
export const THEMES = [
	{ Icon: Monitor, id: "system", label: "System" },
	{ Icon: Sun, id: "light", label: "Light" },
	{ Icon: Moon, id: "dark", label: "Dark" },
] as const;

/**
 * Appearance, from the header.
 *
 * The trigger shows what the app currently looks like rather than which option
 * is chosen — under "System" the setting is neither sun nor moon, but the
 * screen is definitely one of them, and that is what the icon is answering.
 */
export function ThemeToggle() {
	const { theme, resolvedTheme, setTheme } = useTheme();

	// next-themes only knows the resolved theme after mount, so hold the neutral
	// mark until then rather than rendering one and swapping it.
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);

	const Icon = !mounted ? Monitor : resolvedTheme === "dark" ? Moon : Sun;

	return (
		<Dropdown>
			<Button aria-label="Appearance" isIconOnly size="sm" variant="ghost">
				{/* size-5 to sit level with the gear beside it — a sm Button would
				    otherwise give this size-4, four pixels short of its neighbour. */}
				<Icon className="size-5" />
			</Button>
			<Dropdown.Popover className="w-fit min-w-0">
				<Dropdown.Menu
					onSelectionChange={(keys) => {
						const [next] = keys as Set<string>;
						if (next) setTheme(next);
					}}
					selectedKeys={new Set([mounted ? (theme ?? "system") : "system"])}
					selectionMode="single"
				>
					{THEMES.map(({ Icon: Option, id, label }) => (
						// No tick: the trigger already shows what is in effect, and
						// three options that each carry their own icon do not need a
						// second mark to say which is which.
						<Dropdown.Item id={id} key={id} textValue={label}>
							<Option className="size-4 shrink-0" />
							<Label>{label}</Label>
						</Dropdown.Item>
					))}
				</Dropdown.Menu>
			</Dropdown.Popover>
		</Dropdown>
	);
}
