#!/bin/sh
set -eu
# Authorized existing-installation update. The Python control retains the shared lock/fence.
test "$(id -u)" = 0
test -d /opt/vtc-development/private
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
case "$#:${1-}" in
  0:) exec /usr/bin/python3 "$source_dir/update_controls.py" ;;
  1:--notifications-only|1:--notifications-restore)
    exec /usr/bin/python3 "$source_dir/update_controls.py" "$1" ;;
  *) exit 1 ;;
esac
