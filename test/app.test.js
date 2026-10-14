// -----------------------------------------------------------------------------
// The integration against the SDK's fake Gladys and a fake OpenDTU.
// -----------------------------------------------------------------------------

process.env.TZ = 'Europe/Paris';

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { HoymilesApp } from '../src/app.js';
import {
  ACTIONS,
  COMMAND_SETTLE,
  SCENE_ACTIONS,
  SCENE_TRIGGERS,
  WIDGETS,
} from '../src/constants.js';
import { NOW, asleep, awake, installOpenDtu } from './helpers/fakeOpenDtu.js';
import { createFakeTimers } from './helpers/fakeTimers.js';

const quiet = {
  info() {},
  warn: (...a) => process.env.DEBUG_TEST && console.error(...a),
  error() {},
  debug() {},
};

let fake;
afterEach(() => fake?.restore());

const BALCONY = 'ext:hoymiles:inverter:114190000001';
const GARAGE = 'ext:hoymiles:inverter:116190000002';
const CONFIG = { host: '192.168.1.50', password: 'secret123' };

/** An inverter device as Gladys hands it back once created. */
const created = (externalId, name, maxPower) => ({
  external_id: externalId,
  name,
  params: [
    { name: 'serial', value: externalId.split(':').at(-1) },
    { name: 'max_power', value: String(maxPower) },
  ],
});
const balcony = created(BALCONY, 'Balcony', 800);
const garage = created(GARAGE, 'Garage', 1500);

async function setup({ config = CONFIG, devices = [], dtu = {}, before } = {}) {
  fake = installOpenDtu(dtu);
  before?.(fake);
  const gladys = createFakeGladys({ selector: 'hoymiles', config, devices });
  const timers = createFakeTimers();
  const clock = { now: NOW };
  const app = new HoymilesApp({ gladys, logger: quiet, now: () => clock.now, timers });
  gladys.onScanRequest(() => app.publishDevices());
  gladys.onDeviceCreated((device) => app.deviceCreated(device));
  gladys.onSetValue((device, feature, value) => app.setValue(device, feature, value));
  gladys.onSceneAction(SCENE_ACTIONS.SET_LIMIT, (fields) => app.setPowerLimit(fields));
  gladys.onSceneAction(SCENE_ACTIONS.PRODUCTION, (fields) => app.getProduction(fields));
  gladys.onWidgetGet(WIDGETS.SOLAR, (request) => app.getWidget(WIDGETS.SOLAR, request));
  gladys.onAction(ACTIONS.TEST, () => app.testConnection());
  await gladys.connect();
  /** Advance the clock and run the pending reading. */
  const tick = async (ms) => {
    clock.now += ms;
    await timers.runTimeouts();
  };
  return { app, gladys, timers, clock, tick };
}

const next = (timers) => timers.timeouts().at(-1)?.ms;

test('no address, or a wrong one: the status says so and nothing is read', async () => {
  const { app, gladys } = await setup({ config: {} });
  await app.start({});
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /No OpenDTU address/);
  await app.start({ host: 'http://192.168.1.50/api/livedata' });
  assert.match(gladys.fake.connectionStatus.message.fr, /n'est pas valide/);
  assert.equal(fake.calls.length, 0);
});

test('discovery: one device per inverter, details and models read once', async () => {
  const { app, gladys, timers } = await setup();
  await app.start(CONFIG);
  const devices = gladys.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((d) => [d.name, d.external_id, d.features.length]),
    [
      ['Balcony', BALCONY, 13],
      ['Garage', GARAGE, 15],
    ],
  );
  assert.equal(devices[0].params.find((p) => p.name === 'model').value, 'HM-800');
  assert.equal(devices[1].features.find((f) => f.external_id.endsWith(':limit')).max, 1500);
  assert.equal(fake.count('/api/livedata/status', { inv: '114190000001' }), 1);
  assert.equal(fake.count('/api/devinfo/status'), 2);
  // No device created yet: no state, no event log.
  assert.equal(gladys.fake.states.length, 0);
  assert.equal(fake.count('/api/eventlog/status'), 0);
  assert.deepEqual(gladys.fake.connectionStatus, {
    connected: true,
    message: {
      en: 'OpenDTU answers: 2 inverters, awake.',
      fr: 'OpenDTU répond : 2 onduleurs, éveillés.',
    },
  });
  assert.equal(next(timers), 15_000);
  app.stop();
});

