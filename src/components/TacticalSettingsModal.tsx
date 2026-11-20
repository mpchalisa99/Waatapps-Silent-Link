import React, { useState } from 'react';
import {
  X,
  User,
  Shield,
  LogOut,
  LogIn,
  Palette,
  Maximize2,
  Minimize2,
  Activity,
  Smartphone,
  Check,
  KeyRound,
  RefreshCw,
  Lock,
  Unlock,
  Trash2,
  QrCode,
  Volume2,
  Share,
  ShieldAlert,
  CheckCircle2,
} from 'lucide-react';
import {
  MILITARY_THEMES,
  MilitaryThemeId,
  BackgroundKeepAliveStatus,
} from '../utils/pwaAndKeepAliveEngine';
import { LocalNodeIdentity, DeviceRole } from '../types/tactical';

interface TacticalSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  nodeIdentity: LocalNodeIdentity | null;
  isLoggedIn: boolean;
  isOperativeLocked: boolean;
  onLoginAccount: (params: {
    name: string;
    nrp: string;
    rank: string;
    unit: string;
    role: DeviceRole;
  }) => void;
  onLockSession: () => void;
  onUnlockAndAutoReconnect: () => void;
  onWipeRamMessagesOnly: () => void;
  onRevokeDeviceAuthorization: () => void;
  onOpenQrScanner: () => void;
  activeTheme: MilitaryThemeId;
  onSelectTheme: (theme: MilitaryThemeId) => void;
  isFullscreen: boolean;
  autoFullscreenOnTap: boolean;
  onToggleFullscreen: () => void;
  onToggleAutoFullscreen: (val: boolean) => void;
  keepAliveStatus: BackgroundKeepAliveStatus;
  onToggleKeepAlive: (enabled: boolean) => void;
  soundAlertEnabled: boolean;
  onToggleSoundAlert: (enabled: boolean) => void;
  isInstallable: boolean;
  isInstalled: boolean;
  isIOS: boolean;
  onPromptInstall: () => void;
  wsSignalConnected: boolean;
  activePeersCount: number;
}

const MASTER_ADMIN_PASSCODE = 'DISKOMLEKAU-526316';

