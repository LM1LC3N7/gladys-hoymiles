// -----------------------------------------------------------------------------
// The device of an inverter, its feature keys (forever) and its states.
// -----------------------------------------------------------------------------

process.env.TZ = 'Europe/Paris';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import {
  FEATURE,
  buildInverterDevice,
  featureKeyOf,
  inverterStates,
  parseExternalId,
  uuidOf,
} from '../src/devices.js';
import { livedataOf, readingOf } from '../src/opendtu/model.js';
import { NOW, asleep, fixture } from './helpers/fakeOpenDtu.js';

const gladys = createFakeGladys({ selector: 'hoymiles' });
const inverters = () => livedataOf(fixture('livedata.json')).inverters;
const byKey = (device) =>
  Object.fromEntries(device.features.map((f) => [featureKeyOf(f.external_id), f]));

test('an inverter device: its panels, the energy features, the controls', () => {
  const device = buildInverterDevice(gladys, inverters()[1], {
    model: 'HM-1500',
    maxPower: 1500,
    firmware: '10012',
  });
  assert.equal(device.external_id, 'ext:hoymiles:inverter:116190000002');
  assert.equal(device.name, 'Garage');
  const f = byKey(device);
  assert.deepEqual(Object.keys(f), [
    'power',
    'power_1',
    'power_2',
    'power_3',
    'power_4',
    'energy_today',
    'energy_total',
    'energy_total_production',
    'voltage',
    'frequency',
    'temperature',
    'efficiency',
    'limit',
    'switch',
    'reachable',
  ]);
  assert.equal(f.power_1.name, 'East 1 power');
  assert.deepEqual(
    [f.power.category, f.power.type, f.power.unit, f.power.max],
    [C.ENERGY_PRODUCTION_SENSOR, T.ENERGY_PRODUCTION_SENSOR.POWER, U.WATT, 1500],
  );
  assert.deepEqual(
    [f.energy_today.type, f.energy_today.unit],
    [T.ENERGY_PRODUCTION_SENSOR.DAILY_PRODUCTION, U.KILOWATT_HOUR],
  );
  assert.deepEqual(
    [f.energy_total.category, f.energy_total.type, f.energy_total.unit],
    [C.ENERGY_PRODUCTION_SENSOR, T.ENERGY_PRODUCTION_SENSOR.INDEX, U.KILOWATT_HOUR],
  );
  assert.deepEqual(
    [f.limit.category, f.limit.type, f.limit.unit, f.limit.max, f.limit.read_only],
    [C.SWITCH, T.SWITCH.DIMMER, U.WATT, 1500, false],
  );
  assert.equal(f.switch.read_only, false);
  assert.equal(f.temperature.category, C.DEVICE_TEMPERATURE_SENSOR);
  assert.deepEqual(device.params.find((p) => p.name === 'model').value, 'HM-1500');
});

test('the 30-minute production hangs off the index, with stable ids', () => {
  const first = byKey(buildInverterDevice(gladys, inverters()[0], {}));
  const again = byKey(buildInverterDevice(gladys, inverters()[0], { maxPower: 800 }));
  const production = first.energy_total_production;
  assert.equal(production.type, T.ENERGY_PRODUCTION_SENSOR.THIRTY_MINUTES_PRODUCTION);
  assert.equal(production.energy_parent_id, first.energy_total.id);
  assert.match(
    first.energy_total.id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.equal(again.energy_total.id, first.energy_total.id, 'same id at every discovery');
  assert.notEqual(production.id, first.energy_total.id);
  assert.notEqual(uuidOf('a'), uuidOf('b'));
  assert.equal(first.limit.max, 2250, 'unknown maximum power: the OpenDTU bound');
});

test('without details: no panel, and the serial or the model names the device', () => {
  const summary = { ...inverters()[0], channels: undefined, name: '' };
  const device = buildInverterDevice(gladys, summary, { model: 'HM-800' });
  assert.equal(device.name, 'Hoymiles HM-800');
  const keys = Object.keys(byKey(device));
  assert.ok(!keys.includes('power_1'));
  assert.ok(!keys.includes('voltage'));
  assert.ok(keys.includes('energy_total'));
  assert.equal(buildInverterDevice(gladys, summary).name, 'Hoymiles 114190000001');
});

test('external ids and feature keys', () => {
  assert.deepEqual(parseExternalId('ext:hoymiles:inverter:114190000001'), {
    serial: '114190000001',
  });
  assert.equal(parseExternalId('ext:hoymiles:dtu'), undefined);
  assert.equal(featureKeyOf('ext:hoymiles:inverter:114190000001:power_2'), FEATURE.panel(2));
});

test('states: awake, then asleep (power 0, nothing stale, indexes kept)', () => {
  const id = 'ext:hoymiles:inverter:114190000001';
  const awake = Object.fromEntries(
    inverterStates(id, readingOf(inverters()[0], NOW), {
      energyTotal: 1667.007,
      switchState: 1,
    }).map((s) => [featureKeyOf(s.device_feature_external_id), s.state]),
  );
  assert.deepEqual(awake, {
    power: 405.2,
    power_1: 212.4,
    power_2: 208.4,
    energy_today: 2.384,
    energy_total: 1667.007,
    voltage: 231.4,
    frequency: 50.01,
    temperature: 38.4,
    efficiency: 96.3,
    limit: 800,
    switch: 1,
    reachable: 1,
  });
  const raw = fixture('livedata.json').inverters[0];
  asleep(raw);
  const night = Object.fromEntries(
    inverterStates(id, readingOf(livedataOf({ inverters: [raw] }).inverters[0], NOW), {}).map(
      (s) => [featureKeyOf(s.device_feature_external_id), s.state],
    ),
  );
  assert.deepEqual(night, {
    power: 0,
    power_1: 0,
    power_2: 0,
    energy_today: 2.384,
    limit: 800,
    reachable: 0,
  });
});
