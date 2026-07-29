# ZeroTierOne for Magisk

[README](README.md) | [中文文档](README_zh.md)

[![GitHub Release](https://img.shields.io/github/v/release/linuxscreen/ZeroTierOneForMagisk)](https://github.com/linuxscreen/ZeroTierOneForMagisk/releases)
[![GitHub Download](https://img.shields.io/github/downloads/linuxscreen/ZeroTierOneForMagisk/total)](https://github.com/linuxscreen/ZeroTierOneForMagisk/releases)

The project is a [Magisk](https://github.com/topjohnwu/Magisk) module for ZeroTierOne, Support Magisk and KernelSU, You can self-build planet and moon

# Disclaimer

The project is not responsible for bricked equipment, damaged SD cards, or burned SoC

# Usage
After the module is installed, it runs in the background

## WebUI

The module includes a warm light ZeroTier orange-themed WebUI designed for phones and tablets. It provides:

- Start, stop, and restart controls for the ZeroTier service
- Node status, version, and Node ID
- An independent boot autostart toggle
- Peer roles, paths, latency, connection type, and versions
- Joined network status plus join and leave actions
- Planet upload, replacement, and one-level rollback
- Manual Planet backups to a selected shared-storage directory

KernelSU and APatch managers can open the module WebUI directly. Magisk Manager does not provide a native module WebUI entry, so Magisk users need [MMRL](https://github.com/MMRLApp/MMRL) or WebUI X.

Replacing or restoring Planet does not restart the service automatically. The WebUI keeps a pending indicator until ZeroTier is restarted successfully.

Manual backup destinations may be located below `/sdcard`, `/storage/emulated/<user>`, or `/data/local/tmp`. Backup files are named `planet-YYYYMMDD-HHMMSS`.

## Command line

Executable file `zerotier`、`zerotier-one`、`zerotier-cli`、`zerotier-idtool` will copy to `/system/bin`, You can directly run commands as the root user by terminal

```bash
zerotier status
# ● zerotier-one is running
```

Start, restart, stop zerotier-one service

```
zerotier start
zerotier restart
zerotier stop
```

Join network

```
zerotier-cli join <network id>
```

zerotier-one data will storage in `/data/zerotier-one`

If you do not use the WebUI, a self-built Planet can still be copied directly to `/data/zerotier-one/planet`:

```
mv /data/zerotier-one/planet /data/zerotier-one/planet.back
cp /path/planet /data/zerotier-one/planet
```

Run `zerotier restart` after replacement to load it.

Add moon

```bash
zerotier-cli orbit <id> <id>
```

# Uninstall

- Uninstall this module from the Magisk Manager application, will delete `/data/adb/service.d/zerotierone_service.sh`, Reserved data directory `/data/zerotier-one`

- You can use commands to clear data: `rm -rf /data/zerotier-one`
