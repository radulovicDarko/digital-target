#!/usr/bin/env bash
# find-pi.sh — locate the Raspberry Pi on the local network from macOS/Linux.
#
# Tries, in order:
#   1) mDNS/Bonjour hostnames (shooterrange.local, raspberrypi.local)
#   2) the Pi's own Wi-Fi AP gateway (192.168.4.1 etc.) if you're on its hotspot
#   3) an ARP scan of your current subnet, matching Raspberry Pi MAC prefixes
#
# Prints one reachable "user@host" (or host) line per candidate it verifies over
# SSH port 22. Usage:
#
#   ./find-pi.sh                # just discover and print candidates
#   PI_USER=daka ./find-pi.sh   # verify SSH as a specific user
#
set -euo pipefail

PI_USER="${PI_USER:-}"
SSH_PORT="${SSH_PORT:-22}"
CTRL_PORT="${CTRL_PORT:-8080}"

# Known-good mDNS names + common Pi AP gateways.
CANDIDATES=(
  "shooterrange.local"
  "raspberrypi.local"
  "192.168.4.1"
  "192.168.42.1"
  "10.42.0.1"
)

# Raspberry Pi Foundation OUI prefixes (b8:27:eb legacy, dc:a6:32 Pi4,
# e4:5f:01 Pi4/5, 2c:cf:67 Pi5, 28:cd:c1 CM4/5).
PI_MAC_RE='b8:27:eb|dc:a6:32|e4:5f:01|2c:cf:67|28:cd:c1'

port_open() { # host port
  nc -z -G 2 -w 2 "$1" "$2" >/dev/null 2>&1
}

# Returns 0 if the host answers the ShooterRange control-server health check.
is_shooterrange() { # host
  curl -s -m 2 "http://$1:${CTRL_PORT}/api/health" 2>/dev/null | grep -q '"status"'
}

echo "==> Scanning ARP table for Raspberry Pi MAC addresses..."
# `arp -a` output: hostname (ip) at mac on iface ...
while read -r line; do
  ip="$(sed -n 's/.*(\([0-9.]*\)).*/\1/p' <<<"$line")"
  [ -n "$ip" ] && CANDIDATES+=("$ip")
done < <(arp -a 2>/dev/null | grep -Ei "$PI_MAC_RE" || true)

# Fallback: sweep the current /24 for anything answering the control server on
# port 8080. This catches Pis with a non-Pi MAC (e.g. a USB Wi-Fi adapter),
# which is exactly what the ARP/MAC match misses.
MYIP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
if [ -n "$MYIP" ]; then
  SUBNET="${MYIP%.*}"
  echo "==> Sweeping ${SUBNET}.0/24 for the control server on port ${CTRL_PORT}..."
  for i in $(seq 1 254); do
    ( port_open "${SUBNET}.$i" "${CTRL_PORT}" && CANDIDATES+=("${SUBNET}.$i") ) 2>/dev/null || true &
  done
  wait 2>/dev/null || true
  # The subshells above can't mutate CANDIDATES, so collect matches directly.
  while read -r host; do
    [ -n "$host" ] && CANDIDATES+=("$host")
  done < <(for i in $(seq 1 254); do
    ( is_shooterrange "${SUBNET}.$i" && echo "${SUBNET}.$i" ) &
  done; wait)
fi

# Deduplicate.
IFS=$'\n' read -r -d '' -a CANDIDATES < <(printf '%s\n' "${CANDIDATES[@]}" | awk 'NF && !seen[$0]++' && printf '\0')

echo "==> Verifying reachability..."
found=0
for host in "${CANDIDATES[@]}"; do
  label="$host"
  if is_shooterrange "$host"; then
    label="$host  (ShooterRange control server UP on :${CTRL_PORT})"
  fi
  if port_open "$host" "$SSH_PORT"; then
    if [ -n "$PI_USER" ]; then
      echo "  reachable: ${PI_USER}@${label}"
    else
      echo "  reachable: ${label}"
    fi
    found=1
  elif is_shooterrange "$host"; then
    # SSH may be closed but the app is clearly running — still report it.
    echo "  found (no SSH): ${label}"
    found=1
  fi
done

if [ "$found" -eq 0 ]; then
  echo "No Pi found. Make sure you're on the same Wi-Fi / the Pi's hotspot,"
  echo "or pass its IP directly to deploy.sh (e.g. ./deploy.sh pi@192.168.1.50)."
  exit 1
fi
