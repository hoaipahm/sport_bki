'use client';

import React, { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Clock3,
  Download,
  MapPin,
  RefreshCw,
  Ticket,
  X,
  CheckCircle2,
  Calendar,
  AlertCircle,
  QrCode,
  CalendarClock,
} from 'lucide-react';
import { Header } from '../../components/Header';
import { AuthModal } from '../../components/AuthModal';
import { VietQrModal, VietQrBookingData } from '../../components/VietQrModal';
import { LoopingPhotoCarousel } from '../../components/LoopingPhotoCarousel';
import { Button } from '../../components/ui/Button';
import { DatePicker } from '../../components/DatePicker';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { customerApi, createIdempotencyKey } from '../../lib/api';
import { DEFAULT_AUTH_SLIDES, DEFAULT_HERO_SLIDES } from '../../lib/media';
import { PriceRule, resolvePrice, vietnamDate } from '../../../../shared/booking';

interface Booking {
  id: string;
  venue_id: string;
  court_id: string;
  booking_code: string;
  status: string;
  court_name: string;
  venue_name: string;
  start_at: string;
  end_at: string;
  total_amount: number;
  deposit_amount: number;
  paid_amount: number;
  due_at_venue: number;
  refund_status?: string;
  refund_amount?: number;
  payment_review_reason?: string | null;
  hold_expires_at?: string | null;
}

interface CancelPreview {
  booking_id: string;
  booking_code: string;
  paid_amount: number;
  hours_before_start: number;
  refund_percent: number;
  refundable_amount: number;
  forfeited_amount: number;
  policy_i18n?: Record<string, string>;
}

interface RescheduleAvailability {
  courts: Array<{ id: string; name: string; name_i18n?: Record<string, string>; court_type: string; min_duration_mins: number }>;
  booked_slots: Array<{ court_id: string; start_at: string; end_at: string; status: string }>;
  price_rules: PriceRule[];
  opening_hours: Array<{ day_of_week: number; open_time: string; close_time: string; is_closed: boolean }>;
}

