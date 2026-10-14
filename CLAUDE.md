# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors.

## What this is

A Gladys Assistant **external integration** of type `device`: a Node.js
service (Node 22+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through `@gladysassistant/integration-sdk` (v0.15). It
reads **Hoymiles micro-inverters through OpenDTU** (the open-source ESP32
gateway, its web API on the LAN): one device per inverter with its power,
per-panel power, daily and lifetime energy, temperature, a non-persistent
power limit and on/off, scene triggers, scene actions and a widget. Local
only. Unofficial: not affiliated with Hoymiles nor with OpenDTU. Sibling of
`gladys-apsystems` (same solar vocabulary: feature keys, triggers, widget).

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run audit                             # npm audit --omit=dev
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run `format:check`, `lint`, `test` and `audit` before every commit.

## Architecture

```
index.js               SDK wiring only (handlers registered before connect())
src/app.js             HoymilesApp: discovery, reading loop (day / night),
                       commands, scene actions, widget, test button
src/opendtu/client.js  the OpenDTU web API: every path, Basic auth, the
                       `data=<json>` form of the commands
src/opendtu/model.js   OpenDTU JSON -> inverters, readings, logs (pure)
src/devices.js         the inverter device, feature keys, states (pure)
src/triggers.js        readings -> scene events (pure)
src/widget.js          the "solar" widget (pure)
src/config.js          config_schema normalized (DEFAULTS, BOUNDS, the host)
src/constants.js       pacing, thresholds, limit types, manifest keys
src/i18n.js            runtime texts (en/fr)
src/http.js            the only network access (fetch, timeout, no redirect)
test/fixtures/         OpenDTU answers shaped after the firmware source, and
                       the two examples of the OpenDTU web API documentation
test/helpers/          a fake OpenDTU (routes, auth, posts), fake timers;
                       Gladys is the SDK's fake
```

## Rules

- **Unofficial.** Every user-facing surface says "unofficial connector, not
  affiliated with Hoymiles" (and OpenDTU). Never use the Hoymiles logo.
- **Keys are forever**: the manifest keys (`src/constants.js`), the feature
  keys (`FEATURE` in `src/devices.js`: `power`, `power_<n>`, `energy_today`,
  `energy_total`, `energy_total_production`, `voltage`, `frequency`,
  `temperature`, `efficiency`, `limit`, `switch`, `reachable`), the external
  id shape `inverter:<serial>` (lowercase hex) and the feature ids derived
  from them (`uuidOf`, below) are stored in user scenes and dashboards. Never
  rename them; they are shared with `gladys-apsystems`.
- **The energy index**: `energy_total` is `energy-production-sensor` /
  `index` (kWh). The core turns its deltas into 30-minute production only
  into a `thirty-minutes-production` feature whose `energy_parent_id` is the
  index feature, and derives that feature itself for consumption indexes
  only (`getDiscoveredDevices`, Gladys 5.1/5.2). So the device declares both,
  with ids computed as UUID v5 of the feature external ids: stable across
  discoveries. The integration never publishes a state on the 30-minute
  feature. An index never goes down (`guardIndex`): 0 (OpenDTU not yet read
  the inverter) and lower values are skipped, or the core would count the
  whole total again.
- **The night is not an error**: an inverter OpenDTU does not reach, or
  whose data is older than `STALE_DATA`, is asleep: power 0, the indexes
  kept, temperature and voltages not published, "today" 0 once the data is
  from a previous day (Gladys's TZ), a green status, no event storm.
- **Be polite with OpenDTU** (an ESP32 that also polls the radio): the live
  data every `poll_interval` (15 s by default, never below 5: OpenDTU polls
  the inverters every 5 s at best); `?inv=<serial>` only for the awake
  inverters the user created (and once when one falls asleep); one reading a
  minute while every inverter sleeps or after a failure (`NIGHT_INTERVAL`);
  the event log only when its count changed; the limits once an hour; the
  device info once per inverter. A command reads back once after
  `COMMAND_SETTLE`. No websocket in v0.1.
- **Never a persistent limit**: `setLimit` only sends types 0 (W) and 1 (%)
  (`LIMIT_TYPES`); 2/3 (and the old 256/257) write the inverter's flash.
- **Commands need the password and an awake inverter**: OpenDTU silently
  drops a command for an inverter it cannot reach.
- **The password is a secret**: a `secret` field, sent only to the
  configured OpenDTU host as HTTP Basic, never logged, never in an error or
  a status (`http.js` errors carry the path only). A 401 stops the loop until
  the configuration changes.
- **One event per transition** (`src/triggers.js`): the first reading only
  arms; production started/stopped are debounced (5 / 15 minutes); alarms are
  new event log entries minus `ROUTINE_EVENT_CODES`, at most 5 per reading.
- **Built blind**: no OpenDTU was available. Every OpenDTU path and form is in
  `src/opendtu/client.js`, every field name in `src/opendtu/model.js`, so a
  user report fixes one place. `TODO.md` lists what to confirm.
- **Read-only rootfs**: write nothing on disk.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag.
- **Changelog**: every user-visible change adds a line under
  `## [Unreleased]` in `CHANGELOG.md`.
- **Manifest texts** are `{ en, fr }` objects; the catalog description holds
  10 to 100 characters per language; `test/manifest.test.js` ties the
  manifest to the code (keys, defaults, bounds, the event data against the
  trigger fields and variables).
- **User-facing text** is bilingual, `docs/en.md` and `docs/fr.md` kept in
  sync. Comments explain why, in English.
- **Tests never touch the network** (`installOpenDtu` replaces `fetch`); the
  widget contents pass the SDK's `validateWidgetContent`; the tests run with
  `TZ=Europe/Paris`.

## Choices made without the hardware (see the final report)

- `limit` is `switch` / `dimmer` in W (the slider Gladys draws for a writable
  number; no power-setpoint type exists), max = the inverter's maximum power
  (OpenDTU's 2250 W bound when unknown). `energy_today` is
  `energy-production-sensor` / `daily-production`, the per-panel powers
  `energy-production-sensor` / `power` like the total, `temperature`
  `device-temperature-sensor` / `decimal`, `voltage` `energy-sensor` /
  `voltage`, `frequency` and `efficiency` `unknown` / `unknown` (Gladys has no
  hertz unit), `reachable` `unknown` / `binary`, `switch` `switch` / `binary`.
- The trigger field `inverter` holds the device external id (the core matches
  it); the inverter's name is the `name` variable.
- Alarms come from the inverter event log (`/api/eventlog/status`), the
  daily entries left out.

## CI and pushes

- Group the commits and push **at most once a day**, unless the maintainer
  explicitly asks otherwise: the GitHub Actions quota is limited.
- If every CI job fails in under 2 seconds, the quota is exhausted: it is
  not a bug in the code.
- The Docker image cannot be built in the Claude Code cloud container (no
  network for `apk` inside `docker build`): the CI builds it.

## Refreshing the fixtures

With an OpenDTU on the network (anonymize the serials and names):

```bash
H=192.168.1.50
curl -s "http://$H/api/livedata/status" | python3 -m json.tool --indent 1
curl -s "http://$H/api/livedata/status?inv=<serial>" | python3 -m json.tool --indent 1
curl -s "http://$H/api/eventlog/status?inv=<serial>&locale=en" | python3 -m json.tool --indent 1
curl -s "http://$H/api/limit/status" "http://$H/api/devinfo/status?inv=<serial>"
```

`NOW` in `test/helpers/fakeOpenDtu.js` is 13:00 in Paris; `livedata.json`
holds the full inverters (the fake derives the summaries a recent firmware
lists).
