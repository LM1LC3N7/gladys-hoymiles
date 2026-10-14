// -----------------------------------------------------------------------------
// The integration itself: the OpenDTU readings, discovery (one device per
// inverter), the reading loop, the commands (power limit, on/off), the scene
// triggers and actions, the widget, the test button. index.js only wires the
// SDK handlers to it.
//
// Pace: every `poll_interval` seconds (15 by default) the live data, plus the
// details of each awake inverter the user created (recent firmwares give the
// channels only per inverter); one reading a minute while every inverter
// sleeps; the event log only when its entry count changed; the limits and
// maximum powers once an hour. Everything stays on the LAN.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import {
  COMMAND_SETTLE,
  LIMIT_STATUS_INTERVAL,
  LIMIT_TYPES,
  LIMIT_UNITS,
  MAX_INVERTER_LIMIT,
  NIGHT_INTERVAL,
  WIDGETS,
} from './constants.js';
import {
  FEATURE,
  buildInverterDevice,
  featureKeyOf,
  ids,
  inverterStates,
  paramsOf,
  parseExternalId,
} from './devices.js';
import { OpenDtuError } from './http.js';
import { T } from './i18n.js';
import { OpenDtuClient } from './opendtu/client.js';
import {
  devInfoOf,
  eventsOf,
  limitStatusOf,
  livedataOf,
  readingOf,
  systemOf,
  withDetails,
} from './opendtu/model.js';
import { alarmEvents, productionEvents } from './triggers.js';
import { solarWidget } from './widget.js';

const defaultTimers = { setTimeout, clearTimeout, setInterval, clearInterval };

const isAuth = (err) => err instanceof OpenDtuError && err.code === 'auth';

