# gladys-hoymiles

[Gladys Assistant](https://gladysassistant.com) external integration for
**Hoymiles micro-inverters** through [OpenDTU](https://www.opendtu.solar/):
live solar production, daily and lifetime energy, per-panel values, power
limit and on/off, on the local network. **Unofficial, not affiliated with
Hoymiles nor with the OpenDTU project.**

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

## How it works

```
Gladys ⇄ SDK ⇄ src/app.js (HoymilesApp)
                 ├─ src/opendtu/client.js  the OpenDTU web API (live data, limit, power, event log)
                 ├─ src/opendtu/model.js   OpenDTU JSON -> inverters, readings (pure)
                 ├─ src/devices.js         one device per inverter, features, states (pure)
                 ├─ src/triggers.js        readings -> scene events (pure)
                 └─ src/widget.js          the "solar" widget (pure)
```

- **Discovery** offers one device per inverter OpenDTU knows, with one power
  feature per DC input named after the panel names typed in OpenDTU.
- **Reading**: `GET /api/livedata/status` every `poll_interval` seconds (15
  by default), plus `?inv=<serial>` for each awake inverter the user created
  (recent firmwares give the channels only per inverter; the 2023 ones inline
  them). One reading a minute while every inverter sleeps.
- **The night is not an error**: power 0, indexes kept, a green status.
- **Energy monitoring**: the lifetime energy is an `energy-production-sensor`
  / `index` feature, with a `thirty-minutes-production` feature linked to it
  (`energy_parent_id`) that the Gladys core fills from the index deltas.
- **Commands**: a non-persistent power limit (W or %) and on/off, with the
  OpenDTU admin password (HTTP Basic). A persistent limit is never sent.

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npx github:GladysAssistant/integration-store .  # store admission checks
```

No OpenDTU was available while writing it: the fixtures in `test/fixtures/`
are shaped after the firmware source (`src/WebApi_*.cpp` of
tbnobody/OpenDTU) and the examples of its web API documentation; `TODO.md`
lists what a tester must confirm.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release.

## License

Apache-2.0.
