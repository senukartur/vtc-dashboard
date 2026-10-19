#!/bin/sh
set -eu
# Authorized existing-installation update. The Python control retains the shared lock/fence.
test "$(id -u)" = 0
test -d /opt/vtc-development/private
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec /usr/bin/python3 "$source_dir/update_controls.py"
