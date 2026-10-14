// -----------------------------------------------------------------------------
// OpenDTU JSON -> plain objects, on the fixtures shaped after the firmware
// source and on the two answers of the OpenDTU web API documentation.
// -----------------------------------------------------------------------------

process.env.TZ = 'Europe/Paris';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dayKey,
  devInfoOf,
  eventsOf,
  limitStatusOf,
  livedataOf,
  readingOf,
  systemOf,
  withDetails,
} from '../src/opendtu/model.js';
import { normalizeConfig, parseHost } from '../src/config.js';
import { NOW, asleep, fixture, summaryOf } from './helpers/fakeOpenDtu.js';

test('the documented summary of a recent firmware: no channels, limits, data age', () => {
  const live = livedataOf(fixture('docs-summary.json'));
  assert.equal(live.inverters.length, 3);
  const [first, second] = live.inverters;
  assert.equal(first.serial, '116171600001');
  assert.equal(first.name, 'Meine Solaranlage');
  assert.equal(first.channels, undefined);
  assert.equal(first.dataAgeMs, 30636000);
  assert.equal(first.limitAbsolute, 1500);
  assert.equal(second.limitAbsolute, null, '-1 means the maximum power is unknown');
  assert.equal(second.pollEnabled, false);
  assert.equal(live.total.yieldTotal, 2515.605957);
  assert.equal(live.total.yieldDay, 0);
  // A summary inverter far from its last data is asleep: power 0, no energy known.
  const reading = readingOf(first, NOW);
  assert.equal(reading.awake, false);
  assert.equal(reading.power, 0);
  assert.equal(reading.energyTotal, null);
});

test('the documented details: four DC inputs, Wh and kWh, a sleeping inverter', () => {
  const summary = livedataOf(fixture('docs-summary.json')).inverters[0];
  const inverter = withDetails(summary, fixture('docs-details.json'));
  assert.equal(inverter.channels.dc.length, 4);
  assert.deepEqual(
    inverter.channels.dc.map((c) => c.index),
    [1, 2, 3, 4],
  );
  assert.equal(inverter.channels.inv.yieldTotal, 2515.605957);
  assert.equal(inverter.events, 2);
  const reading = readingOf(inverter, NOW);
  assert.equal(reading.awake, false);
  assert.equal(reading.energyTotal, 2515.606, 'the index survives the night');
  assert.equal(reading.energyToday, 0, 'no production yet today');
  assert.equal(reading.temperature, null, 'a sleeping inverter has no temperature');
});

test('an awake inverter: AC power, panels by name, Wh converted, limits', () => {
  const live = livedataOf(fixture('livedata.json'));
  const balcony = live.inverters[0];
  assert.equal(balcony.channels.dc[0].name, 'South');
  assert.equal(balcony.channels.dc[0].yieldDay, 1.201, 'YieldDay comes in Wh');
  const reading = readingOf(balcony, NOW);
  assert.equal(reading.awake, true);
  assert.equal(reading.producing, true);
  assert.equal(reading.power, 405.2);
  assert.deepEqual(
    reading.panels.map((p) => [p.index, p.name, p.power]),
    [
      [1, 'South', 212.4],
      [2, '', 208.4],
    ],
  );
  assert.equal(reading.energyToday, 2.384);
  assert.equal(reading.energyTotal, 1667.007);
  assert.equal(reading.voltage, 231.4);
  assert.equal(reading.frequency, 50.01);
  assert.equal(reading.temperature, 38.4);
  assert.equal(reading.efficiency, 96.3);
  assert.equal(reading.limitWatts, 800);
  assert.equal(reading.limitPercent, 100);
  assert.equal(live.total.power, 1012.3);
  assert.equal(live.total.yieldDay, 3.421);
});

