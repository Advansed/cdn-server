#!/bin/bash
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "run as root" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y nginx curl ca-certificates unzip python3

if [[ ! -x /usr/local/bin/bun ]]; then
  arch="$(uname -m)"
  case "$arch" in
    x86_64) bun_arch="x64" ;;
    aarch64) bun_arch="aarch64" ;;
    *) echo "unsupported arch: $arch" >&2; exit 1 ;;
  esac
  tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/bun.zip" "https://github.com/oven-sh/bun/releases/latest/download/bun-linux-${bun_arch}.zip"
  unzip -q "$tmp/bun.zip" -d "$tmp"
  install -m 755 "$tmp/bun-linux-${bun_arch}/bun" /usr/local/bin/bun
  rm -rf "$tmp"
fi

chown -R root:www-data /opt/cdn
chmod -R u=rwX,g=rX,o= /opt/cdn
chmod 640 /opt/cdn/.env

install -m 644 /opt/cdn/deploy/cdn.service /etc/systemd/system/cdn.service
systemctl daemon-reload
systemctl enable cdn
systemctl restart cdn

install -d -o www-data -g www-data /var/cache/nginx/cdn
install -d /etc/nginx/snippets
install -m 644 /opt/cdn/nginx/cdn-cache.conf /etc/nginx/conf.d/cdn-cache.conf
install -m 644 /opt/cdn/nginx/cdn-location.conf /etc/nginx/snippets/cdn-location.conf
python3 /opt/cdn/deploy/patch-nginx.py
nginx -t
systemctl reload nginx

sleep 1
curl -fsS http://127.0.0.1:8080/health
echo
curl -fsS --resolve reg.aostng.ru:443:127.0.0.1 https://reg.aostng.ru/cdn/health
echo
