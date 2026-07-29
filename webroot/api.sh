#!/system/bin/sh

umask 077
SCRIPT_DIR="${0%/*}"
[ "$SCRIPT_DIR" = "$0" ] && SCRIPT_DIR="."
MODDIR="${ZT_MODDIR:-${SCRIPT_DIR%/webroot}}"
DATA_DIR="${ZT_DATA_DIR:-/data/zerotier-one}"
PLANET="$DATA_DIR/planet"
PLANET_BACKUP="$DATA_DIR/planet.backup"
PLANET_PENDING="$DATA_DIR/.planet-restart-required"
AUTOSTART_DISABLED="$DATA_DIR/disable_autostart"
UPLOAD_B64="$DATA_DIR/.planet-upload.b64"
UPLOAD_BIN="$DATA_DIR/.planet-upload"
UPLOAD_SIZE="$DATA_DIR/.planet-upload.size"
MAX_PLANET_SIZE=1048576
busybox=""

for candidate in \
    /data/adb/magisk/busybox \
    /data/adb/ksu/bin/busybox \
    /data/adb/ap/bin/busybox; do
    if [ -x "$candidate" ]; then
        busybox="$candidate"
        break
    fi
done

run_busybox() {
    if [ -n "$busybox" ]; then
        "$busybox" "$@"
    else
        "$@"
    fi
}

ZT_CONTROL="$MODDIR/system/bin/zerotier"
ZT_CLI="$MODDIR/system/bin/zerotier-cli"
[ -x "$ZT_CONTROL" ] || ZT_CONTROL="$(command -v zerotier 2>/dev/null)"
[ -x "$ZT_CLI" ] || ZT_CLI="$(command -v zerotier-cli 2>/dev/null)"

json_escape() {
    printf '%s' "$1" \
        | run_busybox tr '\r\n\t' '   ' \
        | run_busybox sed 's/\\/\\\\/g; s/"/\\"/g'
}

respond_ok() {
    data="${1:-null}"
    message="$(json_escape "${2:-}")"
    printf '{"ok":true,"data":%s,"message":"%s"}\n' "$data" "$message"
    exit 0
}

respond_error() {
    message="$(json_escape "$1")"
    printf '{"ok":false,"data":null,"error":"%s"}\n' "$message"
    exit "${2:-1}"
}

is_running() {
    run_busybox pidof zerotier-one >/dev/null 2>&1
}

require_cli() {
    if [ -z "$ZT_CLI" ] || [ ! -x "$ZT_CLI" ]; then
        respond_error "找不到 zerotier-cli，请重新安装模块并重启设备"
    fi
}

require_control() {
    if [ -z "$ZT_CONTROL" ] || [ ! -x "$ZT_CONTROL" ]; then
        respond_error "找不到 zerotier 控制脚本，请重新安装模块并重启设备"
    fi
}

require_running() {
    is_running || respond_error "ZeroTier 服务尚未运行"
}

file_metadata() {
    target="$1"
    if [ ! -f "$target" ]; then
        printf 'null'
        return
    fi

    size="$(run_busybox stat -c '%s' "$target" 2>/dev/null)"
    mtime="$(run_busybox stat -c '%Y' "$target" 2>/dev/null)"
    digest="$(run_busybox sha256sum "$target" 2>/dev/null | run_busybox cut -d ' ' -f 1)"
    case "$size" in ''|*[!0-9]*) size=0 ;; esac
    case "$mtime" in ''|*[!0-9]*) mtime=0 ;; esac
    printf '{"size":%s,"mtime":%s,"sha256":"%s"}' "$size" "$mtime" "$(json_escape "$digest")"
}

get_overview() {
    if is_running; then
        running=true
    else
        running=false
    fi
    if [ -f "$AUTOSTART_DISABLED" ]; then
        autostart=false
    else
        autostart=true
    fi
    if [ -f "$PLANET_PENDING" ]; then
        planet_pending=true
    else
        planet_pending=false
    fi

    info=null
    if [ "$running" = true ] && [ -n "$ZT_CLI" ] && [ -x "$ZT_CLI" ]; then
        cli_info="$($ZT_CLI -j info 2>/dev/null)"
        [ -n "$cli_info" ] && info="$cli_info"
    fi

    respond_ok "{\"running\":$running,\"autostart\":$autostart,\"planetPending\":$planet_pending,\"info\":$info}"
}

