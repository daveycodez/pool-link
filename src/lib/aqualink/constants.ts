/**
 * Constants for the iAqualink APIs — a TypeScript port of the `iaqualink`
 * Python package (https://github.com/flz/iaqualink-py).
 *
 * These are the OLD mobile p-api/r-api endpoints, which are fully browser-direct:
 * every endpoint returns `access-control-allow-origin: *` and clean JSON. The
 * modern prm web API's live data (webtouch) is CORS-walled and unusable from a
 * browser PWA, so we don't use it for telemetry/control.
 */

export const API_KEY = "EOOEMOW4YR6QNB07";

export const LOGIN_URL = "https://prod.zodiac-io.com/users/v1/login";
export const REFRESH_URL =
	"https://prod.zodiac-io.com/users/v1/refresh4InviteCode";

/** p-api mobile session endpoint: get_home/get_devices/set_* all go here. */
export const PAPI_SESSION_URL =
	"https://p-api.iaqualink.net/v2/mobile/session.json";

/** prm modern API — used only for login plumbing + device list. */
export const PRM = "https://prm.iaqualink.net/v2";
export const USER_ID_URL = `${PRM}/userId`;
export const accountUrl = (userId: string) => `${PRM}/users/${userId}/account`;
export const locationsUrl = (userId: string) =>
	`${PRM}/users/${userId}/locations`;

/** Screen reads (p-api `command` param). */
export const CMD_GET_HOME = "get_home";
export const CMD_GET_DEVICES = "get_devices";
export const CMD_GET_ONETOUCH = "get_onetouch";

/** Actuation. `set_aux` and `set_onetouch` are prefixes — the target name is
 * appended to the command itself (e.g. `set_aux_3`), not passed as a param. */
export const CMD_SET_AUX = "set_aux";
export const CMD_SET_ONETOUCH = "set_onetouch";

/**
 * One command, two call shapes, told apart by whether `subtype` is sent. A
 * colour light names its family in `subtype` and puts an effect id in `light`;
 * a dimming relay has no family to name and puts a brightness percentage in
 * that same `light` field. Send `subtype` to a dimmer and the panel is being
 * told the percentage is an effect id on a fixture that has no effects.
 */
export const CMD_SET_LIGHT = "set_light";
export const CMD_SET_TEMPS = "set_temps";
export const CMD_SET_POOL_HEATER = "set_pool_heater";
export const CMD_SET_SPA_HEATER = "set_spa_heater";
export const CMD_SET_SOLAR_HEATER = "set_solar_heater";
export const CMD_SET_POOL_PUMP = "set_pool_pump";
export const CMD_SET_SPA_PUMP = "set_spa_pump";

/** Heat pump module. */
export const CMD_ENABLE_DISABLE_HPM = "enable_disable_hpm";
export const CMD_SWITCH_HPM_MODE = "switch_hpm_mode";
export const CMD_SETPOINT_HPM_TEMP = "setpoint_hpm_temp";

/**
 * Salt water chlorinator. Not in flz/iaqualink-py's master branch — these come
 * from its protocol reference and its unmerged SWC branch, and no capture from
 * a panel that pairs a cell exists to check them against, which is why every
 * consumer of them is written to tolerate a rejection.
 *
 * The shape to know: output is two set points and never one, and
 * `set_swc_config` carries both on every write — the same trap `set_temps` has
 * with its two bodies. Boost is a timer with four verbs, not a flag.
 */
export const CMD_GET_SWC_CONFIG = "get_swc_config";
export const CMD_SET_SWC_CONFIG = "set_swc_config";
export const CMD_CONTROL_SWC_BOOST = "control_swc_boost";

/** IntelliCenter-style light zones. */
export const CMD_ICL_ONOFF = "onoff_iclzone";
export const CMD_ICL_SET_COLOR = "set_iclzone_color";
export const CMD_ICL_SET_CUSTOM_COLOR = "define_iclzone_customcolor";

/**
 * The zone list as its own read, rather than the copy that rides along with
 * `get_devices`. The one field it certainly adds is `zoneCount`, the panel's
 * own count of configured zones — without it an empty `icl_info_list` cannot be
 * told apart from a panel that said nothing. Whether it also carries RGBW the
 * copy omits is genuinely unsettled; see `iclGetInfo` for both sides of it.
 *
 * Upstream declines to call it, citing a timeout on hardware — hedged to *some*
 * hardware everywhere but their code comment, and never measured, since they
 * never shipped the call. It answered this panel in well under a second, so it
 * is now a real data source and not only a probe. `get_devices` still carries
 * live zone state; this rides a slow cadence beside it and is never waited on.
 */
