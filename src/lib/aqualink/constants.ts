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

/** Commands (p-api `command` param). */
export const CMD_GET_HOME = "get_home";
export const CMD_GET_DEVICES = "get_devices";
export const CMD_GET_ONETOUCH = "get_onetouch";
export const CMD_SET_AUX = "set_aux";
export const CMD_SET_LIGHT = "set_light";
export const CMD_SET_TEMPS = "set_temps";
