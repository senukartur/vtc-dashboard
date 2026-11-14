FROM docker:29.9.3-cli@sha256:2357639ad1ea7d0194134bf3292622fd4e562483966ed674e5d7c945b5f3b28d AS cli
FROM node:24.22.2-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c
# Package hooks may generate test host keys, but must never start an SSH daemon.
RUN printf '#!/bin/sh\nexit 101\n' > /usr/sbin/policy-rc.d \
    && chmod 0755 /usr/sbin/policy-rc.d \
    && apt-get update && apt-get install -y --no-install-recommends python3 ca-certificates openssh-server \
    && rm -f /etc/ssh/ssh_host_* \
    && rm -rf /var/lib/apt/lists/*
COPY --from=cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=cli /usr/local/libexec/docker/cli-plugins/ /usr/local/libexec/docker/cli-plugins/
COPY deploy/development /source
CMD ["python3", "/source/rehearsal.py"]
