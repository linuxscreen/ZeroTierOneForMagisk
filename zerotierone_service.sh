#!/system/bin/sh

(
    until [ "$(getprop init.svc.bootanim)" = "stopped" ]; do
        sleep 10
    done
    if [ ! -f "/data/zerotier-one/disable_autostart" ]; then
        zerotier start
    fi
)&
