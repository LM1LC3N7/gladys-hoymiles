// -----------------------------------------------------------------------------
// The Gladys device of an inverter and its states. Pure.
//
// External id (forever): inverter:<serial>   (the Hoymiles serial, lowercase hex)
// Feature keys (forever): FEATURE below. The panel features are power_1,
// power_2... in the order of OpenDTU's DC inputs.
//
// The energy monitoring of Gladys turns the deltas of a production index
// (energy-production-sensor / index) into 30-minute production states, but
// only into a `thirty-minutes-production` feature of the same device whose
// `energy_parent_id` is the index feature. The core derives that feature by
// itself for a consumption index only, so the integration declares both,
// with ids it computes (a UUID v5 of the feature external id): stable across
// discoveries, so an "Update" in the Discovery screen keeps the same rows.
// The integration never publishes a state on the 30-minute feature: the core
// writes it.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { MAX_INVERTER_LIMIT } from './constants.js';

export const FEATURE = {
  POWER: 'power',
  panel: (n) => `power_${n}`,
  ENERGY_TODAY: 'energy_today',
  ENERGY_TOTAL: 'energy_total',
  /** Fed by the Gladys core from the index, never by the integration. */
  PRODUCTION_30MIN: 'energy_total_production',
  VOLTAGE: 'voltage',
  FREQUENCY: 'frequency',
  TEMPERATURE: 'temperature',
  EFFICIENCY: 'efficiency',
  LIMIT: 'limit',
  SWITCH: 'switch',
  REACHABLE: 'reachable',
};

export const ids = {
  inverter: (gladys, serial) => gladys.externalId(`inverter:${serial}`),
  feature: (deviceId, key) => `${deviceId}:${key}`,
};

/** { serial } | undefined. */
export function parseExternalId(externalId) {
  const match = /:inverter:([0-9a-f]{6,16})$/.exec(String(externalId ?? ''));
  return match ? { serial: match[1] } : undefined;
}

/** The feature key of a feature external id (`...:inverter:<serial>:<key>`). */
export function featureKeyOf(featureExternalId) {
  const match = /:inverter:[0-9a-f]{6,16}:([a-z0-9_]+)$/.exec(String(featureExternalId ?? ''));
  return match?.[1];
}

/** Namespace of the feature ids of this integration (random, fixed forever). */
const ID_NAMESPACE = Buffer.from('6f1d3c2a9b7e4e0f8a5d2c1b0e9f8a7d', 'hex');