get_cli_json() {
    command_name="$1"
    require_cli
    require_running
    output="$($ZT_CLI -j "$command_name" 2>/dev/null)"
    status=$?
    if [ "$status" -ne 0 ] || [ -z "$output" ]; then
        respond_error "无法读取 ZeroTier $command_name 数据"
    fi
    respond_ok "$output"
}

service_action() {
    action="$1"
    require_control
    case "$action" in
        start|stop|restart) ;;
        *) respond_error "不支持的服务操作" ;;
    esac

    "$ZT_CONTROL" "$action" >/dev/null 2>&1
    status=$?
    if [ "$action" = stop ]; then
        is_running && respond_error "服务停止失败，请检查是否有不可终止的 zerotier-one 进程"
        respond_ok '{"running":false}' "ZeroTier 已停止"
    fi

    if [ "$status" -eq 0 ] && is_running; then
        respond_ok '{"running":true}' "ZeroTier 已启动"
    fi
    respond_error "服务操作失败，请查看 $DATA_DIR/error.log"
}

autostart_action() {
    action="$1"
    mkdir -p "$DATA_DIR" || respond_error "无法访问 ZeroTier 数据目录"
    case "$action" in
        get)
            if [ -f "$AUTOSTART_DISABLED" ]; then
                respond_ok '{"enabled":false}'
            else
                respond_ok '{"enabled":true}'
            fi
            ;;
        enable)
            rm -f "$AUTOSTART_DISABLED" || respond_error "无法启用开机自启"
            respond_ok '{"enabled":true}' "已启用开机自启"
            ;;
        disable)
            umask 077
            : >"$AUTOSTART_DISABLED" || respond_error "无法关闭开机自启"
            respond_ok '{"enabled":false}' "已关闭开机自启"
            ;;
        *) respond_error "不支持的自启操作" ;;
    esac
}

validate_network_id() {
    network_id="$1"
    [ "${#network_id}" -eq 16 ] || return 1
    case "$network_id" in
        *[!0-9a-fA-F]*) return 1 ;;
    esac
    return 0
}

network_action() {
    action="$1"
    network_id="$2"
    require_cli
    require_running
    validate_network_id "$network_id" \
        || respond_error "Network ID 必须是 16 位十六进制字符"
    case "$action" in
        join|leave) ;;
        *) respond_error "不支持的网络操作" ;;
    esac

    "$ZT_CLI" "$action" "$network_id" >/dev/null 2>&1
    status=$?
    [ "$status" -eq 0 ] || respond_error "网络操作失败，请确认 Network ID 和服务状态"
    if [ "$action" = join ]; then
        respond_ok "{\"networkId\":\"$network_id\"}" "已提交加入网络请求"
    else
        respond_ok "{\"networkId\":\"$network_id\"}" "已退出网络"
    fi
}

planet_metadata() {
    if [ -f "$PLANET_PENDING" ]; then
        pending=true
    else
        pending=false
    fi
    current="$(file_metadata "$PLANET")"
    backup="$(file_metadata "$PLANET_BACKUP")"
    respond_ok "{\"current\":$current,\"backup\":$backup,\"pending\":$pending,\"maxSize\":$MAX_PLANET_SIZE}"
}

planet_begin() {
    expected_size="$1"
    case "$expected_size" in
        ''|*[!0-9]*) respond_error "无效的 Planet 文件大小" ;;
    esac
    [ "${#expected_size}" -le 7 ] || respond_error "无效的 Planet 文件大小"
    if [ "$expected_size" -le 0 ] || [ "$expected_size" -gt "$MAX_PLANET_SIZE" ]; then
        respond_error "Planet 文件必须小于 1 MiB 且不能为空"
    fi

    mkdir -p "$DATA_DIR" || respond_error "无法访问 ZeroTier 数据目录"
    umask 077
    rm -f "$UPLOAD_B64" "$UPLOAD_BIN" "$UPLOAD_SIZE"
    : >"$UPLOAD_B64" || respond_error "无法创建上传临时文件"
    printf '%s' "$expected_size" >"$UPLOAD_SIZE" || respond_error "无法记录上传信息"
    respond_ok "{\"expectedSize\":$expected_size}" "已准备上传"
}

