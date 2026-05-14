import { useCallback, useState } from 'react';

import { pairProbe } from '@/api/client';
import { logger } from '@/storage/logger';

// Probe order: IP-based candidates first (faster, more reliable), mDNS
// hostnames last as fallbacks. We dedupe at the end so the same Range
// doesn't appear twice (10.42.0.1 and etarget-1.local resolve to the same
// device but each return a healthy /api/health).
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

export type Candidate = { baseUrl: string; name: string; version: string };

const isMdnsHost = (url: string): boolean => /\.local(?::\d+)?\b/.test(url);

export const useApProbe = () => {
  const [probing, setProbing] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);

  const probe = useCallback(async () => {
    setProbing(true);
    setCandidates([]);
    try {
      const results = await Promise.all(
        COMMON_AP_HOSTS.map(async (baseUrl) => {
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
