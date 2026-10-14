// -----------------------------------------------------------------------------
// Readings -> scene events. Pure. The first reading only arms: no transition
// without a previous value.
//
// Production: a debounced state per inverter. "Started" fires once the
// inverter has produced for START_DEBOUNCE without a break, "stopped" once it
// has not produced for STOP_DEBOUNCE: the flicker of dawn and dusk (a few
// watts, then 0, then a few watts) fires nothing, and each fires once a day.
//
// Alarms: the new entries of the inverter's event log, minus the routine ones
// (start, "no input" at dusk...), at most MAX_ALARM_EVENTS per reading.
// -----------------------------------------------------------------------------

import {
  MAX_ALARM_EVENTS,
  ROUTINE_EVENT_CODES,
  SCENE_TRIGGERS,
  START_DEBOUNCE,
  STOP_DEBOUNCE,
} from './constants.js';

/**
 * One step of the debounced production state.
 * state: { producing, candidate, since } (candidate: the opposite value seen
 * since `since`, or null).
 */
export function productionStep(previous, producing, now) {
  if (!previous) {
    return { state: { producing, candidate: null, since: now } };
  }
  if (producing === previous.producing) {
    return { state: { ...previous, candidate: null } };
  }
  if (previous.candidate !== producing) {
    return { state: { ...previous, candidate: producing, since: now } };
  }
  const wait = producing ? START_DEBOUNCE : STOP_DEBOUNCE;
  if (now - previous.since < wait) {
    return { state: previous };
  }
  return {
    state: { producing, candidate: null, since: now },
    changed: producing ? 'started' : 'stopped',
  };
}

/** The production events of an inverter at a new reading. */
export function productionEvents(deviceId, previousState, reading, now) {
  const { state, changed } = productionStep(previousState, reading.producing, now);
  if (!changed) {
    return { state, events: [] };
  }
  const data = {
    inverter: deviceId,
    name: reading.name,
    serial: reading.serial,
    power: reading.power,
    energy_today: reading.energyToday,
  };
  return {
    state,
    events: [
      { key: changed === 'started' ? SCENE_TRIGGERS.STARTED : SCENE_TRIGGERS.STOPPED, data },
    ],
  };
}

const keyOf = (entry) => `${entry.code}|${entry.startTime}`;

/**
 * The alarm events between two readings of an event log. `previousKeys`
 * undefined = first reading (arms). The log can shrink (cleared at midnight,
 * inverter restart): the keys are always the current log.
 */
export function alarmEvents(deviceId, reading, previousKeys, entries) {
  const keys = new Set(entries.map(keyOf));
  if (!previousKeys) {
    return { keys, events: [] };
  }
  const events = entries
    .filter((e) => !previousKeys.has(keyOf(e)) && !ROUTINE_EVENT_CODES.includes(e.code))
    .slice(-MAX_ALARM_EVENTS)
    .map((e) => ({
      key: SCENE_TRIGGERS.ALARM,
      data: {
        inverter: deviceId,
        name: reading.name,
        serial: reading.serial,
        alarm: e.message,
        code: e.code,
      },
    }));
  return { keys, events };
}