planet_append() {
    chunk="$1"
    if [ ! -f "$UPLOAD_B64" ] || [ ! -f "$UPLOAD_SIZE" ]; then
        respond_error "上传会话不存在，请重新选择文件"
    fi
    [ -n "$chunk" ] || respond_error "上传分块不能为空"
    [ "${#chunk}" -le 32768 ] || respond_error "上传分块过大"
    case "$chunk" in
        *[!A-Za-z0-9+/=]*) respond_error "上传分块包含非法字符" ;;
    esac
    expected_size="$(cat "$UPLOAD_SIZE" 2>/dev/null)"
    case "$expected_size" in
        ''|*[!0-9]*) cleanup_upload; respond_error "上传信息已损坏" ;;
    esac
    encoded_groups=$(( (expected_size + 2) / 3 ))
    encoded_limit=$((encoded_groups * 4))
    encoded_size="$(run_busybox stat -c '%s' "$UPLOAD_B64" 2>/dev/null)"
    case "$encoded_size" in
        ''|*[!0-9]*) cleanup_upload; respond_error "上传临时文件已损坏" ;;
    esac
    [ $((encoded_size + ${#chunk})) -le "$encoded_limit" ] \
        || { cleanup_upload; respond_error "上传数据超过声明的 Planet 文件大小"; }
    printf '%s' "$chunk" >>"$UPLOAD_B64" || respond_error "写入上传分块失败"
    respond_ok "{\"received\":${#chunk}}"
}

cleanup_upload() {
    rm -f "$UPLOAD_B64" "$UPLOAD_BIN" "$UPLOAD_SIZE"
}

planet_commit() {
    if [ ! -f "$UPLOAD_B64" ] || [ ! -f "$UPLOAD_SIZE" ]; then
        respond_error "上传会话不存在，请重新选择文件"
    fi
    expected_size="$(cat "$UPLOAD_SIZE" 2>/dev/null)"
    case "$expected_size" in
        ''|*[!0-9]*) cleanup_upload; respond_error "上传信息已损坏" ;;
    esac

    run_busybox base64 -d "$UPLOAD_B64" >"$UPLOAD_BIN" 2>/dev/null \
        || { cleanup_upload; respond_error "Planet 文件解码失败"; }
    actual_size="$(run_busybox stat -c '%s' "$UPLOAD_BIN" 2>/dev/null)"
    if [ "$actual_size" != "$expected_size" ] || [ "$actual_size" -le 0 ] || [ "$actual_size" -gt "$MAX_PLANET_SIZE" ]; then
        cleanup_upload
        respond_error "Planet 文件大小校验失败"
    fi

    if [ -f "$PLANET" ]; then
        backup_tmp="$DATA_DIR/.planet-backup.tmp"
        rm -f "$backup_tmp"
        cp -f "$PLANET" "$backup_tmp" \
            || { rm -f "$backup_tmp"; cleanup_upload; respond_error "无法备份当前 Planet"; }
        current_size="$(run_busybox stat -c '%s' "$PLANET" 2>/dev/null)"
        backup_size="$(run_busybox stat -c '%s' "$backup_tmp" 2>/dev/null)"
        if [ -z "$current_size" ] || [ "$current_size" != "$backup_size" ]; then
            rm -f "$backup_tmp"
            cleanup_upload
            respond_error "当前 Planet 备份大小校验失败"
        fi
        chmod 0600 "$backup_tmp"
        mv -f "$backup_tmp" "$PLANET_BACKUP" \
            || { rm -f "$backup_tmp"; cleanup_upload; respond_error "无法更新 Planet 备份"; }
    fi
    chmod 0600 "$UPLOAD_BIN"
    mv -f "$UPLOAD_BIN" "$PLANET" \
        || { cleanup_upload; respond_error "无法替换 Planet"; }
    : >"$PLANET_PENDING"
    rm -f "$UPLOAD_B64" "$UPLOAD_SIZE"
    respond_ok "$(file_metadata "$PLANET")" "Planet 已替换，请手动重启 ZeroTier 使其生效"
}

planet_restore() {
    [ -s "$PLANET_BACKUP" ] || respond_error "没有可恢复的 Planet 备份"
    restore_tmp="$DATA_DIR/.planet-restore"
    rm -f "$restore_tmp"
    cp -f "$PLANET_BACKUP" "$restore_tmp" \
        || respond_error "无法读取 Planet 备份"
    backup_size="$(run_busybox stat -c '%s' "$PLANET_BACKUP" 2>/dev/null)"
    restore_size="$(run_busybox stat -c '%s' "$restore_tmp" 2>/dev/null)"
    if [ -z "$backup_size" ] || [ "$backup_size" != "$restore_size" ]; then
        rm -f "$restore_tmp"
        respond_error "Planet 恢复文件大小校验失败"
    fi
    chmod 0600 "$restore_tmp"
    mv -f "$restore_tmp" "$PLANET" \
        || respond_error "无法恢复 Planet 备份"
    : >"$PLANET_PENDING"
    respond_ok "$(file_metadata "$PLANET")" "Planet 备份已恢复，请手动重启 ZeroTier 使其生效"
}

validate_backup_directory() {
    backup_dir="$1"
    [ "${#backup_dir}" -le 512 ] || return 1
    cleaned_path="$(printf '%s' "$backup_dir" | run_busybox tr -d '\r\n\t')"
    [ "$cleaned_path" = "$backup_dir" ] || return 1
    case "$backup_dir" in
        *'/../'*|*'/..'|*'//'*) return 1 ;;
    esac
    case "$backup_dir" in
        /sdcard|/sdcard/*|/data/local/tmp|/data/local/tmp/*) ;;
        /storage/emulated/*)
            storage_path="${backup_dir#/storage/emulated/}"
            storage_user="${storage_path%%/*}"
            [ -n "$storage_user" ] || return 1
            case "$storage_user" in *[!0-9]*) return 1 ;; esac
            ;;
        *) return 1 ;;
    esac
    return 0
}

planet_backup() {
    backup_dir="$1"
    [ -s "$PLANET" ] || respond_error "当前 Planet 文件不存在或为空"
    umask 022
    validate_backup_directory "$backup_dir" \
        || respond_error "备份目录仅支持共享存储或 /data/local/tmp，且不能包含 .."
    mkdir -p "$backup_dir" 2>/dev/null \
        || respond_error "无法创建备份目录：$backup_dir"
    resolved_dir="$(run_busybox realpath "$backup_dir" 2>/dev/null)"
    validate_backup_directory "$resolved_dir" \
        || respond_error "备份目录通过符号链接指向了不允许的位置"
    backup_dir="$resolved_dir"

    timestamp="$(date '+%Y%m%d-%H%M%S' 2>/dev/null)"
    [ -n "$timestamp" ] || timestamp="$(date '+%s' 2>/dev/null)"
    backup_path="$backup_dir/planet-$timestamp"
    suffix=0
    while [ -e "$backup_path" ] || [ -L "$backup_path" ]; do
        suffix=$((suffix + 1))
        [ "$suffix" -le 99 ] || respond_error "同一时间产生的备份过多，请稍后重试"
        backup_path="$backup_dir/planet-$timestamp-$suffix"
    done
    cp -f "$PLANET" "$backup_path" 2>/dev/null \
        || respond_error "无法写入备份文件：$backup_path"
    source_size="$(run_busybox stat -c '%s' "$PLANET" 2>/dev/null)"
    backup_size="$(run_busybox stat -c '%s' "$backup_path" 2>/dev/null)"
    if [ -z "$source_size" ] || [ "$source_size" != "$backup_size" ]; then
        rm -f "$backup_path"
        respond_error "Planet 备份大小校验失败"
    fi
    chmod 0644 "$backup_path" 2>/dev/null
    respond_ok "{\"path\":\"$(json_escape "$backup_path")\",\"file\":$(file_metadata "$backup_path")}" "Planet 已备份到 $backup_path"
}

group="$1"
action="$2"

case "$group" in
    get)
        case "$action" in
            overview) get_overview ;;
            peers) get_cli_json listpeers ;;
            networks) get_cli_json listnetworks ;;
            planet) planet_metadata ;;
            *) respond_error "不支持的查询" ;;
        esac
        ;;
    service) service_action "$action" ;;
    autostart) autostart_action "$action" ;;
    network) network_action "$action" "$3" ;;
    planet)
        case "$action" in
            begin) planet_begin "$3" ;;
            append) planet_append "$3" ;;
            commit) planet_commit ;;
            restore) planet_restore ;;
            backup) planet_backup "$3" ;;
            *) respond_error "不支持的 Planet 操作" ;;
        esac
        ;;
    *) respond_error "不支持的 API 请求" ;;
esac
