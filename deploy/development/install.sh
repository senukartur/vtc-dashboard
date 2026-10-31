#!/bin/sh
set -eu
# Explicit operator action on the separately approved new development VM only.
test "$(id -u)" = 0
command -v docker >/dev/null
command -v python3 >/dev/null
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)'
test ! -e /opt/vtc-development
install -d -m 755 -o root -g root /opt/vtc-development
for file in compose.yaml Caddyfile operations.py activation.py activation-grants.json identity_acceptance.py ingress_probe.py receive.sh setup.mjs notifications_acceptance.py notifications.acceptance.compose.yaml notifications-acceptance-grants.json; do
  install -m 644 -o root -g root "$(dirname "$0")/$file" "/opt/vtc-development/$file"
done
chmod 755 /opt/vtc-development/receive.sh
docker run --rm --network none --user 0 \
  --mount type=bind,source=/opt/vtc-development,target=/configuration \
  node:24.22.0-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 \
  node /configuration/setup.mjs /configuration
install -d -m 700 -o root -g root /opt/vtc-development/state
useradd --system --create-home --shell /bin/sh vtc-deploy
passwd -l vtc-deploy >/dev/null
chown root:root /home/vtc-deploy
chmod 755 /home/vtc-deploy
install -d -m 755 -o root -g root /home/vtc-deploy/.ssh
install -m 440 -o root -g root "$(dirname "$0")/sudoers.example" /etc/sudoers.d/vtc-development
visudo -cf /etc/sudoers.d/vtc-development >/dev/null
printf '%s\n' 'Installation prepared. Keep deployment disabled until private configuration and SSH restrictions are verified.'
