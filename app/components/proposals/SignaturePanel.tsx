'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { PenLine, Type, RotateCcw, ShieldCheck } from 'lucide-react';
import { ESIGN_CONSENT_TEXT } from '@/lib/proposals/signature';

/**
 * Electronic signature capture (requirement 9).
 *
 * Typed or drawn. The drawn pad is a canvas backed by pointer events so it works
 * with a finger, a stylus, and a mouse from one code path — most insureds will
 * sign this on a phone.
 *
 * The canvas is sized to its own bounding box multiplied by the device pixel
 * ratio, otherwise a signature drawn on a retina phone exports blurred.
 */

interface Props {
  selectedOptionLabel: string;
  onSign: (payload: {
    signerName: string;
    signerTitle: string | null;
    signerEmail: string | null;
    signatureType: 'TYPED' | 'DRAWN';
    signatureData: string;
    consentAccepted: boolean;
  }) => Promise<void>;
}

export default function SignaturePanel({ selectedOptionLabel, onSign }: Props) {
  const [mode, setMode] = useState<'TYPED' | 'DRAWN'>('TYPED');
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [email, setEmail] = useState('');
  const [typed, setTyped] = useState('');
  const [consent, setConsent] = useState(false);
  const [hasDrawing, setHasDrawing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);

  /** Match the backing store to the CSS size so strokes are not blurred. */
  const sizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0D2137';
  }, []);

  useEffect(() => {
    if (mode !== 'DRAWN') return;
    sizeCanvas();
    window.addEventListener('resize', sizeCanvas);
    return () => window.removeEventListener('resize', sizeCanvas);
  }, [mode, sizeCanvas]);

  function pointFrom(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function startStroke(e: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    // Capture the pointer so a stroke continues if the finger leaves the canvas.
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const { x, y } = pointFrom(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function continueStroke(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = pointFrom(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!hasDrawing) setHasDrawing(true);
  }

  function endStroke() { drawing.current = false; }

  function clearCanvas() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawing(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!name.trim()) { setError('Please enter your full legal name.'); return; }
    if (!consent) { setError('Please tick the box to agree to sign electronically.'); return; }

    let signatureData: string;
    if (mode === 'DRAWN') {
      if (!hasDrawing) { setError('Please draw your signature.'); return; }
      signatureData = canvasRef.current!.toDataURL('image/png');
    } else {
      if (!typed.trim()) { setError('Please type your signature.'); return; }
      signatureData = typed.trim();
    }

    setSubmitting(true);
    try {
      await onSign({
        signerName: name.trim(),
        signerTitle: title.trim() || null,
        signerEmail: email.trim() || null,
        signatureType: mode,
        signatureData,
        consentAccepted: consent,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record your signature.');
    } finally {
      setSubmitting(false);
    }
  }

  const input = 'w-full px-3 py-2.5 rounded-md border border-slate-300 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-[color:var(--p-accent)] focus:border-transparent';
  const label = 'block text-xs font-medium text-slate-600 mb-1';

  return (
    <section className="rounded-xl border-2 bg-white p-5 sm:p-6" style={{ borderColor: 'var(--p-accent)' }}
             data-testid="signature-panel">
      <h2 className="text-xl sm:text-2xl font-medium mb-1" style={{ color: 'var(--p-primary)' }}>
        Sign and approve
      </h2>
      <p className="text-sm text-slate-500 mb-5">
        You are approving <span className="font-medium text-slate-700">{selectedOptionLabel}</span>.
      </p>

      {error && (
        <div className="mb-4 rounded-md px-3 py-2 text-sm" style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}
             role="alert" data-testid="signature-error">
          {error}
        </div>
      )}

      <form onSubmit={submit}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className={label} htmlFor="sig-name">Full legal name <span className="text-red-500">*</span></label>
            <input id="sig-name" className={input} value={name} onChange={(e) => setName(e.target.value)}
                   autoComplete="name" data-testid="signer-name" />
          </div>
          <div>
            <label className={label} htmlFor="sig-title">Title <span className="text-slate-400 font-normal">(optional)</span></label>
            <input id="sig-title" className={input} value={title} onChange={(e) => setTitle(e.target.value)}
                   placeholder="Owner" autoComplete="organization-title" />
          </div>
          <div className="sm:col-span-2">
            <label className={label} htmlFor="sig-email">Email <span className="text-slate-400 font-normal">(optional, for your copy)</span></label>
            <input id="sig-email" type="email" className={input} value={email}
                   onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </div>
        </div>

        {/* ── Signature ── */}
        <div className="mb-4">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
            <span className={label}>Signature <span className="text-red-500">*</span></span>
            <div className="flex rounded-md border border-slate-300 overflow-hidden" role="tablist">
              {([['TYPED', 'Type', Type], ['DRAWN', 'Draw', PenLine]] as const).map(([m, text, Icon]) => (
                <button
                  key={m} type="button" role="tab" aria-selected={mode === m}
                  onClick={() => { setMode(m); setError(''); }}
                  className="px-3 py-1.5 text-sm font-medium inline-flex items-center gap-1.5"
                  style={mode === m
                    ? { backgroundColor: 'var(--p-primary)', color: '#fff' }
                    : { color: '#64748b' }}
                  data-testid={`sig-mode-${m.toLowerCase()}`}
                >
                  <Icon className="w-3.5 h-3.5" /> {text}
                </button>
              ))}
            </div>
          </div>

          {mode === 'TYPED' ? (
            <>
              <input
                className={`${input} text-2xl`}
                style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontStyle: 'italic' }}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="Type your full name"
                aria-label="Typed signature"
                data-testid="typed-signature"
              />
              <p className="text-xs text-slate-400 mt-1">
                Type your name exactly as entered above.
              </p>
            </>
          ) : (
            <>
              <div className="relative rounded-md border border-slate-300 bg-white">
                <canvas
                  ref={canvasRef}
                  onPointerDown={startStroke}
                  onPointerMove={continueStroke}
                  onPointerUp={endStroke}
                  onPointerCancel={endStroke}
                  className="w-full h-40 touch-none rounded-md cursor-crosshair"
                  aria-label="Draw your signature"
                  data-testid="signature-canvas"
                />
                {!hasDrawing && (
                  <span className="absolute inset-0 flex items-center justify-center text-sm text-slate-300 pointer-events-none">
                    Sign here
                  </span>
                )}
              </div>
              <button type="button" onClick={clearCanvas}
                      className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-slate-700">
                <RotateCcw className="w-3 h-3" /> Clear
              </button>
            </>
          )}
        </div>

        {/* ── Consent (requirement 9) ── */}
        <label className="flex items-start gap-3 mb-5 cursor-pointer rounded-lg bg-slate-50 border border-slate-200 p-3">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="w-4 h-4 mt-0.5 flex-shrink-0 accent-[color:var(--p-accent)]"
            data-testid="consent-checkbox"
          />
          <span className="text-xs text-slate-600 leading-relaxed">{ESIGN_CONSENT_TEXT}</span>
        </label>

        <button
          type="submit"
          disabled={submitting}
          className="w-full sm:w-auto px-6 py-3 rounded-md text-base font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60"
          style={{ backgroundColor: 'var(--p-accent)', color: 'var(--p-primary)' }}
          data-testid="submit-signature"
        >
          <ShieldCheck className="w-5 h-5" />
          {submitting ? 'Signing…' : 'Sign and approve'}
        </button>

        <p className="text-xs text-slate-400 mt-3 leading-relaxed">
          Signing records your name, the date and time, and your device and network address as
          evidence of your agreement. Coverage is not in force until confirmed by the carrier.
        </p>
      </form>
    </section>
  );
}
