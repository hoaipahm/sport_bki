'use client';

import React, { useRef, useState, useEffect } from 'react';
import {
  X,
  Copy,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Download,
  QrCode,
  Check,
  RefreshCw,
  FlaskConical,
  AlertCircle,
} from 'lucide-react';
import { customerApi } from '../lib/api';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { Button } from './ui/Button';
import { useDialog } from '../hooks/useDialog';

export interface VietQrBookingData {
  bookingId: string;
  bookingCode: string;
  allBookingIds?: string[];
  allBookingCodes?: string[];
  slotsLabel?: string;
  courtName: string;
  startAt: string;
  endAt: string;
  totalAmount: number;
  depositAmount: number;
  paidAmount?: number;
  paymentMode?: 'live' | 'sandbox' | 'none';
  emailMode?: 'smtp' | 'test_mode';
  vietqrUrl?: string;
  bankAccount?: {
    bank_name: string;
    account_number: string;
    account_name: string;
    bin: string;
  };
  holdExpiresAt?: string;
}

interface VietQrModalProps {
  isOpen: boolean;
  onClose: () => void;
  bookingData: VietQrBookingData | null;
  onBookingConfirmed?: () => void;
}

export function VietQrModal({ isOpen, onClose, bookingData, onBookingConfirmed }: VietQrModalProps) {
  const { language, t } = useLanguage();
  const dialog = useRef<HTMLDivElement>(null);
  useDialog(isOpen, dialog, onClose);
  const { authHeaders } = useAuth();

  const [timeLeft, setTimeLeft] = useState<number>(600);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [bookingStatus, setBookingStatus] = useState<'PENDING' | 'CONFIRMED' | 'EXPIRED' | 'CANCELLED'>('PENDING');
  const [paidAmount, setPaidAmount] = useState<number>(0);
  const [reviewReason, setReviewReason] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [simulating, setSimulating] = useState<string | null>(null);
  const [downloadingIcs, setDownloadingIcs] = useState(false);

  useEffect(() => {
    if (!bookingData || !isOpen) return;
    setConfirmingCancel(false);
    setPaidAmount(bookingData.paidAmount || 0);
    setReviewReason(null);

    if (bookingData.depositAmount === 0) {
      setBookingStatus('CONFIRMED');
      return;
    }

    setBookingStatus('PENDING');
    const expiresAt = bookingData.holdExpiresAt
      ? new Date(bookingData.holdExpiresAt).getTime()
      : Date.now() + 600 * 1000;

    const updateCountdown = () => {
      const remainingSecs = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      setTimeLeft(remainingSecs);
      if (remainingSecs <= 0) {
        setBookingStatus(curr => (curr === 'CONFIRMED' ? 'CONFIRMED' : 'EXPIRED'));
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [bookingData, isOpen]);

  // Poll live booking & ledger state every 2.2s
  useEffect(() => {
    if (!bookingData?.bookingId || !isOpen || bookingStatus === 'CONFIRMED' || bookingStatus === 'CANCELLED') {
      return;
    }

    const checkStatus = async () => {
      try {
        const res = await fetch(`${customerApi}/bookings/${bookingData.bookingId}`, {
          headers: authHeaders(),
        });
        if (res.ok) {
          const { booking: data } = await res.json();
          setPaidAmount(Number(data.paid_amount || 0));
          setReviewReason(data.payment_review_reason || null);
          if (data.status === 'CONFIRMED') {
            setBookingStatus('CONFIRMED');
            if (onBookingConfirmed) onBookingConfirmed();
          } else if (data.status === 'CANCELLED' || data.status === 'EXPIRED') {
            setBookingStatus(data.status);
          }
        }
      } catch {
        // Ignore transient network hiccup while polling
      }
    };

    const pollInterval = setInterval(checkStatus, 2200);
    return () => clearInterval(pollInterval);
  }, [bookingData, isOpen, bookingStatus, authHeaders, onBookingConfirmed]);

  if (!isOpen || !bookingData) return null;

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleCancelHold = async () => {
    setIsCancelling(true);
    try {
      const ids = bookingData.allBookingIds && bookingData.allBookingIds.length > 0
        ? bookingData.allBookingIds
        : [bookingData.bookingId];
      let allOk = true;
      for (const bid of ids) {
        const res = await fetch(`${customerApi}/bookings/${bid}/cancel`, {
          method: 'POST',
          headers: { ...authHeaders(), 'Accept-Language': language },
        });
        if (!res.ok) allOk = false;
      }
      if (allOk) {
        setBookingStatus('CANCELLED');
        if (onBookingConfirmed) onBookingConfirmed();
        setTimeout(onClose, 600);
      }
    } finally {
      setIsCancelling(false);
    }
  };

  const handleDownloadIcs = async () => {
    setDownloadingIcs(true);
    try {
      const res = await fetch(`${customerApi}/bookings/${bookingData.bookingId}/ics`, {
        headers: authHeaders(),
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `booking-${bookingData.bookingCode}.ics`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } finally {
      setDownloadingIcs(false);
    }
  };

  const runSandboxScenario = async (scenario: 'exact' | 'underpay' | 'overpay' | 'late') => {
    setSimulating(scenario);
    try {
      const res = await fetch(`${customerApi}/bookings/${bookingData.bookingId}/sandbox-pay`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Accept-Language': language, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenario,
          booking_ids: bookingData.allBookingIds,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        if (data.paidAmount !== undefined) setPaidAmount(Number(data.paidAmount));
        if (data.outcome === 'UNDERPAID') {
          setReviewReason('UNDERPAID');
        } else if (data.outcome === 'LATE_PAYMENT_REVIEW') {
          setReviewReason('LATE_PAYMENT');
          setBookingStatus('EXPIRED');
        } else if (data.bookingStatus === 'CONFIRMED') {
          setBookingStatus('CONFIRMED');
          if (onBookingConfirmed) onBookingConfirmed();
        }
      }
    } finally {
      setSimulating(null);
    }
  };

  const formatVnd = (amount: number) =>
    new Intl.NumberFormat(language === 'vi' ? 'vi-VN' : 'en-US', {
      style: 'currency',
      currency: 'VND',
      maximumFractionDigits: 0,
    }).format(amount);

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const timeFormatted = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  const progressPct = Math.min(100, Math.max(0, (timeLeft / 600) * 100));

  const isSandbox = bookingData.paymentMode === 'sandbox' || bookingData.bankAccount?.bin === 'SANDBOX';
  const bankName = bookingData.bankAccount?.bank_name || '';
  const accountNumber = bookingData.bankAccount?.account_number || '';
  const accountName = bookingData.bankAccount?.account_name || '';
  const bin = bookingData.bankAccount?.bin || '';
  const transferNote = bookingData.bookingCode;
  const remainingDeposit = Math.max(0, bookingData.depositAmount - paidAmount);
  const amountToPay = remainingDeposit > 0 ? remainingDeposit : bookingData.depositAmount;

  const vietQrImgUrl =
    !isSandbox && bin && accountNumber
      ? `https://img.vietqr.io/image/${encodeURIComponent(bin)}-${encodeURIComponent(accountNumber)}-compact2.png?amount=${amountToPay}&addInfo=${encodeURIComponent(transferNote)}&accountName=${encodeURIComponent(accountName)}`
      : bookingData.vietqrUrl;

  return (
    <div className="modal-backdrop-anim fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-overlay">
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="VietQrModal-title"
        className="modal-panel-anim customer-shell bg-panel rounded-t-token-lg sm:rounded-token-lg shadow-token-elevated max-w-lg w-full overflow-hidden border border-borderStrong max-h-[94dvh] flex flex-col text-textBody"
      >
        {/* Modal Header */}
        <div className="bg-panel-2 text-textStrong px-6 py-4 flex items-center justify-between border-b border-borderToken">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-token-sm bg-accent-soft border border-accent-border flex items-center justify-center">
              <QrCode className="w-4 h-4 text-accent" />
            </div>
            <div>
              <h3 id="VietQrModal-title" className="font-bold text-base leading-tight text-textStrong">
                {bookingStatus === 'CONFIRMED' ? t('web.copy36') : t('web.copy37')}
              </h3>
              <p className="text-xs text-textMuted font-mono tabular-nums">{bookingData.bookingCode}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label={t('web.close')}
            className="text-textMuted hover:text-textStrong min-h-[44px] min-w-[44px] flex items-center justify-center rounded-token-md hover:bg-surfaceHover"
            type="button"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-5">
          {bookingStatus === 'CONFIRMED' ? (
            <div className="text-center py-4 space-y-4">
              <div className="w-16 h-16 bg-accent-soft text-accent rounded-token-full flex items-center justify-center mx-auto border border-accent-border">
                <CheckCircle2 className="w-9 h-9" />
              </div>
              <div>
                <h4 className="text-xl font-extrabold text-textStrong">{t('web.copy38')}</h4>
                <p className="text-sm text-textBody mt-1.5 leading-relaxed">
                  {bookingData.emailMode === 'smtp'
                    ? t('web.confirmedEmailSmtp')
                    : t('web.confirmedEmailTest')}
                </p>
              </div>

              <div className="bg-panel-2 border border-borderToken rounded-token-md p-4 text-left text-sm text-textBody space-y-2.5 tabular-nums">
                <div className="flex justify-between gap-2">
                  <span className="text-textMuted">{t('web.copy39')}</span>
                  <span className="font-semibold text-textStrong">{bookingData.courtName}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-textMuted">{t('web.copy40')}</span>
                  <span className="font-semibold text-textStrong text-right">
                    {bookingData.slotsLabel ||
                      `${new Date(bookingData.startAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} – ${new Date(bookingData.endAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`}{' '}
                    ({new Date(bookingData.startAt).toLocaleDateString('vi-VN')})
                  </span>
                </div>
                <div className="flex justify-between gap-2 border-t border-borderToken pt-2.5">
                  <span className="text-textMuted">{t('web.paidAmount')}</span>
                  <span className="font-bold text-accent">{formatVnd(paidAmount || bookingData.depositAmount)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-textMuted">{t('web.dueAtVenue')}</span>
                  <span className="font-bold text-textStrong">
                    {formatVnd(Math.max(0, bookingData.totalAmount - (paidAmount || bookingData.depositAmount)))}
                  </span>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <Button
                  variant="secondary"
                  type="button"
                  disabled={downloadingIcs}
                  onClick={handleDownloadIcs}
                  className="flex-1"
                >
                  <Download className="w-4 h-4 text-accent mr-2" />
                  <span>{t('web.copy42')}</span>
                </Button>
                <Button variant="primary" type="button" onClick={onClose} className="flex-1">
                  {t('web.copy43')}
                </Button>
              </div>
            </div>
          ) : bookingStatus === 'EXPIRED' ? (
            <div className="text-center py-5 space-y-4">
              <div className="w-16 h-16 bg-statusDanger-soft text-statusDanger rounded-token-full flex items-center justify-center mx-auto border border-statusDanger-border">
                <AlertTriangle className="w-9 h-9" />
              </div>
              <h4 className="text-lg font-bold text-textStrong">{t('web.copy44')}</h4>
              {reviewReason === 'LATE_PAYMENT' ? (
                <div className="p-3.5 rounded-token-md bg-statusWarning-soft border border-statusWarning-border text-statusWarning text-sm">
                  {t('web.latePaymentNotice')}
                </div>
              ) : (
                <p className="text-sm text-textBody">
                  {language === 'vi'
                    ? 'Thời gian giữ sân 10 phút đã hết. Khung giờ này đã được giải phóng để khách khác có thể đặt.'
                    : 'The 10-minute hold window has expired and the court slots have been released.'}
                </p>
              )}
              <Button variant="secondary" type="button" onClick={onClose} className="w-full">
                {t('web.copy45')}
              </Button>
            </div>
          ) : (
            <>
              {/* Hold Countdown with Progress Bar */}
              <div
                className={`p-3.5 rounded-token-md border space-y-2 ${
                  timeLeft < 120
                    ? 'bg-statusDanger-soft border-statusDanger-border text-statusDanger'
                    : 'bg-statusWarning-soft border-statusWarning-border text-statusWarning'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2 text-sm font-semibold">
                    <Clock className="w-4 h-4 shrink-0" />
                    <span>{t('web.copy46')}</span>
                  </div>
                  <div className="text-base font-mono font-extrabold tracking-wider tabular-nums">
                    {timeFormatted}
                  </div>
                </div>
                <div className="w-full h-1.5 rounded-token-full bg-page/50 overflow-hidden">
                  <div
                    className={`h-full rounded-token-full transition-[width] duration-1000 ${
                      timeLeft < 120 ? 'bg-statusDanger' : 'bg-statusWarning'
                    }`}
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>

              {/* Underpayment Alert */}
              {reviewReason === 'UNDERPAID' && paidAmount > 0 && remainingDeposit > 0 && (
                <div
                  role="alert"
                  className="p-3.5 rounded-token-md bg-statusWarning-soft border border-statusWarning-border text-statusWarning text-sm flex items-start gap-2.5"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="font-semibold">
                    {t('web.underpaidAlert', {
                      paid: formatVnd(paidAmount),
                      remaining: formatVnd(remainingDeposit),
                    })}
                  </span>
                </div>
              )}

              {/* Live VietQR vs Explicit Sandbox Panel */}
              {isSandbox ? (
                <div className="rounded-token-md bg-panel-2 border border-statusWarning-border p-4 space-y-3.5">
                  <div className="flex items-start gap-2.5">
                    <FlaskConical className="w-5 h-5 text-statusWarning shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold text-sm text-statusWarning">{t('web.sandboxBannerTitle')}</p>
                      <p className="text-xs text-textBody mt-1 leading-relaxed">{t('web.sandboxBannerDesc')}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                    <Button
                      variant="primary"
                      size="sm"
                      type="button"
                      disabled={Boolean(simulating)}
                      onClick={() => runSandboxScenario('exact')}
                    >
                      <span>{simulating === 'exact' ? '...' : t('web.simExact')}</span>
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      type="button"
                      disabled={Boolean(simulating)}
                      onClick={() => runSandboxScenario('underpay')}
                    >
                      <span>{simulating === 'underpay' ? '...' : t('web.simUnderpay')}</span>
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      type="button"
                      disabled={Boolean(simulating)}
                      onClick={() => runSandboxScenario('overpay')}
                    >
                      <span>{simulating === 'overpay' ? '...' : t('web.simOverpay')}</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      disabled={Boolean(simulating)}
                      onClick={() => runSandboxScenario('late')}
                      className="border border-statusDanger-border text-statusDanger"
                    >
                      <span>{simulating === 'late' ? '...' : t('web.simLate')}</span>
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center bg-panel-2 border border-borderToken rounded-token-md p-4">
                  {vietQrImgUrl && (
                    <div className="bg-qrSurface p-3 rounded-token-sm shadow-sm">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={vietQrImgUrl}
                        alt="VietQR Payment Code"
                        className="w-52 h-52 object-contain mx-auto"
                      />
                    </div>
                  )}
                  <div className="flex items-center space-x-1.5 mt-3 text-xs text-textMuted font-medium">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-accent" />
                    <span>{t('web.copy47')}</span>
                  </div>
                </div>
              )}

              {/* Payment Summary Table */}
              <div className="bg-panel-2 border border-borderToken rounded-token-md divide-y divide-borderToken text-xs sm:text-sm tabular-nums">
                {!isSandbox && (
                  <>
                    <div className="flex items-center justify-between p-3">
                      <span className="text-textMuted">{t('web.copy48')}</span>
                      <span className="font-semibold text-textStrong">{bankName}</span>
                    </div>
                    <div className="flex items-center justify-between p-3">
                      <span className="text-textMuted">{t('web.copy49')}</span>
                      <div className="flex items-center space-x-2">
                        <span className="font-mono font-bold text-textStrong text-sm">{accountNumber}</span>
                        <button
                          onClick={() => copyToClipboard(accountNumber, 'acc')}
                          className="text-accent hover:text-accent-hover p-1.5 rounded hover:bg-surfaceHover"
                          aria-label="Copy account number"
                          type="button"
                        >
                          {copiedField === 'acc' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between p-3">
                      <span className="text-textMuted">{t('web.copy50')}</span>
                      <span className="font-semibold text-textStrong uppercase">{accountName}</span>
                    </div>
                  </>
                )}

                <div className="flex items-center justify-between p-3 bg-accent-soft">
                  <span className="text-textStrong font-medium">{t('web.copy51')}</span>
                  <div className="flex items-center space-x-2">
                    <span className="font-extrabold text-accent text-base font-mono">
                      {formatVnd(amountToPay)}
                    </span>
                    <button
                      onClick={() => copyToClipboard(amountToPay.toString(), 'amount')}
                      className="text-accent hover:text-accent-hover p-1.5 rounded hover:bg-surfaceHover"
                      aria-label="Copy payment amount"
                      type="button"
                    >
                      {copiedField === 'amount' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between p-3 bg-statusWarning-soft">
                  <div>
                    <span className="text-statusWarning font-semibold block">{t('web.copy52')}</span>
                    <span className="text-xs text-textMuted">({t('web.copy53')})</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="font-mono font-extrabold text-statusWarning bg-panel px-2.5 py-1 rounded border border-statusWarning-border text-sm">
                      {transferNote}
                    </span>
                    <button
                      onClick={() => copyToClipboard(transferNote, 'note')}
                      className="text-statusWarning p-1.5 rounded hover:bg-surfaceHover"
                      aria-label="Copy transfer note"
                      type="button"
                    >
                      {copiedField === 'note' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Accessible Inline Cancellation Confirmation (Zero alert/confirm) */}
              {confirmingCancel ? (
                <div className="p-3.5 rounded-token-md bg-statusDanger-soft border border-statusDanger-border space-y-3">
                  <p className="text-xs sm:text-sm text-textStrong font-semibold">{t('web.copy35')}</p>
                  <div className="flex gap-2.5">
                    <Button
                      variant="secondary"
                      size="sm"
                      type="button"
                      onClick={() => setConfirmingCancel(false)}
                      className="flex-1"
                    >
                      {t('web.keepBooking')}
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      type="button"
                      disabled={isCancelling}
                      onClick={handleCancelHold}
                      className="flex-1"
                    >
                      {isCancelling ? '...' : t('web.confirmCancelAction')}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center space-x-3 pt-1">
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={() => setConfirmingCancel(true)}
                    className="w-2/5 text-statusDanger hover:bg-statusDanger-soft"
                  >
                    {t('web.copy54')}
                  </Button>
                  <Button variant="primary" type="button" onClick={onClose} className="w-3/5">
                    {t('web.copy55')}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
