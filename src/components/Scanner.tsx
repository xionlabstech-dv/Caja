'use client';

import { useEffect, useRef, useState } from 'react';

interface ScannerProps {
  onDetect: (barcode: string) => Promise<{ nombre: string } | null> | void;
  onClose: () => void;
  continuous?: boolean;
}

export default function Scanner({ onDetect, onClose, continuous }: ScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const [manualCode, setManualCode] = useState('');
  const [showManual, setShowManual] = useState(false);
  const [banner, setBanner] = useState<{ text: string; ok: boolean } | null>(null);
  const [itemsAdded, setItemsAdded] = useState(0);
  const detectedRef = useRef(false);
  const cooldownRef = useRef<{ codigo: string; timestamp: number } | null>(null);
  const processingRef = useRef(false);
  const processCodeRef = useRef<((codigo: string) => Promise<void>) | null>(null);

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 1000);
    return () => clearTimeout(t);
  }, [banner]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let animFrame: number;

    const processCode = async (codigo: string) => {
      const now = Date.now();
      const cd = cooldownRef.current;
      if (cd && cd.codigo === codigo && now - cd.timestamp < 1200) return;
      if (processingRef.current) return;
      processingRef.current = true;
      cooldownRef.current = { codigo, timestamp: now };
      navigator.vibrate?.(30);
      const result = await (onDetect(codigo) as Promise<{ nombre: string } | null>);
      if (result) {
        setBanner({ text: `✓ ${result.nombre} agregado`, ok: true });
        setItemsAdded(c => c + 1);
      } else {
        setBanner({ text: `Código ${codigo} no encontrado`, ok: false });
      }
      processingRef.current = false;
    };

    processCodeRef.current = processCode;

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        if (!('BarcodeDetector' in window)) {
          setShowManual(true);
          setError('Escáner no disponible: ingresa el código manualmente');
          return;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const detector = new (window as any).BarcodeDetector({
          formats: ['ean_13', 'ean_8', 'qr_code', 'code_128', 'code_39', 'upc_a', 'upc_e'],
        });

        const scan = async () => {
          if (!continuous && detectedRef.current) return;
          if (!videoRef.current || videoRef.current.readyState < 2) {
            animFrame = requestAnimationFrame(scan);
            return;
          }
          try {
            const barcodes = await detector.detect(videoRef.current);
            if (barcodes.length > 0) {
              const codigo = barcodes[0].rawValue;
              if (!continuous) {
                if (!detectedRef.current) {
                  detectedRef.current = true;
                  onDetect(codigo);
                }
                return;
              }
              // Continuous: fire-and-forget; processingRef prevents overlap
              processCode(codigo);
            }
          } catch { /* continue */ }
          animFrame = requestAnimationFrame(scan);
        };

        scan();
      } catch {
        setShowManual(true);
        setError('No se pudo acceder a la cámara');
      }
    }

    start();

    return () => {
      cancelAnimationFrame(animFrame);
      stream?.getTracks().forEach(t => t.stop());
    };
  }, [onDetect, continuous]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleManualSubmit = async () => {
    const code = manualCode.trim();
    if (!code) return;
    if (continuous) {
      await processCodeRef.current?.(code);
      setManualCode('');
    } else {
      onDetect(code);
    }
  };

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col">
      <div className="flex items-center justify-between p-4 text-white">
        <h2 className="text-lg font-semibold">Escanear código</h2>
        <button onClick={onClose} className="p-2 rounded-lg bg-white/10">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 relative overflow-hidden">
        <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />

        {banner && (
          <div className={`absolute top-4 left-4 right-4 px-4 py-3 rounded-xl text-white text-sm font-semibold text-center shadow-lg ${
            banner.ok ? 'bg-emerald-600/90' : 'bg-amber-500/90'
          }`}>
            {banner.text}
          </div>
        )}

        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative w-64 h-44">
            <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-emerald-400 rounded-tl-lg" />
            <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-emerald-400 rounded-tr-lg" />
            <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-emerald-400 rounded-bl-lg" />
            <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-emerald-400 rounded-br-lg" />
            <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-emerald-400/60 animate-pulse" />
          </div>
        </div>
      </div>

      <div className="p-4 bg-black/80">
        {continuous && (
          <p className="text-white/60 text-xs text-center mb-2">
            {itemsAdded === 0
              ? 'Apunta al código de barras'
              : `${itemsAdded} producto${itemsAdded !== 1 ? 's' : ''} agregado${itemsAdded !== 1 ? 's' : ''}`}
          </p>
        )}
        {error && (
          <p className="text-yellow-400 text-sm text-center mb-3">{error}</p>
        )}
        {showManual && (
          <div className="flex gap-2">
            <input
              type="text"
              value={manualCode}
              onChange={e => setManualCode(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleManualSubmit(); }}
              placeholder="Ingresa el código..."
              className="flex-1 bg-white/10 text-white border border-white/30 rounded-xl px-4 py-3 text-lg placeholder-white/40"
              autoFocus
            />
            <button
              onClick={handleManualSubmit}
              className="bg-emerald-600 text-white px-4 py-3 rounded-xl font-semibold"
            >
              Buscar
            </button>
          </div>
        )}
        {!showManual && !continuous && (
          <p className="text-white/60 text-sm text-center">Apunta al código de barras</p>
        )}
      </div>
    </div>
  );
}
