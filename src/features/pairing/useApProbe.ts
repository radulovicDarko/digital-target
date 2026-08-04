import { useCallback, useState } from 'react';
import * as Network from 'expo-network';

import { pairProbe } from '@/api/client';
import { logger } from '@/storage/logger';

// Static fallback list. These are only tried in addition to the gateway we
// derive dynamically from the phone's own IP (see deriveGatewayHosts), so a
// device on an unusual subnet still gets found without anyone typing an IP.
const COMMON_AP_HOSTS = [
  // NetworkManager `shared` mode default — what `nmcli device wifi hotspot`
  // and our etarget-1 AP setup use. Tried first because it's our happy path.
  'http://10.42.0.1:8080',
  // Other Pi-as-AP defaults for older setups (hostapd/dnsmasq, etc.).
  'http://192.168.4.1:8080',
  'http://192.168.42.1:8080',
  // mDNS hostnames — only useful when no IP candidate answered, otherwise
  // they'd duplicate an entry we already discovered.
  'http://shooterrange.local:8080',
  'http://etarget-1.local:8080',
  // Fallbacks: same hosts on port 80 (e.g. when the Pi runs the server as
  // root or behind a reverse proxy).
  'http://10.42.0.1',
  'http://192.168.4.1',
  'http://192.168.42.1',
  'http://shooterrange.local',
  'http://etarget-1.local',
];

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * Given the phone's own IPv4 on the Wi-Fi it's joined to, return the URLs of
 * the most likely gateway hosts. When a phone joins the Range's own Wi-Fi AP,
 * the Range *is* the gateway, which on every standard AP stack (NetworkManager
 * shared, hostapd/dnsmasq, iOS/Android hotspot) is the `.1` of the subnet the
 * phone was handed. Deriving it from our own IP means we find the device on
 * ANY subnet it chooses, with zero user input and no hard-coded list.
 *
 * We also try `.254`, used by a handful of router firmwares as the gateway.
 */
const deriveGatewayHosts = (ownIp: string | null): string[] => {
  if (!ownIp) return [];
  const m = IPV4_RE.exec(ownIp.trim());
  if (!m) return [];
  const [, a, b, c, d] = m;
  // Ignore loopback / link-local / unassigned — no useful subnet there.
  if (a === '127' || a === '0' || (a === '169' && b === '254')) return [];

  const prefix = `${a}.${b}.${c}`;
  const lastOctets = ['1', '254'];
  const hosts: string[] = [];
  for (const last of lastOctets) {
    // Don't probe our own address.
    if (last === d) continue;
    const ip = `${prefix}.${last}`;
    hosts.push(`http://${ip}:8080`, `http://${ip}`);
  }
  return hosts;
};

/** Read the phone's current Wi-Fi IPv4, or null if it can't be determined. */
const getOwnIp = async (): Promise<string | null> => {
  try {
    const ip = await Network.getIpAddressAsync();
    if (!ip || ip === '0.0.0.0') return null;
    return ip;
  } catch {
    return null;
  }
};

export type Candidate = { baseUrl: string; name: string; version: string };

const isMdnsHost = (url: string): boolean => /\.local(?::\d+)?\b/.test(url);

export const useApProbe = () => {
  const [probing, setProbing] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);

  const probe = useCallback(async () => {
    setProbing(true);
    setCandidates([]);
    try {
      const ownIp = await getOwnIp();
      const gatewayHosts = deriveGatewayHosts(ownIp);
      void logger.info(
        'pair',
        `AP probe: ownIp=${ownIp ?? 'unknown'} gateway=${gatewayHosts.join(',') || 'none'}`,
      );

      // Gateway (derived from our subnet) first — it's the device itself and
      // the most reliable hit — then the static fallbacks. Dedupe by URL.
      const hostsToProbe = Array.from(new Set([...gatewayHosts, ...COMMON_AP_HOSTS]));

      const results = await Promise.all(
        hostsToProbe.map(async (baseUrl) => {
          try {
            const h = await pairProbe(baseUrl);
            return { baseUrl, name: 'ShooterRange', version: h.version } satisfies Candidate;
          } catch {
            return null;
          }
        }),
      );
      const found = results.filter((r): r is Candidate => r !== null);

      // Dedupe: a Pi typically answers on both its IP and its mDNS
      // hostname. We surface only IP entries when at least one IP-based
      // candidate responded, since they're more reliable than mDNS (some
      // routers / iOS Private Wi-Fi Address mode break .local resolution).
      // Within IP/mDNS groups we keep distinct base URLs but collapse
      // duplicate (host:port) when both port-80 and port-8080 hit the same
      // server — port 8080 wins since it's the app's default.
      const ipCandidates = found.filter((c) => !isMdnsHost(c.baseUrl));
      const mdnsCandidates = found.filter((c) => isMdnsHost(c.baseUrl));
      const preferred = ipCandidates.length > 0 ? ipCandidates : mdnsCandidates;

      // Within preferred group, prefer port 8080 over 80 for the same host.
      // (Same Pi answering on both ports → keep one.)
      const byHost = new Map<string, Candidate>();
      for (const c of preferred) {
        const u = new URL(c.baseUrl);
        const key = u.hostname; // host without port
        const existing = byHost.get(key);
        if (!existing) {
          byHost.set(key, c);
          continue;
        }
        // Prefer the explicit :8080 entry over the implicit :80 one.
        if (u.port === '8080' && !existing.baseUrl.includes(':8080')) {
          byHost.set(key, c);
        }
      }

      const deduped = Array.from(byHost.values());
      setCandidates(deduped);
      void logger.info(
        'pair',
        `AP probe found ${found.length} → ${deduped.length} after dedupe`,
      );
      return deduped;
    } finally {
      setProbing(false);
    }
  }, []);

  return { probe, probing, candidates };
};
