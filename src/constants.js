// -----------------------------------------------------------------------------
// Constants of the Hoymiles (OpenDTU) integration.
// -----------------------------------------------------------------------------

export const USER_AGENT = 'gladys-hoymiles/0.1 (+https://github.com/LM1LC3N7/gladys-hoymiles)';
/** The ESP32 answers in a few hundred milliseconds; 10 s means it is gone. */
export const HTTP_TIMEOUT = 10_000;
/** The largest answer accepted (ten inverters with their channels are ~25 KB). */
export const MAX_BODY_BYTES = 512 * 1024;

/** OpenDTU's fixed user name (AUTH_USERNAME in its defaults.h). */
export const OPENDTU_USER = 'admin';

/**
 * Pace. OpenDTU itself polls the inverters every 5 s by default, so reading
 * it faster brings nothing: `poll_interval` is 15 s by default, never below 5.
 * While every inverter sleeps (no sun), one reading a minute is enough to
 * see the first one wake up.
 */
export const NIGHT_INTERVAL = 60_000;
/** The inverters' maximum power and limit status: once an hour. */
export const LIMIT_STATUS_INTERVAL = 60 * 60_000;
/** A command is acknowledged by the inverter within seconds: read it back once. */
export const COMMAND_SETTLE = 8_000;

/**
 * OpenDTU keeps the last values of an inverter it no longer reaches. Data
 * older than this is stale whatever `reachable` says (right after an OpenDTU
 * reboot, an inverter never read counts as reachable for a while).
 */
export const STALE_DATA = 5 * 60_000;

/** Debounce of the production triggers (dawn and dusk flicker around 0 W). */
export const START_DEBOUNCE = 5 * 60_000;
export const STOP_DEBOUNCE = 15 * 60_000;

/** At most this many alarm events per inverter and per reading. */
export const MAX_ALARM_EVENTS = 5;

/**
 * Event log codes that are the daily life of a micro-inverter, not alarms:
 * start, time sync, offline at dusk, "no input" and input undervoltage when
 * the light fades (AlarmLogParser.cpp of OpenDTU). 216, 218, 220 and 222
 * are an undervoltage or a "no input" on every model (HMT reuses some codes).
 */
export const ROUTINE_EVENT_CODES = [1, 2, 4, 130, 207, 208, 209, 210, 211, 212, 216, 218, 220, 222];

/**
 * POST /api/limit/config `limit_type`. Only the two non-persistent types are
 * ever sent: a persistent limit is written to the inverter's flash, which
 * wears out. Their values are 0 and 1 in every firmware generation (the
 * persistent ones were 256/257, now 2/3).
 */
export const LIMIT_TYPES = { ABSOLUTE: 0, RELATIVE: 1 };
/** OpenDTU refuses an absolute limit above this (MAX_INVERTER_LIMIT). */
export const MAX_INVERTER_LIMIT = 2250;

/** Manifest keys (forever: stored in user scenes and dashboards). */
export const ACTIONS = { TEST: 'test_connection' };
export const SCENE_ACTIONS = { SET_LIMIT: 'set_power_limit', PRODUCTION: 'get_production' };
export const SCENE_TRIGGERS = {
  STARTED: 'production_started',
  STOPPED: 'production_stopped',
  ALARM: 'inverter_alarm',
};
export const WIDGETS = { SOLAR: 'solar' };

/** Values of the `unit` field of the set_power_limit action. */
export const LIMIT_UNITS = { WATT: 'W', PERCENT: '%' };
