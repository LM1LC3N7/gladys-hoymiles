# Hoymiles (OpenDTU)

**Unofficial connector, not affiliated with Hoymiles nor with the OpenDTU
project.** It brings your Hoymiles micro-inverters into Gladys through
[OpenDTU](https://www.opendtu.solar/), the open-source gateway (an ESP32 with
an NRF24 or CMT2300A radio module) that talks to the inverters. Everything
stays on your local network: no cloud, no account. Hoymiles is a trademark
of Hoymiles Power Electronics Inc.

## What you need

- An OpenDTU that already shows your inverters in its own web interface
  (HM, HMS and HMT series). AhoyDTU, the other open firmware, is not
  supported yet.
- Its **IP address** on your network. Give it a fixed address in your router
  (DHCP reservation) so it does not move.
- Optional: the OpenDTU **admin password** (the one of its web interface,
  user `admin`), to change the power limit and turn an inverter on or off.

## What you get

| Surface                     | Content                                                                                                                                                                                                                           |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One device per **inverter** | solar power (W), the power of each panel named as in OpenDTU, the energy of the day (kWh), the lifetime energy (kWh) for the energy monitoring, grid voltage and frequency, inverter temperature, efficiency, power limit, on/off |
| Scene triggers              | **production started** (morning), **production stopped** (evening, with the energy of the day), **inverter alarm** (grid overvoltage, over temperature…)                                                                          |
| Scene actions               | **set the power limit** (watts or percent), **solar production** (power, energy of the day and lifetime, of one inverter or all of them)                                                                                          |
| Dashboard widget            | **Solar production**: power now, today, lifetime, each panel, the limit, and whether the inverter sleeps                                                                                                                          |

## Setup

1. Install the integration and type the **OpenDTU address** (for example
   `192.168.1.50`). Its `OpenDTU-xxxxxx` name only works if your router's DNS
   knows it: the integration runs in a container that does not see the mDNS
   names of the network.
2. Optional: type the **admin password**. Without it the integration only
   reads. If you turned off "Allow read-only access" in OpenDTU (Settings →
   Security), the password is needed to read as well.
3. Press **Test OpenDTU**: it lists your inverters and checks the password.
4. Open **Discovery** and add your inverters. Put the **Solar production**
   widget on a dashboard.

OpenDTU is read every 15 seconds (option **Refresh interval**, 5 seconds at
least: OpenDTU itself polls the inverters every 5 seconds).

## The night is not an error

A micro-inverter is powered by its panels: without sun it switches off and
OpenDTU no longer reaches it. The integration then shows a power of **0 W**,
keeps the energy indexes, marks the inverter "sleeping (night)" and reads
OpenDTU once a minute until an inverter wakes up. The status of the
integration stays green. After midnight, the energy of the day reads 0 until
the inverter wakes up.

## Energy monitoring

The **lifetime energy** feature is a production index: Gladys turns it into a
30-minute production (the "Lifetime energy (30-minute production)" feature,
which Gladys fills itself) for its energy screens. The index never goes back:
if OpenDTU restarts and has not read the inverter yet, the integration waits
for the real value.

## Power limit and on/off

The limit is **temporary** (non-persistent): the inverter forgets it when it
restarts, at the latest the next morning. A persistent limit is never sent,
because it is written to the inverter's memory, which wears out. Use the
slider of the device, a scene, or the **set the power limit** action (in
watts or in percent of the maximum power). Both commands need the admin
password and an inverter that is awake: at night OpenDTU cannot reach it and
would drop the command. Turning an inverter **off** stops its production until
you turn it back on.

## Scenes

- **Production started**: the inverter has produced for 5 minutes after a
  pause. The flicker of dawn fires nothing: once a day as a rule.
- **Production stopped**: no production for 15 minutes.
  `{{triggerEvent.data.energy_today}}` holds the energy of the day, for an
  evening summary.
- **Inverter alarm**: a new entry in the inverter's event log, with
  `{{triggerEvent.data.alarm}}` (the message in English) and
  `{{triggerEvent.data.code}}`. The daily entries (start, "no input" at
  dusk) are left out.

Leave the inverter empty to react to any of them. The **solar production**
action gives `power`, `energy_today`, `energy_total`, `producing` and
`sleeping` for a message or a condition. The following actions of the scene
find them in their variable list (written `{{<step>.<action>.<key>}}`, for
instance `{{0.0.power}}` when this action is the first of the scene).

## Troubleshooting

- **"OpenDTU does not answer"**: check the address in a browser on the same
  network; the Gladys host must be able to reach it (same LAN or a route).
- **"OpenDTU refused the access"**: "Allow read-only access" is off in
  OpenDTU and the password is missing or wrong.
- **A panel is missing**: the inverter was added while OpenDTU could not give
  its inputs; open Discovery again and press **Update** on the device.
- **A command fails with "sleeping"**: try again while the inverter produces.
- Logs: the integration's log level is set with the `LOG_LEVEL` variable.

## Privacy

The integration talks to your OpenDTU only, on your local network. The
password is sent to OpenDTU and nowhere else; it is never logged.
