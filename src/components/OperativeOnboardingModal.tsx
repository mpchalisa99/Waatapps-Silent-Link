import React, { useState, useEffect, useRef, useCallback } from 'react';
import jsQR from 'jsqr';
import {
  QrCode,
  ShieldCheck,
  KeyRound,
  Lock,
  X,
  ScanLine,
  AlertTriangle,
  ArrowRight,
  Radio,
  Camera,
  RefreshCw,
  Image as ImageIcon,
  CheckCircle2,
} from 'lucide-react';
import { ProvisionedOperativeCredential } from '../types/tactical';
import { verifyAndParseProvisioningToken } from '../utils/cryptoEngine';

interface OperativeOnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  recentAdminCredentials: ProvisionedOperativeCredential[];
  onCompleteOperativeOnboarding: (verifiedCred: ProvisionedOperativeCredential) => Promise<void>;
}

export const OperativeOnboardingModal: React.FC<OperativeOnboardingModalProps> = ({
  isOpen,
  onClose,
  recentAdminCredentials,
  onCompleteOperativeOnboarding,
}) => {
  const [tokenInput, setTokenInput] = useState('');
  const [verifiedPreview, setVerifiedPreview] = useState<ProvisionedOperativeCredential | null>(
    null
  );
  const [errorMsg, setErrorMsg] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);

  // Live Rear Camera QR Scanner State
  const [cameraState, setCameraState] = useState<'starting' | 'active' | 'denied' | 'stopped'>(
    'starting'
  );
  const [cameraErrorText, setCameraErrorText] = useState('');
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [lastScannedRaw, setLastScannedRaw] = useState('');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanTimerRef = useRef<number | null>(null);
  const isProcessingScanRef = useRef<boolean>(false);
  const qrImageInputRef = useRef<HTMLInputElement | null>(null);

  const stopCameraStream = useCallback(() => {
    if (scanTimerRef.current) {
      window.clearInterval(scanTimerRef.current);
      scanTimerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // Ignore
        }
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const playScannerSuccessBeep = useCallback(() => {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1320, ctx.currentTime);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.16);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.17);
    } catch {
      // Ignore audio policy block
    }
  }, []);

  const handleParseAndVerify = useCallback(
    async (rawTokenString: string, autoConnectOnSuccess = false) => {
      const cleaned = rawTokenString.trim();
      if (!cleaned) return;
      setErrorMsg('');
      setIsVerifying(true);
      try {
        const parsed = await verifyAndParseProvisioningToken(cleaned);
        setVerifiedPreview(parsed);
        setTokenInput(parsed.deepLinkUrl || parsed.encryptedToken);
        setLastScannedRaw(cleaned);
        stopCameraStream();
        setCameraState('stopped');

        if (autoConnectOnSuccess) {
          await onCompleteOperativeOnboarding(parsed);
          onClose();
        }
      } catch (err) {
        setVerifiedPreview(null);
        setErrorMsg(
          err instanceof Error
            ? err.message
            : 'Token QR / Deep Link tidak valid atau tanda tangan ECDSA ditolak.'
        );
        isProcessingScanRef.current = false;
      } finally {
        setIsVerifying(false);
      }
    },
    [onClose, onCompleteOperativeOnboarding, stopCameraStream]
  );

  // Start Rear Camera (facingMode: "environment") automatically when modal opens
  const startLiveCameraScanner = useCallback(
    async (mode: 'environment' | 'user' = facingMode) => {
      stopCameraStream();
      setCameraState('starting');
      setCameraErrorText('');
      isProcessingScanRef.current = false;

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraState('denied');
        setCameraErrorText(
          'Browser perangkat ini tidak mendukung akses kamera WebRTC. Gunakan tombol Pilih Gambar QR atau tempel Deep Link di bawah.'
        );
        return;
      }

      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: mode },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
      } catch {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: mode },
            audio: false,
          });
        } catch {
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              video: true,
              audio: false,
            });
          } catch (finalErr) {
            setCameraState('denied');
            setCameraErrorText(
              finalErr instanceof Error
                ? `Akses kamera ditolak atau tidak tersedia (${finalErr.message}). Izinkan kamera di browser HP atau tempel link ?invite= di bawah.`
                : 'Izin kamera belum diberikan. Izinkan akses kamera HP atau tempel Deep Link di bawah.'
            );
            return;
          }
        }
      }

      if (!stream) return;
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        try {
          await videoRef.current.play();
        } catch {
          // Autoplay handled by muted playsInline
        }
      }

      setCameraState('active');

      // Real-time QR & Barcode frame decoding loop (every 140ms using jsQR)
      scanTimerRef.current = window.setInterval(() => {
        if (isProcessingScanRef.current) return;
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas || video.readyState < HTMLMediaElement.HAVE_ENOUGH_DATA) {
          return;
        }

        const vw = video.videoWidth;
        const vh = video.videoHeight;
        if (!vw || !vh) return;

        // Scale down to max 640px width for fast real-time mobile CPU decoding
        const targetW = Math.min(640, vw);
        const targetH = Math.floor((vh / vw) * targetW);
        canvas.width = targetW;
        canvas.height = targetH;

        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;

        ctx.drawImage(video, 0, 0, targetW, targetH);
        const imageData = ctx.getImageData(0, 0, targetW, targetH);

        const qrResult = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'attemptBoth',
        });

        if (qrResult && qrResult.data && qrResult.data.trim().length > 4) {
          const detectedText = qrResult.data.trim();
          isProcessingScanRef.current = true;
          playScannerSuccessBeep();
          void handleParseAndVerify(detectedText, true);
        }
      }, 140);
    },
    [facingMode, handleParseAndVerify, playScannerSuccessBeep, stopCameraStream]
  );

  useEffect(() => {
    if (isOpen) {
      setVerifiedPreview(null);
      setErrorMsg('');
      setLastScannedRaw('');
      void startLiveCameraScanner('environment');
    } else {
      stopCameraStream();
    }
    return () => {
      stopCameraStream();
    };
  }, [isOpen, startLiveCameraScanner, stopCameraStream]);

  // Decode QR Code from an uploaded/selected image file (e.g. screenshot from WhatsApp)
  const handleScanQrFromImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg('');

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = canvasRef.current || document.createElement('canvas');
        const maxDim = 1024;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        canvas.width = Math.max(1, Math.floor(img.width * scale));
        canvas.height = Math.max(1, Math.floor(img.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const qrResult = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'attemptBoth',
        });
        if (qrResult && qrResult.data) {
          playScannerSuccessBeep();
          void handleParseAndVerify(qrResult.data, true);
        } else {
          setErrorMsg('QR Code tidak terdeteksi pada gambar tersebut. Pastikan gambar QR terlihat jelas.');
        }
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  if (!isOpen) return null;

  const handleEstablishSession = async () => {
    if (!verifiedPreview) return;
    setIsVerifying(true);
    try {
      await onCompleteOperativeOnboarding(verifiedPreview);
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal membuka sesi E2EE WebRTC.');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleToggleCameraFacing = () => {
    const nextMode = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextMode);
    void startLiveCameraScanner(nextMode);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
      <div className="w-full max-w-xl bg-[#111b21] border border-[#222e35] rounded-2xl text-slate-100 shadow-2xl my-auto overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-5 py-3.5 border-b border-[#222e35] bg-[#202c33]">
          <div className="flex items-center gap-2.5">
            <ScanLine className="w-5 h-5 text-[#00f0ff]" />
            <div>
              <h2 className="text-sm sm:text-base font-bold text-slate-100 leading-tight">
                Pindai QR Code / Deep Link Admin
              </h2>
              <p className="text-[11px] text-cyan-300/80">
                Pemindai Kamera Belakang Real-Time &amp; Otorisasi Klien P2P
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              stopCameraStream();
              onClose();
            }}
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-100 hover:bg-white/10"
            aria-label="Tutup modal onboarding"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-4 text-sm max-h-[85vh] overflow-y-auto">
          {/* Hidden Canvas for jsQR Frame Processing & File Input for Gallery QR Scan */}
          <canvas ref={canvasRef} className="hidden" />
          <input
            ref={qrImageInputRef}
            type="file"
            accept="image/*"
            onChange={handleScanQrFromImageFile}
            className="hidden"
          />

          {/* LIVE CAMERA QR SCANNER VIEWPORT */}
          <div className="rounded-2xl overflow-hidden border border-cyan-500/40 bg-[#070d12] relative shadow-inner">
            <div className="px-3.5 py-2 bg-[#16222a] border-b border-cyan-500/20 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    cameraState === 'active'
                      ? 'bg-emerald-400 animate-ping'
                      : cameraState === 'starting'
                      ? 'bg-amber-400 animate-pulse'
                      : 'bg-red-400'
                  }`}
                />
                <span className="text-[11px] font-mono font-bold text-[#00f0ff] uppercase tracking-wider">
                  {cameraState === 'active'
                    ? `KAMERA ${facingMode === 'environment' ? 'BELAKANG' : 'DEPAN'} AKTIF (REAL-TIME QR)`
                    : cameraState === 'starting'
                    ? 'MENYALAKAN KAMERA BELAKANG HP...'
                    : cameraState === 'stopped'
                    ? 'QR TERDETEKSI · KAMERA SELESAI'
                    : 'KAMERA TIDAK TERSEDIA'}
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleToggleCameraFacing}
                  className="px-2.5 py-1 rounded-lg bg-[#202c33] hover:bg-[#2a3942] text-[11px] font-semibold text-cyan-300 flex items-center gap-1 border border-cyan-500/30"
                  title="Putar Kamera Depan/Belakang"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Putar Kamera</span>
                </button>
                <button
                  type="button"
                  onClick={() => qrImageInputRef.current?.click()}
                  className="px-2.5 py-1 rounded-lg bg-[#202c33] hover:bg-[#2a3942] text-[11px] font-semibold text-slate-200 flex items-center gap-1 border border-slate-700"
                  title="Pindai dari Gambar / Screenshot QR di Galeri HP"
                >
                  <ImageIcon className="w-3 h-3 text-[#00f0ff]" />
                  <span>Galeri QR</span>
                </button>
              </div>
            </div>

            {/* Video Feed Container */}
            <div className="relative w-full h-56 sm:h-64 bg-black flex items-center justify-center overflow-hidden">
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className={`w-full h-full object-cover ${
                  cameraState === 'active' ? 'opacity-100' : 'opacity-20'
                }`}
              />

              {/* Tactical Viewfinder Overlay when Camera is Active */}
              {cameraState === 'active' && (
                <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center">
                  <div className="w-44 h-44 sm:w-48 sm:h-48 relative border border-cyan-400/30 rounded-xl shadow-[0_0_0_9999px_rgba(3,12,20,0.45)]">
                    {/* 4 Corner Targeting Brackets */}
                    <div className="absolute -top-0.5 -left-0.5 w-6 h-6 border-t-4 border-l-4 border-[#00f0ff] rounded-tl-lg" />
                    <div className="absolute -top-0.5 -right-0.5 w-6 h-6 border-t-4 border-r-4 border-[#00f0ff] rounded-tr-lg" />
                    <div className="absolute -bottom-0.5 -left-0.5 w-6 h-6 border-b-4 border-l-4 border-[#00f0ff] rounded-bl-lg" />
                    <div className="absolute -bottom-0.5 -right-0.5 w-6 h-6 border-b-4 border-r-4 border-[#00f0ff] rounded-br-lg" />

                    {/* Animated Laser Scanline */}
                    <div className="w-full h-0.5 bg-gradient-to-r from-transparent via-[#00f0ff] to-transparent shadow-[0_0_12px_#00f0ff] animate-bounce mt-20" />
                  </div>
                  <span className="mt-3 px-3 py-1 rounded-full bg-black/75 border border-cyan-500/40 text-[11px] font-medium text-cyan-200">
                    Arahkan kamera ke QR Code dari HP Admin
                  </span>
                </div>
              )}

              {cameraState === 'starting' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs text-cyan-300">
                  <Camera className="w-8 h-8 animate-pulse text-[#00f0ff]" />
                  <span>Mengaktifkan lensa kamera belakang...</span>
                </div>
              )}

              {cameraState === 'stopped' && verifiedPreview && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-emerald-950/80 text-emerald-200 p-4 text-center">
                  <CheckCircle2 className="w-10 h-10 text-emerald-400" />
                  <div className="text-sm font-bold">
                    QR Code Personel Berhasil Dipindai!
                  </div>
                  <div className="text-xs font-mono text-emerald-300">
                    ID: {verifiedPreview.assignedPeerId} ({verifiedPreview.personnelName})
                  </div>
                  <button
                    type="button"
                    onClick={() => void startLiveCameraScanner(facingMode)}
                    className="mt-1 px-3 py-1 rounded-full bg-black/50 hover:bg-black/70 border border-emerald-400/40 text-[11px] font-semibold"
                  >
                    Pindai Ulang Kamera
                  </button>
                </div>
              )}

              {cameraState === 'denied' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 p-5 text-center bg-[#070d12]/95">
                  <Camera className="w-8 h-8 text-amber-400" />
                  <p className="text-xs text-slate-300 max-w-sm leading-relaxed">
                    {cameraErrorText}
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => void startLiveCameraScanner('environment')}
                      className="px-3.5 py-1.5 rounded-full bg-[#00f0ff] text-[#031525] text-xs font-bold flex items-center gap-1.5"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      <span>Coba Nyalakan Kamera</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => qrImageInputRef.current?.click()}
                      className="px-3.5 py-1.5 rounded-full bg-[#202c33] border border-cyan-500/40 text-cyan-300 text-xs font-bold flex items-center gap-1.5"
                    >
                      <ImageIcon className="w-3.5 h-3.5" />
                      <span>Pilih Gambar QR dari Galeri</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {recentAdminCredentials.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-[#00f0ff] flex items-center gap-1.5">
                <QrCode className="w-4 h-4" />
                <span>Pindai Instan QR / Barcode Personel yang Baru Dibuat Admin:</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {recentAdminCredentials.map((cred) => (
                  <button
                    key={cred.assignedPeerId}
                    type="button"
                    onClick={() => void handleParseAndVerify(cred.deepLinkUrl, true)}
                    className="p-3 rounded-xl bg-[#202c33] hover:bg-[#2a3942] border border-cyan-500/20 text-left transition-colors flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-100 truncate">
                        {cred.personnelName}
                      </div>
                      <div className="text-[11px] text-[#00f0ff] tabular-nums">
                        NRP: {cred.nrp}
                      </div>
                      <div className="text-[10px] text-cyan-300/90 font-mono truncate mt-0.5">
                        ID: {cred.assignedPeerId}
                      </div>
                    </div>
                    <span className="px-2.5 py-1 rounded-full bg-[#00f0ff] text-[#031525] text-[11px] font-bold shrink-0">
                      Scan QR
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Alternative Method: Paste Deep Link (?invite=...) */}
          <div className="space-y-2 pt-1 border-t border-[#222e35]">
            <label className="block text-xs font-semibold text-slate-300">
              Metode Alternatif — Tempel Deep Link Undangan (<code>?invite=SLK-ID-...</code>) atau Token:
            </label>
            <textarea
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="Tempel Link Undangan dari WhatsApp (?invite=SLK-ID-...), ID Barcode (SLK-ID-...), atau Token SLK2..."
              rows={2}
              className="w-full bg-[#202c33] border border-[#2a3942] rounded-xl p-3 text-xs text-[#00f0ff] font-mono focus:outline-none focus:border-[#00f0ff]"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-slate-400 flex items-center gap-1">
                <Lock className="w-3 h-3 text-[#00f0ff] shrink-0" />
                <span>Jika link diklik dari WhatsApp/Browser, otomatis login tanpa paste.</span>
              </span>
              <button
                type="button"
                disabled={isVerifying || !tokenInput.trim()}
                onClick={() => void handleParseAndVerify(tokenInput, false)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#202c33] hover:bg-[#2a3942] border border-cyan-500/30 disabled:opacity-40 text-slate-100 text-xs font-semibold transition-colors shrink-0"
              >
                <KeyRound className="w-3.5 h-3.5 text-[#00f0ff]" />
                <span>Verifikasi Link</span>
              </button>
            </div>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-xl bg-red-950/70 border border-red-500/50 text-red-200 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
              <span>{errorMsg}</span>
            </div>
          )}

          {verifiedPreview && (
            <div className="p-4 rounded-xl bg-[#0b141a] border border-cyan-500/40 space-y-3">
              <div className="flex items-center justify-between border-b border-[#202c33] pb-2">
                <div className="flex items-center gap-2 text-[#00f0ff] text-xs font-bold">
                  <ShieldCheck className="w-4 h-4" />
                  <span>KREDENSIAL &amp; ID PERSONEL UNIK VALID</span>
                </div>
                <span className="text-[11px] text-cyan-300 font-mono">
                  {verifiedPreview.assignedPeerId}
                </span>
              </div>

              {lastScannedRaw && (
                <div className="text-[11px] text-emerald-400 font-mono truncate">
                  ✓ Terverifikasi &amp; Disimpan Terenkripsi untuk Auto-Reconnect
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                <div className="p-2.5 rounded-lg bg-[#111b21]">
                  <div className="text-slate-400 text-[11px]">Nama Personel</div>
                  <div className="text-slate-100 font-bold mt-0.5">
                    {verifiedPreview.personnelName}
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-[#111b21]">
                  <div className="text-slate-400 text-[11px]">NRP &amp; Satuan</div>
                  <div className="text-[#00f0ff] font-bold mt-0.5">
                    {verifiedPreview.nrp} · {verifiedPreview.unit}
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-[#111b21]">
                  <div className="text-slate-400 text-[11px]">ID Personel Unik</div>
                  <div className="text-cyan-300 font-mono font-bold mt-0.5">
                    {verifiedPreview.assignedPeerId}
                  </div>
                </div>
              </div>

              <button
                type="button"
                disabled={isVerifying}
                onClick={handleEstablishSession}
                className="w-full flex items-center justify-center gap-2 py-3 px-5 rounded-full bg-[#00f0ff] hover:bg-cyan-300 text-[#031525] font-bold text-sm transition-colors"
              >
                <Radio className="w-4 h-4" />
                <span>Hubungkan Sesi E2EE Sekarang</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