export const CMD_ICL_GET_INFO = "get_icl_info";

/**
 * Brightness as its own command. It exists in the vendor's own app sources and
 * is reachable, but no observed app path ever sends it — the app changes
 * brightness with `set_iclzone_color` and omits `color_id`, which is what
 * `iclSetBrightness` already does. Named here for completeness, and left unused
 * on purpose: the command the app exercises is the one the panel is known to
 * handle correctly, and a second path to the same effect is a second thing to
 * be wrong.
 */
export const CMD_ICL_SET_DIM = "set_iclzone_dim";

/**
 * Rename a zone. Unverified — no capture of this command exists.
 *
 * The one write in this group the app sends, and the reason it is the one is
 * that its blast radius is a string. A zone called the wrong thing is fixed by
 * renaming it again, from the same control, with nothing in the water having
 * moved; every other unexercised ICL write below changes which fixture answers
 * to what. The reference gives the parameter as `name_val`, which is a spelling
 * no other command on this pad uses — `set_vsp_name` takes `pump_name` and
 * `set_speed_name` takes `speed_name` — so it is the single most likely thing
 * here to be wrong, and a panel that rejects it rejects it harmlessly.
 */
export const CMD_ICL_SET_NAME = "set_iclzone_name";

/**
 * Zoning mode, and the fixture inventory that comes back with it. Turning
 * zoning on or off is a commissioning act, not a daily one: it changes how
 * every fixture on the pad is grouped. The response is the only place the
 * per-fixture DCT inventory appears — which lights exist, which zone each one
 * sits in — so the data is genuinely interesting, but it cannot be had without
 * writing, and that is why it is not a diagnostics probe. Unverified.
 *
 * Not reachable from any screen, and the reason is narrower than the risk: the
 * mode has no read. `get_icl_info` reports zones and says nothing about
 * `zoning_mode_status`, and no other command carries the field, so a switch for
 * this would have to paint some position before it knew one — and the only way
 * to learn the real one would be to flip it. A control whose current state is
 * discoverable only by changing it is not a control.
 */
export const CMD_ICL_ZONING_MODE = "enable_disable_zoning_mode";

/**
 * Reassign one fixture to a different zone. Unverified, and not reachable.
 *
 * `dct_id` and `light_id` address a physical light through the transmitter it
 * hangs off, and that id space appears in exactly one place: the `DCT_info_list`
 * that comes back from `enable_disable_zoning_mode`. Since that command is not
 * sent, nothing in this app has ever held a real `dct_id`, and the ids cannot be
 * guessed — the wrong pair moves a light the owner did not name into a zone he
 * did not choose, and the app would have no way to tell him which.
 */
export const CMD_ICL_MOVE_LIGHTS = "move_lights_to_zone";

/**
 * Variable speed pumps. Speeds are addressed directly by id — no aux relay is
 * involved — which is why the iAqualink phone app can set them and the web app
 * can't. Gate these on `SystemSummary.isVSP`.
 */
export const CMD_GET_VSP_SPEED = "get_vsp_speedauxinfo";
export const CMD_SET_VSP_SPEED = "enable_disable_pump_speedId";
export const CMD_GET_VSP_NAMES = "get_vsp_names";
export const CMD_GET_VSP_APPMODELSERIALS = "get_vsp_appmodelserials";
export const CMD_GET_MASTER_DEVICE_LIST = "get_master_device_list";

/**
 * A pump's own definition: the model behind the slot, the unit its speeds are
 * counted in, and the priming and freeze-protection speeds the panel runs
 * without being asked. `get_vsp_speedauxinfo` reports a slot's presets and a
 * min/max, but not whether that min/max is RPM or GPM — a flow-rate pump and a
 * speed pump report the same integers and mean different things. This is the
 * command that says which.
 */
export const CMD_GET_VSP_DEFINITION = "get_vsp_definition";

/** Pump serials the panel can see but nobody has assigned to a slot yet. */
export const CMD_GET_UNASSIGNED_SERIALS = "get_unassigned_serials";

