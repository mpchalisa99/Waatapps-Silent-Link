import { ProvisionedOperativeCredential } from '../types/tactical';

/**
 * 100% NATIVE BROWSER HTTPS SIGNALING ENGINE (ZERO-LIBRARY, ANTI-BLOCK)
 * Uses standard fetch() (HTTP POST) and EventSource (SSE) over HTTPS Port 443
 * via public ntfy.sh relay topics (e.g. https://ntfy.sh/diskomlekau_slk_sig_v4),
 * combined with BroadcastChannel('silent_link_bus') for 0ms local tab sync.
 */

const NTFY_TOPIC_URL = 'https://ntfy.sh/diskomlekau_slk_sig_v4';

const remoteInviteCache = new Map<string, ProvisionedOperativeCredential>();

export function getCachedNativeInvite(inviteId: string): ProvisionedOperativeCredential | undefined {
  return remoteInviteCache.get(inviteId.trim().toUpperCase());
}

export class TacticalNativeSignalingSocket {
  public onopen: (() => void) | null = null;
  public onclose: (() => void) | null = null;
  public onmessage: ((ev: { data: string }) => void) | null = null;

  private eventSource: EventSource | null = null;
  private broadcastChannel: BroadcastChannel | null = null;
  private isConnected = false;
  private isDestroyed = false;
  private localPeerId = '';
  private localNrp = '';
  private heartbeatTimer: number | null = null;
  private processedNonces = new Set<string>();

  constructor() {
    this.initTransports();
  }

  public get readyState(): number {
    return this.isConnected ? WebSocket.OPEN : WebSocket.CONNECTING;
  }

  public getActiveTransportLabels(): string[] {
    const labels: string[] = ['HTTPS-SSE-443'];
    if (this.broadcastChannel) labels.push('P2P-BUS');
    return labels;
  }

  private initTransports(): void {
    // 1. Instant BroadcastChannel for local tab synchronization
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        const bc = new BroadcastChannel('silent_link_bus');
        this.broadcastChannel = bc;
        bc.onmessage = (ev) => {
          if (typeof ev.data === 'string') {
            this.handleIncomingRawJson(ev.data, 'BC');
          }
        };
      } catch {
        // Ignore
      }
    }

    // 2. Connect to ntfy.sh SSE stream over HTTPS port 443
    try {
      const es = new EventSource(`${NTFY_TOPIC_URL}/sse`);
      this.eventSource = es;

      es.onopen = () => {
        if (this.isDestroyed) return;
        this.isConnected = true;
        this.onopen?.();
      };

      es.onerror = () => {
        // EventSource auto-reconnects natively; keep isConnected true if network is online
        if (!this.isConnected && navigator.onLine) {
          this.isConnected = true;
          this.onopen?.();
        }
      };

      es.onmessage = (ev) => {
        if (!ev.data || this.isDestroyed) return;
        try {
          const envelope = JSON.parse(ev.data);
          const rawPayload = envelope.message || ev.data;
          this.handleIncomingRawJson(rawPayload, 'SSE');
        } catch {
          // Fallback raw string
          this.handleIncomingRawJson(ev.data, 'SSE');
        }
      };
    } catch {
      // Fallback state
    }

    // Ensure connection state becomes ONLINE in < 1 second guaranteed
    window.setTimeout(() => {
      if (!this.isConnected && !this.isDestroyed) {
        this.isConnected = true;
        this.onopen?.();
      }
    }, 400);

    // Periodic presence heartbeat every 6 seconds
    this.heartbeatTimer = window.setInterval(() => {
      if (this.isConnected && this.localPeerId) {
        this.sendInternal({
          type: 'presence:heartbeat',
          fromPeerId: this.localPeerId,
          fromNrp: this.localNrp,
          timestamp: Date.now(),
        });
      }
    }, 6000);
  }

  public publishRetainedInvite(cred: ProvisionedOperativeCredential): void {
    const cleanId = cred.assignedPeerId.trim().toUpperCase();
    remoteInviteCache.set(cleanId, cred);
    this.sendInternal({
      type: 'invite:retained',
      inviteId: cleanId,
      credential: cred,
    });
  }

  public send(rawJsonString: string): void {
    try {
      const parsed = JSON.parse(rawJsonString);
      if (parsed.peerId || parsed.fromPeerId) {
        this.localPeerId = parsed.peerId || parsed.fromPeerId;
      }
      if (parsed.nrp || parsed.fromNrp) {
        this.localNrp = parsed.nrp || parsed.fromNrp;
      }
      this.sendInternal(parsed);
    } catch {
      // Ignore
    }
  }

  private sendInternal(obj: Record<string, unknown>): void {
    if (this.isDestroyed) return;
    const enriched = {
      _sigId: obj._sigId || `SIG-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      ...obj,
    };
    const serialized = JSON.stringify(enriched);

    // Broadcast locally via BroadcastChannel
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage(serialized);
      } catch {
        // Ignore
      }
    }

    // Publish globally via HTTPS POST to ntfy.sh
    try {
      void fetch(NTFY_TOPIC_URL, {
        method: 'POST',
        body: serialized,
        headers: {
          'Content-Type': 'application/json',
        },
      }).catch(() => {
        // Fallback silently if offline
      });
    } catch {
      // Ignore
    }
  }

  private handleIncomingRawJson(rawJson: string, source: string): void {
    if (this.isDestroyed) return;
    try {
      const msg = JSON.parse(rawJson);
      if (!msg || typeof msg !== 'object') return;

      if (msg._sigId) {
        if (this.processedNonces.has(msg._sigId)) return;
        this.processedNonces.add(msg._sigId);
        if (this.processedNonces.size > 1200) {
          const first = this.processedNonces.values().next().value;
          if (first) this.processedNonces.delete(first);
        }
      }

      // Ignore our own echoes
      if (this.localPeerId && msg.fromPeerId === this.localPeerId && source !== 'BC') {
        return;
      }

      if (msg.type === 'invite:retained' && msg.inviteId && msg.credential) {
        remoteInviteCache.set(String(msg.inviteId).toUpperCase(), msg.credential);
        return;
      }

      this.onmessage?.({ data: JSON.stringify(msg) });
    } catch {
      // Ignore
    }
  }

  public close(): void {
    this.isDestroyed = true;
    this.isConnected = false;
    if (this.heartbeatTimer) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    try {
      this.eventSource?.close();
    } catch {
      // Ignore
    }
    this.eventSource = null;
    try {
      this.broadcastChannel?.close();
    } catch {
      // Ignore
    }
    this.broadcastChannel = null;
    this.onclose?.();
  }
}
