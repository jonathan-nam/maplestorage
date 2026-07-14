#!/usr/bin/env bash
#
# Runs once, on the instance's first boot (Lightsail user_data). It installs Docker and nothing
# else.
#
# Deliberately does NOT clone the repo, write .env, or deploy. user_data is visible in plaintext in
# the Lightsail console, so anything secret that goes in here is a secret you have published to
# anyone with read access to the account. The rest of the setup is in docs/deploy.md.
set -euxo pipefail

apt-get update
apt-get install -y ca-certificates curl gnupg

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg |
  gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  >/etc/apt/sources.list.d/docker.list

apt-get update
apt-get install -y \
  docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin \
  awscli git

# So the ubuntu user can run docker without sudo. Takes effect on its next login, which is why
# docs/deploy.md tells you to reconnect before deploying.
usermod -aG docker ubuntu

systemctl enable --now docker
