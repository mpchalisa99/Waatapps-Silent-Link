/**
 * PURE NRP & VERCEL RELAY ENGINE WITH BROADCASTCHANNEL LOCAL FALLBACK
 * - Uses clean NRP strings (e.g. "526316" or "666666").
 * - Polls /api/relay?nrp=<myNrp> every 1500ms (Retrieve & Wipe).
 * - BroadcastChannel('slk_diskomlekau_bus') fallback for same-device multi-tab testing.
 * - AES-256-GCM Web Crypto API encryption.
 * - Automatic PING_ONLINE and ACK_READ handling for double ticks (✓✓) and online status.
 */

import { ProvisionedOperativeCredential } from '../types/tactical';

export interface E2EEEncryptedPayload {
  msgId: string;
  id?: string;
  senderPeerId: string;
  senderCallsign: string;
  senderNrp: string;
  targetNrp?: string;
  targetPeerId?: string;
  kind: 'text' | 'image' | 'document' | 'voice' | 'ack:delivered' | 'ack_delivered' | 'ack:read' | 'presence' | 'presence:ping' | 'ping_online' | 'ack_read' | 'join:confirmed';
  ivB64?: string;
  ciphertextB64?: string;
  sha256Hash?: string;
  timestamp: number;
  plaintext?: string;
}

export interface RelayTrafficStats {
  myNrp: string;
  sentCount: number;
  receivedCount: number;
  lastActiveTime: number;
  activeEndpoint: string;
  isOnlineViaApi: boolean;
}

const trafficStats: RelayTrafficStats = {
  myNrp: '000000',
  sentCount: 0,
  receivedCount: 0,
  lastActiveTime: Date.now(),
  activeEndpoint: '/api/relay',
  isOnlineViaApi: false,
};

export function getRelayTrafficStats(): RelayTrafficStats {
  return { ...trafficStats };
}

const remoteInviteRegistry = new Map<string, ProvisionedOperativeCredential>();

export function getCachedRelayInvite(inviteId: string): ProvisionedOperativeCredential | undefined {
  return remoteInviteRegistry.get(inviteId.trim().toUpperCase());
}

export class E2EERelayClient {
  public onopen: (() => void) | null = null;
  public onclose: (() => void) | null = null;
  public onmessage: ((payload: E2EEEncryptedPayload) => void) | null = null;

  private pollTimer: number | null = null;
  private broadcastChannel: BroadcastChannel | null = null;
  private isConnected = false;
  private isDestroyed = false;
  private localPeerId = '';
  private localNrp = '';
  private sharedSessionKey: CryptoKey | null = null;
  private processedIds = new Set<string>();

  constructor(localPeerId: string, localNrp: string) {
    this.localPeerId = localPeerId;
    this.localNrp = localNrp.trim().toUpperCase() || '000000';
    trafficStats.myNrp = this.localNrp;
    void this.initDeterministicKey();
    this.initTransports();
  }

