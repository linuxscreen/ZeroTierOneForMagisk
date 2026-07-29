# ZeroTierOne for Magisk

[![GitHub Release](https://img.shields.io/github/v/release/linuxscreen/ZeroTierOneForMagisk)](https://github.com/linuxscreen/ZeroTierOneForMagisk/releases)
[![GitHub Download](https://img.shields.io/github/downloads/linuxscreen/ZeroTierOneForMagisk/total)](https://github.com/linuxscreen/ZeroTierOneForMagisk/releases)

ZeroTierOne安卓客户端使用不太方便，无法设置自建planet和moon，并且需要开启vpn。编译的二进制目前Mi13Pro测试使用正常。

思路参考链接：[是否有可能 Zerotier-One 直接在 Android 设备上运行？ - V2EX](https://v2ex.com/t/863131)

# 免责声明
本项目不对以下情况负责：设备变砖、SD 卡损坏或 SoC 烧毁。

# 使用方法
安装模块之后会在系统后台运行

## 操作界面

模块内置适配手机和平板的 ZeroTier 暖白浅色橙色主题 WebUI，支持：

- 启动、停止、重启 ZeroTier 服务
- 查看节点状态、版本和 Node ID
- 单独启用或关闭开机自启
- 查看 Peers、链路类型、延迟、角色和版本
- 查看已加入网络，以及加入或退出网络
- 上传、替换和恢复最近一份 Planet 备份
- 将当前 Planet 手动备份到共享存储中的自选目录

KernelSU 和 APatch 管理器可直接打开模块 WebUI。Magisk Manager 本身不提供模块 WebUI 入口，Magisk 用户需要通过 [MMRL](https://github.com/MMRLApp/MMRL) 或 WebUI X 打开。

Planet 替换或恢复后不会自动重启服务。界面会显示“等待生效”，请确认网络环境允许中断后手动重启 ZeroTier。

手动备份支持 `/sdcard`、`/storage/emulated/<用户编号>` 和 `/data/local/tmp` 下的目录，备份文件名格式为 `planet-YYYYMMDD-HHMMSS`。

## 命令行

可执行文件`zerotier`、`zerotier-one`、`zerotier-cli`、`zerotier-idtool`会复制到`/system/bin`，切换root后，可以直接运行命令

```bash
zerotier status
# ● zerotier-one is running
```

启动、重启、停止zerotier-one服务

```
zerotier start
zerotier restart
zerotier stop
```

加入网络

```
zerotier-cli join <network id>
```

zerotier-one数据存储在/data/zerotier-one

如果不使用 WebUI，自建 planet 也可以直接替换 `/data/zerotier-one/planet`：

```
mv /data/zerotier-one/planet /data/zerotier-one/planet.back
cp /path/planet /data/zerotier-one/planet
```

替换后需要执行 `zerotier restart` 才能生效。

添加moon

```bash
zerotier-cli orbit <id> <id>
```

自建planet参考教程：[一分钟自建zerotier-plant - Jonnyan的原创笔记 - 亖亖亖 (mrdoc.fun)](https://www.mrdoc.fun/doc/443/)

# 卸载

- 从 Magisk Manager应用卸载本模块，会删除 `/data/adb/service.d/zerotierone_service.sh` 文件，保留数据目录 `/data/zerotier-one`

- 可使用命令清除数据：`rm -rf /data/zerotier-one`
