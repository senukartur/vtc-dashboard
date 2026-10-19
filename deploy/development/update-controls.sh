#!/bin/sh
set -eu
# Authorized existing-installation control update only. Preserve every private setting/volume.
test "$(id -u)" = 0
test -d /opt/vtc-development/private
exec 9>/opt/vtc-development/state/operations.lock
flock -w 60 9
test ! -e /opt/vtc-development/state/recovery-required
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
for file in compose.yaml Caddyfile operations.py receive.sh; do
  install -m 644 -o root -g root "$source_dir/$file" "/opt/vtc-development/$file.new"
  mv "/opt/vtc-development/$file.new" "/opt/vtc-development/$file"
done
chmod 755 /opt/vtc-development/receive.sh
# Configuration creation precedes Compose parsing; this preserves an existing jobs.env.
/usr/bin/python3 -c 'import importlib.util; s=importlib.util.spec_from_file_location("o","/opt/vtc-development/operations.py"); o=importlib.util.module_from_spec(s); s.loader.exec_module(o); o.jobs_configuration()'
# Deliberate separate step after reviewed additive migration and exact grant update:
# install -m 644 -o root -g root "$source_dir/cron.example" /etc/cron.d/vtc-development
printf '%s\n' 'Controls updated. Apply reviewed migration/grants, then install the reviewed cron separately.'