export default function MyBookingsPage() {
  const { language, t } = useLanguage();
  const { token, isAuthenticated, authHeaders, sessionExpired, setSessionExpired, handleSessionExpired } = useAuth();

  const [authOpen, setAuthOpen] = useState(false);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [filter, setFilter] = useState<'upcoming' | 'history' | 'allBookings'>('upcoming');
  const [busy, setBusy] = useState('');

  // Resume pending payment modal
  const [resumePaymentData, setResumePaymentData] = useState<VietQrBookingData | null>(null);

  // Policy-aware Cancel modal
  const [cancelTarget, setCancelTarget] = useState<Booking | null>(null);
  const [cancelPreview, setCancelPreview] = useState<CancelPreview | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);

  // Live Reschedule modal
  const [rescheduleTarget, setRescheduleTarget] = useState<Booking | null>(null);
  const [reschedDate, setReschedDate] = useState(() => vietnamDate());
  const [reschedCourtId, setReschedCourtId] = useState('');
  const [reschedAvail, setReschedAvail] = useState<RescheduleAvailability | null>(null);
  const [reschedStart, setReschedStart] = useState<number | null>(null);
  const [reschedDuration, setReschedDuration] = useState<number>(60);
  const [reschedBusy, setReschedBusy] = useState(false);
  const [reschedError, setReschedError] = useState('');

  useEffect(() => {
    if (sessionExpired) setAuthOpen(true);
  }, [sessionExpired]);

  useEffect(() => {
    if (!token) {
      setBookings([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError('');
    fetch(`${customerApi}/bookings`, {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async response => {
        if (response.status === 401) {
          handleSessionExpired();
          throw new Error('SESSION_EXPIRED');
        }
        if (!response.ok) throw new Error('Booking request failed');
        return response.json();
      })
      .then(data => setBookings(data.bookings || []))
      .catch(err => {
        if (!controller.signal.aborted && err.message !== 'SESSION_EXPIRED') setError('web.bookingsError');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [token, refresh, handleSessionExpired]);

  // Load availability when Reschedule modal opens or date changes
  useEffect(() => {
    if (!rescheduleTarget) return;
    const controller = new AbortController();
    setReschedError('');
    fetch(`${customerApi}/venues/${rescheduleTarget.venue_id}/availability?date=${reschedDate}`, {
      signal: controller.signal,
    })
      .then(res => (res.ok ? res.json() : Promise.reject()))
      .then((data: RescheduleAvailability) => {
        if (controller.signal.aborted) return;
        setReschedAvail(data);
        setReschedCourtId(curr =>
          data.courts.some(c => c.id === curr) ? curr : rescheduleTarget.court_id || data.courts[0]?.id || ''
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) setReschedError(t('web.availabilityError'));
      });
    return () => controller.abort();
  }, [rescheduleTarget, reschedDate, t]);

  const downloadIcs = async (booking: Booking) => {
    setBusy(booking.id);
    setError('');
    try {
      const response = await fetch(`${customerApi}/bookings/${booking.id}/ics`, {
        headers: authHeaders(),
      });
      if (!response.ok) throw new Error('Calendar download failed');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `booking-${booking.booking_code}.ics`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError('web.downloadError');
    } finally {
      setBusy('');
    }
  };

  const handleResumePayment = async (booking: Booking) => {
    setBusy(booking.id);
    setError('');
    try {
      const res = await fetch(`${customerApi}/bookings/${booking.id}/payment`, {
        headers: { ...authHeaders(), 'Accept-Language': language },
      });
      if (!res.ok) throw new Error('Payment info failed');
      const { payment: p } = await res.json();
      setResumePaymentData({
        bookingId: booking.id,
        bookingCode: p.booking_code,
        courtName: p.court_name || booking.court_name,
        startAt: p.start_at || booking.start_at,
        endAt: p.end_at || booking.end_at,
        totalAmount: Number(p.total_amount_vnd ?? booking.total_amount),
        depositAmount: Number(p.deposit_amount_vnd ?? booking.deposit_amount),
        paidAmount: Number(p.paid_amount_vnd ?? booking.paid_amount ?? 0),
        paymentMode: p.payment_mode,
        emailMode: p.email_mode,
        vietqrUrl: p.vietqr_url,
        bankAccount: p.bank_account,
        holdExpiresAt: p.hold_expires_at,
      });
    } catch {
      setError('web.bookingError');
    } finally {
      setBusy('');
    }
  };

  const openCancelDialog = async (booking: Booking) => {
    setCancelTarget(booking);
    setCancelPreview(null);
    setCancelLoading(true);
    try {
      const res = await fetch(`${customerApi}/bookings/${booking.id}/cancel-preview`, {
        headers: { ...authHeaders(), 'Accept-Language': language },
      });
      if (res.ok) {
        const data = await res.json();
        setCancelPreview(data.preview);
      }
    } finally {
      setCancelLoading(false);
    }
  };

  const confirmCancelBooking = async () => {
    if (!cancelTarget) return;
    setCancelLoading(true);
    try {
      const response = await fetch(`${customerApi}/bookings/${cancelTarget.id}/cancel`, {
        method: 'POST',
        headers: {
          ...authHeaders(),
          'Accept-Language': language,
          'Idempotency-Key': createIdempotencyKey('cust-cancel'),
        },
        body: JSON.stringify({ reason: 'Customer requested cancellation' }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Cancellation failed');
      setBookings(current =>
        current.map(item =>
          item.id === cancelTarget.id
            ? {
                ...item,
                status: 'CANCELLED',
                due_at_venue: 0,
                refund_status: data.refund_status,
                refund_amount: data.refund_amount,
              }
            : item
        )
      );
      setCancelTarget(null);
      setCancelPreview(null);
    } catch {
      setError('web.bookingError');
    } finally {
      setCancelLoading(false);
    }
  };

  const openRescheduleDialog = (booking: Booking) => {
    const dur = Math.max(
      60,
      Math.round((new Date(booking.end_at).getTime() - new Date(booking.start_at).getTime()) / 60000)
    );
    setRescheduleTarget(booking);
    setReschedDate(vietnamDate(new Date(Date.now() + 86400000)));
    setReschedCourtId(booking.court_id);
    setReschedDuration(dur);
    setReschedStart(null);
    setReschedError('');
  };

  const toMinutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
  const toTime = (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  const atResched = (minutes: number) => new Date(`${reschedDate}T${toTime(minutes)}:00+07:00`);

  const reschedCourt = reschedAvail?.courts.find(c => c.id === reschedCourtId);
  const reschedSlots = useMemo(() => {
    if (!reschedAvail || !reschedCourt) return [];
    const dow = new Date(`${reschedDate}T12:00:00+07:00`).getUTCDay();
    const oh = reschedAvail.opening_hours.find(h => h.day_of_week === dow);
    if (!oh || oh.is_closed) return [];
    const list: Array<{ minute: number; total: number }> = [];
    const openM = toMinutes(oh.open_time);
    const closeM = toMinutes(oh.close_time);

    for (let m = openM; m + reschedDuration <= closeM; m += 30) {
      if (atResched(m).getTime() <= Date.now()) continue;
      let ok = true;
      let quoteTotal = 0;
      for (let pt = m; pt < m + reschedDuration; pt += 30) {
        const occupied = reschedAvail.booked_slots.some(
          b =>
            b.court_id === reschedCourtId &&
            atResched(pt) < new Date(b.end_at) &&
            atResched(pt + 30) > new Date(b.start_at)
        );
        const p = resolvePrice(reschedAvail.price_rules, reschedCourtId, reschedCourt.court_type, reschedDate, toTime(pt));
        if (occupied || p === null) {
          ok = false;
          break;
        }
        quoteTotal += Math.round(p / 2);
      }
      if (ok) list.push({ minute: m, total: quoteTotal });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reschedAvail, reschedCourt, reschedCourtId, reschedDate, reschedDuration]);

  const submitReschedule = async () => {
    if (!rescheduleTarget || reschedStart === null) return;
    setReschedBusy(true);
    setReschedError('');
    try {
      const response = await fetch(`${customerApi}/bookings/${rescheduleTarget.id}/reschedule`, {
        method: 'POST',
        headers: {
          ...authHeaders(),
          'Accept-Language': language,
          'Idempotency-Key': createIdempotencyKey('cust-resched'),
        },
        body: JSON.stringify({
          new_court_id: reschedCourtId,
          new_start_at: atResched(reschedStart).toISOString(),
          new_end_at: atResched(reschedStart + reschedDuration).toISOString(),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setReschedError(data.message || t('web.bookingError'));
        return;
      }
      setRescheduleTarget(null);
      setRefresh(v => v + 1);
    } catch {
      setReschedError(t('web.networkError'));
    } finally {
      setReschedBusy(false);
    }
  };

  const visible = bookings.filter(item => {
    const upcoming =
      new Date(item.end_at).getTime() > Date.now() &&
      !['CANCELLED', 'EXPIRED', 'NO_SHOW', 'COMPLETED'].includes(item.status);
    return filter === 'allBookings' || (filter === 'upcoming' ? upcoming : !upcoming);
  });

  const money = (value: number) =>
    new Intl.NumberFormat(language === 'vi' ? 'vi-VN' : 'en-US', {
      style: 'currency',
      currency: 'VND',
      maximumFractionDigits: 0,
    }).format(Number(value || 0));

  const format = (value: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(language === 'vi' ? 'vi-VN' : 'en-US', {
      timeZone: 'Asia/Ho_Chi_Minh',
      ...options,
    }).format(new Date(value));

  const statusLabel = (status: string) => t(`web.status${status}`);

  return (
    <div className="customer-shell min-h-screen text-textBody">
      <Header onOpenAuthModal={() => setAuthOpen(true)} />

      <main className="max-w-[1000px] mx-auto px-4 sm:px-8 py-8 sm:py-12 space-y-8">
        <div className="stage-enter-1 bg-panel rounded-token-lg overflow-hidden border border-borderStrong shadow-token-card">
          <LoopingPhotoCarousel
            images={DEFAULT_HERO_SLIDES}
            alt=""
            intervalMs={5000}
            className="h-32 sm:h-40 border-b border-borderToken"
            showCounter={false}
            overlayClassName="bg-gradient-to-t from-panel via-page/25 to-transparent"
          />
          <div className="p-6 sm:p-8">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-sm text-textMuted hover:text-textStrong transition-colors mb-3"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>{t('web.book')}</span>
            </Link>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="text-3xl sm:text-4xl font-extrabold text-textStrong tracking-tight">
                  {t('web.tickets')}
                </h1>
                <p className="mt-1.5 text-sm text-textMuted max-w-[55ch] leading-relaxed">
                  {t('web.bookingsDescription')}
                </p>
              </div>
              {isAuthenticated && (
                <button
                  aria-label={t('web.retry')}
                  disabled={loading}
                  onClick={() => setRefresh(value => value + 1)}
                  type="button"
                  className="min-h-[44px] min-w-[44px] bg-panel-2 rounded-token-md flex items-center justify-center border border-borderStrong hover:bg-surfaceHover shrink-0"
                >
                  <RefreshCw className={`w-4 h-4 text-accent ${loading ? 'animate-spin' : ''}`} />
                </button>
              )}
            </div>
          </div>
        </div>

        {!isAuthenticated ? (
          <div className="stage-enter-2 bg-panel rounded-token-lg overflow-hidden text-center border border-borderStrong shadow-token-card">
            <LoopingPhotoCarousel
              images={DEFAULT_AUTH_SLIDES}
              alt=""
              className="h-36 border-b border-borderToken"
              showControls={false}
              showCounter={false}
              overlayClassName="bg-gradient-to-t from-panel via-page/30 to-transparent"
            />
            <div className="p-8 sm:p-12 space-y-4">
              <div className="w-14 h-14 rounded-token-full bg-accent-soft text-accent border border-accent-border flex items-center justify-center mx-auto">
                <Ticket className="w-7 h-7" />
              </div>
              <h2 className="text-xl font-bold text-textStrong">{t('web.loginRequired')}</h2>
              <p className="text-sm text-textMuted max-w-[42ch] mx-auto">
                {t('web.bookingsDescription')}
              </p>
              <Button size="lg" className="mt-4" onClick={() => setAuthOpen(true)}>
                <span>{t('auth.login')}</span>
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </div>
        ) : (
          <>
            {/* Filter Tabs */}
            <div className="stage-enter-2 flex flex-wrap gap-2" role="group" aria-label={t('web.tickets')}>
              {(['upcoming', 'history', 'allBookings'] as const).map(value => (
                <button
                  key={value}
                  onClick={() => setFilter(value)}
                  aria-pressed={filter === value}
                  type="button"
                  className={`min-h-[44px] px-5 rounded-token-full text-xs sm:text-sm font-semibold ${
                    filter === value
                      ? 'bg-accent text-textOnAccent font-bold shadow-sm'
                      : 'bg-panel text-textBody hover:text-textStrong hover:bg-surfaceHover border border-borderToken'
                  }`}
                >
                  {t(`web.${value}`)}
                </button>
              ))}
            </div>

            {error && (
              <div
                role="alert"
                className="p-4 rounded-token-md bg-statusDanger-soft border border-statusDanger-border text-statusDanger text-sm flex items-center gap-2"
              >
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{t(error)}</span>
              </div>
            )}

            {loading && !bookings.length ? (
              <div className="py-20 text-center space-y-3" role="status">
                <RefreshCw className="w-8 h-8 text-accent animate-spin mx-auto" />
                <p className="text-sm text-textMuted">{t('common.loading')}</p>
              </div>
            ) : !visible.length ? (
              <div className="stage-enter-3 bg-panel p-12 rounded-token-lg text-center border border-borderToken space-y-4">
                <div className="w-14 h-14 rounded-token-full bg-panel-2 flex items-center justify-center mx-auto text-textMuted border border-borderToken">
                  <CalendarDays className="w-7 h-7" />
                </div>
                <h2 className="text-lg font-bold text-textStrong">{t('web.copy71')}</h2>
                <Link
                  className="inline-flex items-center gap-2 min-h-[44px] px-6 bg-accent text-textOnAccent font-bold rounded-token-full hover:bg-accent-hover transition-colors"
                  href="/"
                >
                  <span>{t('hero.bookNow')}</span>
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            ) : (
              <div className="stage-enter-3 space-y-4">
                {visible.map(booking => {
                  const isPending = booking.status === 'PENDING';
                  const isHoldAlive =
                    isPending &&
                    (!booking.hold_expires_at || new Date(booking.hold_expires_at).getTime() > Date.now());
                  const isCancelled =
                    booking.status === 'CANCELLED' ||
                    booking.status === 'NO_SHOW' ||
                    booking.status === 'EXPIRED';
                  const canReschedule =
                    booking.status === 'CONFIRMED' &&
                    new Date(booking.start_at).getTime() > Date.now();

                  return (
                    <article
                      key={booking.id}
                      className="card-interactive bg-panel rounded-token-lg p-5 sm:p-7 border border-borderStrong shadow-token-card"
                    >
                      {/* Top Header */}
                      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-borderToken">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono font-extrabold text-sm text-textStrong tracking-wider bg-panel-2 px-3 py-1 rounded-token-sm border border-borderStrong tabular-nums">
                            {booking.booking_code}
                          </span>
                          {booking.refund_status === 'PENDING' && Number(booking.refund_amount || 0) > 0 && (
                            <span className="px-2.5 py-1 rounded-token-full text-xs font-semibold bg-statusWarning-soft text-statusWarning border border-statusWarning-border tabular-nums">
                              {t('web.refundPendingBadge', { amount: money(booking.refund_amount || 0) })}
                            </span>
                          )}
                          {booking.refund_status === 'COMPLETED' && Number(booking.refund_amount || 0) > 0 && (
                            <span className="px-2.5 py-1 rounded-token-full text-xs font-semibold bg-accent-soft text-accent border border-accent-border tabular-nums">
                              {t('web.refundCompletedBadge', { amount: money(booking.refund_amount || 0) })}
                            </span>
                          )}
                        </div>

                        <span
                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-token-full text-xs font-semibold border ${
                            isPending
                              ? 'bg-statusWarning-soft border-statusWarning-border text-statusWarning'
                              : isCancelled
                              ? 'bg-statusDanger-soft border-statusDanger-border text-statusDanger'
                              : 'bg-accent-soft border-accent-border text-accent'
                          }`}
                        >
                          {isPending ? (
                            <Clock3 className="w-3.5 h-3.5" />
                          ) : isCancelled ? (
                            <X className="w-3.5 h-3.5" />
                          ) : (
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          )}
                          <span>{statusLabel(booking.status)}</span>
                        </span>
                      </div>

                      {/* Body */}
                      <div className="grid sm:grid-cols-[1fr_auto] gap-5 py-5 items-center">
                        <div>
                          <h2 className="text-xl sm:text-2xl font-bold text-textStrong tracking-tight">
                            {booking.court_name}
                          </h2>
                          <p className="mt-1.5 flex items-center gap-2 text-xs sm:text-sm text-textBody">
                            <MapPin className="w-4 h-4 text-accent shrink-0" />
                            <span>{booking.venue_name}</span>
                          </p>
                          <div className="mt-3 flex flex-wrap items-center gap-2 font-mono font-bold text-sm sm:text-base text-textStrong tabular-nums">
                            <Calendar className="w-4 h-4 text-accent" />
                            <span>
                              {format(booking.start_at, { hour: '2-digit', minute: '2-digit' })} –{' '}
                              {format(booking.end_at, { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            <span className="text-textMuted font-sans font-normal text-xs">
                              ·{' '}
                              {format(booking.start_at, {
                                weekday: 'short',
                                day: 'numeric',
                                month: 'numeric',
                                year: 'numeric',
                              })}
                            </span>
                          </div>
                        </div>

                        <div className="sm:text-right bg-panel-2 p-3.5 sm:p-4 rounded-token-md border border-borderToken tabular-nums space-y-1">
                          <p className="text-xs text-textMuted">{t('web.total')}</p>
                          <p className="font-extrabold text-xl sm:text-2xl text-textStrong font-mono">
                            {money(booking.total_amount)}
                          </p>
                          <p className="text-xs text-accent font-semibold">
                            {t('web.paidAmount')}: {money(booking.paid_amount || 0)}
                          </p>
                          {Number(booking.due_at_venue) > 0 && !isCancelled && (
                            <p className="text-xs text-statusWarning font-semibold">
                              {t('web.dueAtVenue')}: {money(booking.due_at_venue)}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="border-t border-borderToken pt-4 flex flex-wrap justify-end items-center gap-2.5">
                        {isHoldAlive && (
                          <Button
                            variant="primary"
                            size="sm"
                            disabled={busy === booking.id}
                            onClick={() => handleResumePayment(booking)}
                          >
                            <QrCode className="w-4 h-4 mr-1.5" />
                            <span>{t('web.resumePayment')}</span>
                          </Button>
                        )}

                        {['CONFIRMED', 'CHECKED_IN', 'COMPLETED'].includes(booking.status) && (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy === booking.id}
                            onClick={() => downloadIcs(booking)}
                          >
                            <Download className="w-3.5 h-3.5 text-accent mr-1.5" />
                            <span>{t('benefits.addCalendar')}</span>
                          </Button>
                        )}

                        {canReschedule && (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy === booking.id}
                            onClick={() => openRescheduleDialog(booking)}
                          >
                            <CalendarClock className="w-3.5 h-3.5 text-accent mr-1.5" />
                            <span>{t('web.rescheduleBooking')}</span>
                          </Button>
                        )}

                        {['PENDING', 'CONFIRMED'].includes(booking.status) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy === booking.id}
                            onClick={() => openCancelDialog(booking)}
                            className="text-statusDanger hover:bg-statusDanger-soft"
                          >
                            <X className="w-3.5 h-3.5 mr-1" />
                            <span>{t('common.cancel')}</span>
                          </Button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </>
        )}
      </main>

      {/* Policy-Aware Cancellation Modal */}
      {cancelTarget && (
        <div className="modal-backdrop-anim fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-overlay">
          <div
            role="dialog"
            aria-modal="true"
            className="modal-panel-anim bg-panel rounded-t-token-lg sm:rounded-token-lg shadow-token-elevated max-w-md w-full p-6 border border-borderStrong space-y-4"
          >
            <div className="flex items-center justify-between border-b border-borderToken pb-3">
              <h3 className="font-bold text-base text-textStrong">{t('web.cancelPreviewTitle')}</h3>
              <button
                type="button"
                onClick={() => setCancelTarget(null)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-token-sm text-textMuted hover:text-textStrong hover:bg-surfaceHover"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-panel-2 p-4 rounded-token-md border border-borderToken text-sm space-y-2 tabular-nums">
              <p className="font-bold text-textStrong">
                {cancelTarget.court_name} · {cancelTarget.booking_code}
              </p>
              {cancelLoading && !cancelPreview ? (
                <p className="text-xs text-textMuted">{t('common.loading')}</p>
              ) : cancelPreview ? (
                cancelPreview.paid_amount > 0 ? (
                  <p className="text-statusWarning font-semibold">
                    {t('web.cancelRefundSummary', {
                      hours: cancelPreview.hours_before_start,
                      percent: cancelPreview.refund_percent,
                      amount: money(cancelPreview.refundable_amount),
                    })}
                  </p>
                ) : (
                  <p className="text-accent font-semibold">{t('web.cancelNoPaidSummary')}</p>
                )
              ) : null}
              {cancelPreview?.policy_i18n?.[language] && (
                <p className="text-xs text-textMuted pt-1 border-t border-borderToken">
                  {cancelPreview.policy_i18n[language]}
                </p>
              )}
            </div>

            <div className="flex gap-3 pt-1">
              <Button
                variant="secondary"
                type="button"
                onClick={() => setCancelTarget(null)}
                className="flex-1"
              >
                {t('web.keepBooking')}
              </Button>
              <Button
                variant="danger"
                type="button"
                disabled={cancelLoading}
                onClick={confirmCancelBooking}
                className="flex-1"
              >
                {cancelLoading ? '...' : t('web.confirmCancelAction')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Live Reschedule Modal */}
      {rescheduleTarget && (
        <div className="modal-backdrop-anim fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-overlay">
          <div
            role="dialog"
            aria-modal="true"
            className="modal-panel-anim bg-panel rounded-t-token-lg sm:rounded-token-lg shadow-token-elevated max-w-xl w-full max-h-[90dvh] overflow-y-auto p-6 border border-borderStrong space-y-5"
          >
            <div className="flex items-center justify-between border-b border-borderToken pb-3">
              <div>
                <h3 className="font-bold text-lg text-textStrong">{t('web.rescheduleTitle')}</h3>
                <p className="text-xs text-textMuted mt-0.5">{t('web.rescheduleDesc')}</p>
              </div>
              <button
                type="button"
                onClick={() => setRescheduleTarget(null)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-token-sm text-textMuted hover:text-textStrong hover:bg-surfaceHover"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {reschedError && (
              <div className="p-3 rounded-token-md bg-statusDanger-soft border border-statusDanger-border text-statusDanger text-xs">
                {reschedError}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <DatePicker value={reschedDate} onChange={d => { setReschedDate(d); setReschedStart(null); }} />
              <div className="flex flex-wrap gap-1.5">
                {reschedAvail?.courts.map(c => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setReschedCourtId(c.id);
                      setReschedStart(null);
                    }}
                    className={`min-h-[40px] px-3.5 rounded-token-full text-xs font-semibold border ${
                      reschedCourtId === c.id
                        ? 'bg-accent text-textOnAccent border-accent font-bold'
                        : 'bg-panel-2 text-textBody border-borderToken hover:text-textStrong'
                    }`}
                  >
                    {c.name_i18n?.[language] || c.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-60 overflow-y-auto pr-1">
              {reschedSlots.map(slot => {
                const selected = reschedStart === slot.minute;
                return (
                  <button
                    key={slot.minute}
                    type="button"
                    onClick={() => setReschedStart(slot.minute)}
                    className={`p-3 rounded-token-sm border text-left tabular-nums ${
                      selected
                        ? 'bg-accent text-textOnAccent border-accent font-bold'
                        : 'bg-panel-2 text-textStrong border-borderToken hover:border-accent'
                    }`}
                  >
                    <span className="block text-sm font-bold">
                      {toTime(slot.minute)} – {toTime(slot.minute + reschedDuration)}
                    </span>
                    <span className={`block text-xs mt-1 ${selected ? 'text-textOnAccent' : 'text-accent font-semibold'}`}>
                      {money(slot.total)}
                    </span>
                  </button>
                );
              })}
              {reschedAvail && reschedSlots.length === 0 && (
                <p className="col-span-full text-center py-6 text-xs text-textMuted">{t('web.noSlots')}</p>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t border-borderToken">
              <Button variant="secondary" type="button" onClick={() => setRescheduleTarget(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="primary"
                type="button"
                disabled={reschedStart === null || reschedBusy}
                onClick={submitReschedule}
              >
                {reschedBusy ? '...' : t('web.confirmReschedule')}
              </Button>
            </div>
          </div>
        </div>
      )}

      <AuthModal
        isOpen={authOpen}
        onClose={() => {
          setAuthOpen(false);
          setSessionExpired(false);
        }}
        initialTab="LOGIN"
        sessionExpiredNotice={sessionExpired}
      />

      <VietQrModal
        isOpen={Boolean(resumePaymentData)}
        onClose={() => {
          setResumePaymentData(null);
          setRefresh(v => v + 1);
        }}
        bookingData={resumePaymentData}
        onBookingConfirmed={() => setRefresh(v => v + 1)}
      />
    </div>
  );
}
