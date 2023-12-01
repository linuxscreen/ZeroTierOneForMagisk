# ZeroTierOne for Magisk

ZeroTierOne安卓客户端使用不太方便，无法使用自建planet和设置moon，并且需要新建vpn。编译的二进制目前Mi13Pro测试使用正常。

思路参考: https://v2ex.com/t/863131

# 免责声明
本项目不对以下情况负责：设备变砖、SD 卡损坏或 SoC 烧毁。

# 使用方法
安装模块之后会在系统后台运行

可执行文件会复制到`/system/bin`，切换root后，可以直接运行命令

```bash
zerotier status
# zerotier-one is running
```

启动、重启、停止zerotier-one服务

```
zerotier start
zerotier restart
zerotier stop
```

加入网络

```
zerotier-cli join xxxxxxx
```

zerotier-one数据存储在/data/zerotier-one

如果自建planet直接替换/data/zerotier-one/planet即可

```
mv /data/zerotier-one/planet /data/zerotier-one/planet.back
cp /path/planet /data/zerotier-one/planet
```

卸载

- 从 Magisk Manager应用卸载本模块，会删除 `/data/adb/service.d/zerotierone_service.sh` 文件，保留数据目录 `/data/zerotier-one`

- 可使用命令清除数据：`rm -rf /data/zerotier-one`
