#!/bin/sh
#
# Runs once, on the instance's first boot (Lightsail user_data). It installs Docker and nothing
# else.
#
# Deliberately does NOT clone the repo, write .env, or deploy. user_data is visible in plaintext in
# the Lightsail console, so anything secret that goes in here is a secret you have published to
# anyone with read access to the account. The rest of the setup is in docs/deploy.md.
#
# POSIX sh, and it has to stay that way. Lightsail PREPENDS its own /bin/sh preamble to user_data,
# so the shebang here is not line 1 by the time this runs and the whole file executes under dash.
# `set -o pipefail` aborted the very first boot with "Illegal option" at what dash counted as line
# 24, leaving a box with no Docker and no error anywhere except cloud-init-output.log.
set -eux

apt-get update
apt-get install -y ca-certificates curl gnupg

install -m 0755 -d /etc/apt/keyrings
# Two steps rather than a pipe. Without pipefail a failed curl would feed gpg nothing, and the
# empty keyring only surfaces later as an apt signature error that names the wrong cause.
curl -fsSL -o /tmp/docker.asc https://download.docker.com/linux/ubuntu/gpg
gpg --dearmor -o /etc/apt/keyrings/docker.gpg /tmp/docker.asc
rm -f /tmp/docker.asc
chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  >/etc/apt/sources.list.d/docker.list

apt-get update
apt-get install -y \
  docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin \
  git unzip

# NOT `apt-get install awscli`. Ubuntu 24.04 has no installation candidate for it, and because this
# ran in the same apt-get as Docker, one missing package aborted the whole script and left a box
# with no Docker at all. scripts/backup-db.sh needs `aws s3 cp` and nothing else.
#
# x86_64 because bundle_id is pinned to small_3_0. An ARM bundle needs aarch64 here, and fails
# loudly rather than silently if this is wrong.
curl -fsSL -o /tmp/awscliv2.zip https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip
unzip -q /tmp/awscliv2.zip -d /tmp
/tmp/aws/install --update
rm -rf /tmp/aws /tmp/awscliv2.zip

# Headroom, not a build requirement: images are built in CI and only pulled here. The box is 2 GB
# and runs two backend replicas (~390 MB each, measured idle), the auth service, Postgres and nginx.
# The parser is no longer deployed, which gives some of this back.
if [ ! -e /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi

# So the ubuntu user can run docker without sudo. Takes effect on its next login, which is why
# docs/deploy.md tells you to reconnect before deploying.
usermod -aG docker ubuntu

systemctl enable --now docker