test('a 2023 firmware inlines the channels: no request per inverter', async () => {
  const { app, gladys } = await setup({ dtu: { firmware: 'inline' }, devices: [balcony] });
  await app.start(CONFIG);
  assert.equal(gladys.fake.discoveredDevices[1].features.length, 15);
  assert.equal(fake.count('/api/livedata/status', { inv: '114190000001' }), 0);
  assert.equal(fake.count('/api/livedata/status', { inv: '116190000002' }), 0);
  assert.equal(gladys.fake.lastState(`${BALCONY}:power`), 405.2);
  app.stop();
});

test('a created inverter: its states, the first reading fires nothing', async () => {
  const { app, gladys, tick } = await setup({ devices: [balcony] });
  await app.start(CONFIG);
  const last = (key) => gladys.fake.lastState(`${BALCONY}:${key}`);
  assert.equal(last('power'), 405.2);
  assert.equal(last('power_1'), 212.4);
  assert.equal(last('energy_today'), 2.384);
  assert.equal(last('energy_total'), 1667.007);
  assert.equal(last('limit'), 800);
  assert.equal(last('switch'), 1);
  assert.equal(last('reachable'), 1);
  assert.equal(last('energy_total_production'), undefined, 'the core feeds it, never us');
  assert.equal(gladys.fake.sceneEvents.length, 0);
  assert.equal(fake.count('/api/eventlog/status'), 1, 'read once to arm the alarms');
  // The next reading: the details of the tracked inverter only, the log not re-read.
  fake.inverter('114190000001').AC['0'].Power.v = 380;
  await tick(15_000);
  assert.equal(last('power'), 380);
  assert.equal(fake.count('/api/livedata/status', { inv: '114190000001' }), 2);
  assert.equal(fake.count('/api/livedata/status', { inv: '116190000002' }), 1, 'discovery only');
  assert.equal(fake.count('/api/eventlog/status'), 1);
  app.stop();
});