  private async initDeterministicKey(): Promise<void> {
    try {
      const rawMaster = new TextEncoder().encode('DISKOMLEKAU-SLK-DETERMINISTIC-MASTER-SECRET-2026');
      const baseKey = await window.crypto.subtle.importKey(
        'raw',
        rawMaster,
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
      );
      this.sharedSessionKey = await window.crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: new TextEncoder().encode('DISKOMLEKAU-SLK-526316'),
          iterations: 100000,
          hash: 'SHA-256',
        },
        baseKey,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );
    } catch {
      // Fallback
    }
  }

  public get readyState(): number {
    return this.isConnected ? WebSocket.OPEN : WebSocket.CONNECTING;
  }

  public getActiveTransportLabels(): string[] {
    const labels: string[] = [trafficStats.isOnlineViaApi ? 'VERCEL-API-RELAY' : 'LOCAL-BROADCAST-BUS', 'AES-256-GCM'];
    return labels;
  }

  private initTransports(): void {
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        const bc = new BroadcastChannel('slk_diskomlekau_bus');
        this.broadcastChannel = bc;
        bc.onmessage = (ev) => {
          if (ev.data) {
            this.handleIncomingPacket(ev.data, 'BC');
          }
        };
      } catch {
        // Ignore
      }
    }

    this.isConnected = true;
    this.onopen?.();

    // Poll /api/relay?nrp=<myNrp> every 1500ms
    this.pollTimer = window.setInterval(() => {
      if (this.isDestroyed || !this.localNrp) return;
      void this.pollServerlessRelay();
    }, 1500);

    // Initial PING_ONLINE
    window.setTimeout(() => {
      void this.dispatchEncryptedPayload({
        msgId: `PING-${Date.now()}`,
        senderPeerId: this.localPeerId,
        senderCallsign: 'USER',
        senderNrp: this.localNrp,
        targetNrp: this.localNrp === '526316' ? 'ALL' : '526316',
        kind: 'ping_online',
        timestamp: Date.now(),
      });
    }, 400);
  }

  private async pollServerlessRelay(): Promise<void> {
    try {
      const res = await fetch(`/api/relay?nrp=${encodeURIComponent(this.localNrp)}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        const data = await res.json();
        trafficStats.isOnlineViaApi = true;
        trafficStats.activeEndpoint = '/api/relay';
        if (data && Array.isArray(data.messages)) {
          for (const pkt of data.messages) {
            this.handleIncomingPacket(pkt, 'API');
          }
        }
      } else {
        trafficStats.isOnlineViaApi = false;
        trafficStats.activeEndpoint = 'LOCAL-BUS-FALLBACK';
      }
    } catch {
      trafficStats.isOnlineViaApi = false;
      trafficStats.activeEndpoint = 'LOCAL-BUS-FALLBACK';
    }
  }

  public publishRetainedInvite(cred: ProvisionedOperativeCredential): void {
    const cleanId = cred.assignedPeerId.trim().toUpperCase();
    remoteInviteRegistry.set(cleanId, cred);
    if (cred.nrp) {
      remoteInviteRegistry.set(cred.nrp.trim().toUpperCase(), cred);
    }
  }

  public async encryptPlaintext(plaintext: string): Promise<{ ivB64: string; ciphertextB64: string; sha256Hash: string }> {
    if (!this.sharedSessionKey) {
      await this.initDeterministicKey();
    }
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', encoded);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const sha256Hash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

    const ciphertextBuf = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      this.sharedSessionKey!,
      encoded
    );

    const ivB64 = btoa(String.fromCharCode(...iv));
    const ciphertextB64 = btoa(String.fromCharCode(...new Uint8Array(ciphertextBuf)));

    return { ivB64, ciphertextB64, sha256Hash };
  }

  public async decryptCiphertext(ivB64?: string, ciphertextB64?: string): Promise<string> {
    if (!ivB64 || !ciphertextB64 || !this.sharedSessionKey) {
      return '[Gagal Mendekripsi]';
    }
    try {
      const iv = Uint8Array.from(atob(ivB64), (c) => c.charCodeAt(0));
      const data = Uint8Array.from(atob(ciphertextB64), (c) => c.charCodeAt(0));

      const decryptedBuf = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        this.sharedSessionKey!,
        data
      );
      return new TextDecoder().decode(decryptedBuf);
    } catch {
      return '[Gagal Mendekripsi Payload E2EE]';
    }
  }

  public async dispatchEncryptedPayload(payload: {
    msgId: string;
    senderPeerId: string;
    senderCallsign: string;
    senderNrp: string;
    targetNrp?: string;
    targetPeerId?: string;
    kind: E2EEEncryptedPayload['kind'];
    plaintext?: string;
    timestamp: number;
  }): Promise<void> {
    const textToEncrypt = payload.plaintext || payload.kind;
    const encrypted = await this.encryptPlaintext(textToEncrypt);

    const cleanTargetNrp = (payload.targetNrp || '').trim().toUpperCase();
    const cleanSenderNrp = (payload.senderNrp || '').trim().toUpperCase();

    const packet: E2EEEncryptedPayload = {
      msgId: payload.msgId,
      id: payload.msgId,
      senderPeerId: payload.senderPeerId,
      senderCallsign: payload.senderCallsign,
      senderNrp: cleanSenderNrp,
      targetNrp: cleanTargetNrp,
      targetPeerId: payload.targetPeerId,
      kind: payload.kind,
      ivB64: encrypted.ivB64,
      ciphertextB64: encrypted.ciphertextB64,
      sha256Hash: encrypted.sha256Hash,
      timestamp: payload.timestamp,
    };

    trafficStats.sentCount += 1;
    trafficStats.lastActiveTime = Date.now();

    this.sendPacketToRelay(packet);
  }

  private sendPacketToRelay(packet: E2EEEncryptedPayload): void {
    // 1. Broadcast locally via BroadcastChannel
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage(packet);
      } catch {
        // Ignore
      }
    }

    // 2. Send via fetch POST to /api/relay
    void fetch('/api/relay', {
      method: 'POST',
      body: JSON.stringify(packet),
      headers: { 'Content-Type': 'application/json' },
    }).catch(() => {
      // Fallback handled by BroadcastChannel
    });
  }

  public send(rawJsonString: string): void {
    try {
      const parsed = JSON.parse(rawJsonString);
      void this.dispatchEncryptedPayload({
        msgId: parsed.msgId || parsed.id || `PKT-${Date.now()}`,
        senderPeerId: this.localPeerId,
        senderCallsign: 'USER',
        senderNrp: this.localNrp,
        targetNrp: parsed.targetNrp || '526316',
        kind: parsed.kind || 'text',
        plaintext: parsed.plaintext || rawJsonString,
        timestamp: Date.now(),
      });
    } catch {
      // Ignore
    }
  }

  private handleIncomingPacket(packet: E2EEEncryptedPayload, source: string): void {
    if (this.isDestroyed || !packet) return;
    const pid = packet.msgId || packet.id;
    if (pid) {
      if (this.processedIds.has(pid)) return;
      this.processedIds.add(pid);
      if (this.processedIds.size > 1500) {
        const first = this.processedIds.values().next().value;
        if (first) this.processedIds.delete(first);
      }
    }

    // Ignore our own echoes (except BroadcastChannel if needed, but filter by senderNrp)
    const cleanSenderNrp = String(packet.senderNrp || '').trim().toUpperCase();
    if (this.localNrp && cleanSenderNrp === this.localNrp && source !== 'BC') {
      return;
    }

    // Filter by targetNrp if addressed specifically
    const cleanTargetNrp = String(packet.targetNrp || '').trim().toUpperCase();
    if (cleanTargetNrp && cleanTargetNrp !== 'ALL' && this.localNrp) {
      if (cleanTargetNrp !== this.localNrp) {
        return;
      }
    }

    trafficStats.receivedCount += 1;
    trafficStats.lastActiveTime = Date.now();

    // If it's a PING_ONLINE packet, dispatch ACK or handle contact online status
    if (packet.kind === 'ping_online' || packet.kind === 'presence:ping') {
      // Send ACK or update contact
      this.onmessage?.(packet);
      return;
    }

    // If it's a message/file, trigger ACK_READ back to sender
    if (packet.kind === 'text' || packet.kind === 'image' || packet.kind === 'document' || packet.kind === 'voice') {
      // Dispatch ACK_READ back
      if (cleanSenderNrp && cleanSenderNrp !== this.localNrp) {
        void this.dispatchEncryptedPayload({
          msgId: `ACK-${packet.msgId || Date.now()}`,
          senderPeerId: this.localPeerId,
          senderCallsign: 'SYSTEM',
          senderNrp: this.localNrp,
          targetNrp: cleanSenderNrp,
          kind: 'ack_read',
          plaintext: packet.msgId || '',
          timestamp: Date.now(),
        });
      }
    }

    this.onmessage?.(packet);
  }

  public close(): void {
    this.isDestroyed = true;
    this.isConnected = false;
    if (this.pollTimer) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    try {
      this.broadcastChannel?.close();
    } catch {
      // Ignore
    }
    this.broadcastChannel = null;
    this.onclose?.();
  }
}