/**
 * Pump commissioning. These are the commands that decide what a slot *is* —
 * which physical pump answers to it, what model the panel thinks it is talking
 * to, what its speeds are called and worth. Getting one wrong does not turn
 * something on at the wrong time; it teaches the panel a wrong fact about the
 * hardware and leaves it there. None has ever been captured on the wire, and
 * upstream implements none of them, so every one is unverified in the strongest
 * sense: parameter names come from the protocol reference alone.
 */
export const CMD_SET_VSP_NAME = "set_vsp_name";
export const CMD_SET_VSP_DEFINITION = "set_vsp_definition";
export const CMD_ASSIGN_VSP_SERIAL = "assign_vsp_serial";
export const CMD_UNASSIGN_VSP_SERIAL = "unassign_vsp_serial";
export const CMD_SET_AUX_SPEED = "set_aux_speed";
export const CMD_SET_SPEED_NAME = "set_speed_name";
export const CMD_SET_SPEEDNAME_VALUE = "set_speedname_value";

/**
 * Run a pump at a speed that is not one of its saved presets.
 *
 * Every other way to move a pump picks from the eight the owner configured;
 * this one carries a raw value. Upstream flags arbitrary-RPM writes as not yet
 * confirmed for iaqua, and a pump asked for a speed outside what its plumbing
 * can carry is a real-world hazard rather than a rejected request — which is
 * why nothing here bounds it and the caller must.
 */
export const CMD_ENABLE_PUMP_SPEED_VALUE = "enable_pump_speed_value";

/**
 * The panel's own timed programs. This app used to treat schedules as
 * WebTouch-only and sent owners to the panel's embedded web UI for them.
 * `get_schedule_list` has since been run against a pad and answers properly, so
 * the programs that quietly overrule every switch in this app are readable
 * after all — which is what the Schedules page is built on.
 *
 * The reference this was ported from was wrong about the reply in several ways
 * worth remembering, because the same reference is still the only source for
 * `do_schedule_operation`, which nothing has ever sent. `scheduleDays` is a
 * closed set of words with no spaces in them ("AllDays", "Weekdays",
 * "Weekends", "Wednesday") rather than a free descriptor or a day mask,
 * `isNewScheduleAllowed` is the string "Allowed" rather than a boolean, and
 * `pageNum` is an accepted request parameter that goes undocumented.
 *
 * A schedule names a `deviceId`, not an aux key — the id space is
 * `get_master_device_list`'s low range, and `listType=1` is the join that turns
 * "device 12" into "Waterfall".
 */
export const CMD_GET_SCHEDULE_LIST = "get_schedule_list";
export const CMD_DO_SCHEDULE_OPERATION = "do_schedule_operation";

/**
 * TruSense pH/ORP probe. The readings themselves already arrive on `get_home`
 * as `ph` and `orp`, so these commands are not how the numbers are obtained —
 * they are how the sensor's own health is: whether each channel is calibrated,
 * when it last was, and what the probe says about itself. That is the part
 * `get_home` cannot answer, and a pH reading from an uncalibrated probe is
 * worse than no reading because it looks the same as a good one.
 *
 * `unit_id` addresses the sensor unit. Upstream confirms it is an integer from
 * the request signature but has never seen a live value, so the valid range is
 * genuinely unknown — the probes try the low ids rather than assuming one.
 */
export const CMD_GET_PHORP_VALUES = "get_phorp_values";
export const CMD_GET_PHORP_LASTCALIBINFO = "get_phorp_lastcalibinfo";
export const CMD_GET_PHORP_CALIBSTATUS = "get_phorp_calibstatus";

/**
 * Sensor calibration. These start a physical procedure at the probe, and a
 * calibration begun with the wrong reference solution in the cup leaves the
 * sensor confidently wrong about the water until someone redoes it. They exist
 * here for coverage and are deliberately not reachable from diagnostics; any
 * caller needs a deliberate, guided flow rather than a button. Unverified.
 */
export const CMD_DO_1POINT_PH_CALIBRATION = "do1pointphcalibration";
export const CMD_DO_2POINT_PH_CALIBRATION = "do_2point_phcalibration";
export const CMD_DO_ORP_CALIBRATION = "do_orp_calibration";