test('the night: power 0, index kept, a calm status, one reading a minute', async () => {
  const { app, gladys, timers, tick } = await setup({ devices: [balcony, garage] });
  await app.start(CONFIG);
  fake.state.live.inverters.forEach((i) => asleep(i));
  await tick(15_000);
  const last = (key) => gladys.fake.lastState(`${BALCONY}:${key}`);
  assert.equal(last('power'), 0);
  assert.equal(last('power_2'), 0);
  assert.equal(last('reachable'), 0);
  assert.equal(last('energy_total'), 1667.007);
  assert.equal(last('energy_today'), 2.384, 'the day is not over');
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(gladys.fake.connectionStatus.message.en, /inverters are sleeping \(night/);
  assert.equal(next(timers), 60_000);
  // Asleep: the details were read once more (the transition), never again.
  const details = fake.count('/api/livedata/status', { inv: '114190000001' });
  await tick(60_000);
  await tick(60_000);
  assert.equal(fake.count('/api/livedata/status', { inv: '114190000001' }), details);
  assert.equal(gladys.fake.sceneEvents.length, 0, 'no event storm at dusk');
  app.stop();
});

test('morning and evening: production_started and production_stopped, once each', async () => {
  const { app, gladys, tick } = await setup({
    devices: [balcony],
    before: (f) => asleep(f.inverter('114190000001'), 8 * 3600),
  });
  await app.start(CONFIG);
  const inverter = fake.inverter('114190000001');
  const keys = () => gladys.fake.sceneEvents.map((e) => e.key);
  awake(inverter, 12, 1);
  await tick(60_000);
  await tick(2 * 60_000);
  assert.deepEqual(keys(), [], 'not yet 5 minutes');
  await tick(4 * 60_000);
  await tick(60_000);
  assert.deepEqual(keys(), [SCENE_TRIGGERS.STARTED]);
  assert.equal(gladys.fake.sceneEvents[0].data.inverter, BALCONY);
  assert.equal(gladys.fake.sceneEvents[0].data.name, 'Balcony');
  // Evening.
  asleep(inverter, 30);
  await tick(60_000);
  await tick(10 * 60_000);
  await tick(10 * 60_000);
  await tick(60_000);
  assert.deepEqual(keys(), [SCENE_TRIGGERS.STARTED, SCENE_TRIGGERS.STOPPED]);
  assert.equal(gladys.fake.sceneEvents[1].data.energy_today, 0.001);
  app.stop();
});

test('a new event log entry fires inverter_alarm; routine entries do not', async () => {
  const { app, gladys, tick } = await setup({ devices: [balcony] });
  await app.start(CONFIG);
  const log = fake.state.eventlogs['114190000001'];
  log.events.push(
    { message_id: 209, message: 'PV-2: No input', start_time: 50000, end_time: 0 },
    { message_id: 141, message: 'Grid: Grid overvoltage', start_time: 50100, end_time: 0 },
  );
  log.count = 5;
  fake.inverter('114190000001').events = 5;
  await tick(15_000);
  assert.deepEqual(
    gladys.fake.sceneEvents.map((e) => [e.key, e.data.alarm, e.data.code, e.data.inverter]),
    [[SCENE_TRIGGERS.ALARM, 'Grid: Grid overvoltage', 141, BALCONY]],
  );
  await tick(15_000);
  assert.equal(fake.count('/api/eventlog/status'), 2, 're-read only when the count changes');
  assert.equal(gladys.fake.sceneEvents.length, 1);
  app.stop();
});

test('the limit and the switch, from the device and from the scene action', async () => {
  const { app, gladys, timers } = await setup({ devices: [balcony] });
  await app.start(CONFIG);
  const limit = { external_id: `${BALCONY}:limit` };
  assert.equal((await gladys.fake.setValue(balcony, limit, 400)).success, true);
  assert.equal(gladys.fake.lastState(`${BALCONY}:limit`), 400);
  assert.ok(
    timers.timeouts().some((t) => t.ms === COMMAND_SETTLE),
    'read back soon',
  );
  await gladys.fake.setValue(balcony, limit, 5000);
  const off = await gladys.fake.setValue(balcony, { external_id: `${BALCONY}:switch` }, 0);
  assert.equal(off.success, true);
  assert.equal(gladys.fake.lastState(`${BALCONY}:switch`), 0);
  const percent = await gladys.fake.sceneAction(SCENE_ACTIONS.SET_LIMIT, {
    inverter: BALCONY,
    value: 50,
    unit: '%',
  });
  assert.deepEqual(percent.data.outputs, { limit_watts: 400, limit_percent: 50 });
  const watts = await gladys.fake.sceneAction(SCENE_ACTIONS.SET_LIMIT, {
    inverter: BALCONY,
    value: 600,
  });
  assert.deepEqual(watts.data.outputs, { limit_watts: 600, limit_percent: 75 });
  assert.deepEqual(
    fake.state.posts.map((p) => [p.path, p.data.limit_type ?? p.data.power, p.data.limit_value]),
    [
      ['/api/limit/config', 0, 400],
      ['/api/limit/config', 0, 800],
      ['/api/power/config', false, undefined],
      ['/api/limit/config', 1, 50],
      ['/api/limit/config', 0, 600],
    ],
    'clamped to the maximum power, never a persistent type',
  );
  const readOnly = await gladys.fake.setValue(balcony, { external_id: `${BALCONY}:power` }, 1);
  assert.equal(readOnly.success, false);
  app.stop();
});

test('commands need the password and an awake inverter', async () => {
  const noPassword = await setup({ config: { host: '192.168.1.50' }, devices: [balcony] });
  await noPassword.app.start({ host: '192.168.1.50' });
  const refused = await noPassword.gladys.fake.setValue(
    balcony,
    { external_id: `${BALCONY}:limit` },
    300,
  );
  assert.equal(refused.success, false);
  assert.match(refused.error, /admin password is needed/);
  noPassword.app.stop();
  fake.restore();
  const night = await setup({
    devices: [balcony],
    before: (f) => asleep(f.inverter('114190000001')),
  });
  await night.app.start(CONFIG);
  const action = await night.gladys.fake.sceneAction(SCENE_ACTIONS.SET_LIMIT, {
    inverter: BALCONY,
    value: 300,
  });
  assert.equal(action.success, false);
  assert.match(action.error, /sleeping/);
  assert.equal(fake.state.posts.length, 0);
  night.app.stop();
});

test('get_production and the widget', async () => {
  const { app, gladys } = await setup({ devices: [balcony, garage] });
  await app.start(CONFIG);
  const all = await gladys.fake.sceneAction(SCENE_ACTIONS.PRODUCTION, {});
  assert.deepEqual(all.data.outputs, {
    power: 1012.3,
    energy_today: 3.421,
    energy_total: 2510.612,
    producing: true,
    sleeping: false,
    inverters: 2,
  });
  const one = await gladys.fake.sceneAction(SCENE_ACTIONS.PRODUCTION, { inverter: GARAGE });
  assert.equal(one.data.outputs.power, 607.1);
  const widget = (
    await gladys.fake.widgetGet(WIDGETS.SOLAR, { settings: { inverter: GARAGE }, language: 'en' })
  ).data.content;
  assert.deepEqual(validateWidgetContent(widget), []);
  assert.equal(widget.components.find((c) => c.type === 'status').items.length, 6);
  const total = (await gladys.fake.widgetGet(WIDGETS.SOLAR, { settings: {} })).data.content;
  assert.equal(total.components.find((c) => c.type === 'value').value, 1012);
  app.stop();
});

test('the test button', async () => {
  const { app, gladys } = await setup();
  await app.start(CONFIG);
  const ok = await gladys.fake.action(ACTIONS.TEST);
  assert.equal(
    ok.data.message.en,
    'OpenDTU v25.5.10 (OpenDTU-A1B2C3) answers at 192.168.1.50: 2 inverters: Balcony, Garage.\n' +
      'Admin password accepted: the limit and on/off commands are available.',
  );
  await app.start({ ...CONFIG, password: 'wrong-one' });
  fake.state.live.hints.default_password = true;
  const wrong = await gladys.fake.action(ACTIONS.TEST);
  assert.match(wrong.data.message.fr, /Mot de passe admin REFUSÉ/);
  assert.match(wrong.data.message.en, /default password/);
  await app.start({ host: '192.168.1.50' });
  assert.match((await gladys.fake.action(ACTIONS.TEST)).data.message.en, /reading only/);
  app.stop();
});

test('OpenDTU down: a red status, a slower loop, then back to normal', async () => {
  const { app, gladys, timers, tick } = await setup({ before: (f) => (f.state.down = true) });
  await app.start(CONFIG);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /does not answer: .*EHOSTUNREACH/);
  assert.equal(next(timers), 60_000);
  assert.equal(gladys.fake.discoveredDevices.length, 0);
  fake.state.down = false;
  await tick(60_000);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(gladys.fake.discoveredDevices.length, 2, 'discovery published once it answers');
  assert.equal(next(timers), 15_000);
  app.stop();
});

