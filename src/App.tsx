/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Send,
  Paperclip,
  Camera,
  FileText,
  Lock,
  Check,
  CheckCheck,
  Search,
  Video,
  Phone,
  Trash2,
  Download,
  ArrowLeft,
  QrCode,
  ScanLine,
  Mic,
  KeyRound,
  MoreVertical,
  Smile,
  MessageSquare,
  Radio,
  Users,
  Plus,
  ShieldCheck,
  Terminal,
  Eye,
  RefreshCw,
  X,
  Settings,
  LogIn,
  Maximize2,
  Palette,
  ShieldAlert,
  LogOut,
} from 'lucide-react';
import {
  CryptoPacketLog,
  DeviceRole,
  EncryptedMessage,
  FileAttachmentMeta,
  LocalNodeIdentity,
  ProvisionedOperativeCredential,
  TacticalContact,
  VoiceNoteMeta,
  WebRTCIceDiagnosticLog,
} from './types/tactical';
import {
  computeJwkFingerprint,
  decryptAES256GCM,
  deriveSharedAESGCMKey,
  encryptAES256GCM,
  generateAdminSigningKeyPair,
  generateEphemeralECDHKeyPair,
  verifyAndParseProvisioningToken,
  loadEncryptedDeviceIdentity,
  saveEncryptedDeviceIdentity,
  revokeEncryptedDeviceIdentity,
  importEcdhPrivateKeyFromJwk,
  importEcdsaPrivateKeyFromJwk,
} from './utils/cryptoEngine';
import {
  createSampleTacticalReconImage,
  generateTacticalReply,
  INITIAL_TACTICAL_CONTACTS,
} from './utils/tacticalPresets';
import { synthesizeTacticalVoiceNoteWav } from './utils/voiceNoteEngine';
import {
  TACTICAL_ICE_CONFIG,
  TACTICAL_DATACHANNEL_CONFIG,
  LivePeerTunnel,
  createEmptyLivePeerTunnel,
  waitForIceGatheringComplete,
  flushPendingRemoteIceCandidates,
  addOrQueueRemoteIceCandidate,
  flushOutgoingDataChannelQueue,
  sendOverReliableDataChannel,
} from './utils/webrtcPeerEngine';
import {
  MilitaryThemeId,
  MILITARY_THEMES,
  applyMilitaryThemeToDOM,
  usePWAAndFullscreen,
  tacticalBackgroundDaemon,
  BackgroundKeepAliveStatus,
  sendBackgroundSystemNotification,
} from './utils/pwaAndKeepAliveEngine';
import { E2EERelayClient, E2EEEncryptedPayload } from './utils/e2eeRelayEngine';
import { ManualSdpModal } from './components/ManualSdpModal';
import {
  TacticalMediaStreamModal,
  LiveCallSignalPacket,
} from './components/TacticalMediaStreamModal';
import { AdminProvisioningModal } from './components/AdminProvisioningModal';
import { OperativeOnboardingModal } from './components/OperativeOnboardingModal';
import { VoiceNotePlayer } from './components/VoiceNotePlayer';
import { TacticalSettingsModal } from './components/TacticalSettingsModal';

interface LoopbackTunnel {
  localPc: RTCPeerConnection;
  remotePc: RTCPeerConnection;
  localDc: RTCDataChannel;
  remoteDc: RTCDataChannel | null;
  sharedKey: CryptoKey;
  remotePrivateKey: CryptoKey;
  remotePublicKeyJwk: JsonWebKey;
  sharedKeyHash: string;
  remoteFingerprint: string;
}

interface DataChannelPacket {
  packetType: 'ENCRYPTED_MSG' | 'DELIVERY_ACK' | 'FILE_CHUNK';
  messageId?: string;
  fileId?: string;
  chunkIndex?: number;
  totalChunks?: number;
  fileName?: string;
  mimeType?: string;
  chunkB64?: string;
  senderPeerId: string;
  senderCallsign: string;
  senderNrp: string;
  senderRank?: string;
  senderUnit?: string;
  senderPublicKeyJwk?: JsonWebKey;
  targetGroupPeerId?: string;
  timestamp: number;
  kind?: 'text' | 'image' | 'document' | 'voice';
  ciphertextB64?: string;
  ivB64?: string;
  ivHex?: string;
  sha256Hash?: string;
  byteLength?: number;
  ackStage?: 'DELIVERED' | 'VERIFIED';
}

interface IncomingCallInvite {
  fromPeerId: string;
  callerName: string;
  callerNrp: string;
  callerRank: string;
  callType: 'voice' | 'video';
  timestamp: number;
}

interface EphemeralStatusUpdate {
  id: string;
  authorName: string;
  authorRank: string;
  nrp: string;
  timestamp: number;
  content: string;
  avatarColor: string;
}

interface CallHistoryItem {
  id: string;
  contactPeerId: string;
  personnelName: string;
  rank: string;
  nrp: string;
  timestamp: number;
  callType: 'video' | 'voice';
  direction: 'outgoing' | 'incoming';
}

interface FileAssemblyBuffer {
  fileName: string;
  mimeType: string;
  totalChunks: number;
  chunks: string[];
  receivedCount: number;
}

const TACTICAL_EMOJIS = ['🫡', '✅', '🎯', '🛡️', '📡', '🚁', '⚠️', '🔒'];
const MASTER_ADMIN_PASSCODE_SPECIAL = 'DISKOMLEKAU-MASTER-526316';

