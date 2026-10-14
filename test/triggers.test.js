// -----------------------------------------------------------------------------
// Readings -> scene events: the first reading arms, one event per transition,
// the dawn and dusk flicker fires nothing, routine log entries are no alarm.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENE_TRIGGERS } from '../src/constants.js';
import { alarmEvents, productionEvents, productionStep } from '../src/triggers.js';

const MIN = 60_000;
const ID = 'ext:hoymiles:inverter:114190000001';
const reading = (producing, extra = {}) => ({
  serial: '114190000001',
  name: 'Balcony',
  producing,
  power: producing ? 120 : 0,
  energyToday: 1.5,
  ...extra,
});

/** Runs a list of [minute, producing] observations, returns the events. */
function run(observations, initial) {
  let state = initial;
  const events = [];
  for (const [minute, producing] of observations) {
    const step = productionEvents(ID, state, reading(producing), minute * MIN);
    state = step.state;
    events.push(...step.events.map((e) => [minute, e.key]));
  }
  return events;
}

test('the first reading arms the production state and fires nothing', () => {
  assert.deepEqual(run([[0, true]]), []);
  assert.deepEqual(run([[0, false]]), []);
  assert.equal(productionStep(undefined, true, 0).changed, undefined);
});

test('morning: started once production lasted 5 minutes, once', () => {
  const events = run([
    [0, false],
    [1, true],
    [3, true],
    [6, true],
    [7, true],
    [30, true],
  ]);
  assert.deepEqual(events, [[6, SCENE_TRIGGERS.STARTED]]);
});

test('dawn flicker fires nothing; evening fires stopped after 15 minutes', () => {
  assert.deepEqual(
    run([
      [0, false],
      [1, true],
      [2, false],
      [3, true],
      [4, false],
      [10, false],
    ]),
    [],
  );
  const evening = run([
    [0, true],
    [1, false],
    [10, false],
    [15, true],
    [16, false],
    [31, false],
    [40, false],
  ]);
  assert.deepEqual(evening, [[31, SCENE_TRIGGERS.STOPPED]], 'a sunny break restarts the wait');
});

test('the event data: inverter, name, energy of the day', () => {
  const armed = productionEvents(ID, undefined, reading(true), 0).state;
  const first = productionEvents(ID, armed, reading(false), MIN).state;
  const { events } = productionEvents(ID, first, reading(false, { energyToday: 3.25 }), 20 * MIN);
  assert.deepEqual(events[0].data, {
    inverter: ID,
    name: 'Balcony',
    serial: '114190000001',
    power: 0,
    energy_today: 3.25,
  });
});

test('alarms: the log arms, new entries fire, routine ones do not, at most 5', () => {
  const entry = (code, startTime, message = `Event ${code}`) => ({
    code,
    message,
    startTime,
    endTime: 0,
  });
  const first = alarmEvents(ID, reading(true), undefined, [entry(1, 100), entry(121, 200)]);
  assert.equal(first.events.length, 0, 'the first reading only arms');
  const second = alarmEvents(ID, reading(true), first.keys, [
    entry(1, 100),
    entry(121, 200),
    entry(209, 300, 'PV-1: No input'),
    entry(141, 400, 'Grid: Grid overvoltage'),
  ]);
  assert.deepEqual(
    second.events.map((e) => [e.key, e.data.code, e.data.alarm, e.data.inverter]),
    [[SCENE_TRIGGERS.ALARM, 141, 'Grid: Grid overvoltage', ID]],
  );
  // The log was cleared, then the same entry comes back: no event.
  const cleared = alarmEvents(ID, reading(true), second.keys, []);
  assert.equal(cleared.events.length, 0);
  const storm = alarmEvents(
    ID,
    reading(true),
    cleared.keys,
    Array.from({ length: 9 }, (_, i) => entry(141, 1000 + i)),
  );
  assert.equal(storm.events.length, 5);
});
