import {
	ArrowDownToLine,
	ArrowUpFromLine,
	Blinds,
	Bot,
	BroomSparkles,
	Bubbles,
	ChevronsDown,
	ChevronsUp,
	CloudFog,
	Droplets,
	Fan,
	Filter,
	Flame,
	FlaskConical,
	Gauge,
	Lamp,
	LayoutGrid,
	Lightbulb,
	Moon,
	Music,
	Palette,
	PartyPopper,
	Power,
	RefreshCcw,
	Snowflake,
	Sparkles,
	Split,
	SprayCan,
	Sun,
	Sunset,
	ThermometerSun,
	Timer,
	TrendingDown,
	Waves,
	Wind,
	ZodiacAquarius,
} from "lucide-react";

type Icon = React.ComponentType<{ className?: string }>;

/**
 * Aux labels come from a fixed list the panel offers when naming a relay, so
 * they are the panel's vocabulary rather than free text — which makes matching
 * on them safe across installs. The fixed-key labels this app supplies itself
 * (Spa Mode, Pool Cover) are in here too, for the same reason. Anything
 * unlisted falls back to the device's kind, so a label we do not know costs
 * nothing.
 */
const PRESET_ICONS: Record<string, Icon> = {
	aerator: Wind,
	"air blower": Wind,
	"aqua accents": Sparkles,
	backwash: RefreshCcw,
	"booster pump": Droplets,
	"chem feed": FlaskConical,
	cleaner: Bot,
	"color wheel": Palette,
	"deck jets": Droplets,
	"drain line": ArrowDownToLine,
	fan: Fan,
	"fiber optic": Sparkles,
	"fill line": ArrowUpFromLine,
	"filter pump": Filter,
	"floor system": LayoutGrid,
	fogger: CloudFog,
	fountain: Droplets,
	"freeze protection": Snowflake,
	"heat pump": ThermometerSun,
	heater: Flame,
	"high speed": ChevronsUp,
	"home a/c": Snowflake,
	"home heat": Flame,
	"jet pump": Wind,
	"laminar jets": Droplets,
	lamp: Lamp,
	light: Lightbulb,
	"low speed": ChevronsDown,
	mist: CloudFog,
	music: Music,
	ozonater: FlaskConical,
	ozonator: FlaskConical,
	pond: Waves,
	"pool cover": Blinds,
	"pool light": Lightbulb,
	pump: Filter,
	"ray-vac": Bot,
	rockfall: Waves,
	sconce: Lamp,
	"sheer descent": Waves,
	"sheer dscnt": Waves,
	slide: TrendingDown,
	"solar heater": Sun,
	"solar pump": Sun,
	spa: Bubbles,
	"spa light": Lightbulb,
	"spa mode": Bubbles,
	spillway: Waves,
	stereo: Music,
	"swim jet": Wind,
	"timed aux": Timer,
	"valve(s)": Split,
	valves: Split,
	"vanishing edge": Waves,
	"vanshng edge": Waves,
	waterfall: ZodiacAquarius,
	"water feature": Waves,
	whirlpool: Bubbles,
	"wtr feature": Waves,
};

/** Presets that come in numbered families, so each variant need not be listed. */
const PRESET_PATTERNS: [RegExp, Icon][] = [
	[/^speed\s*\d+$/, Gauge],
	[/^sprinkler\s*\d*$/, SprayCan],
];

/** The icon a panel label asks for, or null to fall back to the device kind. */
export function presetIcon(label: string | undefined): Icon | null {
	const key = (label ?? "").trim().toLowerCase().replace(/\s+/g, " ");
	if (!key) return null;
	const exact = PRESET_ICONS[key];
	if (exact) return exact;
	return PRESET_PATTERNS.find(([re]) => re.test(key))?.[1] ?? null;
}

/**
 * OneTouch macros are named from the panel's own list too, so the same
 * argument applies: matching the name is reading the panel's vocabulary, not
 * guessing at one owner's wording. A macro's contents are unreadable from
 * here, so the icon is all the hint there is about what it does.
 */
const MACRO_ICONS: Record<string, Icon> = {
	"all off": Power,
	"clean mode": BroomSparkles,
	"day party": PartyPopper,
	"night party": Moon,
	"pool mode": Waves,
	"spa mode": Bubbles,
};

/** Falls back to a generic scene mark, so no macro sits iconless beside one. */
export function macroIcon(label: string | undefined): Icon {
	const key = (label ?? "").trim().toLowerCase().replace(/\s+/g, " ");
	return MACRO_ICONS[key] ?? Sunset;
}
