// -----------------------------------------------------------------------------
// OpenDTU JSON -> plain objects. Pure. Every OpenDTU field name is here (and
// the paths in client.js), so a firmware change is fixed in one place.
//
// The shapes, from the firmware source (src/WebApi_ws_live.cpp):
//   GET /api/livedata/status
//     { inverters: [{ serial, name, order, data_age, data_age_ms?,
//         poll_enabled, reachable, producing, limit_relative, limit_absolute,
//         radio_stats, AC?, DC?, INV?, events? }],
//       total: { Power, YieldDay, YieldTotal }, hints: { ... } }
//   Recent firmwares give AC/DC/INV and `events` only with ?inv=<serial>;
//   the 2023 ones inline them for every inverter. A value is { v, u, d }.
//   AC: { "0": { Power, Voltage, Current, Frequency, PowerFactor, ReactivePower } }
//   DC: { "0": { name: { u }, Power, Voltage, Current, YieldDay, YieldTotal, Irradiation }, "1": ... }
//   INV: { "0": { "Power DC", YieldDay, YieldTotal, Temperature, Efficiency } }
// YieldDay is in Wh, YieldTotal in kWh (the `u` of each value says so too).
// -----------------------------------------------------------------------------

import { STALE_DATA } from '../constants.js';

/** The number of an OpenDTU value { v, u, d }, or null. */
export function valueOf(field) {
  const v = field && typeof field === 'object' ? field.v : field;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

const round = (value, digits) =>
  value === null || value === undefined ? null : Number(value.toFixed(digits));

/** Wh or kWh as OpenDTU labels it, in kWh. */
function kwhOf(field) {
  const v = valueOf(field);
  if (v === null) {
    return null;
  }
  return String(field?.u ?? '').toLowerCase() === 'wh' ? v / 1000 : v;
}

const sumOf = (values) => {
  const known = values.filter((v) => v !== null);
  return known.length === 0 ? null : known.reduce((a, b) => a + b, 0);
};

/** The channels of an inverter object, or undefined when it has none (summary). */
export function channelsOf(inverter) {
  if (!inverter || (!inverter.AC && !inverter.DC && !inverter.INV)) {
    return undefined;
  }
  const entries = (group) =>
    Object.entries(group ?? {})
      .filter(([key, value]) => /^\d+$/.test(key) && value && typeof value === 'object')
      .sort(([a], [b]) => Number(a) - Number(b));
  const acChannels = entries(inverter.AC).map(([, c]) => c);
  const ac0 = acChannels[0] ?? {};
  const inv0 = entries(inverter.INV)[0]?.[1] ?? {};
  const dc = entries(inverter.DC).map(([key, c]) => ({
    index: Number(key) + 1,
    name: String(c.name?.u ?? '').trim(),
    power: valueOf(c.Power),
    voltage: valueOf(c.Voltage),
    current: valueOf(c.Current),
    yieldDay: kwhOf(c.YieldDay),
    yieldTotal: kwhOf(c.YieldTotal),
    irradiation: valueOf(c.Irradiation),
  }));
  return {
    ac: {
      power: sumOf(acChannels.map((c) => valueOf(c.Power))),
      voltage: valueOf(ac0.Voltage),
      current: valueOf(ac0.Current),
      frequency: valueOf(ac0.Frequency),
      powerFactor: valueOf(ac0.PowerFactor),
    },
    dc,
    inv: {
      powerDc: valueOf(inv0['Power DC']),
      yieldDay: kwhOf(inv0.YieldDay) ?? sumOf(dc.map((c) => c.yieldDay)),
      yieldTotal: kwhOf(inv0.YieldTotal) ?? sumOf(dc.map((c) => c.yieldTotal)),
      temperature: valueOf(inv0.Temperature),
      efficiency: valueOf(inv0.Efficiency),
    },
  };
}

/** One inverter of the live data (summary, plus channels when present). */
export function inverterOf(raw) {
  const serial = String(raw?.serial ?? '')
    .trim()
    .toLowerCase();
  if (!/^[0-9a-f]{6,16}$/.test(serial)) {
    return undefined;
  }
  const ageMs = Number.isFinite(raw.data_age_ms)
    ? raw.data_age_ms
    : Number.isFinite(raw.data_age)
      ? raw.data_age * 1000
      : null;
  const relative = valueOf(raw.limit_relative);
  const absolute = valueOf(raw.limit_absolute);
  return {
    serial,
    name: String(raw.name ?? '').trim(),
    order: Number.isFinite(raw.order) ? raw.order : 0,
    dataAgeMs: ageMs,
    pollEnabled: raw.poll_enabled !== false,
    reachable: raw.reachable === true,
    producing: raw.producing === true,
    limitRelative: relative !== null && relative >= 0 ? relative : null,
    limitAbsolute: absolute !== null && absolute >= 0 ? absolute : null,
    events: Number.isFinite(raw.events) && raw.events >= 0 ? raw.events : null,
    channels: channelsOf(raw),
  };
}

/** GET /api/livedata/status -> { inverters, total, hints }. */
export function livedataOf(json) {
  const inverters = (Array.isArray(json?.inverters) ? json.inverters : [])
    .map(inverterOf)
    .filter(Boolean)
    .sort((a, b) => a.order - b.order);
  const total = json?.total ?? {};
  const hints = json?.hints ?? {};
  return {
    inverters,
    total: {
      power: valueOf(total.Power),
      yieldDay: kwhOf(total.YieldDay),
      yieldTotal: kwhOf(total.YieldTotal),
    },
    hints: {
      timeSync: hints.time_sync === true,
      radioProblem: hints.radio_problem === true,
      defaultPassword: hints.default_password === true,
    },
  };
}

/** A summary inverter completed by its ?inv=<serial> answer. */
export function withDetails(inverter, detailsJson) {
  const raw = (detailsJson?.inverters ?? []).find(
    (i) => String(i?.serial ?? '').toLowerCase() === inverter.serial,
  );
  const detailed = raw ? inverterOf(raw) : undefined;
  if (!detailed?.channels) {
    return inverter;
  }
  return { ...detailed, order: inverter.order };
}

/** The local calendar day of an instant (the container runs in Gladys's TZ). */
export function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * The reading Gladys sees of one inverter at `now`. The night is not an
 * error: an inverter OpenDTU no longer reaches (or whose data is stale) is
 * asleep, its power is 0, its indexes stay, and a YieldDay left from a
 * previous day reads 0 (OpenDTU only resets it when the inverter wakes up).
 */
export function readingOf(inverter, now) {
  const age = inverter.dataAgeMs ?? Infinity;
  const awake = inverter.pollEnabled && inverter.reachable && age <= STALE_DATA;
  const dataAt = Number.isFinite(age) ? now - age : null;
  const staleDay = dataAt === null || dayKey(dataAt) !== dayKey(now);
  const ch = inverter.channels;
  const live = (value, digits) => (awake ? round(value, digits) : null);
  let power = null;
  if (ch) {
    power = awake ? round(ch.ac.power ?? 0, 1) : 0;
  } else if (!awake) {
    power = 0;
  }
  return {
    serial: inverter.serial,
    name: inverter.name,
    awake,
    staleDay,
    reachable: inverter.reachable,
    producing: awake && inverter.producing,
    detailed: Boolean(ch),
    power,
    panels: (ch?.dc ?? []).map((c) => ({
      index: c.index,
      name: c.name,
      power: awake ? round(c.power ?? 0, 1) : 0,
      voltage: live(c.voltage, 1),
    })),
    energyToday: ch ? (staleDay ? 0 : round(ch.inv.yieldDay ?? 0, 3)) : null,
    // 0 is what OpenDTU says before its first reading of the inverter: never
    // an index (the energy monitoring would count the whole total back).
    energyTotal: ch && ch.inv.yieldTotal > 0 ? round(ch.inv.yieldTotal, 3) : null,
    voltage: ch ? live(ch.ac.voltage, 1) : null,
    frequency: ch ? live(ch.ac.frequency, 2) : null,
    temperature: ch ? live(ch.inv.temperature, 1) : null,
    efficiency: ch ? live(ch.inv.efficiency, 1) : null,
    limitPercent: inverter.limitRelative === null ? null : round(inverter.limitRelative, 1),
    limitWatts: inverter.limitAbsolute === null ? null : Math.round(inverter.limitAbsolute),
    events: inverter.events,
    readAt: now,
  };
}

/** GET /api/limit/status -> Map serial -> { limitRelative, maxPower, setStatus }. */
export function limitStatusOf(json) {
  const map = new Map();
  for (const [serial, value] of Object.entries(json ?? {})) {
    if (!value || typeof value !== 'object') {
      continue;
    }
    const maxPower = valueOf(value.max_power);
    map.set(serial.toLowerCase(), {
      limitRelative: valueOf(value.limit_relative),
      maxPower: maxPower !== null && maxPower > 0 ? maxPower : null,
      setStatus: typeof value.limit_set_status === 'string' ? value.limit_set_status : null,
    });
  }
  return map;
}

/** GET /api/devinfo/status?inv= -> { model, maxPower, firmware }. */
export function devInfoOf(json) {
  const maxPower = valueOf(json?.max_power);
  const model = String(json?.hw_model_name ?? '').trim();
  return {
    model: model && model !== 'Unknown' ? model : null,
    maxPower: maxPower !== null && maxPower > 0 ? maxPower : null,
    firmware: String(json?.fw_build_version ?? '').trim() || null,
  };
}

/**
 * GET /api/eventlog/status?inv= -> [{ code, message, startTime, endTime }].
 * Recent firmwares answer { count, events }; older ones nest it under the
 * serial ({ "<serial>": { count, events } }).
 */
export function eventsOf(json, serial) {
  let log = json;
  if (!Array.isArray(log?.events)) {
    const key = Object.keys(json ?? {}).find((k) => k.toLowerCase() === serial);
    log = key ? json[key] : undefined;
  }
  return (Array.isArray(log?.events) ? log.events : [])
    .filter((e) => Number.isFinite(e?.message_id))
    .map((e) => ({
      code: e.message_id,
      message: String(e.message ?? '').slice(0, 200) || `Event ${e.message_id}`,
      startTime: Number.isFinite(e.start_time) ? e.start_time : null,
      endTime: Number.isFinite(e.end_time) ? e.end_time : null,
    }));
}

/** GET /api/system/status -> { hostname, version, board }. */
export function systemOf(json) {
  return {
    hostname: String(json?.hostname ?? '').trim() || null,
    version: String(json?.git_hash ?? '').trim() || null,
    board: String(json?.pioenv ?? '').trim() || null,
  };
}