export const TacticalSettingsModal: React.FC<TacticalSettingsModalProps> = ({
  isOpen,
  onClose,
  nodeIdentity,
  isLoggedIn,
  isOperativeLocked,
  onLoginAccount,
  onLockSession,
  onUnlockAndAutoReconnect,
  onWipeRamMessagesOnly,
  onRevokeDeviceAuthorization,
  onOpenQrScanner,
  activeTheme,
  onSelectTheme,
  isFullscreen,
  autoFullscreenOnTap,
  onToggleFullscreen,
  onToggleAutoFullscreen,
  keepAliveStatus,
  onToggleKeepAlive,
  soundAlertEnabled,
  onToggleSoundAlert,
  isInstallable,
  isInstalled,
  isIOS,
  onPromptInstall,
  wsSignalConnected,
  activePeersCount,
}) => {
  const [activeSection, setActiveSection] = useState<'account' | 'theme' | 'general'>('account');
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const [confirmRevokeStep, setConfirmRevokeStep] = useState(false);

  // Master Admin Passcode Gate (Only accessible if device is NOT locked as an Operative Client)
  const [showAdminPasscodeForm, setShowAdminPasscodeForm] = useState(false);
  const [adminPasscodeInput, setAdminPasscodeInput] = useState('');
  const [adminPasscodeError, setAdminPasscodeError] = useState('');
  const [isMasterPasscodeUnlocked, setIsMasterPasscodeUnlocked] = useState(false);

  // Master Admin Profile Edit state (only when Master Admin unlocked)
  const [formName, setFormName] = useState(
    nodeIdentity?.personnelName || 'Kolonel Lek Yudhi Eko Santoso'
  );
  const [formNrp, setFormNrp] = useState(nodeIdentity?.nrp || '526316');
  const [formRank, setFormRank] = useState(
    nodeIdentity?.rank || 'Kasubdis Rudal Diskomlekau'
  );
  const [formUnit, setFormUnit] = useState(nodeIdentity?.unit || 'SUBDIS RUDAL DISKOMLEKAU');

  if (!isOpen) return null;

  const currentThemeObj = MILITARY_THEMES[activeTheme];
  const isClientDevice = isOperativeLocked || nodeIdentity?.role === 'OPERATIVE';

  const handleVerifyMasterPasscode = (e: React.FormEvent) => {
    e.preventDefault();
    if (isClientDevice) return;
    if (adminPasscodeInput.trim() === MASTER_ADMIN_PASSCODE) {
      setIsMasterPasscodeUnlocked(true);
      setAdminPasscodeError('');
    } else {
      setAdminPasscodeError('Master Passcode Admin ditolak.');
    }
  };

  const handleSubmitMasterAdminProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (isClientDevice || !isMasterPasscodeUnlocked) return;
    if (!formName.trim() || !formNrp.trim()) return;
    onLoginAccount({
      name: formName.trim(),
      nrp: formNrp.trim(),
      rank: formRank.trim() || 'Kasubdis Rudal Diskomlekau',
      unit: formUnit.trim() || 'SUBDIS RUDAL DISKOMLEKAU',
      role: 'ADMIN',
    });
    setShowAdminPasscodeForm(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/80 backdrop-blur-md animate-fadeIn">
      <div
        className="flex flex-col w-full max-w-[480px] mx-auto h-full overflow-hidden border-x"
        style={{
          backgroundColor: 'var(--slk-bg-main)',
          borderColor: 'var(--slk-border)',
          color: 'var(--slk-text-primary)',
        }}
      >
        {/* Top Mobile Header */}
        <div
          className="flex items-center justify-between px-4 py-3.5 border-b shrink-0"
          style={{
            backgroundColor: 'var(--slk-bg-header)',
            borderColor: 'var(--slk-border)',
          }}
        >
          <div className="flex items-center gap-2.5">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center border"
              style={{
                backgroundColor: 'var(--slk-accent-muted)',
                borderColor: 'var(--slk-accent)',
                color: 'var(--slk-accent)',
              }}
            >
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold tracking-tight leading-tight">
                Pengaturan HP &amp; Sesi Taktis
              </h2>
              <p className="text-[11px]" style={{ color: 'var(--slk-text-secondary)' }}>
                SILENT LINK DISKOMLEKAU • Tema: {currentThemeObj.badgeText}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-white/10 transition-colors"
            title="Tutup Pengaturan"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Sub-Navigation Tabs inside Settings */}
        <div
          className="grid grid-cols-3 gap-1.5 p-2.5 border-b shrink-0"
          style={{
            backgroundColor: 'var(--slk-bg-card)',
            borderColor: 'var(--slk-border)',
          }}
        >
          <button
            onClick={() => setActiveSection('account')}
            className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg text-xs font-semibold transition-all border"
            style={{
              backgroundColor:
                activeSection === 'account' ? 'var(--slk-accent-muted)' : 'transparent',
              borderColor:
                activeSection === 'account' ? 'var(--slk-accent)' : 'transparent',
              color:
                activeSection === 'account'
                  ? 'var(--slk-accent)'
                  : 'var(--slk-text-secondary)',
            }}
          >
            <User className="w-3.5 h-3.5" />
            <span>Identitas &amp; Sesi</span>
          </button>

          <button
            onClick={() => setActiveSection('theme')}
            className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg text-xs font-semibold transition-all border"
            style={{
              backgroundColor:
                activeSection === 'theme' ? 'var(--slk-accent-muted)' : 'transparent',
              borderColor:
                activeSection === 'theme' ? 'var(--slk-accent)' : 'transparent',
              color:
                activeSection === 'theme'
                  ? 'var(--slk-accent)'
                  : 'var(--slk-text-secondary)',
            }}
          >
            <Palette className="w-3.5 h-3.5" />
            <span>Tema Militer</span>
          </button>

          <button
            onClick={() => setActiveSection('general')}
            className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg text-xs font-semibold transition-all border"
            style={{
              backgroundColor:
                activeSection === 'general' ? 'var(--slk-accent-muted)' : 'transparent',
              borderColor:
                activeSection === 'general' ? 'var(--slk-accent)' : 'transparent',
              color:
                activeSection === 'general'
                  ? 'var(--slk-accent)'
                  : 'var(--slk-text-secondary)',
            }}
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span>Sistem &amp; APK</span>
          </button>
        </div>

        {/* Scrollable Content Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* ================================================================
              TAB 1: IDENTITAS TERENKRIPSI, KUNCI SESI & AUTO-RECONNECT
              ================================================================ */}
          {activeSection === 'account' && (
            <div className="space-y-4">
              {/* Current Authorized Device Identity Card */}
              <div
                className="rounded-xl p-4 border space-y-3"
                style={{
                  backgroundColor: 'var(--slk-bg-card)',
                  borderColor: 'var(--slk-border)',
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="text-[11px] font-bold uppercase tracking-wider"
                    style={{ color: 'var(--slk-accent)' }}
                  >
                    Kredensial Perangkat Terotorisasi
                  </span>
                  <span
                    className="px-2 py-0.5 rounded text-[10px] font-bold uppercase border"
                    style={{
                      backgroundColor: isLoggedIn
                        ? 'var(--slk-accent-muted)'
                        : 'rgba(245,158,11,0.15)',
                      borderColor: isLoggedIn ? 'var(--slk-accent)' : '#f59e0b',
                      color: isLoggedIn ? 'var(--slk-accent)' : '#fbbf24',
                    }}
                  >
                    {!isLoggedIn
                      ? 'SESI TERKUNCI (STANDBY)'
                      : isClientDevice
                      ? 'OPERATIVE CLIENT'
                      : 'MASTER ADMIN'}
                  </span>
                </div>

                {nodeIdentity && (
                  <>
                    <div className="flex items-center gap-3.5 pt-1">
                      <div
                        className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold border-2 shrink-0"
                        style={{
                          backgroundColor: 'var(--slk-bg-header)',
                          borderColor: 'var(--slk-accent)',
                          color: 'var(--slk-accent)',
                        }}
                      >
                        {nodeIdentity.personnelName
                          .split(' ')
                          .map((w) => w[0])
                          .join('')
                          .slice(0, 2)
                          .toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-bold truncate">
                          {nodeIdentity.personnelName}
                        </h3>
                        <p
                          className="text-xs truncate"
                          style={{ color: 'var(--slk-text-secondary)' }}
                        >
                          {nodeIdentity.rank}
                        </p>
                        <div className="flex flex-wrap items-center gap-2 mt-1">
                          <span
                            className="text-[11px] font-mono px-2 py-0.5 rounded"
                            style={{
                              backgroundColor: 'var(--slk-bg-input)',
                              color: 'var(--slk-accent)',
                            }}
                          >
                            NRP: {nodeIdentity.nrp}
                          </span>
                          <span
                            className="text-[11px] font-mono px-2 py-0.5 rounded"
                            style={{
                              backgroundColor: 'var(--slk-bg-input)',
                              color: 'var(--slk-text-secondary)',
                            }}
                          >
                            {nodeIdentity.unit}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Encrypted LocalStorage Vault Status */}
                    <div className="p-2.5 rounded-lg bg-emerald-950/40 border border-emerald-500/30 flex items-center gap-2 text-[11px] text-emerald-300">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span>
                        Identitas &amp; Kunci ECDH tersimpan terenkripsi (AES-256-GCM) untuk{' '}
                        <strong>Auto-Reconnect Otomatis</strong> tanpa scan QR ulang.
                      </span>
                    </div>

                    {/* Cryptographic Node Metadata */}
                    <div
                      className="rounded-lg p-3 space-y-1.5 text-xs font-mono border"
                      style={{
                        backgroundColor: 'var(--slk-bg-main)',
                        borderColor: 'var(--slk-border)',
                      }}
                    >
                      <div className="flex justify-between">
                        <span style={{ color: 'var(--slk-text-secondary)' }}>ID NODE HP:</span>
                        <span className="font-semibold" style={{ color: 'var(--slk-accent)' }}>
                          {nodeIdentity.peerId}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span style={{ color: 'var(--slk-text-secondary)' }}>
                          SIDIK JARI ECDH:
                        </span>
                        <span className="truncate max-w-[190px]">
                          {nodeIdentity.fingerprint}
                        </span>
                      </div>
                      {nodeIdentity.authorizedByAdminFingerprint && (
                        <div className="flex justify-between">
                          <span style={{ color: 'var(--slk-text-secondary)' }}>
                            KUNCI PUBLIK ADMIN:
                          </span>
                          <span className="truncate max-w-[175px] text-emerald-400">
                            {nodeIdentity.authorizedByAdminFingerprint}
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span style={{ color: 'var(--slk-text-secondary)' }}>
                          KANAL SIGNALING:
                        </span>
                        <span className={wsSignalConnected ? 'text-emerald-400' : 'text-amber-400'}>
                          {wsSignalConnected ? 'SIGNALING: ONLINE' : 'MENYAMBUNGKAN...'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span style={{ color: 'var(--slk-text-secondary)' }}>
                          KANAL P2P E2EE:
                        </span>
                        <span className="text-emerald-400 font-bold">
                          {activePeersCount > 0
                            ? `CONNECTED (${activePeersCount} Rekan)`
                            : 'STANDBY AUTO-DIAL'}
                        </span>
                      </div>
                    </div>

                    {/* SESSION LOCK / UNLOCK & AUTO-RECONNECT ACTIONS */}
                    {isLoggedIn ? (
                      <div className="grid grid-cols-2 gap-2.5 pt-1">
                        <button
                          type="button"
                          onClick={onLockSession}
                          className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-lg text-xs font-bold border border-amber-500/40 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 transition-all"
                          title="Hanya menghapus pesan dari RAM & mengunci layar sementara tanpa menghapus identitas"
                        >
                          <LogOut className="w-3.5 h-3.5" />
                          <span>Log Out / Kunci Sesi</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            onOpenQrScanner();
                          }}
                          className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-lg text-xs font-bold border transition-all"
                          style={{
                            backgroundColor: 'var(--slk-bg-input)',
                            borderColor: 'var(--slk-accent)',
                            color: 'var(--slk-accent)',
                          }}
                          title="Pindai QR Code Baru dengan Kamera Belakang"
                        >
                          <QrCode className="w-3.5 h-3.5" />
                          <span>Pindai QR Kamera</span>
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2.5 pt-1">
                        <div className="p-3 rounded-lg bg-amber-950/40 border border-amber-500/40 text-xs text-amber-200">
                          Sesi layar sedang dikunci &amp; riwayat pesan RAM telah dibersihkan.
                          Kredensial identitas Anda (<strong>{nodeIdentity.peerId}</strong>) tetap
                          tersimpan aman.
                        </div>
                        <button
                          type="button"
                          onClick={onUnlockAndAutoReconnect}
                          className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-xs font-bold text-slate-950 transition-all shadow-lg"
                          style={{ backgroundColor: 'var(--slk-accent)' }}
                        >
                          <Unlock className="w-4 h-4" />
                          <span>Buka Kunci Sesi &amp; Auto-Reconnect P2P Sekarang</span>
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* 1. Zero-Retention RAM Chat Wipe ONLY (Preserves Identity & Connection) */}
              <div className="rounded-xl p-3.5 border border-cyan-500/30 bg-cyan-950/15 flex items-center justify-between gap-3">
                <div>
                  <h4 className="text-xs font-bold" style={{ color: 'var(--slk-accent)' }}>
                    Bersihkan Isi Pesan &amp; Media dari RAM (Zero-Retention)
                  </h4>
                  <p className="text-[11px]" style={{ color: 'var(--slk-text-secondary)' }}>
                    Menghapus seluruh riwayat chat, file &amp; voice note di RAM tanpa memutus
                    identitas perangkat atau koneksi P2P.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onWipeRamMessagesOnly}
                  className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-bold transition-colors"
                  style={{
                    backgroundColor: 'var(--slk-bg-input)',
                    borderColor: 'var(--slk-accent)',
                    color: 'var(--slk-accent)',
                  }}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Bersihkan Chat</span>
                </button>
              </div>

              {/* 2. Master Admin Passcode Section — STRICTLY HIDDEN ON OPERATIVE CLIENT DEVICES */}
              {!isClientDevice && (
                <div
                  className="rounded-xl p-3.5 border space-y-3"
                  style={{
                    backgroundColor: 'var(--slk-bg-card)',
                    borderColor: 'var(--slk-border)',
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <KeyRound className="w-4 h-4" style={{ color: 'var(--slk-accent)' }} />
                      <span className="text-xs font-bold">
                        Otoritas Perangkat Master Admin
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowAdminPasscodeForm(!showAdminPasscodeForm)}
                      className="text-[11px] font-semibold underline"
                      style={{ color: 'var(--slk-accent)' }}
                    >
                      {showAdminPasscodeForm ? 'Tutup' : 'Konfigurasi Master Admin'}
                    </button>
                  </div>

                  {showAdminPasscodeForm && !isMasterPasscodeUnlocked && (
                    <form onSubmit={handleVerifyMasterPasscode} className="space-y-2">
                      <label className="block text-[11px] text-slate-400">
                        Masukkan Master Passcode Admin untuk mengubah parameter komando:
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="password"
                          value={adminPasscodeInput}
                          onChange={(e) => setAdminPasscodeInput(e.target.value)}
                          placeholder="Master Passcode..."
                          className="flex-1 px-3 py-2 rounded-lg text-xs font-mono border focus:outline-none"
                          style={{
                            backgroundColor: 'var(--slk-bg-input)',
                            borderColor: 'var(--slk-border)',
                            color: 'var(--slk-text-primary)',
                          }}
                        />
                        <button
                          type="submit"
                          className="px-3.5 py-2 rounded-lg text-xs font-bold text-slate-950"
                          style={{ backgroundColor: 'var(--slk-accent)' }}
                        >
                          Buka
                        </button>
                      </div>
                      {adminPasscodeError && (
                        <p className="text-[11px] text-red-400">{adminPasscodeError}</p>
                      )}
                    </form>
                  )}

                  {showAdminPasscodeForm && isMasterPasscodeUnlocked && (
                    <form onSubmit={handleSubmitMasterAdminProfile} className="space-y-2.5 pt-1">
                      <div>
                        <label
                          className="block text-[11px] font-semibold mb-1"
                          style={{ color: 'var(--slk-text-secondary)' }}
                        >
                          Nama Lengkap &amp; Pangkat Master Admin
                        </label>
                        <input
                          type="text"
                          required
                          value={formName}
                          onChange={(e) => setFormName(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg text-xs border focus:outline-none"
                          style={{
                            backgroundColor: 'var(--slk-bg-input)',
                            borderColor: 'var(--slk-border)',
                            color: 'var(--slk-text-primary)',
                          }}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label
                            className="block text-[11px] font-semibold mb-1"
                            style={{ color: 'var(--slk-text-secondary)' }}
                          >
                            NRP
                          </label>
                          <input
                            type="text"
                            required
                            value={formNrp}
                            onChange={(e) => setFormNrp(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg text-xs font-mono border focus:outline-none"
                            style={{
                              backgroundColor: 'var(--slk-bg-input)',
                              borderColor: 'var(--slk-border)',
                              color: 'var(--slk-text-primary)',
                            }}
                          />
                        </div>
                        <div>
                          <label
                            className="block text-[11px] font-semibold mb-1"
                            style={{ color: 'var(--slk-text-secondary)' }}
                          >
                            Satuan
                          </label>
                          <input
                            type="text"
                            value={formUnit}
                            onChange={(e) => setFormUnit(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg text-xs border focus:outline-none"
                            style={{
                              backgroundColor: 'var(--slk-bg-input)',
                              borderColor: 'var(--slk-border)',
                              color: 'var(--slk-text-primary)',
                            }}
                          />
                        </div>
                      </div>
                      <div>
                        <label
                          className="block text-[11px] font-semibold mb-1"
                          style={{ color: 'var(--slk-text-secondary)' }}
                        >
                          Jabatan Taktis
                        </label>
                        <input
                          type="text"
                          value={formRank}
                          onChange={(e) => setFormRank(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg text-xs border focus:outline-none"
                          style={{
                            backgroundColor: 'var(--slk-bg-input)',
                            borderColor: 'var(--slk-border)',
                            color: 'var(--slk-text-primary)',
                          }}
                        />
                      </div>
                      <button
                        type="submit"
                        className="w-full py-2.5 px-4 rounded-lg text-xs font-bold text-slate-950 flex items-center justify-center gap-1.5"
                        style={{ backgroundColor: 'var(--slk-accent)' }}
                      >
                        <LogIn className="w-4 h-4" />
                        <span>Simpan Identitas Master Admin</span>
                      </button>
                    </form>
                  )}
                </div>
              )}

              {/* 3. SEPARATE PERMANENT DEVICE AUTHORIZATION REVOCATION ("Cabut Otorisasi Perangkat") */}
              <div className="rounded-xl p-3.5 border border-red-500/35 bg-red-950/20 space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-0.5">
                    <h4 className="text-xs font-bold text-red-400 flex items-center gap-1.5">
                      <ShieldAlert className="w-4 h-4 shrink-0" />
                      <span>Cabut Otorisasi Perangkat (Hapus Akun Permanen)</span>
                    </h4>
                    <p className="text-[11px] text-red-300/80 leading-relaxed">
                      Berbeda dengan Log Out / Kunci Sesi: tindakan ini akan menghapus permanen
                      kredensial identitas <code>{nodeIdentity?.peerId}</code> dan kunci dari{' '}
                      <code>localStorage</code> terenkripsi. Anda wajib memindai QR Code Admin baru
                      untuk masuk kembali.
                    </p>
                  </div>
                </div>

                {!confirmRevokeStep ? (
                  <button
                    type="button"
                    onClick={() => setConfirmRevokeStep(true)}
                    className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-red-950/70 hover:bg-red-900/80 border border-red-500/50 text-red-200 text-xs font-bold transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Cabut Otorisasi Perangkat Ini</span>
                  </button>
                ) : (
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmRevokeStep(false);
                        onRevokeDeviceAuthorization();
                      }}
                      className="flex-1 py-2 px-3 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition-colors"
                    >
                      Ya, Hapus Kredensial &amp; Cabut Otorisasi
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmRevokeStep(false)}
                      className="py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold"
                    >
                      Batal
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ================================================================
              TAB 2: PILIHAN TEMA MILITER (4 TEMA WARNA)
              ================================================================ */}
          {activeSection === 'theme' && (
            <div className="space-y-3">
              <div
                className="rounded-xl p-3.5 border"
                style={{
                  backgroundColor: 'var(--slk-bg-card)',
                  borderColor: 'var(--slk-border)',
                }}
              >
                <h3 className="text-xs font-bold uppercase tracking-wider mb-1">
                  Pilihan Tema Militer Taktis
                </h3>
                <p className="text-[11px]" style={{ color: 'var(--slk-text-secondary)' }}>
                  Pilih skema warna kamuflase operasi untuk seluruh tampilan obrolan, header, dan
                  gelembung pesan.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3">
                {(Object.keys(MILITARY_THEMES) as MilitaryThemeId[]).map((themeKey) => {
                  const theme = MILITARY_THEMES[themeKey];
                  const isSelected = activeTheme === theme.id;
                  return (
                    <button
                      key={theme.id}
                      onClick={() => onSelectTheme(theme.id)}
                      className="w-full text-left rounded-xl p-3.5 border-2 transition-all flex items-center justify-between gap-3"
                      style={{
                        backgroundColor: theme.bgCard,
                        borderColor: isSelected ? theme.accent : theme.border,
                        boxShadow: isSelected ? `0 0 18px ${theme.accentMuted}` : 'none',
                      }}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {/* Swatch Preview Circle */}
                        <div
                          className="w-12 h-12 rounded-xl overflow-hidden border flex flex-col shrink-0"
                          style={{ borderColor: theme.accent }}
                        >
                          <div
                            className="flex-1 w-full"
                            style={{ backgroundColor: theme.swatchColors[0] }}
                          />
                          <div className="flex-1 w-full flex">
                            <div
                              className="flex-1 h-full"
                              style={{ backgroundColor: theme.swatchColors[1] }}
                            />
                            <div
                              className="flex-1 h-full"
                              style={{ backgroundColor: theme.swatchColors[2] }}
                            />
                          </div>
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className="text-sm font-bold truncate"
                              style={{ color: theme.textPrimary }}
                            >
                              {theme.name}
                            </span>
                            <span
                              className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase"
                              style={{
                                backgroundColor: theme.accentMuted,
                                color: theme.accent,
                              }}
                            >
                              {theme.badgeText}
                            </span>
                          </div>
                          <p
                            className="text-xs mt-0.5 truncate"
                            style={{ color: theme.textSecondary }}
                          >
                            {theme.subtitle}
                          </p>
                        </div>
                      </div>

                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center border shrink-0"
                        style={{
                          backgroundColor: isSelected ? theme.accent : 'transparent',
                          borderColor: theme.accent,
                          color: isSelected ? '#05080c' : theme.accent,
                        }}
                      >
                        {isSelected && <Check className="w-4 h-4 stroke-[3]" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ================================================================
              TAB 3: PENGATURAN UMUM HP, FULLSCREEN & BACKGROUND KEEP-ALIVE
              ================================================================ */}
          {activeSection === 'general' && (
            <div className="space-y-3.5">
              {/* 1. Fullscreen Mode on HP */}
              <div
                className="rounded-xl p-4 border space-y-3"
                style={{
                  backgroundColor: 'var(--slk-bg-card)',
                  borderColor: 'var(--slk-border)',
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <Maximize2
                      className="w-5 h-5 mt-0.5 shrink-0"
                      style={{ color: 'var(--slk-accent)' }}
                    />
                    <div>
                      <h4 className="text-xs font-bold">
                        Mode Layar Penuh HP (Fullscreen APK)
                      </h4>
                      <p
                        className="text-[11px] mt-0.5"
                        style={{ color: 'var(--slk-text-secondary)' }}
                      >
                        Menyembunyikan bilah URL &amp; navigasi browser agar tampilan di HP 100%
                        layar penuh seperti aplikasi native.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={onToggleFullscreen}
                    className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold text-slate-950 transition-all"
                    style={{ backgroundColor: 'var(--slk-accent)' }}
                  >
                    {isFullscreen ? (
                      <span className="flex items-center gap-1">
                        <Minimize2 className="w-3.5 h-3.5" /> Keluar Full
                      </span>
                    ) : (
                      <span className="flex items-center gap-1">
                        <Maximize2 className="w-3.5 h-3.5" /> Fullscreen
                      </span>
                    )}
                  </button>
                </div>

                <div
                  className="flex items-center justify-between pt-2 border-t text-xs"
                  style={{ borderColor: 'var(--slk-border)' }}
                >
                  <span>Otomatis Fullscreen saat layar HP disentuh</span>
                  <button
                    type="button"
                    onClick={() => onToggleAutoFullscreen(!autoFullscreenOnTap)}
                    className="w-11 h-6 rounded-full transition-colors p-0.5 flex items-center"
                    style={{
                      backgroundColor: autoFullscreenOnTap
                        ? 'var(--slk-accent)'
                        : 'var(--slk-bg-input)',
                    }}
                  >
                    <div
                      className={`w-5 h-5 rounded-full bg-slate-950 transition-transform ${
                        autoFullscreenOnTap ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* 2. Background Operation while opening other apps */}
              <div
                className="rounded-xl p-4 border space-y-3"
                style={{
                  backgroundColor: 'var(--slk-bg-card)',
                  borderColor: 'var(--slk-border)',
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <Activity
                      className="w-5 h-5 mt-0.5 shrink-0"
                      style={{ color: 'var(--slk-accent)' }}
                    />
                    <div>
                      <h4 className="text-xs font-bold">
                        Tetap Beroperasi Saat Buka APK Lain (Background Daemon)
                      </h4>
                      <p
                        className="text-[11px] mt-0.5"
                        style={{ color: 'var(--slk-text-secondary)' }}
                      >
                        Menjaga koneksi P2P WebRTC &amp; WebSocket tetap hidup di latar belakang HP
                        menggunakan Web Audio Keep-Alive, MediaSession &amp; Web Lock.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onToggleKeepAlive(!keepAliveStatus.enabled)}
                    className="w-11 h-6 rounded-full transition-colors p-0.5 flex items-center shrink-0"
                    style={{
                      backgroundColor: keepAliveStatus.enabled
                        ? 'var(--slk-accent)'
                        : 'var(--slk-bg-input)',
                    }}
                  >
                    <div
                      className={`w-5 h-5 rounded-full bg-slate-950 transition-transform ${
                        keepAliveStatus.enabled ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {/* Live Telemetry of Background Daemon */}
                <div
                  className="rounded-lg p-2.5 text-[11px] font-mono space-y-1 border"
                  style={{
                    backgroundColor: 'var(--slk-bg-main)',
                    borderColor: 'var(--slk-border)',
                  }}
                >
                  <div className="flex justify-between">
                    <span style={{ color: 'var(--slk-text-secondary)' }}>
                      STATUS BACKGROUND DAEMON:
                    </span>
                    <span
                      className={
                        keepAliveStatus.enabled ? 'text-emerald-400 font-bold' : 'text-amber-400'
                      }
                    >
                      {keepAliveStatus.enabled ? 'AKTIF (ANTI-SLEEP)' : 'NONAKTIF'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span style={{ color: 'var(--slk-text-secondary)' }}>
                      MEDIA SESSION &amp; WEB LOCK:
                    </span>
                    <span>
                      {keepAliveStatus.webLockActive ? 'LOCKED' : 'STANDBY'} •{' '}
                      {keepAliveStatus.wakeLockActive ? 'WAKE-ON' : 'AUTO'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span style={{ color: 'var(--slk-text-secondary)' }}>
                      HEARTBEAT TERAKHIR:
                    </span>
                    <span>{keepAliveStatus.lastHeartbeat}</span>
                  </div>
                </div>
              </div>

              {/* 3. Sound & System Notification Toggle */}
              <div
                className="rounded-xl p-4 border flex items-center justify-between gap-3"
                style={{
                  backgroundColor: 'var(--slk-bg-card)',
                  borderColor: 'var(--slk-border)',
                }}
              >
                <div className="flex items-start gap-2.5">
                  <Volume2
                    className="w-5 h-5 mt-0.5 shrink-0"
                    style={{ color: 'var(--slk-accent)' }}
                  />
                  <div>
                    <h4 className="text-xs font-bold">
                      Suara &amp; Getar Notifikasi Taktis
                    </h4>
                    <p
                      className="text-[11px] mt-0.5"
                      style={{ color: 'var(--slk-text-secondary)' }}
                    >
                      Bunyikan nada dering &amp; notifikasi sistem saat pesan atau panggilan masuk
                      ketika membuka aplikasi lain.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const next = !soundAlertEnabled;
                    onToggleSoundAlert(next);
                    if (
                      next &&
                      typeof Notification !== 'undefined' &&
                      Notification.permission === 'default'
                    ) {
                      void Notification.requestPermission();
                    }
                  }}
                  className="w-11 h-6 rounded-full transition-colors p-0.5 flex items-center shrink-0"
                  style={{
                    backgroundColor: soundAlertEnabled
                      ? 'var(--slk-accent)'
                      : 'var(--slk-bg-input)',
                  }}
                >
                  <div
                    className={`w-5 h-5 rounded-full bg-slate-950 transition-transform ${
                      soundAlertEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* 4. Install WebAPK to HP Home Screen */}
              <div
                className="rounded-xl p-4 border space-y-2.5"
                style={{
                  backgroundColor: 'var(--slk-bg-card)',
                  borderColor: 'var(--slk-accent)',
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Smartphone className="w-4 h-4" style={{ color: 'var(--slk-accent)' }} />
                    <h4 className="text-xs font-bold">
                      Instalasi APK Fullscreen di HP (PWA Vercel)
                    </h4>
                  </div>
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded"
                    style={{
                      backgroundColor: 'var(--slk-accent-muted)',
                      color: 'var(--slk-accent)',
                    }}
                  >
                    {isInstalled ? 'TERINSTAL FULLSCREEN' : 'SIAP INSTAL'}
                  </span>
                </div>

                <p className="text-[11px]" style={{ color: 'var(--slk-text-secondary)' }}>
                  Setelah diinstal ke layar utama HP, SILENT LINK otomatis berjalan dalam mode{' '}
                  <strong>display: fullscreen</strong> tanpa bilah alamat browser.
                </p>

                {!isInstalled && isInstallable && (
                  <button
                    onClick={onPromptInstall}
                    className="w-full py-2.5 px-4 rounded-lg text-xs font-bold text-slate-950 flex items-center justify-center gap-2"
                    style={{ backgroundColor: 'var(--slk-accent)' }}
                  >
                    <Smartphone className="w-4 h-4" />
                    <span>Instal APK SILENT LINK Sekarang</span>
                  </button>
                )}

                {!isInstalled && isIOS && (
                  <button
                    onClick={() => setShowIOSGuide(!showIOSGuide)}
                    className="w-full py-2 px-3 rounded-lg text-xs font-bold border flex items-center justify-center gap-2"
                    style={{
                      backgroundColor: 'var(--slk-bg-input)',
                      borderColor: 'var(--slk-accent)',
                      color: 'var(--slk-accent)',
                    }}
                  >
                    <Share className="w-3.5 h-3.5" />
                    <span>Cara Instal Fullscreen di iPhone / iOS</span>
                  </button>
                )}

                {showIOSGuide && (
                  <div
                    className="rounded-lg p-3 text-xs space-y-1.5 border"
                    style={{
                      backgroundColor: 'var(--slk-bg-main)',
                      borderColor: 'var(--slk-border)',
                    }}
                  >
                    <p className="font-bold">Langkah Instal di iOS Safari:</p>
                    <p>1. Ketuk ikon <strong>Bagikan (Share)</strong> di bagian bawah Safari.</p>
                    <p>2. Pilih <strong>&quot;Tambah ke Layar Utama&quot; (Add to Home Screen)</strong>.</p>
                    <p>3. Buka ikon SILENT LINK dari layar utama HP untuk tampilan Fullscreen.</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Bottom Footer Bar */}
        <div
          className="px-4 py-3 border-t flex items-center justify-between text-[11px] shrink-0"
          style={{
            backgroundColor: 'var(--slk-bg-header)',
            borderColor: 'var(--slk-border)',
            color: 'var(--slk-text-secondary)',
          }}
        >
          <span className="flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5" style={{ color: 'var(--slk-accent)' }} />
            <span>Zero-Retention Pesan RAM • Auto-Reconnect</span>
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-xs font-bold text-slate-950"
            style={{ backgroundColor: 'var(--slk-accent)' }}
          >
            Selesai
          </button>
        </div>
      </div>
    </div>
  );
};
