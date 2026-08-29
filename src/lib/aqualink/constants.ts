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

/** IntelliCenter-style light zones. */
export const CMD_ICL_ONOFF = "onoff_iclzone";
export const CMD_ICL_SET_COLOR = "set_iclzone_color";
export const CMD_ICL_SET_CUSTOM_COLOR = "define_iclzone_customcolor";

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