export class HoymilesApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'hoymiles' }),
    now = Date.now,
    timers = defaultTimers,
    clientFactory = (config) => new OpenDtuClient(config),
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.timers = timers;
    this.clientFactory = clientFactory;
    this.config = normalizeConfig();
    this.client = undefined;
    this.generation = 0;
    this.tickTimer = undefined;
    this.settleTimer = undefined;
    this.refreshing = undefined;
    this.lastStatus = undefined;
    this.reset();
  }

  reset() {
    /** The last live data: { inverters, total, hints, at }. */
    this.live = undefined;
    /** serial -> the last inverter object (with its channels once read). */
    this.inverters = new Map();
    /** serial -> { model, maxPower, firmware } (devinfo, limit status). */
    this.info = new Map();
    /** serial -> { limitRelative, maxPower, setStatus } (limit status). */
    this.limits = undefined;
    this.limitsAt = 0;
    /** device external id -> last reading, debounced production state, ... */
    this.readings = new Map();
    this.production = new Map();
    this.alarmKeys = new Map();
    this.eventCounts = new Map();
    this.lastTotals = new Map();
    this.switchStates = new Map();
    this.warnedIndex = new Set();
    this.published = false;
    this.failed = false;
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(raw = {}) {
    this.stop();
    const generation = ++this.generation;
    this.config = normalizeConfig(raw);
    this.reset();
    if (this.config.hostInvalid) {
      await this.setStatus(false, T.hostInvalid);
      return;
    }
    if (!this.config.host) {
      await this.setStatus(false, T.noHost);
      return;
    }
    this.client = this.clientFactory(this.config);
    try {
      await this.refresh();
    } catch (err) {
      await this.reportError(err);
      if (isAuth(err)) {
        return;
      }
    }
    await this.discoverOnce();
    if (generation === this.generation) {
      this.scheduleNext();
    }
  }

  /**
   * Publish the discovered devices until it worked once. A failure here is
   * logged, not shown as an OpenDTU outage: the reading itself worked.
   */
  async discoverOnce() {
    if (this.published || this.failed) {
      return;
    }
    await this.publishDevices().catch((err) =>
      this.logger.warn(`Discovery failed: ${err.message}`),
    );
  }

  stop() {
    this.generation += 1;
    this.timers.clearTimeout(this.tickTimer);
    this.timers.clearTimeout(this.settleTimer);
    this.tickTimer = undefined;
    this.settleTimer = undefined;
  }

  /** The delay before the next reading: slower at night and after a failure. */
  nextDelay() {
    const poll = this.config.pollInterval * 1000;
    const asleep =
      this.live?.inverters.length > 0 &&
      this.live.inverters.every((inv) => !readingOf(inv, this.now()).awake);
    return asleep || this.failed ? Math.max(poll, NIGHT_INTERVAL) : poll;
  }

  scheduleNext() {
    this.timers.clearTimeout(this.tickTimer);
    const generation = this.generation;
    this.tickTimer = this.timers.setTimeout(async () => {
      if (generation !== this.generation) {
        return;
      }
      try {
        await this.refresh();
      } catch (err) {
        await this.reportError(err);
        if (isAuth(err)) {
          return;
        }
      }
      await this.discoverOnce();
      if (generation === this.generation) {
        this.scheduleNext();
      }
    }, this.nextDelay());
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  async reportError(err) {
    this.failed = true;
    this.logger.warn(`OpenDTU: ${err.message}`);
    if (isAuth(err)) {
      await this.setStatus(false, T.badPassword);
      return;
    }
    await this.setStatus(false, T.unreachable(this.config.host, err.message));
  }

  // --- Discovery -------------------------------------------------------------------

  /** One device per inverter OpenDTU knows, with its panels. */
  async publishDevices() {
    const live = this.live && this.now() - this.live.at < 5000 ? this.live : await this.readLive();
    await this.readLimits(true);
    const devices = [];
    for (const summary of live.inverters) {
      let inverter = this.inverters.get(summary.serial) ?? summary;
      if (!inverter.channels) {
        try {
          inverter = withDetails(summary, await this.client.inverterDetails(summary.serial));
          this.inverters.set(summary.serial, inverter);
        } catch (err) {
          if (isAuth(err)) {
            throw err;
          }
          this.logger.warn(`Details of ${summary.serial} unavailable: ${err.message}`);
        }
      }
      devices.push(buildInverterDevice(this.gladys, inverter, await this.infoOf(summary.serial)));
    }
    await this.gladys.publishDiscoveredDevices(devices);
    this.published = true;
  }

  /** The model and maximum power of an inverter (devinfo, once; limit status). */
  async infoOf(serial) {
    let info = this.info.get(serial);
    if (!info?.model) {
      try {
        info = { ...info, ...devInfoOf(await this.client.devInfo(serial)) };
      } catch (err) {
        if (isAuth(err)) {
          throw err;
        }
        this.logger.debug?.(`Device info of ${serial} unavailable: ${err.message}`);
      }
    }
    const merged = { model: null, firmware: null, ...info };
    merged.maxPower = merged.maxPower ?? this.limits?.get(serial)?.maxPower ?? null;
    this.info.set(serial, merged);
    return merged;
  }

  /** The limit status (maximum powers): once an hour, or now when `force`d once. */
  async readLimits(force = false) {
    if (!(force && !this.limits) && this.now() - this.limitsAt < LIMIT_STATUS_INTERVAL) {
      return;
    }
    this.limitsAt = this.now();
    try {
      this.limits = limitStatusOf(await this.client.limitStatus());
      for (const [serial, limit] of this.limits) {
        const info = this.info.get(serial);
        if (info && limit.maxPower) {
          info.maxPower = limit.maxPower;
        }
      }
    } catch (err) {
      if (isAuth(err)) {
        throw err;
      }
      this.logger.debug?.(`Limit status unavailable: ${err.message}`);
    }
  }

  /** The inverter devices the user created, by serial. */
  trackedDevices() {
    const map = new Map();
    for (const device of this.gladys.devices ?? []) {
      const parsed = parseExternalId(device.external_id);
      if (parsed) {
        map.set(parsed.serial, device);
      }
    }
    return map;
  }

  // --- Reading ---------------------------------------------------------------------

  async readLive() {
    const live = livedataOf(await this.client.livedata());
    this.live = { ...live, at: this.now() };
    return this.live;
  }

  refresh() {
    if (!this.refreshing) {
      this.refreshing = this.doRefresh().finally(() => {
        this.refreshing = undefined;
      });
    }
    return this.refreshing;
  }

  async doRefresh() {
    const now = this.now();
    const live = livedataOf(await this.client.livedata());
    const tracked = this.trackedDevices();
    if (tracked.size > 0) {
      await this.readLimits();
    }
    const inverters = [];
    for (const summary of live.inverters) {
      inverters.push(await this.completed(summary, tracked.get(summary.serial), now));
    }
    this.live = { ...live, inverters, at: now };
    this.failed = false;
    let changed = 0;
    for (const inverter of inverters) {
      const device = tracked.get(inverter.serial);
      if (device) {
        changed += await this.processInverter(device, inverter, now);
      }
    }
    if (changed > 0) {
      this.gladys.requestWidgetRefresh(WIDGETS.SOLAR);
    }
    await this.setStatus(true, this.statusMessage());
  }

  /**
   * The inverter with its channels. The details of a tracked inverter are
   * read while it is awake, once more when it falls asleep (its last
   * values), and never again until it wakes up.
   */
  async completed(summary, device, now) {
    const previous = this.inverters.get(summary.serial);
    let inverter = summary;
    if (!summary.channels && device) {
      const before = this.readings.get(device.external_id);
      const awake = readingOf(summary, now).awake;
      if (awake || before?.awake !== false || !previous?.channels) {
        try {
          inverter = withDetails(summary, await this.client.inverterDetails(summary.serial));
        } catch (err) {
          if (isAuth(err)) {
            throw err;
          }
          this.logger.warn(`Details of ${summary.serial} unavailable: ${err.message}`);
        }
      }
      if (!inverter.channels && previous?.channels) {
        inverter = { ...summary, channels: previous.channels, events: previous.events };
      }
    } else if (!summary.channels && previous?.channels) {
      inverter = { ...summary, channels: previous.channels, events: previous.events };
    }
    this.inverters.set(summary.serial, inverter);
    return inverter;
  }

  /** States and events of one tracked inverter; resolves the number of states sent. */
  async processInverter(device, inverter, now) {
    const deviceId = device.external_id;
    const reading = readingOf(inverter, now);
    this.readings.set(deviceId, reading);
    if (reading.producing) {
      // It cannot produce while turned off.
      this.switchStates.set(deviceId, 1);
    }
    const states = inverterStates(deviceId, reading, {
      energyTotal: this.guardIndex(device, reading.energyTotal),
      switchState: this.switchStates.get(deviceId),
    });
    let count = 0;
    try {
      count = (await this.gladys.publishChangedStates(states, { heartbeat: 10 * 60_000 })).count;
    } catch (err) {
      this.logger.warn(`States of ${device.name} failed: ${err.message}`);
    }
    const production = productionEvents(deviceId, this.production.get(deviceId), reading, now);
    this.production.set(deviceId, production.state);
    const events = [...production.events];
    if (reading.events !== null && reading.events !== this.eventCounts.get(deviceId)) {
      try {
        const entries = eventsOf(await this.client.eventLog(inverter.serial), inverter.serial);
        const alarms = alarmEvents(deviceId, reading, this.alarmKeys.get(deviceId), entries);
        this.alarmKeys.set(deviceId, alarms.keys);
        this.eventCounts.set(deviceId, reading.events);
        events.push(...alarms.events);
      } catch (err) {
        if (isAuth(err)) {
          throw err;
        }
        this.logger.warn(`Event log of ${device.name} unavailable: ${err.message}`);
      }
    }
    for (const event of events) {
      await this.gladys
        .publishSceneEvent(event.key, event.data)
        .catch((err) => this.logger.warn(`Scene event ${event.key} failed: ${err.message}`));
    }
    return count;
  }

  /**
   * The lifetime index to publish, or undefined. An index never goes down:
   * a lower value (OpenDTU restarted and not yet read the inverter, a reset
   * offset) is skipped, or the energy monitoring would count the whole total
   * again when it comes back.
   */
  guardIndex(device, value) {
    if (value === null || value === undefined) {
      return undefined;
    }
    const featureId = ids.feature(device.external_id, FEATURE.ENERGY_TOTAL);
    let last = this.lastTotals.get(device.external_id);
    if (last === undefined) {
      const stored = Number(
        (device.features ?? []).find((f) => f.external_id === featureId)?.last_value,
      );
      last = Number.isFinite(stored) && stored > 0 ? stored : undefined;
    }
    if (last !== undefined && value < last - 0.0005) {
      if (!this.warnedIndex.has(device.external_id)) {
        this.warnedIndex.add(device.external_id);
        this.logger.warn(
          `${device.name}: lifetime energy went down (${last} -> ${value}), skipped`,
        );
      }
      return undefined;
    }
    this.warnedIndex.delete(device.external_id);
    this.lastTotals.set(device.external_id, value);
    return value;
  }

  statusMessage() {
    const live = this.live;
    if (live.inverters.length === 0) {
      return T.noInverter;
    }
    const awake = live.inverters.some((inv) => readingOf(inv, this.now()).awake);
    const base = awake ? T.awake(live.inverters.length) : T.sleeping(live.inverters.length);
    if (!live.hints.radioProblem) {
      return base;
    }
    return { en: base.en + T.radioProblem.en, fr: base.fr + T.radioProblem.fr };
  }

  /** A device was just created (or updated): read it now. */
  async deviceCreated(device) {
    if (!parseExternalId(device?.external_id) || !this.client) {
      return;
    }
    try {
      await this.refresh();
    } catch (err) {
      this.logger.warn(`Reading ${device.name} after creation failed: ${err.message}`);
    }
  }

  // --- Commands --------------------------------------------------------------------

  inverterDevice(externalId) {
    const device = (this.gladys.devices ?? []).find((d) => d.external_id === externalId);
    if (!device || !parseExternalId(externalId)) {
      throw new Error(T.unknownInverter(externalId));
    }
    return device;
  }

  /** The checks every command shares: a password, an awake inverter. */
  commandTarget(device) {
    if (!this.client || !this.config.password) {
      throw new Error(T.needPassword);
    }
    const reading = this.readings.get(device.external_id);
    if (reading && !reading.awake) {
      throw new Error(T.asleep(device.name));
    }
    const serial = paramsOf(device).serial || parseExternalId(device.external_id).serial;
    const maxPower =
      this.info.get(serial)?.maxPower ?? (Number(paramsOf(device).max_power) || null);
    return { serial, maxPower };
  }

  /** OpenDTU errors as the user should read them. */
  commandError(err) {
    if (isAuth(err)) {
      return new Error('OpenDTU refused the admin password: check it in the configuration.');
    }
    if (err instanceof OpenDtuError && err.code === 'no_password') {
      return new Error(T.needPassword);
    }
    return err;
  }

  async setValue(device, feature, value) {
    if (!parseExternalId(device?.external_id)) {
      throw new Error(T.unknownInverter(device?.external_id));
    }
    const key = featureKeyOf(feature.external_id);
    if (key !== FEATURE.LIMIT && key !== FEATURE.SWITCH) {
      throw new Error(`${key} is read-only`);
    }
    const { serial, maxPower } = this.commandTarget(device);
    try {
      if (key === FEATURE.LIMIT) {
        const watts = Math.round(
          Math.min(maxPower ?? MAX_INVERTER_LIMIT, Math.max(0, Number(value))),
        );
        if (!Number.isFinite(watts)) {
          throw new Error(`invalid limit ${value}`);
        }
        await this.client.setLimit(serial, watts, LIMIT_TYPES.ABSOLUTE);
        await this.gladys.publishState(feature.external_id, watts).catch(() => {});
      } else {
        const on = Number(value) === 1;
        await this.client.setPower(serial, on);
        this.switchStates.set(device.external_id, on ? 1 : 0);
        await this.gladys.publishState(feature.external_id, on ? 1 : 0).catch(() => {});
      }
    } catch (err) {
      throw this.commandError(err);
    }
    this.settle();
  }

  /** Read the inverters back once the command had time to reach them. */
  settle() {
    this.timers.clearTimeout(this.settleTimer);
    this.settleTimer = this.timers.setTimeout(() => {
      this.settleTimer = undefined;
      this.refresh().catch((err) => this.logger.warn(`Reading back failed: ${err.message}`));
    }, COMMAND_SETTLE);
  }

  // --- Scene actions ---------------------------------------------------------------

  async setPowerLimit(fields = {}) {
    const device = this.inverterDevice(fields.inverter);
    const { serial, maxPower } = this.commandTarget(device);
    const value = Number(fields.value);
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`invalid limit ${fields.value}`);
    }
    let watts;
    let percent;
    try {
      if (fields.unit === LIMIT_UNITS.PERCENT) {
        percent = Math.round(Math.min(100, value) * 10) / 10;
        watts = maxPower ? Math.round((percent * maxPower) / 100) : null;
        await this.client.setLimit(serial, percent, LIMIT_TYPES.RELATIVE);
      } else {
        watts = Math.round(Math.min(maxPower ?? MAX_INVERTER_LIMIT, value));
        percent = maxPower ? Math.round((watts / maxPower) * 1000) / 10 : null;
        await this.client.setLimit(serial, watts, LIMIT_TYPES.ABSOLUTE);
      }
    } catch (err) {
      throw this.commandError(err);
    }
    if (watts !== null) {
      await this.gladys
        .publishState(ids.feature(device.external_id, FEATURE.LIMIT), watts)
        .catch(() => {});
    }
    this.settle();
    return { limit_watts: watts, limit_percent: percent };
  }

  async getProduction(fields = {}) {
    const devices = fields.inverter
      ? [this.inverterDevice(fields.inverter)]
      : [...this.trackedDevices().values()];
    if (devices.length === 0) {
      throw new Error('No Hoymiles inverter device yet: add one in Discovery.');
    }
    if (devices.some((d) => !this.readings.has(d.external_id))) {
      await this.refresh();
    }
    const readings = devices.map((d) => this.readings.get(d.external_id)).filter(Boolean);
    const sum = (key, digits) =>
      Number(readings.reduce((total, r) => total + (r[key] ?? 0), 0).toFixed(digits));
    return {
      power: sum('power', 1),
      energy_today: sum('energyToday', 3),
      energy_total: readings.every((r) => r.energyTotal !== null) ? sum('energyTotal', 3) : null,
      producing: readings.some((r) => r.producing),
      sleeping: readings.every((r) => !r.awake),
      inverters: readings.length,
    };
  }

  // --- Widget ----------------------------------------------------------------------

  async getWidget(key, { settings = {}, language } = {}) {
    const entries = [...this.trackedDevices().values()].map((device) => ({
      deviceId: device.external_id,
      name: device.name,
      reading: this.readings.get(device.external_id),
    }));
    return solarWidget({ entries, deviceId: settings.inverter, language: language ?? 'en' });
  }

  // --- Configuration screen button -------------------------------------------------

  async testConnection() {
    if (this.config.hostInvalid) {
      return T.hostInvalid;
    }
    if (!this.config.host || !this.client) {
      return T.noHost;
    }
    const lines = { en: [], fr: [] };
    const add = (text) => {
      lines.en.push(text.en);
      lines.fr.push(text.fr);
    };
    try {
      const live = livedataOf(await this.client.livedata());
      let system = {};
      try {
        system = systemOf(await this.client.systemStatus());
      } catch (err) {
        this.logger.debug?.(`System status unavailable: ${err.message}`);
      }
      add(
        T.test.answers({
          ...system,
          host: this.config.host,
          inverters: live.inverters.map((i) => i.name || i.serial),
        }),
      );
      if (!this.config.password) {
        add(T.test.noPassword);
      } else {
        try {
          await this.client.authenticate();
          add(T.test.passwordOk);
        } catch (err) {
          if (!isAuth(err)) {
            throw err;
          }
          add(T.test.passwordRefused);
        }
      }
      if (live.hints.defaultPassword) {
        add(T.test.defaultPassword);
      }
      if (live.hints.radioProblem) {
        add({ en: T.radioProblem.en.trim(), fr: T.radioProblem.fr.trim() });
      }
      return { en: lines.en.join('\n'), fr: lines.fr.join('\n') };
    } catch (err) {
      if (isAuth(err)) {
        return T.badPassword;
      }
      return T.unreachable(this.config.host, err.message);
    }
  }
}