test('the night: power 0, indexes kept, today kept until midnight', () => {
  const raw = fixture('livedata.json').inverters[0];
  asleep(raw, 2 * 3600);
  const evening = readingOf(livedataOf({ inverters: [raw] }).inverters[0], NOW);
  assert.equal(evening.awake, false);
  assert.equal(evening.producing, false);
  assert.equal(evening.power, 0, 'OpenDTU keeps the stale power: it reads 0');
  assert.ok(evening.panels.every((p) => p.power === 0));
  assert.equal(evening.energyToday, 2.384, 'same day: what was produced');
  assert.equal(evening.energyTotal, 1667.007);
  assert.equal(evening.voltage, null);
  // 01:00 the next day (Paris), the last data dates from 19:00: it is yesterday's.
  const nextDay = Date.UTC(2026, 9, 14, 23, 0);
  raw.data_age_ms = 6 * 3600 * 1000;
  const after = readingOf(livedataOf({ inverters: [raw] }).inverters[0], nextDay);
  assert.equal(after.energyToday, 0);
  assert.equal(after.energyTotal, 1667.007);
  assert.notEqual(dayKey(NOW), dayKey(nextDay));
  assert.equal(dayKey(nextDay), '2026-10-15', 'the local day of Gladys (TZ), not UTC');
});

test('stale data and a never-read inverter are asleep; a zero total is no index', () => {
  const raw = fixture('livedata.json').inverters[1];
  raw.data_age_ms = 10 * 60_000; // reachable says true, but 10 minutes without data
  assert.equal(readingOf(livedataOf({ inverters: [raw] }).inverters[0], NOW).awake, false);
  const fresh = fixture('livedata.json').inverters[1];
  fresh.INV['0'].YieldTotal.v = 0;
  fresh.INV['0'].YieldDay.v = 0;
  const reading = readingOf(livedataOf({ inverters: [fresh] }).inverters[0], NOW);
  assert.equal(reading.energyTotal, null, 'OpenDTU says 0 before its first reading');
});

test('a summary inverter completed by its details; unknown serials ignored', () => {
  const full = fixture('livedata.json');
  const summary = livedataOf({ inverters: full.inverters.map(summaryOf) });
  assert.equal(summary.inverters[1].channels, undefined);
  const merged = withDetails(summary.inverters[1], { inverters: [full.inverters[1]] });
  assert.equal(merged.channels.dc.length, 4);
  assert.equal(merged.events, 2);
  assert.equal(withDetails(summary.inverters[1], { inverters: [] }), summary.inverters[1]);
  const odd = livedataOf({ inverters: [{ serial: 'not a serial' }, null, { serial: 12 }] });
  assert.equal(odd.inverters.length, 0);
});

test('limit status, device info, event logs (both shapes), system status', () => {
  const limits = limitStatusOf(fixture('limit-status.json'));
  assert.equal(limits.get('116190000002').maxPower, 1500);
  assert.equal(limits.get('116190000002').setStatus, 'Ok');
  const info = devInfoOf(fixture('devinfo.json')['114190000001']);
  assert.deepEqual(info, { model: 'HM-800', maxPower: 800, firmware: '10012' });
  assert.deepEqual(devInfoOf({ hw_model_name: 'Unknown', max_power: 0 }).maxPower, null);
  const recent = eventsOf(fixture('eventlog.json'), '114190000001');
  assert.deepEqual(recent[1], {
    code: 209,
    message: 'PV-1: No input',
    startTime: 28036,
    endTime: 28140,
  });
  const nested = eventsOf(fixture('docs-eventlog-nested.json'), '114181860001');
  assert.equal(nested.length, 4);
  assert.equal(nested[3].message, 'MPPT-A: Input undervoltage');
  assert.deepEqual(eventsOf({}, '114181860001'), []);
  assert.deepEqual(systemOf(fixture('system-status.json')), {
    hostname: 'OpenDTU-A1B2C3',
    version: 'v25.5.10',
    board: 'generic_esp32',
  });
});

test('the configuration: host forms, bounds', () => {
  assert.deepEqual(parseHost('192.168.1.50'), { host: '192.168.1.50', secure: false });
  assert.deepEqual(parseHost('http://opendtu.lan:8080/'), {
    host: 'opendtu.lan:8080',
    secure: false,
  });
  assert.deepEqual(parseHost('https://dtu.example.org'), { host: 'dtu.example.org', secure: true });
  assert.equal(parseHost('http://admin:pw@192.168.1.50'), undefined);
  assert.equal(parseHost('192.168.1.50/api'), undefined);
  assert.equal(parseHost(''), undefined);
  const config = normalizeConfig({ host: ' 10.0.0.7 ', password: 'pw', poll_interval: 1 });
  assert.equal(config.host, '10.0.0.7');
  assert.equal(config.pollInterval, 5, 'never below 5 s');
  assert.equal(normalizeConfig({}).pollInterval, 15);
  assert.equal(normalizeConfig({ host: 'a b' }).hostInvalid, true);
});
