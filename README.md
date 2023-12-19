# ZeroTierOne for Magisk

[README](README.md) | [中文文档](README_zh.md)

[![GitHub Release](https://img.shields.io/github/v/release/linuxscreen/ZeroTierOneForMagisk)](https://github.com/linuxscreen/ZeroTierOneForMagisk/releases)
[![GitHub Download](https://img.shields.io/github/downloads/linuxscreen/ZeroTierOneForMagisk/total)](https://github.com/linuxscreen/ZeroTierOneForMagisk/releases)

The project is a [Magisk](https://github.com/topjohnwu/Magisk) module for ZeroTierOne, Support Magisk and KernelSU, You can self-build planet and moon

# Disclaimer

The project is not responsible for bricked equipment, damaged SD cards, or burned SoC

# Usage
After the module is installed, it runs in the background

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

If self-built planet, you can direct replace file `/data/zerotier-one/planet`

```
mv /data/zerotier-one/planet /data/zerotier-one/planet.back
cp /path/planet /data/zerotier-one/planet
```

Add moon

```bash
zerotier-cli orbit <id> <id>
```

# Uninstall

- Uninstall this module from the Magisk Manager application, will delete `/data/adb/service.d/zerotierone_service.sh`, Reserved data directory `/data/zerotier-one`

- You can use commands to clear data: `rm -rf /data/zerotier-one`