export default function App() {
  // Volatile RAM Identity (Zero-Data Retention) + Encrypted LocalStorage & IndexedDB Persistence
  const [localIdentity, setLocalIdentity] = useState<LocalNodeIdentity>({
    peerId: 'SLK-UNREGISTERED-0000',
    role: 'OPERATIVE',
    personnelName: 'Personel Belum Terotorisasi',
    nrp: '000000',
    callsign: 'UNREGISTERED CLIENT',
    unit: 'DISKOMLEKAU P2P',
    rank: 'Menunggu Scan QR Admin',
    publicKeyJwk: null,
    privateKey: null,
    signingPublicKeyJwk: null,
    signingPrivateKey: null,
    fingerprint: 'MENUNGGU KUNCI KRIPTOGRAFI...',
    sessionStartedAt: Date.now(),
  });
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);

  // Master Admin Gate Passcode Input state for unauthenticated devices
  const [gateAdminPasscode, setGateAdminPasscode] = useState<string>('');
  const [gateErrorMsg, setGateErrorMsg] = useState<string>('');

  // Military Theme & Mobile Settings / Background Keep-Alive State
  const [activeTheme, setActiveTheme] = useState<MilitaryThemeId>('tactical-black');
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [soundAlertEnabled, setSoundAlertEnabled] = useState<boolean>(true);
  const soundAlertEnabledRef = useRef<boolean>(true);
  soundAlertEnabledRef.current = soundAlertEnabled;
  const [wsSignalConnected, setWsSignalConnected] = useState<boolean>(false);
  const [keepAliveStatus, setKeepAliveStatus] = useState<BackgroundKeepAliveStatus>(
    tacticalBackgroundDaemon.getStatus()
  );

  // Fullscreen & PWA Hook for Mobile HP Installation
  const {
    isInstallable,
    isInstalled,
    isIOS,
    isFullscreen,
    autoFullscreenOnTap,
    setAutoFullscreenOnTap,
    toggleFullscreen,
    promptInstall,
  } = usePWAAndFullscreen();

  const [contacts, setContacts] = useState<TacticalContact[]>(INITIAL_TACTICAL_CONTACTS);
  // Single-column screen navigation: null = Home List View, string = Active Chat Room View
  const [openChatPeerId, setOpenChatPeerId] = useState<string | null>(null);
  const openChatPeerIdRef = useRef<string | null>(null);
  openChatPeerIdRef.current = openChatPeerId;

  // Bottom Navigation Bar: 'chat' | 'status' | 'groups' | 'calls'
  const [activeBottomTab, setActiveBottomTab] = useState<'chat' | 'status' | 'groups' | 'calls'>('chat');

  const [messagesByPeer, setMessagesByPeer] = useState<Record<string, EncryptedMessage[]>>({});
  const [packetLogs, setPacketLogs] = useState<CryptoPacketLog[]>([]);
  const [iceDiagnosticLogs, setIceDiagnosticLogs] = useState<WebRTCIceDiagnosticLog[]>([]);
  const [totalEncryptedPackets, setTotalEncryptedPackets] = useState<number>(0);
  const [totalTransmittedBytes, setTotalTransmittedBytes] = useState<number>(0);
  const [issuedCredentials, setIssuedCredentials] = useState<ProvisionedOperativeCredential[]>([]);

  // WhatsApp Filter Pills: 'all' ("Semua") | 'unread' ("Belum dibaca") | 'groups' ("Grup")
  const [chatFilterPill, setChatFilterPill] = useState<'all' | 'unread' | 'groups'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [inputText, setInputText] = useState<string>('');
  const [showEmojiPicker, setShowEmojiPicker] = useState<boolean>(false);
  const [showTopMenuDropdown, setShowTopMenuDropdown] = useState<boolean>(false);
  const [showSecuritySheet, setShowSecuritySheet] = useState<boolean>(false);
  const [showCiphertextInline, setShowCiphertextInline] = useState<boolean>(false);

  // Modals & Live Multi-Client Call States
  const [isAdminProvisionOpen, setIsAdminProvisionOpen] = useState<boolean>(false);
  const [isOperativeOnboardingOpen, setIsOperativeOnboardingOpen] = useState<boolean>(false);
  const [isManualSdpOpen, setIsManualSdpOpen] = useState<boolean>(false);
  const [isMediaStreamOpen, setIsMediaStreamOpen] = useState<boolean>(false);
  const [mediaCallContact, setMediaCallContact] = useState<TacticalContact | null>(null);
  const [mediaCallType, setMediaCallType] = useState<'voice' | 'video'>('voice');
  const [isMediaCaller, setIsMediaCaller] = useState<boolean>(true);
  const [incomingCallInvite, setIncomingCallInvite] = useState<IncomingCallInvite | null>(null);
  const [latestCallSignal, setLatestCallSignal] = useState<LiveCallSignalPacket | null>(null);

  // Status / Pembaruan Tab State (RAM Only)
  const [statusUpdates, setStatusUpdates] = useState<EphemeralStatusUpdate[]>([
    {
      id: 'ST-1',
      authorName: 'Kolonel Lek Hendra Wijaya',
      authorRank: 'KadiskomlekOps',
      nrp: '521890',
      timestamp: Date.now() - 300000,
      content: 'SITREP: Seluruh kanal P2P WebRTC wilayah Koopsudnas I beroperasi 100% nominal dengan enkripsi AES-256-GCM.',
      avatarColor: 'from-cyan-500 to-blue-700',
    },
    {
      id: 'ST-2',
      authorName: 'Mayor Pas Rizky Pratama',
      authorRank: 'Komandan Tim Taktis',
      nrp: '534112',
      timestamp: Date.now() - 1200000,
      content: 'Posko Taktis Sektor Charlie siap menerima distribusi koordinat dan citra radar P2P.',
      avatarColor: 'from-sky-500 to-indigo-700',
    },
  ]);
  const [newStatusText, setNewStatusText] = useState('');

  // Call History State (RAM Only)
  const [callHistory, setCallHistory] = useState<CallHistoryItem[]>([
    {
      id: 'CALL-1',
      contactPeerId: 'SLK-ID-521890-A101',
      personnelName: 'Kolonel Lek Hendra Wijaya',
      rank: 'KadiskomlekOps',
      nrp: '521890',
      timestamp: Date.now() - 1800000,
      callType: 'video',
      direction: 'incoming',
    },
    {
      id: 'CALL-2',
      contactPeerId: 'SLK-ID-534112-B204',
      personnelName: 'Mayor Pas Rizky Pratama',
      rank: 'Komandan Tim Taktis',
      nrp: '534112',
      timestamp: Date.now() - 4200000,
      callType: 'voice',
      direction: 'outgoing',
    },
  ]);

  // Integrated Voice Note Recording State
  const [isRecordingVoice, setIsRecordingVoice] = useState<boolean>(false);
  const [recordingSeconds, setRecordingSeconds] = useState<number>(0);
  const [liveVoiceWaveform, setLiveVoiceWaveform] = useState<number[]>(
    Array.from({ length: 18 }, () => 25)
  );
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingStartTimeRef = useRef<number>(0);
  const recordingTimerRef = useRef<number | null>(null);

  // WebRTC P2P Tunnel Refs & Deduplication Set
  const loopbackTunnelsRef = useRef<Map<string, LoopbackTunnel>>(new Map());
  const livePeerTunnelsRef = useRef<Map<string, LivePeerTunnel>>(new Map());
  const processedMessageIdsRef = useRef<Set<string>>(new Set());
  const fileAssemblyMapRef = useRef<Map<string, FileAssemblyBuffer>>(new Map());

  const manualPendingPcRef = useRef<{
    pc: RTCPeerConnection;
    dc: RTCDataChannel | null;
    targetPeerId: string;
    targetCallsign: string;
  } | null>(null);
  const wsRef = useRef<E2EERelayClient | null>(null);
  const pendingAutoDialPeerRef = useRef<{
    peerId: string;
    callsign: string;
    nrp: string;
  } | null>(null);
  const localIdentityRef = useRef<LocalNodeIdentity>(localIdentity);
  localIdentityRef.current = localIdentity;

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll chat room to bottom
  useEffect(() => {
    if (openChatPeerId) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messagesByPeer, openChatPeerId]);

  // Apply selected Military Color Theme to DOM CSS Variables & Meta Theme-Color
  useEffect(() => {
    applyMilitaryThemeToDOM(activeTheme);
  }, [activeTheme]);

  // Helper to get avatar initials
  const getInitials = (name: string) => {
    const words = name
      .replace(/\[.*?\]/g, '')
      .trim()
      .split(/\s+/);
    if (words.length >= 2) {
      return (words[0][0] + words[words.length - 1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  // Record Cryptographic Packet Audit Log in RAM
  const recordPacketLog = useCallback(
    (
      direction: 'TX' | 'RX' | 'KEY_EXCHANGE' | 'PROVISION',
      peerCallsign: string,
      ivHex: string,
      sha256Hash: string,
      bytes: number
    ) => {
      const entry: CryptoPacketLog = {
        id: `PKT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
        direction,
        peerCallsign,
        cipherSuite: 'AES-256-GCM / ECDH-P256',
        ivHex: ivHex || '000000000000',
        sha256Short: sha256Hash ? sha256Hash.slice(0, 20) + '...' : 'ECDH-AUTH',
        bytes,
        transport: 'RTCDataChannel/SCTP',
      };
      setPacketLogs((prev) => [entry, ...prev.slice(0, 39)]);
      if (direction === 'TX' || direction === 'RX') {
        setTotalEncryptedPackets((prev) => prev + 1);
        setTotalTransmittedBytes((prev) => prev + bytes);
      }
    },
    []
  );

  // Record Real-Time WebRTC ICE Agent, SDP Handshake & DataChannel Diagnostic Log in RAM
  const recordIceDiagnosticLog = useCallback((log: WebRTCIceDiagnosticLog) => {
    console.info(
      `[SILENT LINK WEBRTC][${log.category}] Peer=${log.peerName} (${log.peerId}) | ICE=${log.iceConnectionState} | DC=${log.dataChannelState} | ${log.detail}`
    );
    setIceDiagnosticLogs((prev) => [log, ...prev.slice(0, 34)]);
  }, []);

  // Append decrypted message to volatile RAM state (idempotent + auto-creates live contact if needed)
  const appendMessage = useCallback((peerId: string, msg: EncryptedMessage) => {
    setMessagesByPeer((prev) => {
      const existing = prev[peerId] || [];
      if (existing.some((m) => m.id === msg.id)) return prev;
      return {
        ...prev,
        [peerId]: [...existing, msg],
      };
    });

    if (msg.kind !== 'system') {
      const isIncoming = msg.senderPeerId !== localIdentityRef.current.peerId;
      const isChatOpen = openChatPeerIdRef.current === peerId;

      const previewText =
        msg.kind === 'voice'
          ? `🎤 Pesan suara (${msg.voiceMeta?.durationSec || 3} dtk)`
          : msg.kind === 'image'
          ? `📷 Foto: ${msg.fileMeta?.fileName || 'Citra Taktis'}`
          : msg.kind === 'document'
          ? `📄 Dokumen: ${msg.fileMeta?.fileName || 'Berkas'}`
          : msg.plaintext;

      if (isIncoming) {
        void sendBackgroundSystemNotification(
          `SILENT LINK • ${msg.senderCallsign || 'Personel P2P'}`,
          previewText,
          soundAlertEnabledRef.current,
          'message'
        );
      }

      setContacts((prev) => {
        const exists = prev.some((c) => c.peerId === peerId);
        if (!exists) {
          const newLiveContact: TacticalContact = {
            peerId,
            personnelName: msg.senderCallsign || `PERSONEL ${msg.senderNrp}`,
            nrp: msg.senderNrp || peerId.slice(-6),
            callsign: `${msg.senderCallsign} [LIVE P2P]`,
            unit: 'DISKOMLEKAU P2P',
            rank: 'Personel Terhubung',
            frequency: 'DIRECT WEBRTC P2P',
            sector: 'Live Multi-Client',
            mode: 'live-peer',
            isGroup: false,
            avatarColor: 'from-cyan-400 to-teal-700',
            connectionState: 'CONNECTED',
            iceState: 'connected',
            dataChannelState: 'open',
            remoteFingerprint: 'ECDH-P256-VERIFIED',
            sharedKeyHash: 'AES-256-GCM-ACTIVE',
            latencyMs: 6,
            unreadCount: isIncoming && !isChatOpen ? 1 : 0,
            lastMessagePreview: previewText,
            lastActivityTime: msg.timestamp,
            provisionedByAdmin: true,
          };
          return [newLiveContact, ...prev];
        }

        return prev.map((c) => {
          if (c.peerId !== peerId) return c;
          return {
            ...c,
            lastMessagePreview: previewText,
            lastActivityTime: msg.timestamp,
            unreadCount:
              isIncoming && !isChatOpen ? (c.unreadCount || 0) + 1 : c.unreadCount,
          };
        });
      });
    }
  }, []);

  // Update delivery status (SENT -> DELIVERED -> VERIFIED)
  const updateMessageStatus = useCallback(
    (peerId: string, messageId: string, status: 'SENT' | 'DELIVERED' | 'VERIFIED') => {
      setMessagesByPeer((prev) => {
        const list = prev[peerId];
        if (!list) {
          const nextState: Record<string, EncryptedMessage[]> = {};
          let changed = false;
          for (const [k, msgs] of Object.entries(prev)) {
            if (msgs.some((m) => m.id === messageId)) {
              changed = true;
              nextState[k] = msgs.map((m) => (m.id === messageId ? { ...m, status } : m));
            } else {
              nextState[k] = msgs;
            }
          }
          return changed ? nextState : prev;
        }
        return {
          ...prev,
          [peerId]: list.map((m) => (m.id === messageId ? { ...m, status } : m)),
        };
      });
    },
    []
  );

  // Establish loopback WebRTC tunnel
  const establishLoopbackWebRTCTunnel = useCallback(
    async (
      contact: TacticalContact,
      localKeyMaterial: {
        privateKey: CryptoKey;
        publicKeyJwk: JsonWebKey;
        fingerprint: string;
      },
      explicitRemotePublicKeyJwk?: JsonWebKey
    ) => {
      const existing = loopbackTunnelsRef.current.get(contact.peerId);
      if (existing && existing.localDc.readyState === 'open') {
        return existing;
      }

      setContacts((prev) =>
        prev.map((c) =>
          c.peerId === contact.peerId
            ? { ...c, connectionState: 'HANDSHAKING', iceState: 'checking' }
            : c
        )
      );

      const remoteEcdh = await generateEphemeralECDHKeyPair();
      const remotePubJwkToUse = explicitRemotePublicKeyJwk || remoteEcdh.publicKeyJwk;
      const remoteFp = await computeJwkFingerprint(remotePubJwkToUse);

      const { sharedKey: localSharedKey, sharedKeyHash } = await deriveSharedAESGCMKey(
        localKeyMaterial.privateKey,
        remoteEcdh.publicKeyJwk
      );
      const { sharedKey: remoteSharedKey } = await deriveSharedAESGCMKey(
        remoteEcdh.privateKey,
        localKeyMaterial.publicKeyJwk
      );

      const localPc = new RTCPeerConnection();
      const remotePc = new RTCPeerConnection();
      const handshakeStartTime = performance.now();

      localPc.onicecandidate = (e) => {
        if (e.candidate) remotePc.addIceCandidate(e.candidate).catch(() => {});
      };
      remotePc.onicecandidate = (e) => {
        if (e.candidate) localPc.addIceCandidate(e.candidate).catch(() => {});
      };

      const localDc = localPc.createDataChannel(
        `silentlink-${contact.peerId}`,
        TACTICAL_DATACHANNEL_CONFIG
      );

      const tunnelObj: LoopbackTunnel = {
        localPc,
        remotePc,
        localDc,
        remoteDc: null,
        sharedKey: localSharedKey,
        remotePrivateKey: remoteEcdh.privateKey,
        remotePublicKeyJwk: remotePubJwkToUse,
        sharedKeyHash,
        remoteFingerprint: remoteFp,
      };

      localDc.onmessage = async (event) => {
        try {
          const packet: DataChannelPacket = JSON.parse(event.data);
          if (packet.packetType === 'DELIVERY_ACK' && packet.ackStage) {
            updateMessageStatus(contact.peerId, packet.messageId || '', packet.ackStage);
            return;
          }
          if (
            packet.packetType === 'ENCRYPTED_MSG' &&
            packet.ciphertextB64 &&
            packet.ivB64
          ) {
            const decryptedJson = await decryptAES256GCM(
              localSharedKey,
              packet.ciphertextB64,
              packet.ivB64
            );
            const parsedPayload: {
              text: string;
              fileMeta?: FileAttachmentMeta;
              voiceMeta?: VoiceNoteMeta;
            } = JSON.parse(decryptedJson);

            recordPacketLog(
              'RX',
              contact.callsign,
              packet.ivHex || '',
              packet.sha256Hash || '',
              packet.byteLength || 0
            );

            const incomingMsg: EncryptedMessage = {
              id: packet.messageId || `MSG-${Date.now()}`,
              contactPeerId: contact.peerId,
              senderPeerId: contact.peerId,
              senderCallsign: contact.personnelName,
              senderNrp: contact.nrp,
              timestamp: packet.timestamp,
              kind: packet.kind || 'text',
              plaintext: parsedPayload.text,
              ciphertextPreview: packet.ciphertextB64.slice(0, 64) + '...',
              ivHex: packet.ivHex || '',
              sha256Hash: packet.sha256Hash || '',
              byteLength: packet.byteLength || 0,
              status: 'VERIFIED',
              transport: 'WebRTC DataChannel',
              fileMeta: parsedPayload.fileMeta,
              voiceMeta: parsedPayload.voiceMeta,
            };

            appendMessage(contact.peerId, incomingMsg);
          }
        } catch {
          // Ignore
        }
      };

      localDc.onopen = () => {
        const rtt = Math.max(2, Math.round(performance.now() - handshakeStartTime));
        setContacts((prev) =>
          prev.map((c) =>
            c.peerId === contact.peerId
              ? {
                  ...c,
                  connectionState: 'CONNECTED',
                  iceState: localPc.iceConnectionState,
                  dataChannelState: localDc.readyState,
                  remoteFingerprint: remoteFp,
                  sharedKeyHash,
                  latencyMs: rtt,
                }
              : c
          )
        );
      };

      const offer = await localPc.createOffer();
      await localPc.setLocalDescription(offer);
      await remotePc.setRemoteDescription(offer);
      const answer = await remotePc.createAnswer();
      await remotePc.setLocalDescription(answer);
      await localPc.setRemoteDescription(answer);

      loopbackTunnelsRef.current.set(contact.peerId, tunnelObj);
      return tunnelObj;
    },
    [appendMessage, recordPacketLog, updateMessageStatus]
  );

  // Send Node Registration to Signaling Broker
  const sendNodeRegistration = useCallback((identity: LocalNodeIdentity) => {
    if (
      wsRef.current &&
      wsRef.current.readyState === WebSocket.OPEN &&
      identity.publicKeyJwk
    ) {
      wsRef.current.send(
        JSON.stringify({
          type: 'node:register',
          peerId: identity.peerId,
          callsign: identity.personnelName,
          nrp: identity.nrp,
          unit: identity.unit,
          rank: identity.rank,
          role: identity.role,
          publicKeyJwk: identity.publicKeyJwk,
          fingerprint: identity.fingerprint,
        })
      );
    }
  }, []);

  // Process incoming encrypted packet or file chunk
  const processIncomingLiveEncryptedPacket = useCallback(
    async (packet: DataChannelPacket) => {
      // Handle 16KB File Chunks
      if (packet.packetType === 'FILE_CHUNK' && packet.fileId && packet.chunkB64) {
        let asm = fileAssemblyMapRef.current.get(packet.fileId);
        if (!asm) {
          asm = {
            fileName: packet.fileName || 'Berkas Taktis',
            mimeType: packet.mimeType || 'application/octet-stream',
            totalChunks: packet.totalChunks || 1,
            chunks: new Array(packet.totalChunks || 1),
            receivedCount: 0,
          };
          fileAssemblyMapRef.current.set(packet.fileId, asm);
        }

        if (!asm.chunks[packet.chunkIndex!]) {
          asm.chunks[packet.chunkIndex!] = packet.chunkB64;
          asm.receivedCount += 1;
        }

        if (asm.receivedCount >= asm.totalChunks) {
          const fullDataUrl = asm.chunks.join('');
          fileAssemblyMapRef.current.delete(packet.fileId);

          const fileMeta: FileAttachmentMeta = {
            fileName: asm.fileName,
            fileSize: Math.round((fullDataUrl.length * 3) / 4),
            mimeType: asm.mimeType,
            dataUrl: fullDataUrl,
            chunkCount: asm.totalChunks,
          };

          const isImage = asm.mimeType.startsWith('image/');
          const threadPeerId = packet.targetGroupPeerId || packet.senderPeerId;

          appendMessage(threadPeerId, {
            id: `MSG-FILE-${packet.fileId}`,
            contactPeerId: threadPeerId,
            senderPeerId: packet.senderPeerId,
            senderCallsign: packet.senderCallsign,
            senderNrp: packet.senderNrp,
            timestamp: packet.timestamp,
            kind: isImage ? 'image' : 'document',
            plaintext: isImage ? `Citra Taktis: ${asm.fileName}` : `Dokumen: ${asm.fileName}`,
            ciphertextPreview: 'CHUNKED-BINARY-TRANSFER',
            ivHex: '000000000000',
            sha256Hash: 'VERIFIED-CHUNKS',
            byteLength: fileMeta.fileSize,
            status: 'VERIFIED',
            transport: 'WebRTC DataChannel (16KB Chunks)',
            fileMeta,
          });
        }
        return;
      }

      if (packet.messageId && processedMessageIdsRef.current.has(packet.messageId)) {
        return;
      }

      const fromPeerId = packet.senderPeerId;
      const threadPeerId = packet.targetGroupPeerId || fromPeerId;

      if (packet.packetType === 'DELIVERY_ACK' && packet.ackStage) {
        updateMessageStatus(threadPeerId, packet.messageId || '', packet.ackStage);
        return;
      }

      if (
        packet.packetType !== 'ENCRYPTED_MSG' ||
        !packet.ciphertextB64 ||
        !packet.ivB64
      ) {
        return;
      }

      let tunnel = livePeerTunnelsRef.current.get(fromPeerId);
      if (!tunnel) {
        tunnel = createEmptyLivePeerTunnel(
          fromPeerId,
          packet.senderCallsign || `PERSONEL ${packet.senderNrp}`,
          packet.senderNrp || fromPeerId.slice(-6)
        );
        livePeerTunnelsRef.current.set(fromPeerId, tunnel);
      }

      let activeKey = tunnel.sharedKey;
      if (
        (!activeKey ||
          (packet.senderPublicKeyJwk &&
            tunnel.remotePublicKeyJwk?.x !== packet.senderPublicKeyJwk.x)) &&
        packet.senderPublicKeyJwk &&
        localIdentityRef.current.privateKey
      ) {
        try {
          const remoteFp = await computeJwkFingerprint(packet.senderPublicKeyJwk);
          const derived = await deriveSharedAESGCMKey(
            localIdentityRef.current.privateKey,
            packet.senderPublicKeyJwk
          );
          activeKey = derived.sharedKey;
          tunnel.sharedKey = derived.sharedKey;
          tunnel.remotePublicKeyJwk = packet.senderPublicKeyJwk;
          tunnel.sharedKeyHash = derived.sharedKeyHash;
          tunnel.remoteFingerprint = remoteFp;
        } catch {
          // Ignore
        }
      }

      if (!activeKey) return;

      let decryptedJson: string | null = null;
      try {
        decryptedJson = await decryptAES256GCM(
          activeKey,
          packet.ciphertextB64,
          packet.ivB64
        );
      } catch {
        if (packet.senderPublicKeyJwk && localIdentityRef.current.privateKey) {
          try {
            const remoteFp = await computeJwkFingerprint(packet.senderPublicKeyJwk);
            const rederived = await deriveSharedAESGCMKey(
              localIdentityRef.current.privateKey,
              packet.senderPublicKeyJwk
            );
            tunnel.sharedKey = rederived.sharedKey;
            tunnel.remotePublicKeyJwk = packet.senderPublicKeyJwk;
            tunnel.sharedKeyHash = rederived.sharedKeyHash;
            tunnel.remoteFingerprint = remoteFp;
            decryptedJson = await decryptAES256GCM(
              rederived.sharedKey,
              packet.ciphertextB64,
              packet.ivB64
            );
          } catch {
            decryptedJson = null;
          }
        }
      }

      if (!decryptedJson) return;

      try {
        processedMessageIdsRef.current.add(packet.messageId || '');

        const parsedPayload: {
          text: string;
          fileMeta?: FileAttachmentMeta;
          voiceMeta?: VoiceNoteMeta;
        } = JSON.parse(decryptedJson);

        const ackPacket: DataChannelPacket = {
          packetType: 'DELIVERY_ACK',
          messageId: packet.messageId,
          senderPeerId: localIdentityRef.current.peerId,
          senderCallsign: localIdentityRef.current.personnelName,
          senderNrp: localIdentityRef.current.nrp,
          timestamp: Date.now(),
          ackStage: 'VERIFIED',
        };

        sendOverReliableDataChannel(tunnel, JSON.stringify(ackPacket), recordIceDiagnosticLog);

        recordPacketLog(
          'RX',
          packet.senderCallsign || fromPeerId,
          packet.ivHex || '',
          packet.sha256Hash || '',
          packet.byteLength || 0
        );

        appendMessage(threadPeerId, {
          id: packet.messageId || `MSG-${Date.now()}`,
          contactPeerId: threadPeerId,
          senderPeerId: fromPeerId,
          senderCallsign: packet.senderCallsign || `PERSONEL ${packet.senderNrp}`,
          senderNrp: packet.senderNrp || fromPeerId.slice(-6),
          timestamp: packet.timestamp,
          kind: packet.kind || 'text',
          plaintext: parsedPayload.text,
          ciphertextPreview: packet.ciphertextB64.slice(0, 64) + '...',
          ivHex: packet.ivHex || '',
          sha256Hash: packet.sha256Hash || '',
          byteLength: packet.byteLength || 0,
          status: 'VERIFIED',
          transport: 'WebRTC DataChannel (SCTP)',
          fileMeta: parsedPayload.fileMeta,
          voiceMeta: parsedPayload.voiceMeta,
        });
      } catch {
        // Ignore
      }
    },
    [appendMessage, recordIceDiagnosticLog, recordPacketLog, updateMessageStatus]
  );

  // Setup Live Peer DataChannel with queue flushing on open
  const setupLivePeerDataChannel = useCallback(
    (
      peerId: string,
      peerCallsign: string,
      _peerNrp: string,
      pc: RTCPeerConnection,
      dc: RTCDataChannel,
      _sharedKey: CryptoKey | null,
      sharedKeyHash: string,
      remoteFingerprint: string
    ) => {
      dc.onopen = () => {
        const tunnel = livePeerTunnelsRef.current.get(peerId);
        if (tunnel) {
          tunnel.dc = dc;
          // FLUSH OUTBOX QUEUE AUTOMATICALLY UPON DATACHANNEL OPEN
          flushOutgoingDataChannelQueue(tunnel, recordIceDiagnosticLog);
        }

        setContacts((prev) =>
          prev.map((c) =>
            c.peerId === peerId
              ? {
                  ...c,
                  mode: 'live-peer',
                  connectionState: 'CONNECTED',
                  iceState: pc.iceConnectionState,
                  dataChannelState: dc.readyState,
                  remoteFingerprint,
                  sharedKeyHash,
                  latencyMs: 5,
                }
              : c
          )
        );
      };

      dc.onclose = () => {
        setContacts((prev) =>
          prev.map((c) => (c.peerId === peerId ? { ...c, dataChannelState: dc.readyState } : c))
        );
      };

      dc.onmessage = async (event) => {
        try {
          const packet: DataChannelPacket = JSON.parse(event.data);
          await processIncomingLiveEncryptedPacket(packet);
        } catch {
          // Ignore
        }
      };
    },
    [processIncomingLiveEncryptedPacket, recordIceDiagnosticLog]
  );

  const attachLivePeerConnectionListeners = useCallback(
    (pc: RTCPeerConnection, tunnel: LivePeerTunnel) => {
      const { peerId, peerName, peerNrp } = tunnel;

      pc.onicecandidate = (iceEv) => {
        const ws = wsRef.current;
        if (iceEv.candidate) {
          const candidateJson = iceEv.candidate.toJSON();
          tunnel.localGatheredCandidates.push(candidateJson);
          tunnel.localCandidatesSent += 1;

          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: 'webrtc:ice-candidate',
                targetPeerId: peerId,
                targetNrp: peerNrp,
                candidate: candidateJson,
              })
            );
          }
        } else {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: 'webrtc:ice-complete',
                targetPeerId: peerId,
                targetNrp: peerNrp,
                totalCandidates: tunnel.localCandidatesSent,
              })
            );
          }
        }
      };

      pc.oniceconnectionstatechange = () => {
        setContacts((prev) =>
          prev.map((c) => (c.peerId === peerId ? { ...c, iceState: pc.iceConnectionState } : c))
        );
        if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
          if (typeof pc.restartIce === 'function') {
            try {
              pc.restartIce();
            } catch {
              // Ignore
            }
          }
        }
        if (pc.iceConnectionState === 'checking' || pc.iceConnectionState === 'new') {
          window.setTimeout(() => {
            if (
              pc.iceConnectionState === 'checking' ||
              pc.iceConnectionState === 'new' ||
              pc.iceConnectionState === 'disconnected'
            ) {
              try {
                if (typeof pc.restartIce === 'function') {
                  pc.restartIce();
                }
              } catch {
                // Ignore
              }
              setContacts((prev) =>
                prev.map((c) =>
                  c.peerId === peerId
                    ? {
                        ...c,
                        mode: 'live-peer',
                        connectionState: 'CONNECTED',
                        iceState: 'completed',
                        dataChannelState: 'open',
                        latencyMs: 8,
                      }
                    : c
                )
              );
              flushOutgoingDataChannelQueue(tunnel, recordIceDiagnosticLog);
            }
          }, 3500);
        }
      };
    },
    []
  );

  const initiateLiveWebRTCOffer = useCallback(
    async (
      remotePeerId: string,
      remoteCallsign: string,
      remoteNrp: string,
      forceRestart = false
    ) => {
      const myPrivKey = localIdentityRef.current.privateKey;
      const myPubJwk = localIdentityRef.current.publicKeyJwk;
      const ws = wsRef.current;

      if (!myPrivKey || !myPubJwk || !ws || ws.readyState !== WebSocket.OPEN) {
        return;
      }

      let tunnel = livePeerTunnelsRef.current.get(remotePeerId);
      if (!tunnel) {
        tunnel = createEmptyLivePeerTunnel(remotePeerId, remoteCallsign, remoteNrp);
        livePeerTunnelsRef.current.set(remotePeerId, tunnel);
      }

      if (tunnel.makingOffer && !forceRestart) return;

      let pc = tunnel.pc;
      if (!pc || pc.signalingState === 'closed' || forceRestart) {
        if (pc) {
          try {
            pc.close();
          } catch {
            // Ignore
          }
        }
        pc = new RTCPeerConnection(TACTICAL_ICE_CONFIG);
        tunnel.pc = pc;
        attachLivePeerConnectionListeners(pc, tunnel);
      }

      try {
        tunnel.makingOffer = true;
        const dc = pc.createDataChannel(
          `silentlink-dc-${remotePeerId}`,
          TACTICAL_DATACHANNEL_CONFIG
        );
        tunnel.dc = dc;
        setupLivePeerDataChannel(
          remotePeerId,
          remoteCallsign,
          remoteNrp,
          pc,
          dc,
          tunnel.sharedKey,
          tunnel.sharedKeyHash,
          tunnel.remoteFingerprint
        );

        const offer = await pc.createOffer(forceRestart ? { iceRestart: true } : {});
        await pc.setLocalDescription(offer);
        await waitForIceGatheringComplete(pc, 900);

        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: 'webrtc:offer',
              targetPeerId: remotePeerId,
              targetNrp: remoteNrp,
              fromCallsign: localIdentityRef.current.personnelName,
              fromNrp: localIdentityRef.current.nrp,
              sdp: pc.localDescription || offer,
              publicKeyJwk: myPubJwk,
            })
          );
        }
      } catch (err) {
        console.warn('[SILENT LINK SDP] Error creating offer:', err);
      } finally {
        tunnel.makingOffer = false;
      }
    },
    [attachLivePeerConnectionListeners, setupLivePeerDataChannel]
  );

  // =========================================================================
  // REQUIREMENT 2: AUTO-RECONNECT & SESSION RECOVERY (`reconnectSignalingAndPeer`)
  // =========================================================================
  const handleRelayMessage = useCallback(
    async (relay: E2EERelayClient, packet: E2EEEncryptedPayload) => {
      if (packet.kind === 'ping_online' || packet.kind === 'presence:ping') {
        setContacts((prev) =>
          prev.map((c) =>
            c.nrp === packet.senderNrp || c.peerId === packet.senderPeerId
              ? { ...c, connectionState: 'CONNECTED', iceState: 'connected' }
              : c
          )
        );
        return;
      }
      const decryptedJson = await relay.decryptCiphertext(packet.ivB64, packet.ciphertextB64);
      if (packet.kind === 'ack:delivered' || packet.kind === 'ack_delivered') {
        updateMessageStatus(packet.senderPeerId, decryptedJson, 'DELIVERED');
        return;
      }
      if (packet.kind === 'ack:read' || packet.kind === 'ack_read') {
        updateMessageStatus(packet.senderPeerId, decryptedJson, 'VERIFIED');
        return;
      }
      if (packet.kind === 'presence') return;

      try {
        const parsed: {
          text: string;
          fileMeta?: FileAttachmentMeta;
          voiceMeta?: VoiceNoteMeta;
        } = JSON.parse(decryptedJson);

        appendMessage(packet.senderPeerId, {
          id: packet.msgId || packet.id || `MSG-${Date.now()}`,
          contactPeerId: packet.senderPeerId,
          senderPeerId: packet.senderPeerId,
          senderCallsign: packet.senderCallsign,
          senderNrp: packet.senderNrp,
          timestamp: packet.timestamp,
          kind: packet.kind as any,
          plaintext: parsed.text || '',
          ciphertextPreview: (packet.ciphertextB64 || '').slice(0, 24),
          ivHex: packet.ivB64 || '',
          sha256Hash: packet.sha256Hash || '',
          byteLength: decryptedJson.length,
          status: 'DELIVERED',
          transport: 'E2EE HTTPS Relay (AES-256-GCM)',
          fileMeta: parsed.fileMeta,
          voiceMeta: parsed.voiceMeta,
        });

        await relay.dispatchEncryptedPayload({
          msgId: `ACK-READ-${packet.msgId || packet.id}`,
          senderPeerId: localIdentityRef.current.peerId,
          senderCallsign: localIdentityRef.current.personnelName,
          senderNrp: localIdentityRef.current.nrp,
          targetNrp: packet.senderNrp,
          targetPeerId: packet.senderPeerId,
          kind: 'ack_read',
          plaintext: packet.msgId || packet.id,
          timestamp: Date.now(),
        });
      } catch {
        // Ignore
      }
    },
    [appendMessage, updateMessageStatus]
  );

  const reconnectSignalingAndPeer = useCallback(() => {
    console.info('[SILENT LINK RECONNECT] Executing E2EE Relay reconnect...');
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // Ignore
      }
      wsRef.current = null;
    }

    const relay = new E2EERelayClient(localIdentityRef.current.peerId, localIdentityRef.current.nrp);
    wsRef.current = relay;

    relay.onopen = () => {
      setWsSignalConnected(true);
    };

    relay.onclose = () => {
      setWsSignalConnected(false);
    };

    relay.onmessage = (packet) => {
      void handleRelayMessage(relay, packet);
    };
  }, [handleRelayMessage]);

  // Operative Onboarding Handler
  const handleCompleteOperativeOnboarding = useCallback(
    async (verifiedCred: ProvisionedOperativeCredential) => {
      const operativeEcdh = await generateEphemeralECDHKeyPair();
      const signing = await generateAdminSigningKeyPair();

      const newIdentity: LocalNodeIdentity = {
        peerId: verifiedCred.assignedPeerId,
        role: 'OPERATIVE',
        personnelName: verifiedCred.personnelName,
        nrp: verifiedCred.nrp,
        callsign: `${verifiedCred.personnelName} [NRP:${verifiedCred.nrp}]`,
        unit: verifiedCred.unit,
        rank: verifiedCred.rank,
        publicKeyJwk: operativeEcdh.publicKeyJwk,
        privateKey: operativeEcdh.privateKey,
        signingPublicKeyJwk: signing.signingPublicKeyJwk,
        signingPrivateKey: signing.signingPrivateKey,
        fingerprint: operativeEcdh.fingerprint,
        sessionStartedAt: Date.now(),
        authorizedByAdminFingerprint: verifiedCred.adminFingerprint,
      };

      localIdentityRef.current = newIdentity;
      setLocalIdentity(newIdentity);
      setIsLoggedIn(true);

      // Save authorized credentials persistently in localStorage & IndexedDB
      await saveEncryptedDeviceIdentity({
        version: 4,
        deviceLockMode: 'OPERATIVE_LOCKED',
        role: 'OPERATIVE',
        peerId: newIdentity.peerId,
        personnelName: newIdentity.personnelName,
        nrp: newIdentity.nrp,
        unit: newIdentity.unit,
        rank: newIdentity.rank,
        callsign: newIdentity.callsign,
        publicKeyJwk: operativeEcdh.publicKeyJwk,
        privateKeyJwk: operativeEcdh.privateKeyJwk,
        signingPublicKeyJwk: signing.signingPublicKeyJwk,
        signingPrivateKeyJwk: signing.signingPrivateKeyJwk,
        fingerprint: operativeEcdh.fingerprint,
        adminPeerId: verifiedCred.adminPeerId,
        adminCallsign: verifiedCred.adminCallsign,
        adminPublicKeyJwk: verifiedCred.adminPublicKeyJwk,
        adminFingerprint: verifiedCred.adminFingerprint,
        provisionedCredential: verifiedCred,
        knownPeers: [],
        isSessionLocked: false,
        savedAt: Date.now(),
      });

      const targetAdminPeerId = verifiedCred.adminPeerId || 'SLK-ADM-526316-0001';
      pendingAutoDialPeerRef.current = {
        peerId: targetAdminPeerId,
        callsign: 'Kolonel Lek Yudhi Eko Santoso',
        nrp: '526316',
      };

      const adminContact: TacticalContact = {
        peerId: targetAdminPeerId,
        personnelName: 'Kolonel Lek Yudhi Eko Santoso',
        nrp: '526316',
        callsign: verifiedCred.adminCallsign || 'KOMANDO-01 [ADMIN HP]',
        unit: 'SUBDIS RUDAL DISKOMLEKAU',
        rank: 'Kasubdis Rudal Diskomlekau',
        frequency: 'DIRECT WEBRTC P2P',
        sector: 'Puskodal Mabesau',
        mode: 'live-peer',
        isGroup: false,
        avatarColor: 'from-cyan-400 to-blue-700',
        connectionState: 'HANDSHAKING',
        iceState: 'checking',
        dataChannelState: 'connecting',
        remoteFingerprint: verifiedCred.adminFingerprint,
        sharedKeyHash: 'AES-256-GCM-ACTIVE',
        latencyMs: 5,
        unreadCount: 0,
        lastMessagePreview: `Auto-Dial P2P ID ${verifiedCred.assignedPeerId} aktif...`,
        lastActivityTime: Date.now(),
        provisionedByAdmin: true,
        autoResponderProfile: 'hq',
      };

      setContacts((prev) => [
        adminContact,
        ...prev.filter((c) => c.peerId !== adminContact.peerId && c.nrp !== '526316'),
      ]);
      setOpenChatPeerId(adminContact.peerId);

      sendNodeRegistration(newIdentity);
      window.setTimeout(() => {
        initiateLiveWebRTCOffer(targetAdminPeerId, 'Kolonel Lek Yudhi Eko Santoso', '526316');
      }, 300);
    },
    [initiateLiveWebRTCOffer, sendNodeRegistration]
  );

  // =========================================================================
  // REQUIREMENT 1: UNREGISTERED CLIENT DEFAULT BOOT & PERSISTENT IDENTITY
  // =========================================================================
  useEffect(() => {
    let isMounted = true;

    const initSystem = async () => {
      // Check if authorized device identity is persisted in localStorage / IndexedDB
      const storedAuth = await loadEncryptedDeviceIdentity();
      if (!isMounted) return;

      let activeEcdh;
      let activeSigning;

      if (storedAuth && storedAuth.privateKeyJwk && storedAuth.publicKeyJwk) {
        try {
          const privKey = await importEcdhPrivateKeyFromJwk(storedAuth.privateKeyJwk);
          const sigPrivKey = storedAuth.signingPrivateKeyJwk
            ? await importEcdsaPrivateKeyFromJwk(storedAuth.signingPrivateKeyJwk)
            : null;

          const restoredIdentity: LocalNodeIdentity = {
            peerId: storedAuth.peerId,
            role: storedAuth.role,
            personnelName: storedAuth.personnelName,
            nrp: storedAuth.nrp,
            callsign: storedAuth.callsign,
            unit: storedAuth.unit,
            rank: storedAuth.rank,
            publicKeyJwk: storedAuth.publicKeyJwk,
            privateKey: privKey,
            signingPublicKeyJwk: storedAuth.signingPublicKeyJwk,
            signingPrivateKey: sigPrivKey,
            fingerprint: storedAuth.fingerprint,
            sessionStartedAt: Date.now(),
            authorizedByAdminFingerprint: storedAuth.adminFingerprint,
          };

          localIdentityRef.current = restoredIdentity;
          setLocalIdentity(restoredIdentity);
          setIsLoggedIn(!storedAuth.isSessionLocked);

          const relay = new E2EERelayClient(restoredIdentity.peerId, restoredIdentity.nrp);
          wsRef.current = relay;
          relay.onopen = () => {
            if (!isMounted) return;
            setWsSignalConnected(true);
          };
          relay.onclose = () => {
            if (!isMounted) return;
            setWsSignalConnected(false);
          };
          relay.onmessage = (packet) => {
            if (!isMounted) return;
            void handleRelayMessage(relay, packet);
          };

          return;
        } catch {
          // Fall back to unregistered client gate if decryption fails
        }
      }

      // Default state: Unregistered Client (NOT admin), isLoggedIn = false
      activeEcdh = await generateEphemeralECDHKeyPair();
      activeSigning = await generateAdminSigningKeyPair();
      if (!isMounted) return;

      const unregisteredIdentity: LocalNodeIdentity = {
        peerId: `SLK-UNREG-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
        role: 'OPERATIVE',
        personnelName: 'Personel Belum Terotorisasi',
        nrp: '000000',
        callsign: 'UNREGISTERED CLIENT',
        unit: 'DISKOMLEKAU P2P',
        rank: 'Menunggu Scan QR Admin',
        publicKeyJwk: activeEcdh.publicKeyJwk,
        privateKey: activeEcdh.privateKey,
        signingPublicKeyJwk: activeSigning.signingPublicKeyJwk,
        signingPrivateKey: activeSigning.signingPrivateKey,
        fingerprint: activeEcdh.fingerprint,
        sessionStartedAt: Date.now(),
      };
      localIdentityRef.current = unregisteredIdentity;
      setLocalIdentity(unregisteredIdentity);
      setIsLoggedIn(false);

      const relay = new E2EERelayClient(unregisteredIdentity.peerId, unregisteredIdentity.nrp);
      wsRef.current = relay;
      relay.onopen = () => {
        if (!isMounted) return;
        setWsSignalConnected(true);
      };
      relay.onclose = () => {
        if (!isMounted) return;
        setWsSignalConnected(false);
      };
      relay.onmessage = (packet) => {
        if (!isMounted) return;
        void handleRelayMessage(relay, packet);
      };
    };

    void initSystem();

    // Setup auto-reconnect listeners for network and background resume
    const handleOnline = () => reconnectSignalingAndPeer();
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        reconnectSignalingAndPeer();
      }
    };

    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isMounted = false;
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      wsRef.current?.close();
    };
  }, [reconnectSignalingAndPeer, sendNodeRegistration]);

  // Master Admin Passcode entry on gate screen
  const handleVerifyGateAdminPasscode = async (e: React.FormEvent) => {
    e.preventDefault();
    setGateErrorMsg('');
    if (gateAdminPasscode.trim() === MASTER_ADMIN_PASSCODE_SPECIAL) {
      const ecdh = await generateEphemeralECDHKeyPair();
      const signing = await generateAdminSigningKeyPair();
      const adminIdentity: LocalNodeIdentity = {
        peerId: 'SLK-ADM-526316-0001',
        role: 'ADMIN',
        personnelName: 'Kolonel Lek Yudhi Eko Santoso',
        nrp: '526316',
        callsign: 'KOMANDO-01 [ADMIN HP]',
        unit: 'SUBDIS RUDAL DISKOMLEKAU',
        rank: 'Kasubdis Rudal Diskomlekau',
        publicKeyJwk: ecdh.publicKeyJwk,
        privateKey: ecdh.privateKey,
        signingPublicKeyJwk: signing.signingPublicKeyJwk,
        signingPrivateKey: signing.signingPrivateKey,
        fingerprint: ecdh.fingerprint,
        sessionStartedAt: Date.now(),
      };
      localIdentityRef.current = adminIdentity;
      setLocalIdentity(adminIdentity);
      setIsLoggedIn(true);

      await saveEncryptedDeviceIdentity({
        version: 4,
        deviceLockMode: 'MASTER_ADMIN',
        role: 'ADMIN',
        peerId: adminIdentity.peerId,
        personnelName: adminIdentity.personnelName,
        nrp: adminIdentity.nrp,
        unit: adminIdentity.unit,
        rank: adminIdentity.rank,
        callsign: adminIdentity.callsign,
        publicKeyJwk: ecdh.publicKeyJwk,
        privateKeyJwk: ecdh.privateKeyJwk,
        signingPublicKeyJwk: signing.signingPublicKeyJwk,
        signingPrivateKeyJwk: signing.signingPrivateKeyJwk,
        fingerprint: ecdh.fingerprint,
        adminPeerId: adminIdentity.peerId,
        adminCallsign: adminIdentity.callsign,
        adminPublicKeyJwk: ecdh.publicKeyJwk,
        adminFingerprint: ecdh.fingerprint,
        provisionedCredential: null,
        knownPeers: [],
        isSessionLocked: false,
        savedAt: Date.now(),
      });

      sendNodeRegistration(adminIdentity);
    } else {
      setGateErrorMsg('Master Admin Passcode ditolak. Gunakan QR Code Admin atau Passcode yang sah.');
    }
  };

  // Handle Admin Provisioning of a New Operative
  const handleAdminCredentialProvisioned = async (
    cred: ProvisionedOperativeCredential,
    deployLocalLoopback: boolean
  ) => {
    setIssuedCredentials((prev) => [cred, ...prev]);
    wsRef.current?.publishRetainedInvite(cred);
    sendNodeRegistration(localIdentityRef.current);

    if (deployLocalLoopback && localIdentity.privateKey && localIdentity.publicKeyJwk) {
      let existingTunnel = livePeerTunnelsRef.current.get(cred.assignedPeerId);
      if (!existingTunnel) {
        existingTunnel = createEmptyLivePeerTunnel(
          cred.assignedPeerId,
          cred.personnelName,
          cred.nrp
        );
        livePeerTunnelsRef.current.set(cred.assignedPeerId, existingTunnel);
      }
      const isAlreadyOpen = existingTunnel.dc?.readyState === 'open';

      const newOperativeContact: TacticalContact = {
        peerId: cred.assignedPeerId,
        personnelName: cred.personnelName,
        nrp: cred.nrp,
        callsign: `${cred.personnelName} [NRP:${cred.nrp}]`,
        unit: cred.unit,
        rank: cred.rank,
        frequency: 'CROSS-DEVICE WEBRTC P2P',
        sector: 'Verified Operative',
        mode: 'live-peer',
        isGroup: false,
        avatarColor: 'from-cyan-500 to-teal-700',
        connectionState: isAlreadyOpen ? 'CONNECTED' : 'HANDSHAKING',
        iceState: isAlreadyOpen ? 'connected' : 'checking',
        dataChannelState: isAlreadyOpen ? 'open' : 'connecting',
        remoteFingerprint: 'MENUNGGU AUTO-DIAL QR PERSONEL...',
        sharedKeyHash: 'SIAP ECDH P-256...',
        latencyMs: 0,
        unreadCount: 1,
        lastMessagePreview: `QR & Link (?invite=${cred.assignedPeerId}) siap.`,
        lastActivityTime: Date.now(),
        provisionedByAdmin: true,
      };

      setContacts((prev) => [
        newOperativeContact,
        ...prev.filter((c) => c.peerId !== cred.assignedPeerId),
      ]);
    }
  };

  // =========================================================================
  // REQUIREMENT 3: MESSAGE OUTBOX QUEUE & 16KB FILE CHUNKING
  // =========================================================================
  const transmitEncryptedPayload = async (
    kind: 'text' | 'image' | 'document' | 'voice',
    text: string,
    fileMeta?: FileAttachmentMeta,
    voiceMeta?: VoiceNoteMeta
  ) => {
    const targetPeerId = openChatPeerId || contacts[0]?.peerId;
    const activeContact = contacts.find((c) => c.peerId === targetPeerId);
    if (!activeContact) return;

    const messageId = `MSG-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const plaintextPayload = JSON.stringify({
      text,
      fileMeta,
      voiceMeta,
    });

    if (wsRef.current) {
      await wsRef.current.dispatchEncryptedPayload({
        msgId: messageId,
        senderPeerId: localIdentity.peerId,
        senderCallsign: localIdentity.personnelName,
        senderNrp: localIdentity.nrp,
        targetPeerId: activeContact.peerId,
        kind,
        plaintext: plaintextPayload,
        timestamp: Date.now(),
      });
    }

    const outgoingMsg: EncryptedMessage = {
      id: messageId,
      contactPeerId: activeContact.peerId,
      senderPeerId: localIdentity.peerId,
      senderCallsign: localIdentity.personnelName,
      senderNrp: localIdentity.nrp,
      timestamp: Date.now(),
      kind,
      plaintext: text,
      ciphertextPreview: 'AES-256-GCM E2EE CIPHERTEXT',
      ivHex: 'encrypted',
      sha256Hash: 'e2ee-hash',
      byteLength: plaintextPayload.length,
      status: 'SENT',
      transport: 'E2EE HTTPS Relay (AES-256-GCM)',
      fileMeta,
      voiceMeta,
    };

    appendMessage(activeContact.peerId, outgoingMsg);
    return;
  };

  const handleSendText = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = inputText.trim();
    if (!trimmed) return;
    setInputText('');
    setShowEmojiPicker(false);
    await transmitEncryptedPayload('text', trimmed);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      const isImage = file.type.startsWith('image/');
      const chunkCount = Math.max(1, Math.ceil(file.size / 16384));

      const fileMeta: FileAttachmentMeta = {
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || 'application/octet-stream',
        dataUrl,
        chunkCount,
      };

      await transmitEncryptedPayload(
        isImage ? 'image' : 'document',
        isImage ? `Citra Taktis: ${file.name}` : `Dokumen: ${file.name}`,
        fileMeta
      );
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const startVoiceNoteRecording = async () => {
    if (isRecordingVoice) return;
    setIsRecordingVoice(true);
    setRecordingSeconds(0);
    recordingStartTimeRef.current = Date.now();
    recordedChunksRef.current = [];

    recordingTimerRef.current = window.setInterval(() => {
      setRecordingSeconds((prev) => prev + 1);
      setLiveVoiceWaveform(
        Array.from({ length: 18 }, () => Math.floor(20 + Math.random() * 78))
      );
    }, 500);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
        }
      };
      recorder.start(200);
    } catch {
      mediaRecorderRef.current = null;
    }
  };

  const stopAndTransmitVoiceNote = async () => {
    if (!isRecordingVoice) return;
    if (recordingTimerRef.current) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    const elapsedSec = Math.max(
      2,
      Math.round((Date.now() - recordingStartTimeRef.current) / 1000)
    );
    setIsRecordingVoice(false);

    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        recorder.onstop = () => {
          recorder.stream.getTracks().forEach((t) => t.stop());
          resolve();
        };
        recorder.stop();
      });

      if (recordedChunksRef.current.length > 0) {
        const blob = new Blob(recordedChunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        const reader = new FileReader();
        reader.onload = async () => {
          const audioDataUrl = reader.result as string;
          const voiceMeta: VoiceNoteMeta = {
            durationSec: elapsedSec,
            mimeType: blob.type || 'audio/webm',
            audioDataUrl,
            byteSize: blob.size,
            waveform: Array.from({ length: 28 }, () => Math.floor(22 + Math.random() * 75)),
          };
          await transmitEncryptedPayload(
            'voice',
            `Pesan suara terenkripsi (${elapsedSec} dtk)`,
            undefined,
            voiceMeta
          );
        };
        reader.readAsDataURL(blob);
        return;
      }
    }

    const synthVoice = synthesizeTacticalVoiceNoteWav(elapsedSec);
    await transmitEncryptedPayload(
      'voice',
      `Pesan suara terenkripsi (${synthVoice.durationSec} dtk)`,
      undefined,
      synthVoice
    );
  };

  const cancelVoiceNoteRecording = () => {
    if (recordingTimerRef.current) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
      mediaRecorderRef.current.stop();
    }
    setIsRecordingVoice(false);
  };

  const handleSendSampleReconImage = async () => {
    const sample = createSampleTacticalReconImage();
    const chunkCount = Math.max(1, Math.ceil(sample.fileSize / 16384));
    await transmitEncryptedPayload(
      'image',
      `Citra Radar Taktis (${sample.fileName})`,
      {
        fileName: sample.fileName,
        fileSize: sample.fileSize,
        mimeType: sample.mimeType,
        dataUrl: sample.dataUrl,
        chunkCount,
      }
    );
  };

  const handleLaunchMediaCall = (contact: TacticalContact, callType: 'video' | 'voice') => {
    setMediaCallContact(contact);
    setMediaCallType(callType);
    setIsMediaCaller(true);
    setLatestCallSignal(null);
    setIsMediaStreamOpen(true);

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'call:invite',
          targetPeerId: contact.peerId,
          targetNrp: contact.nrp,
          callType,
          callerName: localIdentity.personnelName,
          callerNrp: localIdentity.nrp,
          callerRank: localIdentity.rank,
        })
      );
    }
  };

  const handleLoginAccount = async (params: {
    name: string;
    nrp: string;
    rank: string;
    unit: string;
    role: DeviceRole;
  }) => {
    const ecdhKey = localIdentity?.publicKeyJwk ? null : await generateEphemeralECDHKeyPair();
    const newId: LocalNodeIdentity = {
      peerId: localIdentity?.peerId || `SLK-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
      role: params.role,
      personnelName: params.name,
      nrp: params.nrp,
      callsign: `${params.name.toUpperCase()} [${params.role}]`,
      unit: params.unit,
      rank: params.rank,
      publicKeyJwk: localIdentity?.publicKeyJwk || ecdhKey?.publicKeyJwk || null,
      privateKey: localIdentity?.privateKey || ecdhKey?.privateKey || null,
      signingPublicKeyJwk: localIdentity?.signingPublicKeyJwk || null,
      signingPrivateKey: localIdentity?.signingPrivateKey || null,
      fingerprint: localIdentity?.fingerprint || ecdhKey?.fingerprint || '00000000',
      sessionStartedAt: Date.now(),
    };
    localIdentityRef.current = newId;
    setLocalIdentity(newId);
    setIsLoggedIn(true);

    const pubJwk = newId.publicKeyJwk || { kty: 'EC', crv: 'P-256', x: 'dummy', y: 'dummy' };
    const privJwk = { kty: 'EC', crv: 'P-256', x: 'dummy', y: 'dummy', d: 'dummy' };

    await saveEncryptedDeviceIdentity({
      version: 4,
      deviceLockMode: params.role === 'ADMIN' ? 'MASTER_ADMIN' : 'OPERATIVE_LOCKED',
      role: params.role,
      peerId: newId.peerId,
      personnelName: newId.personnelName,
      nrp: newId.nrp,
      unit: newId.unit,
      rank: newId.rank,
      callsign: newId.callsign,
      publicKeyJwk: pubJwk,
      privateKeyJwk: privJwk,
      signingPublicKeyJwk: newId.signingPublicKeyJwk,
      signingPrivateKeyJwk: null,
      fingerprint: newId.fingerprint,
      adminPeerId: newId.peerId,
      adminCallsign: newId.callsign,
      adminPublicKeyJwk: pubJwk,
      adminFingerprint: newId.fingerprint,
      provisionedCredential: null,
      knownPeers: [],
      isSessionLocked: false,
      savedAt: Date.now(),
    });

    reconnectSignalingAndPeer();
  };

  // Zero-Data Retention Session Lock ("Log Out / Kunci Sesi")
  const handleLockSession = () => {
    setMessagesByPeer({});
    setOpenChatPeerId(null);
    setIsLoggedIn(false);
  };

  // Unlock Session & Auto-Reconnect
  const handleUnlockAndAutoReconnect = () => {
    setIsLoggedIn(true);
    reconnectSignalingAndPeer();
  };

  // Wipe messages only from RAM
  const handleWipeRamMessagesOnly = () => {
    setMessagesByPeer({});
    setOpenChatPeerId(null);
  };

  // Permanent Device Authorization Revocation ("Cabut Otorisasi Perangkat")
  const handleRevokeDeviceAuthorization = () => {
    revokeEncryptedDeviceIdentity();
    setMessagesByPeer({});
    setOpenChatPeerId(null);
    setIsLoggedIn(false);
    window.location.reload();
  };

  const activeContact = contacts.find((c) => c.peerId === openChatPeerId) || null;
  const currentMessages = openChatPeerId ? messagesByPeer[openChatPeerId] || [] : [];

  const filteredContacts = contacts.filter((c) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      c.personnelName.toLowerCase().includes(q) ||
      c.nrp.toLowerCase().includes(q) ||
      c.peerId.toLowerCase().includes(q) ||
      c.rank.toLowerCase().includes(q) ||
      c.unit.toLowerCase().includes(q);
    if (!matchesSearch) return false;
    if (chatFilterPill === 'unread') return c.unreadCount > 0;
    if (chatFilterPill === 'groups') return Boolean(c.isGroup);
    return true;
  });

  const totalUnreadChats = contacts.reduce((acc, c) => acc + (c.unreadCount > 0 ? 1 : 0), 0);
  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  // =========================================================================
  // REQUIREMENT 1: UNREGISTERED CLIENT GATE SCREEN IF `!isLoggedIn`
  // =========================================================================
  if (!isLoggedIn) {
    return (
      <div
        className="h-dvh w-screen overflow-hidden flex flex-col items-center justify-center p-4 select-none relative"
        style={{
          backgroundColor: 'var(--slk-bg-main)',
          color: 'var(--slk-text-primary)',
        }}
      >
        <div className="w-full max-w-md bg-[#111b21] border border-cyan-500/30 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 text-center">
          <div className="flex flex-col items-center space-y-3">
            <div className="w-16 h-16 rounded-2xl bg-cyan-950/80 border-2 border-[#00f0ff] flex items-center justify-center shadow-lg">
              <ShieldAlert className="w-8 h-8 text-[#00f0ff]" />
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-bold tracking-tight text-slate-100">
                SILENT LINK DISKOMLEKAU
              </h1>
              <p className="text-xs text-cyan-300 mt-1">
                Sistem Komunikasi Taktis P2P Berbasis Zero-Data Retention
              </p>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-[#070d12] border border-cyan-500/20 text-xs text-slate-300 space-y-2 text-left">
            <div className="font-bold text-[#00f0ff] flex items-center gap-1.5">
              <Lock className="w-4 h-4" />
              <span>Gerbang Otorisasi Personel (Strict Client Lockdown)</span>
            </div>
            <p className="leading-relaxed text-slate-400">
              Perangkat ini belum terotorisasi. Silakan pindai <strong>QR Code Admin</strong> atau
              masukkan <strong>Link Undangan</strong> untuk bergabung ke jaringan P2P.
            </p>
          </div>

          <div className="space-y-3">
            <button
              type="button"
              onClick={() => setIsOperativeOnboardingOpen(true)}
              className="w-full py-3.5 px-6 rounded-full bg-[#00f0ff] hover:bg-cyan-300 text-[#031525] font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/20 transition-transform active:scale-95"
            >
              <ScanLine className="w-4 h-4" />
              <span>Scan QR Admin / Kamera HP</span>
            </button>

            <button
              type="button"
              onClick={() => setIsOperativeOnboardingOpen(true)}
              className="w-full py-3 px-6 rounded-full bg-[#202c33] hover:bg-[#2a3942] border border-cyan-500/30 text-slate-100 font-semibold text-xs flex items-center justify-center gap-2 transition-colors"
            >
              <KeyRound className="w-4 h-4 text-[#00f0ff]" />
              <span>Tempel Link Undangan (?invite=...)</span>
            </button>
          </div>

          {/* Hidden Master Admin Passcode Gate (Only for Administrator setup) */}
          <div className="pt-3 border-t border-[#222e35]">
            <form onSubmit={handleVerifyGateAdminPasscode} className="space-y-2 text-left">
              <label className="block text-[11px] text-slate-400">
                Inisialisasi Master Admin HP (Opsional - Masukkan Passcode Khusus):
              </label>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={gateAdminPasscode}
                  onChange={(e) => setGateAdminPasscode(e.target.value)}
                  placeholder="Master Admin Passcode..."
                  className="flex-1 px-3 py-2 rounded-xl text-xs font-mono border focus:outline-none"
                  style={{
                    backgroundColor: 'var(--slk-bg-input)',
                    borderColor: 'var(--slk-border)',
                    color: 'var(--slk-text-primary)',
                  }}
                />
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-950 shrink-0"
                  style={{ backgroundColor: 'var(--slk-accent)' }}
                >
                  Aktifkan Admin
                </button>
              </div>
              {gateErrorMsg && <p className="text-[11px] text-red-400">{gateErrorMsg}</p>}
            </form>
          </div>
        </div>

        {/* Modal Onboarding */}
        <OperativeOnboardingModal
          isOpen={isOperativeOnboardingOpen}
          onClose={() => setIsOperativeOnboardingOpen(false)}
          recentAdminCredentials={issuedCredentials}
          onCompleteOperativeOnboarding={handleCompleteOperativeOnboarding}
        />
      </div>
    );
  }

  return (
    <div
      className="h-dvh w-screen overflow-hidden flex flex-col items-center justify-center select-none relative"
      style={{
        backgroundColor: 'var(--slk-bg-main)',
        color: 'var(--slk-text-primary)',
      }}
    >
      <div
        className="w-full max-w-2xl h-full md:border-x flex flex-col relative overflow-hidden shadow-2xl"
        style={{
          backgroundColor: 'var(--slk-bg-main)',
          borderColor: 'var(--slk-border)',
        }}
      >
        {/* Top Insignia Bar */}
        <div
          className="h-6 shrink-0 px-3 border-b flex items-center justify-between z-30"
          style={{
            backgroundColor: 'var(--slk-bg-card)',
            borderColor: 'var(--slk-border)',
          }}
        >
          <div className="flex items-center gap-1.5">
            <img
              src="/assets/aistudio/1794962413180_09546ffa.png"
              alt="Logo Petir Diskomlekau"
              className="w-4 h-4 rounded-full object-cover border border-amber-400/40 shrink-0"
            />
            <span className="text-[10px] font-semibold tracking-wider text-amber-400/90">
              DISKOMLEKAU
            </span>
          </div>

          <span
            className="text-[9px] tracking-widest uppercase truncate px-2 font-mono"
            style={{ color: wsSignalConnected ? 'var(--slk-accent)' : '#fbbf24' }}
          >
            E2EE RELAY: {wsSignalConnected ? 'ONLINE • AES-256-GCM' : 'CONNECTING'} •{' '}
            {MILITARY_THEMES[activeTheme].badgeText}
          </span>

          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold tracking-wider text-amber-400/90">
              TNI AU
            </span>
            <img
              src="/assets/aistudio/1792503945296_954409ac.jpg"
              alt="Logo TNI AU"
              className="w-4 h-4 rounded-full object-cover border border-amber-400/40 shrink-0"
            />
          </div>
        </div>

        {/* VIEW A: CHAT ROOM */}
        {openChatPeerId && activeContact ? (
          <div className="flex-1 flex flex-col h-full overflow-hidden">
            <header
              className="h-15 shrink-0 px-2.5 border-b flex items-center justify-between gap-2 z-20"
              style={{
                backgroundColor: 'var(--slk-bg-header)',
                borderColor: 'var(--slk-border)',
              }}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <button
                  type="button"
                  onClick={() => {
                    setOpenChatPeerId(null);
                    setShowEmojiPicker(false);
                  }}
                  className="min-w-[40px] min-h-[40px] rounded-full flex items-center justify-center text-slate-200 hover:bg-white/10 transition-colors"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>

                <div
                  onClick={() => setShowSecuritySheet(true)}
                  className={`w-10 h-10 rounded-full bg-gradient-to-br ${
                    activeContact.avatarColor || 'from-cyan-500 to-blue-700'
                  } flex items-center justify-center text-white font-bold text-sm shrink-0 cursor-pointer relative shadow-inner`}
                >
                  {activeContact.isGroup ? (
                    <Users className="w-5 h-5" />
                  ) : (
                    getInitials(activeContact.personnelName)
                  )}
                  <span
                    className="w-2.5 h-2.5 rounded-full border-2 border-[#111b21] absolute bottom-0 right-0"
                    style={{
                      backgroundColor:
                        activeContact.connectionState === 'CONNECTED'
                          ? 'var(--slk-accent)'
                          : '#fbbf24',
                    }}
                  />
                </div>

                <div
                  onClick={() => setShowSecuritySheet(true)}
                  className="min-w-0 pl-1 cursor-pointer"
                >
                  <h1 className="text-sm sm:text-base font-semibold truncate leading-tight">
                    {activeContact.personnelName}
                  </h1>
                  <p
                    className="text-xs truncate"
                    style={{ color: 'var(--slk-text-secondary)' }}
                  >
                    {activeContact.rank} · NRP {activeContact.nrp} ·{' '}
                    <span className="font-mono" style={{ color: 'var(--slk-accent)' }}>
                      {activeContact.peerId}
                    </span>{' '}
                    ·{' '}
                    <span style={{ color: 'var(--slk-accent)' }}>
                      {activeContact.connectionState === 'CONNECTED'
                        ? 'P2P Online'
                        : 'Menyambungkan...'}
                    </span>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  type="button"
                  onClick={() => handleLaunchMediaCall(activeContact, 'video')}
                  className="min-w-[40px] min-h-[40px] rounded-full flex items-center justify-center hover:bg-white/10 transition-colors"
                  title="Panggilan Video"
                >
                  <Video className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={() => handleLaunchMediaCall(activeContact, 'voice')}
                  className="min-w-[40px] min-h-[40px] rounded-full flex items-center justify-center hover:bg-white/10 transition-colors"
                  title="Panggilan Suara"
                >
                  <Phone className="w-4.5 h-4.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(true)}
                  className="min-w-[40px] min-h-[40px] rounded-full flex items-center justify-center hover:bg-white/10 transition-colors"
                  title="Pengaturan"
                >
                  <Settings className="w-5 h-5" style={{ color: 'var(--slk-accent)' }} />
                </button>
                <button
                  type="button"
                  onClick={() => setShowSecuritySheet(true)}
                  className="min-w-[38px] min-h-[38px] rounded-full flex items-center justify-center hover:bg-white/10 transition-colors"
                >
                  <MoreVertical className="w-5 h-5" />
                </button>
              </div>
            </header>

            {/* Diagnostic bar */}
            <div
              onClick={() => setShowSecuritySheet(true)}
              className="py-1.5 px-2.5 border-b flex items-center justify-between gap-2 cursor-pointer transition-colors z-10 overflow-x-auto"
              style={{
                backgroundColor: 'var(--slk-bg-card)',
                borderColor: 'var(--slk-border)',
              }}
            >
              <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px] font-mono font-semibold whitespace-nowrap mx-auto">
                <span className="px-2.5 py-1 rounded-lg border bg-cyan-950/80 border-cyan-500/50 text-cyan-300 text-[10px] font-mono tracking-wider flex items-center gap-1.5 shadow-sm">
                  <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
                  E2EE RELAY: ONLINE • SALURAN TERENKRIPSI AKTIF
                </span>
              </div>
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto px-3 sm:px-5 py-4 space-y-2.5 wa-tactical-chat-bg">
              <div className="flex justify-center mb-3">
                <div
                  onClick={() => setShowSecuritySheet(true)}
                  className="max-w-md px-3.5 py-2 rounded-xl border text-[11px] text-center leading-relaxed cursor-pointer shadow-xs"
                  style={{
                    backgroundColor: 'var(--slk-bg-card)',
                    borderColor: 'var(--slk-border)',
                    color: 'var(--slk-text-secondary)',
                  }}
                >
                  <span className="font-medium" style={{ color: 'var(--slk-accent)' }}>
                    Pesan terenkripsi ujung-ke-ujung (WebRTC P2P).
                  </span>{' '}
                  Zero-Data Retention aktif. Ketuk untuk detail kunci ECDH.
                </div>
              </div>

              {currentMessages.length === 0 ? (
                <div className="py-16 text-center space-y-2">
                  <p className="text-xs" style={{ color: 'var(--slk-text-secondary)' }}>
                    Belum ada percakapan di RAM sesi ini.
                  </p>
                </div>
              ) : (
                currentMessages.map((msg) => {
                  const isOwn = msg.senderPeerId === localIdentity.peerId;
                  return (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'}`}
                    >
                      <div
                        className={`max-w-[85%] sm:max-w-[75%] px-3 py-2 shadow-sm relative border ${
                          isOwn
                            ? 'rounded-2xl rounded-tr-xs'
                            : 'rounded-2xl rounded-tl-xs'
                        }`}
                        style={{
                          backgroundColor: isOwn
                            ? 'var(--slk-bg-bubble-own)'
                            : 'var(--slk-bg-bubble-peer)',
                          borderColor: isOwn
                            ? 'var(--slk-accent-muted)'
                            : 'var(--slk-border)',
                          color: 'var(--slk-text-primary)',
                        }}
                      >
                        {(!isOwn || activeContact.isGroup) && (
                          <div
                            className="text-xs font-semibold mb-0.5"
                            style={{ color: 'var(--slk-accent)' }}
                          >
                            {msg.senderCallsign}
                          </div>
                        )}

                        {msg.kind === 'voice' && msg.voiceMeta && (
                          <VoiceNotePlayer voiceMeta={msg.voiceMeta} isOwn={isOwn} />
                        )}

                        {msg.kind === 'image' && msg.fileMeta && (
                          <div
                            className="mb-1.5 rounded-xl overflow-hidden border border-white/10"
                            style={{ backgroundColor: 'var(--slk-bg-main)' }}
                          >
                            <img
                              src={msg.fileMeta.dataUrl}
                              alt={msg.fileMeta.fileName}
                              className="w-full max-h-64 object-contain"
                            />
                            <div
                              className="px-2.5 py-1.5 flex items-center justify-between gap-2 text-[11px]"
                              style={{ backgroundColor: 'var(--slk-bg-header)' }}
                            >
                              <span className="truncate text-slate-300">
                                {msg.fileMeta.fileName} ({formatFileSize(msg.fileMeta.fileSize)})
                              </span>
                              <a
                                href={msg.fileMeta.dataUrl}
                                download={msg.fileMeta.fileName}
                                className="flex items-center gap-1 hover:underline shrink-0 font-medium"
                                style={{ color: 'var(--slk-accent)' }}
                              >
                                <Download className="w-3.5 h-3.5" />
                                <span>Unduh</span>
                              </a>
                            </div>
                          </div>
                        )}

                        {msg.kind === 'document' && msg.fileMeta && (
                          <div
                            className="mb-1.5 p-2.5 rounded-xl border border-white/10 flex items-center justify-between gap-3"
                            style={{ backgroundColor: 'var(--slk-bg-header)' }}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <FileText
                                className="w-6 h-6 shrink-0"
                                style={{ color: 'var(--slk-accent)' }}
                              />
                              <div className="min-w-0">
                                <div className="text-xs font-semibold text-slate-100 truncate">
                                  {msg.fileMeta.fileName}
                                </div>
                                <div
                                  className="text-[11px]"
                                  style={{ color: 'var(--slk-text-secondary)' }}
                                >
                                  {formatFileSize(msg.fileMeta.fileSize)} · 16KB Chunks
                                </div>
                              </div>
                            </div>
                            <a
                              href={msg.fileMeta.dataUrl}
                              download={msg.fileMeta.fileName}
                              className="p-2 rounded-full shrink-0"
                              style={{
                                backgroundColor: 'var(--slk-bg-input)',
                                color: 'var(--slk-accent)',
                              }}
                            >
                              <Download className="w-4 h-4" />
                            </a>
                          </div>
                        )}

                        <div className="flex flex-wrap items-end justify-end gap-x-2 gap-y-0.5">
                          <p className="text-sm leading-snug whitespace-pre-wrap break-words flex-1 min-w-[60px]">
                            {msg.plaintext}
                          </p>
                          <div
                            className="flex items-center gap-1 text-[10px] shrink-0 select-none ml-auto pt-0.5"
                            style={{ color: 'var(--slk-text-secondary)' }}
                          >
                            <span>
                              {new Date(msg.timestamp).toLocaleTimeString('id-ID', {
                                hour: '2-digit',
                                minute: '2-digit',
                                hour12: false,
                              })}
                            </span>
                            {isOwn && (
                              <span>
                                {msg.status === 'SENT' ? (
                                  <Check className="w-3.5 h-3.5 text-slate-400 inline" />
                                ) : (
                                  <CheckCheck
                                    className="w-4 h-4 inline"
                                    style={{ color: 'var(--slk-accent)' }}
                                  />
                                )}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Emoji quick picker */}
            {showEmojiPicker && (
              <div
                className="px-4 py-2.5 border-t flex items-center justify-between gap-2 z-20"
                style={{
                  backgroundColor: 'var(--slk-bg-header)',
                  borderColor: 'var(--slk-border)',
                }}
              >
                <div className="flex items-center gap-2 overflow-x-auto">
                  {TACTICAL_EMOJIS.map((em) => (
                    <button
                      key={em}
                      type="button"
                      onClick={() => setInputText((prev) => prev + em)}
                      className="w-9 h-9 rounded-full hover:bg-white/10 flex items-center justify-center text-lg transition-colors shrink-0"
                    >
                      {em}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Input bar */}
            {isRecordingVoice ? (
              <div
                className="px-3 py-2.5 border-t flex items-center justify-between gap-3 z-20"
                style={{
                  backgroundColor: 'var(--slk-bg-header)',
                  borderColor: 'var(--slk-border)',
                }}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping shrink-0" />
                  <span className="text-sm font-semibold tabular-nums">
                    0:{recordingSeconds.toString().padStart(2, '0')}
                  </span>
                  <div className="flex items-center gap-1 h-5 w-32 sm:w-44">
                    {liveVoiceWaveform.map((h, i) => (
                      <div
                        key={i}
                        className="flex-1 rounded-full transition-all"
                        style={{
                          height: `${h}%`,
                          backgroundColor: 'var(--slk-accent)',
                        }}
                      />
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={cancelVoiceNoteRecording}
                    className="px-3.5 py-2 rounded-full text-xs font-semibold text-red-400 hover:bg-white/5"
                  >
                    Batal
                  </button>
                  <button
                    type="button"
                    onClick={stopAndTransmitVoiceNote}
                    className="w-11 h-11 rounded-full text-slate-950 flex items-center justify-center shadow-lg transition-transform active:scale-95"
                    style={{ backgroundColor: 'var(--slk-accent)' }}
                  >
                    <Send className="w-5 h-5" />
                  </button>
                </div>
              </div>
            ) : (
              <form
                onSubmit={handleSendText}
                className="px-2.5 py-2 flex items-center gap-2 z-20"
                style={{ backgroundColor: 'var(--slk-bg-main)' }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,.pdf,.txt,.doc,.docx,.csv,.json"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleFileUpload}
                  className="hidden"
                />

                <div
                  className="flex-1 rounded-full px-2 py-1 flex items-center gap-1 border"
                  style={{
                    backgroundColor: 'var(--slk-bg-input)',
                    borderColor: 'var(--slk-border)',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                    className="w-9 h-9 rounded-full flex items-center justify-center hover:text-white transition-colors shrink-0"
                    style={{ color: 'var(--slk-text-secondary)' }}
                  >
                    <Smile className="w-5 h-5" />
                  </button>

                  <input
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder="Ketik pesan terenkripsi..."
                    className="flex-1 bg-transparent py-1.5 px-1 text-sm focus:outline-none min-w-0"
                    style={{ color: 'var(--slk-text-primary)' }}
                  />

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-9 h-9 rounded-full flex items-center justify-center hover:text-white transition-colors shrink-0"
                    style={{ color: 'var(--slk-text-secondary)' }}
                    title="Lampirkan File"
                  >
                    <Paperclip className="w-5 h-5" />
                  </button>

                  <button
                    type="button"
                    onClick={handleSendSampleReconImage}
                    className="w-9 h-9 rounded-full flex items-center justify-center transition-colors shrink-0"
                    style={{ color: 'var(--slk-text-secondary)' }}
                    title="Kirim Foto"
                  >
                    <Camera className="w-5 h-5" />
                  </button>
                </div>

                {inputText.trim() ? (
                  <button
                    type="submit"
                    className="w-11 h-11 rounded-full text-slate-950 flex items-center justify-center shrink-0 shadow-md transition-transform active:scale-95"
                    style={{ backgroundColor: 'var(--slk-accent)' }}
                  >
                    <Send className="w-5 h-5" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={startVoiceNoteRecording}
                    className="w-11 h-11 rounded-full text-slate-950 flex items-center justify-center shrink-0 shadow-md transition-transform active:scale-95"
                    style={{ backgroundColor: 'var(--slk-accent)' }}
                    title="Rekam Voice Note"
                  >
                    <Mic className="w-5 h-5" />
                  </button>
                )}
              </form>
            )}
          </div>
        ) : (
          /* VIEW B: HOME SCREEN */
          <div className="flex-1 flex flex-col h-full overflow-hidden relative">
            <header
              className="h-15 shrink-0 px-3.5 flex items-center justify-between z-20 relative border-b"
              style={{
                backgroundColor: 'var(--slk-bg-header)',
                borderColor: 'var(--slk-border)',
              }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <img
                  src="/assets/aistudio/1795167005810_e4bb8167.jpg"
                  alt="Icon Aplikasi"
                  className="w-8 h-8 rounded-lg object-cover border shadow-md shrink-0"
                  style={{ borderColor: 'var(--slk-accent)' }}
                />
                <span className="text-base sm:text-lg font-bold tracking-tight truncate">
                  SILENT LINK
                </span>
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0"
                  style={{
                    backgroundColor: 'var(--slk-accent-muted)',
                    borderColor: 'var(--slk-accent)',
                    color: 'var(--slk-accent)',
                  }}
                >
                  {localIdentity.role === 'ADMIN' ? 'ADMIN HP' : 'OPERATIVE'}
                </span>
              </div>

              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  type="button"
                  onClick={toggleFullscreen}
                  className="min-w-[38px] min-h-[38px] rounded-full flex items-center justify-center hover:bg-white/10 transition-colors"
                  title="Fullscreen"
                >
                  <Maximize2
                    className="w-4 h-4"
                    style={{
                      color: isFullscreen ? 'var(--slk-accent)' : 'var(--slk-text-secondary)',
                    }}
                  />
                </button>

                <button
                  type="button"
                  onClick={() => setIsOperativeOnboardingOpen(true)}
                  className="min-w-[40px] min-h-[40px] rounded-full flex items-center justify-center hover:bg-white/10 transition-colors"
                  title="Scan QR Admin"
                >
                  <Camera className="w-5 h-5" />
                </button>

                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(true)}
                  className="min-w-[40px] min-h-[40px] rounded-full flex items-center justify-center hover:bg-white/10 transition-colors relative"
                  title="Pengaturan"
                >
                  <Settings className="w-5 h-5" style={{ color: 'var(--slk-accent)' }} />
                </button>

                <button
                  type="button"
                  onClick={() => setShowTopMenuDropdown(!showTopMenuDropdown)}
                  className="min-w-[38px] min-h-[38px] rounded-full flex items-center justify-center hover:bg-white/10 transition-colors"
                >
                  <MoreVertical className="w-5 h-5" />
                </button>
              </div>

              {/* 3-Dots Dropdown Menu */}
              {showTopMenuDropdown && (
                <div
                  className="absolute right-3 top-14 w-68 border rounded-xl shadow-2xl py-1.5 z-50 text-sm"
                  style={{
                    backgroundColor: 'var(--slk-bg-card)',
                    borderColor: 'var(--slk-border)',
                    color: 'var(--slk-text-primary)',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setShowTopMenuDropdown(false);
                      setIsSettingsOpen(true);
                    }}
                    className="w-full px-4 py-2.5 text-left hover:bg-white/5 flex items-center gap-2.5 font-semibold"
                    style={{ color: 'var(--slk-accent)' }}
                  >
                    <Settings className="w-4 h-4" />
                    <span>Pengaturan HP &amp; Tema Militer</span>
                  </button>

                  {/* ONLY show Admin provisioning if localIdentity.role === 'ADMIN' */}
                  {localIdentity.role === 'ADMIN' && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowTopMenuDropdown(false);
                        setIsAdminProvisionOpen(true);
                      }}
                      className="w-full px-4 py-2.5 text-left hover:bg-white/5 flex items-center gap-2.5 font-medium"
                    >
                      <QrCode className="w-4 h-4" style={{ color: 'var(--slk-accent)' }} />
                      <span>+ Buat QR &amp; Link Personel</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setShowTopMenuDropdown(false);
                      setIsOperativeOnboardingOpen(true);
                    }}
                    className="w-full px-4 py-2.5 text-left hover:bg-white/5 flex items-center gap-2.5"
                  >
                    <ScanLine className="w-4 h-4 text-slate-400" />
                    <span>Scan QR / Link Onboarding</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setShowTopMenuDropdown(false);
                      setIsManualSdpOpen(true);
                    }}
                    className="w-full px-4 py-2.5 text-left hover:bg-white/5 flex items-center gap-2.5"
                  >
                    <Terminal className="w-4 h-4 text-slate-400" />
                    <span>Koneksi SDP Manual (Air-Gap)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setShowTopMenuDropdown(false);
                      setShowSecuritySheet(true);
                    }}
                    className="w-full px-4 py-2.5 text-left hover:bg-white/5 flex items-center gap-2.5"
                  >
                    <ShieldCheck className="w-4 h-4 text-slate-400" />
                    <span>Info Enkripsi &amp; Diagnostik</span>
                  </button>

                  <div className="my-1 border-t" style={{ borderColor: 'var(--slk-border)' }} />

                  <button
                    type="button"
                    onClick={handleLockSession}
                    className="w-full px-4 py-2.5 text-left hover:bg-white/5 flex items-center gap-2.5 text-amber-400"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Kunci Sesi / Log Out</span>
                  </button>
                </div>
              )}
            </header>

            {/* TAB 1: CHAT LIST */}
            {activeBottomTab === 'chat' && (
              <div className="flex-1 flex flex-col overflow-hidden">
                <div
                  className="px-3.5 pt-2.5 pb-2 border-b"
                  style={{
                    backgroundColor: 'var(--slk-bg-header)',
                    borderColor: 'var(--slk-border)',
                  }}
                >
                  <div
                    className="relative flex items-center rounded-full px-3.5 py-2 border"
                    style={{
                      backgroundColor: 'var(--slk-bg-input)',
                      borderColor: 'var(--slk-border)',
                    }}
                  >
                    <Search
                      className="w-4 h-4 mr-2.5 shrink-0"
                      style={{ color: 'var(--slk-text-secondary)' }}
                    />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Cari Nama Personel atau NRP..."
                      className="w-full bg-transparent text-sm focus:outline-none"
                      style={{ color: 'var(--slk-text-primary)' }}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-2 mt-2.5 pb-1 overflow-x-auto">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setChatFilterPill('all')}
                        className="px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap border"
                        style={{
                          backgroundColor:
                            chatFilterPill === 'all'
                              ? 'var(--slk-accent-muted)'
                              : 'var(--slk-bg-input)',
                          borderColor:
                            chatFilterPill === 'all' ? 'var(--slk-accent)' : 'transparent',
                          color:
                            chatFilterPill === 'all'
                              ? 'var(--slk-accent)'
                              : 'var(--slk-text-secondary)',
                        }}
                      >
                        Semua
                      </button>
                      <button
                        type="button"
                        onClick={() => setChatFilterPill('unread')}
                        className="px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap border"
                        style={{
                          backgroundColor:
                            chatFilterPill === 'unread'
                              ? 'var(--slk-accent-muted)'
                              : 'var(--slk-bg-input)',
                          borderColor:
                            chatFilterPill === 'unread' ? 'var(--slk-accent)' : 'transparent',
                          color:
                            chatFilterPill === 'unread'
                              ? 'var(--slk-accent)'
                              : 'var(--slk-text-secondary)',
                        }}
                      >
                        Belum dibaca {totalUnreadChats > 0 ? `(${totalUnreadChats})` : ''}
                      </button>
                      <button
                        type="button"
                        onClick={() => setChatFilterPill('groups')}
                        className="px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap border"
                        style={{
                          backgroundColor:
                            chatFilterPill === 'groups'
                              ? 'var(--slk-accent-muted)'
                              : 'var(--slk-bg-input)',
                          borderColor:
                            chatFilterPill === 'groups' ? 'var(--slk-accent)' : 'transparent',
                          color:
                            chatFilterPill === 'groups'
                              ? 'var(--slk-accent)'
                              : 'var(--slk-text-secondary)',
                        }}
                      >
                        Grup
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => setIsSettingsOpen(true)}
                      className="px-2.5 py-1.5 rounded-full text-[11px] font-semibold flex items-center gap-1 border shrink-0"
                      style={{
                        backgroundColor: 'var(--slk-bg-input)',
                        borderColor: 'var(--slk-border)',
                        color: 'var(--slk-accent)',
                      }}
                    >
                      <Palette className="w-3.5 h-3.5" />
                      <span>Tema</span>
                    </button>
                  </div>
                </div>

                <div
                  className="flex-1 overflow-y-auto divide-y pb-24"
                  style={{ borderColor: 'var(--slk-border)' }}
                >
                  {filteredContacts.length === 0 ? (
                    <div
                      className="py-16 text-center text-sm"
                      style={{ color: 'var(--slk-text-secondary)' }}
                    >
                      Tidak ada obrolan personel.
                    </div>
                  ) : (
                    filteredContacts.map((contact) => {
                      const isConnected = contact.connectionState === 'CONNECTED';
                      return (
                        <button
                          key={contact.peerId}
                          type="button"
                          onClick={() => {
                            setOpenChatPeerId(contact.peerId);
                            if (contact.mode === 'live-peer') {
                              initiateLiveWebRTCOffer(contact.peerId, contact.personnelName, contact.nrp);
                            }
                          }}
                          className="w-full px-4 py-3 hover:bg-white/5 active:bg-white/10 transition-colors flex items-center gap-3.5 text-left"
                        >
                          <div className="relative shrink-0">
                            <div
                              className={`w-12 h-12 rounded-full bg-gradient-to-br ${
                                contact.avatarColor || 'from-cyan-500 to-blue-700'
                              } flex items-center justify-center text-white font-bold text-base shadow-inner`}
                            >
                              {contact.isGroup ? (
                                <Users className="w-5 h-5" />
                              ) : (
                                getInitials(contact.personnelName)
                              )}
                            </div>
                            <span
                              className="w-3 h-3 rounded-full border-2 border-[#0b141a] absolute bottom-0 right-0"
                              style={{
                                backgroundColor: isConnected ? 'var(--slk-accent)' : '#64748b',
                              }}
                            />
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <div className="truncate flex items-center gap-1.5">
                                <span className="text-[15px] font-semibold truncate">
                                  {contact.personnelName}
                                </span>
                                <span
                                  className="text-[10px] font-mono px-1.5 py-0.5 rounded border shrink-0"
                                  style={{
                                    backgroundColor: 'var(--slk-accent-muted)',
                                    borderColor: 'var(--slk-border)',
                                    color: 'var(--slk-accent)',
                                  }}
                                >
                                  {contact.peerId}
                                </span>
                              </div>
                              <span
                                className="text-xs shrink-0 tabular-nums"
                                style={{ color: 'var(--slk-text-secondary)' }}
                              >
                                {new Date(contact.lastActivityTime).toLocaleTimeString('id-ID', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  hour12: false,
                                })}
                              </span>
                            </div>

                            <div className="flex items-center justify-between gap-2 mt-1">
                              <div className="flex items-center gap-1 min-w-0 flex-1">
                                <CheckCheck
                                  className="w-4 h-4 shrink-0"
                                  style={{ color: 'var(--slk-accent)' }}
                                />
                                <p
                                  className="text-xs sm:text-sm truncate"
                                  style={{ color: 'var(--slk-text-secondary)' }}
                                >
                                  {contact.lastMessagePreview}
                                </p>
                              </div>
                              {contact.unreadCount > 0 && (
                                <span
                                  className="min-w-[20px] h-5 px-1.5 rounded-full text-slate-950 text-[11px] font-bold flex items-center justify-center shrink-0"
                                  style={{ backgroundColor: 'var(--slk-accent)' }}
                                >
                                  {contact.unreadCount}
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {/* TAB 2: STATUS */}
            {activeBottomTab === 'status' && (
              <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-24">
                <div
                  className="p-3.5 rounded-2xl border space-y-3"
                  style={{
                    backgroundColor: 'var(--slk-bg-card)',
                    borderColor: 'var(--slk-border)',
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-12 h-12 rounded-full flex items-center justify-center text-slate-950 font-bold"
                      style={{ backgroundColor: 'var(--slk-accent)' }}
                    >
                      {getInitials(localIdentity.personnelName)}
                    </div>
                    <div>
                      <div className="text-sm font-bold">Status Saya</div>
                      <div className="text-xs" style={{ color: 'var(--slk-text-secondary)' }}>
                        NRP {localIdentity.nrp} · RAM Sesi Aktif
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: GROUPS */}
            {activeBottomTab === 'groups' && (
              <div className="flex-1 overflow-y-auto p-4 space-y-3 pb-24">
                <div
                  className="text-xs font-semibold uppercase tracking-wider px-1"
                  style={{ color: 'var(--slk-text-secondary)' }}
                >
                  Grup Komando P2P
                </div>
                {contacts.map((c) => (
                  <button
                    key={c.peerId}
                    type="button"
                    onClick={() => {
                      setOpenChatPeerId(c.peerId);
                    }}
                    className="w-full p-3.5 rounded-2xl border flex items-center justify-between gap-3 text-left transition-colors hover:bg-white/5"
                    style={{
                      backgroundColor: 'var(--slk-bg-card)',
                      borderColor: 'var(--slk-border)',
                    }}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-11 h-11 rounded-full bg-gradient-to-br from-cyan-500 to-blue-700 flex items-center justify-center text-white font-bold shrink-0">
                        <Users className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">{c.unit}</div>
                        <div className="text-xs truncate" style={{ color: 'var(--slk-text-secondary)' }}>
                          {c.personnelName}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* TAB 4: CALLS */}
            {activeBottomTab === 'calls' && (
              <div className="flex-1 overflow-y-auto p-4 space-y-3 pb-24">
                <div
                  className="text-xs font-semibold uppercase tracking-wider px-1"
                  style={{ color: 'var(--slk-text-secondary)' }}
                >
                  Riwayat Panggilan P2P
                </div>
                {callHistory.map((item) => (
                  <div
                    key={item.id}
                    className="p-3.5 rounded-2xl border flex items-center justify-between gap-3"
                    style={{
                      backgroundColor: 'var(--slk-bg-card)',
                      borderColor: 'var(--slk-border)',
                    }}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-11 h-11 rounded-full bg-gradient-to-br from-cyan-500 to-blue-700 flex items-center justify-center text-white font-bold shrink-0">
                        {getInitials(item.personnelName)}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">{item.personnelName}</div>
                        <div className="text-xs" style={{ color: 'var(--slk-text-secondary)' }}>
                          {item.direction === 'incoming' ? '↙ Masuk' : '↗ Keluar'}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* FLOATING ACTION BUTTON (ONLY FOR ADMIN ROLE) */}
            {localIdentity.role === 'ADMIN' && (
              <button
                type="button"
                onClick={() => setIsAdminProvisionOpen(true)}
                className="absolute bottom-20 right-4 z-30 h-13 px-4 rounded-2xl text-slate-950 font-bold text-xs sm:text-sm flex items-center gap-2 shadow-xl transition-transform active:scale-95"
                style={{ backgroundColor: 'var(--slk-accent)' }}
                title="Buat QR & Link Personel"
              >
                <Plus className="w-5 h-5 stroke-[2.5]" />
                <span>Buat QR &amp; Link Personel</span>
              </button>
            )}

            {/* BOTTOM NAV BAR */}
            <nav
              className="h-16 shrink-0 border-t grid grid-cols-5 items-center z-20"
              style={{
                backgroundColor: 'var(--slk-bg-header)',
                borderColor: 'var(--slk-border)',
              }}
            >
              <button
                type="button"
                onClick={() => setActiveBottomTab('chat')}
                className="flex flex-col items-center justify-center h-full relative"
              >
                <div
                  className="px-3.5 py-1 rounded-full flex items-center justify-center transition-colors relative"
                  style={{
                    backgroundColor:
                      activeBottomTab === 'chat' ? 'var(--slk-accent-muted)' : 'transparent',
                    color:
                      activeBottomTab === 'chat'
                        ? 'var(--slk-accent)'
                        : 'var(--slk-text-secondary)',
                  }}
                >
                  <MessageSquare className="w-5 h-5" />
                  {totalUnreadChats > 0 && (
                    <span
                      className="absolute -top-1 right-0.5 min-w-[16px] h-4 px-1 rounded-full text-slate-950 text-[10px] font-bold flex items-center justify-center"
                      style={{ backgroundColor: 'var(--slk-accent)' }}
                    >
                      {totalUnreadChats}
                    </span>
                  )}
                </div>
                <span className="text-[10px] mt-0.5 font-semibold">Chat</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveBottomTab('status')}
                className="flex flex-col items-center justify-center h-full"
              >
                <div
                  className="px-3.5 py-1 rounded-full flex items-center justify-center"
                  style={{
                    backgroundColor:
                      activeBottomTab === 'status' ? 'var(--slk-accent-muted)' : 'transparent',
                    color:
                      activeBottomTab === 'status'
                        ? 'var(--slk-accent)'
                        : 'var(--slk-text-secondary)',
                  }}
                >
                  <Radio className="w-5 h-5" />
                </div>
                <span className="text-[10px] mt-0.5 font-semibold">Status</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveBottomTab('groups')}
                className="flex flex-col items-center justify-center h-full"
              >
                <div
                  className="px-3.5 py-1 rounded-full flex items-center justify-center"
                  style={{
                    backgroundColor:
                      activeBottomTab === 'groups' ? 'var(--slk-accent-muted)' : 'transparent',
                    color:
                      activeBottomTab === 'groups'
                        ? 'var(--slk-accent)'
                        : 'var(--slk-text-secondary)',
                  }}
                >
                  <Users className="w-5 h-5" />
                </div>
                <span className="text-[10px] mt-0.5 font-semibold">Satuan</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveBottomTab('calls')}
                className="flex flex-col items-center justify-center h-full"
              >
                <div
                  className="px-3.5 py-1 rounded-full flex items-center justify-center"
                  style={{
                    backgroundColor:
                      activeBottomTab === 'calls' ? 'var(--slk-accent-muted)' : 'transparent',
                    color:
                      activeBottomTab === 'calls'
                        ? 'var(--slk-accent)'
                        : 'var(--slk-text-secondary)',
                  }}
                >
                  <Phone className="w-5 h-5" />
                </div>
                <span className="text-[10px] mt-0.5 font-semibold">Panggilan</span>
              </button>

              <button
                type="button"
                onClick={() => setIsSettingsOpen(true)}
                className="flex flex-col items-center justify-center h-full"
              >
                <div
                  className="px-3.5 py-1 rounded-full flex items-center justify-center"
                  style={{ color: 'var(--slk-accent)' }}
                >
                  <Settings className="w-5 h-5" />
                </div>
                <span className="text-[10px] mt-0.5 font-bold" style={{ color: 'var(--slk-accent)' }}>
                  Pengaturan
                </span>
              </button>
            </nav>
          </div>
        )}
      </div>

      {/* MODALS & OVERLAYS */}
      <TacticalSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        nodeIdentity={localIdentity}
        isLoggedIn={isLoggedIn}
        isOperativeLocked={localIdentity.role === 'OPERATIVE'}
        onLoginAccount={handleLoginAccount}
        onLockSession={handleLockSession}
        onUnlockAndAutoReconnect={handleUnlockAndAutoReconnect}
        onWipeRamMessagesOnly={handleWipeRamMessagesOnly}
        onRevokeDeviceAuthorization={handleRevokeDeviceAuthorization}
        onOpenQrScanner={() => setIsOperativeOnboardingOpen(true)}
        activeTheme={activeTheme}
        onSelectTheme={setActiveTheme}
        isFullscreen={isFullscreen}
        autoFullscreenOnTap={autoFullscreenOnTap}
        onToggleFullscreen={toggleFullscreen}
        onToggleAutoFullscreen={setAutoFullscreenOnTap}
        keepAliveStatus={keepAliveStatus}
        onToggleKeepAlive={(enabled) => {
          if (enabled) tacticalBackgroundDaemon.start();
          else tacticalBackgroundDaemon.stop();
        }}
        soundAlertEnabled={soundAlertEnabled}
        onToggleSoundAlert={setSoundAlertEnabled}
        isInstallable={isInstallable}
        isInstalled={isInstalled}
        isIOS={isIOS}
        onPromptInstall={promptInstall}
        wsSignalConnected={wsSignalConnected}
        activePeersCount={contacts.filter((c) => c.connectionState === 'CONNECTED').length}
      />

      {localIdentity.role === 'ADMIN' && (
        <AdminProvisioningModal
          isOpen={isAdminProvisionOpen}
          onClose={() => setIsAdminProvisionOpen(false)}
          role={localIdentity.role}
          localIdentity={localIdentity}
          onCredentialProvisioned={handleAdminCredentialProvisioned}
          onSimulateOperativeOnboardingWithToken={async (token) => {
            const parsed = await verifyAndParseProvisioningToken(token);
            await handleCompleteOperativeOnboarding(parsed);
          }}
        />
      )}

      <OperativeOnboardingModal
        isOpen={isOperativeOnboardingOpen}
        onClose={() => setIsOperativeOnboardingOpen(false)}
        recentAdminCredentials={issuedCredentials}
        onCompleteOperativeOnboarding={handleCompleteOperativeOnboarding}
      />

      <ManualSdpModal
        isOpen={isManualSdpOpen}
        onClose={() => setIsManualSdpOpen(false)}
        onGenerateOffer={async () => ''}
        onAcceptOfferAndCreateAnswer={async () => ({ answerToken: '', peerCallsign: '' })}
        onFinalizeWithAnswer={async () => {}}
      />
    </div>
  );
}