test('read-only access disabled and a wrong password: the loop stops', async () => {
  const { app, gladys, timers } = await setup({ dtu: { readonly: false } });
  await app.start({ ...CONFIG, password: 'not-it' });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /refused the access/);
  assert.equal(timers.timeouts().length, 0);
  assert.ok(!JSON.stringify(gladys.fake.connectionStatuses).includes('not-it'));
  await app.start(CONFIG);
  assert.equal(gladys.fake.connectionStatus.connected, true, 'the right password works');
  app.stop();
});

test('the lifetime index never goes down, and a device created later is read at once', async () => {
  const { app, gladys, tick } = await setup();
  await app.start(CONFIG);
  await gladys.fake.deviceCreated(balcony);
  assert.equal(gladys.fake.lastState(`${BALCONY}:energy_total`), 1667.007);
  const yieldTotal = fake.inverter('114190000001').INV['0'].YieldTotal;
  yieldTotal.v = 0;
  await tick(15_000);
  yieldTotal.v = 12.5;
  await tick(15_000);
  assert.equal(gladys.fake.lastState(`${BALCONY}:energy_total`), 1667.007);
  yieldTotal.v = 1667.2;
  await tick(15_000);
  assert.equal(gladys.fake.lastState(`${BALCONY}:energy_total`), 1667.2);
  app.stop();
});
