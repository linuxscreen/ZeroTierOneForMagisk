#!/system/bin/sh

(
    until [ $(getprop init.svc.bootanim) = "stopped" ]; do
        sleep 10
    done
    zerotier start
)&