/** A deterministic UUID (version 5, RFC 9562) of a name. */
export function uuidOf(name) {
  const hash = createHash('sha1').update(ID_NAMESPACE).update(String(name), 'utf8').digest();
  const bytes = hash.subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const feature = (deviceId, key, name, category, type, extra = {}) => ({
  name,
  external_id: ids.feature(deviceId, key),
  category,
  type,
  min: 0,
  max: 1,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...extra,
});

/**
 * The device of an inverter. `inverter` comes from the live data (with its
 * channels when OpenDTU gave them), `info` is { model, maxPower, firmware }.
 * Without channels (details unreadable), the device has no panel feature: a
 * later discovery adds them through the "Update" button.
 */
export function buildInverterDevice(gladys, inverter, info = {}) {
  const id = ids.inverter(gladys, inverter.serial);
  const maxPower = info.maxPower ?? MAX_INVERTER_LIMIT;
  const ch = inverter.channels;
  const watts = (key, name, max) =>
    feature(id, key, name, C.ENERGY_PRODUCTION_SENSOR, T.ENERGY_PRODUCTION_SENSOR.POWER, {
      unit: U.WATT,
      max,
    });
  const indexId = ids.feature(id, FEATURE.ENERGY_TOTAL);
  const features = [
    watts(FEATURE.POWER, 'Solar power', maxPower),
    ...(ch?.dc ?? []).map((c) =>
      watts(FEATURE.panel(c.index), `${c.name || `Panel ${c.index}`} power`, 1000),
    ),
    feature(
      id,
      FEATURE.ENERGY_TODAY,
      'Energy today',
      C.ENERGY_PRODUCTION_SENSOR,
      T.ENERGY_PRODUCTION_SENSOR.DAILY_PRODUCTION,
      { unit: U.KILOWATT_HOUR, max: 100 },
    ),
    feature(
      id,
      FEATURE.ENERGY_TOTAL,
      'Lifetime energy',
      C.ENERGY_PRODUCTION_SENSOR,
      T.ENERGY_PRODUCTION_SENSOR.INDEX,
      { id: uuidOf(indexId), unit: U.KILOWATT_HOUR, max: 1_000_000_000 },
    ),
    feature(
      id,
      FEATURE.PRODUCTION_30MIN,
      'Lifetime energy (30-minute production)',
      C.ENERGY_PRODUCTION_SENSOR,
      T.ENERGY_PRODUCTION_SENSOR.THIRTY_MINUTES_PRODUCTION,
      {
        id: uuidOf(ids.feature(id, FEATURE.PRODUCTION_30MIN)),
        energy_parent_id: uuidOf(indexId),
        unit: U.KILOWATT_HOUR,
        max: 100_000_000_000,
      },
    ),
  ];
  if (ch?.ac.voltage !== null && ch?.ac.voltage !== undefined) {
    features.push(
      feature(id, FEATURE.VOLTAGE, 'Grid voltage', C.ENERGY_SENSOR, T.ENERGY_SENSOR.VOLTAGE, {
        unit: U.VOLT,
        max: 400,
        keep_history: false,
      }),
    );
  }
  if (ch?.ac.frequency !== null && ch?.ac.frequency !== undefined) {
    // Gladys has no frequency unit: the name carries it.
    features.push(
      feature(id, FEATURE.FREQUENCY, 'Grid frequency (Hz)', C.UNKNOWN, T.UNKNOWN.UNKNOWN, {
        max: 100,
        keep_history: false,
      }),
    );
  }
  if (ch?.inv.temperature !== null && ch?.inv.temperature !== undefined) {
    features.push(
      feature(
        id,
        FEATURE.TEMPERATURE,
        'Inverter temperature',
        C.DEVICE_TEMPERATURE_SENSOR,
        T.SENSOR.DECIMAL,
        { unit: U.CELSIUS, min: -40, max: 120 },
      ),
    );
  }
  if (ch?.inv.efficiency !== null && ch?.inv.efficiency !== undefined) {
    features.push(
      feature(id, FEATURE.EFFICIENCY, 'Efficiency', C.UNKNOWN, T.UNKNOWN.UNKNOWN, {
        unit: U.PERCENT,
        max: 100,
        keep_history: false,
      }),
    );
  }
  features.push(
    // A non-persistent limit (W): the slider of a dimmer is the control
    // Gladys draws for a writable number.
    feature(id, FEATURE.LIMIT, 'Power limit', C.SWITCH, T.SWITCH.DIMMER, {
      unit: U.WATT,
      max: maxPower,
      read_only: false,
      has_feedback: true,
    }),
    feature(id, FEATURE.SWITCH, 'Inverter on/off', C.SWITCH, T.SWITCH.BINARY, {
      read_only: false,
    }),
    feature(id, FEATURE.REACHABLE, 'Reachable', C.UNKNOWN, T.SENSOR.BINARY, {
      keep_history: false,
    }),
  );
  return {
    name: inverter.name || (info.model ? `Hoymiles ${info.model}` : `Hoymiles ${inverter.serial}`),
    external_id: id,
    features,
    params: [
      { name: 'serial', value: inverter.serial },
      { name: 'model', value: info.model ?? '' },
      { name: 'max_power', value: info.maxPower ? String(info.maxPower) : '' },
      { name: 'dc_inputs', value: String(ch?.dc.length ?? '') },
      { name: 'firmware', value: info.firmware ?? '' },
    ],
  };
}

/** The params of a device as a plain object. */
export function paramsOf(device) {
  return Object.fromEntries((device?.params ?? []).map((p) => [p.name, p.value]));
}

const state = (deviceId, key, value) =>
  value === null || value === undefined || Number.isNaN(value)
    ? []
    : [{ device_feature_external_id: ids.feature(deviceId, key), state: value }];

/**
 * The states of a reading. `energyTotal` is the index the app decided to
 * publish (never lower than the last one), `switchState` 1, 0 or undefined.
 */
export function inverterStates(deviceId, reading, { energyTotal, switchState } = {}) {
  return [
    ...state(deviceId, FEATURE.POWER, reading.power),
    ...reading.panels.flatMap((p) => state(deviceId, FEATURE.panel(p.index), p.power)),
    ...state(deviceId, FEATURE.ENERGY_TODAY, reading.energyToday),
    ...state(deviceId, FEATURE.ENERGY_TOTAL, energyTotal),
    ...state(deviceId, FEATURE.VOLTAGE, reading.voltage),
    ...state(deviceId, FEATURE.FREQUENCY, reading.frequency),
    ...state(deviceId, FEATURE.TEMPERATURE, reading.temperature),
    ...state(deviceId, FEATURE.EFFICIENCY, reading.efficiency),
    ...state(deviceId, FEATURE.LIMIT, reading.limitWatts),
    ...state(deviceId, FEATURE.SWITCH, switchState),
    ...state(deviceId, FEATURE.REACHABLE, reading.awake ? 1 : 0),
  ];
}
