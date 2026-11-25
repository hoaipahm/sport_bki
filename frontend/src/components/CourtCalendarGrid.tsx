'use client';

import React, { useEffect, useState, useRef, useMemo } from 'react';
import {
  Check,
  Clock,
  RefreshCw,
  ArrowRight,
  Sun,
  Sunset,
  Moon,
  Circle,
  Wrench,
  UserCheck,
  AlertCircle,
  Layers,
  Radio,
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { DatePicker } from './DatePicker';
import { CourtMark } from './CourtMark';
import { Button } from './ui/Button';
import { customerApi, formatVndCurrency } from '../lib/api';
import { PriceRule, DealRule, resolvePrice, resolveDealPrice, vietnamDate } from '../../../shared/booking';

interface Court {
  id: string;
  name: string;
  name_i18n?: Record<string, string>;
  court_type: string;
  sport_code?: string;
  sport_name?: Record<string, string>;
  min_duration_mins: number;
  step_mins: number;
}

interface CourtLink {
  parent_court_id: string;
  child_court_id: string;
  child_name: string;
}

interface BookedSlot {
  court_id: string;
  start_at: string;
  end_at: string;
  status: string;
  hold_expires_at?: string;
}

interface OpeningHours {
  day_of_week: number;
  open_time: string;
  close_time: string;
  is_closed: boolean;
}

interface Availability {
  courts: Court[];
  court_links?: CourtLink[];
  booked_slots: BookedSlot[];
  price_rules: PriceRule[];
  deal_rules?: DealRule[];
  opening_hours: OpeningHours[];
  deposit_percent: number;
  hold_duration_mins?: number;
  closures?: { start_at: string; end_at: string; reason?: string }[];
}

export interface BookingSelectionPayload {
  courtId: string;
  courtName: string;
  startAt: string;
  endAt: string;
  intervals?: Array<{ start_at: string; end_at: string }>;
  slotsLabel?: string;
  durationMins: number;
  totalAmount: number;
  depositAmount: number;
}

interface CourtCalendarGridProps {
  venueId: string;
  venueName: string;
  onInitiateBooking: (selection: BookingSelectionPayload) => void | Promise<void>;
}

export function CourtCalendarGrid({ venueId, venueName, onInitiateBooking }: CourtCalendarGridProps) {
  const { language, t } = useLanguage();
  const [date, setDate] = useState(() => vietnamDate());
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [courtId, setCourtId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [selectedMinutes, setSelectedMinutes] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [period, setPeriod] = useState<'all' | 'morning' | 'afternoon' | 'evening'>('all');
  const [showPast, setShowPast] = useState(false);
  const [sseState, setSseState] = useState<'connected' | 'reconnecting'>('connected');

  const loadedKey = useRef('');
  const cache = useRef(new Map<string, Availability>());

  useEffect(() => {
    const controller = new AbortController();
    const key = `${venueId}/${date}`;
    const changed = loadedKey.current !== key;
    if (changed) {
      setSelectedMinutes([]);
      const cached = cache.current.get(key);
      setAvailability(cached || null);
      setLoading(!cached);
    }
    setError(false);
    loadedKey.current = key;

    fetch(`${customerApi}/venues/${venueId}/availability?date=${date}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Availability failed');
        return response.json();
      })
      .then((data: Availability) => {
        if (controller.signal.aborted) return;
        cache.current.set(key, data);
        setAvailability(data);
        setCourtId(current => (data.courts.some(c => c.id === current) ? current : data.courts[0]?.id || ''));
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError(true);
          setAvailability(null);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [venueId, date, refresh]);

  // Real-time SSE listener with truthful connection freshness (F-11)
  useEffect(() => {
    const stream = new EventSource(`${customerApi}/venues/${venueId}/realtime`);
    let timer: ReturnType<typeof setTimeout>;

    stream.onopen = () => setSseState('connected');
    stream.onerror = () => setSseState('reconnecting');

    const update = () => {
      setSseState('connected');
      clearTimeout(timer);
      timer = setTimeout(() => setRefresh(value => value + 1), 120);
    };
    stream.addEventListener('court_update', update);
    return () => {
      clearTimeout(timer);
      stream.removeEventListener('court_update', update);
      stream.close();
    };
  }, [venueId]);

  const court = availability?.courts.find(item => item.id === courtId);
  const childCourtNames = useMemo(() => {
    if (!availability?.court_links || !courtId) return [];
    return availability.court_links
      .filter(l => l.parent_court_id === courtId)
      .map(l => l.child_name);
  }, [availability?.court_links, courtId]);

  const day = new Date(`${date}T12:00:00+07:00`).getUTCDay();
  const opening = availability?.opening_hours?.find(item => item.day_of_week === day);

  const toMinutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
  const toTime = (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  const at = (minutes: number) => new Date(`${date}T${toTime(minutes)}:00+07:00`);

  const slots: number[] = [];
  if (opening && !opening.is_closed) {
    for (let minute = toMinutes(opening.open_time); minute + 30 <= toMinutes(opening.close_time); minute += 30) {
      slots.push(minute);
    }
  }

  const statusOf = (minute: number) => {
    if (at(minute).getTime() <= Date.now()) return 'PAST';
    if (
      availability?.closures?.some(
        item => at(minute) < new Date(item.end_at) && at(minute + 30) > new Date(item.start_at)
      )
    ) {
      return 'BLOCKED';
    }
    const matching = availability?.booked_slots.filter(
      item =>
        item.court_id === courtId &&
        at(minute) < new Date(item.end_at) &&
        at(minute + 30) > new Date(item.start_at)
    );
    if (!matching || matching.length === 0) return 'FREE';
    if (matching.some(m => m.status === 'BLOCKED')) return 'BLOCKED';
    if (matching.some(m => m.status === 'CHECKED_IN')) return 'CHECKED_IN';
    if (matching.some(m => m.status === 'CONFIRMED')) return 'CONFIRMED';
    if (matching.some(m => m.status === 'PENDING')) return 'PENDING';
    return matching[0].status || 'CONFIRMED';
  };

  const basePriceOf = (minute: number) =>
    court ? resolvePrice(availability?.price_rules || [], courtId, court.court_type, date, toTime(minute)) : null;

  const dealQuoteOf = (minute: number) => {
    const base = basePriceOf(minute);
    if (base == null || !court) return { baseHourly: null as number | null, finalHourly: null as number | null, hasDeal: false };
    const slotStartMs = Date.parse(`${date}T${toTime(minute)}:00+07:00`);
    const resolved = resolveDealPrice(base, availability?.deal_rules, courtId, court.sport_code, date, toTime(minute), slotStartMs);
    return {
      baseHourly: base,
      finalHourly: resolved.finalHourly,
      hasDeal: Boolean(resolved.deal && resolved.finalHourly < base),
    };
  };

  const priceOf = (minute: number) => dealQuoteOf(minute).finalHourly;

  const isSlotBookable = (minute: number) =>
    slots.includes(minute) && statusOf(minute) === 'FREE' && priceOf(minute) !== null;

  // Prune only newly occupied slots if an SSE update marks a slot taken, preserving remaining selected slots
  useEffect(() => {
    if (selectedMinutes.length === 0 || !availability) return;
    setSelectedMinutes((prev) => {
      const next = prev.filter((pt) => isSlotBookable(pt));
      return next.length === prev.length ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availability]);

  const isPeakHour = (minute: number) => {
    if (!court) return false;
    const time = toTime(minute);
    const rule = availability?.price_rules?.find(
      item =>
        (!item.court_id || item.court_id === courtId) &&
        (!item.court_type || item.court_type === court.court_type) &&
        (item.day_of_week == null || item.day_of_week === day) &&
        (!item.is_weekend || day === 0 || day === 6) &&
        !item.is_holiday &&
        time >= item.start_time.slice(0, 5) &&
        time < item.end_time.slice(0, 5)
    );
    return Boolean(rule?.is_peak_hour || (minute >= 1020 && minute < 1260));
  };

  const money = (amount: number) => formatVndCurrency(amount, language);

  // Independent multi-slot toggle:
  // - Click an unselected free slot -> adds ONLY that slot (keeps all other selected slots).
  // - Click an already-selected slot -> removes ONLY that slot (keeps all other selected slots).
  const choose = (minute: number) => {
    if (!court) return;
    setSelectedMinutes((prev) => {
      if (prev.includes(minute)) {
        return prev.filter((m) => m !== minute);
      }
      if (!isSlotBookable(minute)) return prev;
      return [...prev, minute].sort((a, b) => a - b);
    });
  };

  const activeSelectedMinutes = selectedMinutes.filter((m) => isSlotBookable(m));
  const selectedSet = new Set(activeSelectedMinutes);

  // Coalesce adjacent 30-min cells into clean intervals (supports both contiguous & separated multi-slot selections)
  const groupedIntervals: Array<{ startMin: number; endMin: number }> = [];
  for (const m of activeSelectedMinutes) {
    const last = groupedIntervals[groupedIntervals.length - 1];
    if (last && last.endMin === m) {
      last.endMin = m + 30;
    } else {
      groupedIntervals.push({ startMin: m, endMin: m + 30 });
    }
  }

  const applyDurationPreset = (mins: number) => {
    if (activeSelectedMinutes.length === 0) return;
    const anchor = activeSelectedMinutes[0];
    const nextList: number[] = [];
    for (let pt = anchor; pt < anchor + mins; pt += 30) {
      if (!isSlotBookable(pt)) return;
      nextList.push(pt);
    }
    setSelectedMinutes(nextList);
  };

  const canUsePreset = (mins: number) => {
    if (activeSelectedMinutes.length === 0) return false;
    const anchor = activeSelectedMinutes[0];
    for (let pt = anchor; pt < anchor + mins; pt += 30) {
      if (!isSlotBookable(pt)) return false;
    }
    return true;
  };

  const duration = activeSelectedMinutes.length * 30;
  let total = 0;
  for (const point of activeSelectedMinutes) {
    total += (priceOf(point) || 0) / 2;
  }
  total = Math.round(total);
  const depositPct = availability?.deposit_percent ?? 30;
  const deposit = Math.round((total * depositPct) / 100);
  const dueAtVenue = Math.max(0, total - deposit);

  const minReq = Math.min(30, court?.min_duration_mins || 30);
  const valid =
    !!court &&
    groupedIntervals.length > 0 &&
    groupedIntervals.every((iv) => iv.endMin - iv.startMin >= minReq);

  const slotsLabel = groupedIntervals
    .map((iv) => `${toTime(iv.startMin)} – ${toTime(iv.endMin)}`)
    .join(', ');

  const submit = async () => {
    if (!valid || !court || groupedIntervals.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      const firstIv = groupedIntervals[0];
      const lastIv = groupedIntervals[groupedIntervals.length - 1];
      await onInitiateBooking({
        courtId,
        courtName: court.name_i18n?.[language] || court.name,
        startAt: at(firstIv.startMin).toISOString(),
        endAt: at(lastIv.endMin).toISOString(),
        intervals: groupedIntervals.map((iv) => ({
          start_at: at(iv.startMin).toISOString(),
          end_at: at(iv.endMin).toISOString(),
        })),
        slotsLabel,
        durationMins: duration,
        totalAmount: total,
        depositAmount: deposit,
      });
      setSelectedMinutes([]);
    } finally {
      setSubmitting(false);
    }
  };

  const visibleSlots = slots.filter(
    minute =>
      (showPast || statusOf(minute) !== 'PAST') &&
      (period === 'all' ||
        (period === 'morning' && minute < 720) ||
        (period === 'afternoon' && minute >= 720 && minute < 1080) ||
        (period === 'evening' && minute >= 1080))
  );

  const periods = [
    { id: 'all', icon: Circle, label: language === 'vi' ? 'Tất cả' : 'All day' },
    { id: 'morning', icon: Sun, label: language === 'vi' ? 'Buổi sáng' : 'Morning' },
    { id: 'afternoon', icon: Sunset, label: language === 'vi' ? 'Buổi chiều' : 'Afternoon' },
    { id: 'evening', icon: Moon, label: language === 'vi' ? 'Buổi tối' : 'Evening' },
  ] as const;

  return (
    <div
      className="bg-panel rounded-token-lg shadow-token-card overflow-hidden border border-borderStrong"
      aria-busy={loading}
    >
      {/* Top Selection Header */}
      <div className="p-5 sm:p-7 border-b border-borderToken bg-panel-2/45">
        <div className="flex flex-col md:flex-row gap-4 md:items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-token-md bg-accent-soft border border-accent-border flex items-center justify-center shrink-0">
              <CourtMark className="w-6 h-6 text-accent" />
            </div>
            <div>
              <h3 className="font-bold text-lg sm:text-xl text-textStrong leading-tight">
                {venueName}
              </h3>
              <p className="text-xs text-textMuted mt-1 flex items-center gap-1.5">
                <Radio
                  className={`w-3.5 h-3.5 ${
                    sseState === 'connected' ? 'text-accent animate-pulse' : 'text-statusWarning'
                  }`}
                />
                <span>
                  {sseState === 'connected' ? t('web.liveConnected') : t('web.liveReconnecting')}
                </span>
              </p>
            </div>
          </div>

          {/* Date Controls */}
          <div className="flex flex-wrap items-center gap-2">
            {[0, 1].map(offset => {
              const target = vietnamDate(new Date(Date.now() + offset * 86400000));
              const isSelected = date === target;
              return (
                <button
                  key={offset}
                  onClick={() => setDate(target)}
                  aria-pressed={isSelected}
                  type="button"
                  className={`min-h-[44px] px-4 rounded-token-md font-semibold text-xs sm:text-sm transition-colors ${
                    isSelected
                      ? 'bg-accent text-textOnAccent font-bold shadow-sm'
                      : 'bg-panel-2 text-textBody hover:text-textStrong hover:bg-surfaceHover border border-borderToken'
                  }`}
                >
                  {t(offset ? 'web.tomorrow' : 'web.today')}
                </button>
              );
            })}
            <DatePicker value={date} onChange={setDate} />
          </div>
        </div>

        {/* Court Selector Pills */}
        {!!availability?.courts.length && (
          <div className="flex flex-wrap gap-2 mt-5 pt-5 border-t border-borderToken">
            {availability.courts.map(item => {
              const active = courtId === item.id;
              return (
                <button
                  key={item.id}
                  aria-pressed={active}
                  onClick={() => {
                    setCourtId(item.id);
                    setSelectedMinutes([]);
                  }}
                  type="button"
                  className={`min-h-[44px] px-4 rounded-token-full font-semibold text-xs sm:text-sm flex items-center gap-2 border ${
                    active
                      ? 'border-accent bg-accent-soft text-textStrong shadow-sm'
                      : 'border-borderToken text-textBody bg-panel hover:text-textStrong hover:bg-surfaceHover'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${active ? 'bg-accent' : 'bg-textMuted'}`} />
                  <span>{item.name_i18n?.[language] || item.name}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Composite Court Notice */}
        {childCourtNames.length > 0 && (
          <div className="mt-4 p-3 rounded-token-sm bg-statusInfo-soft border border-borderStrong text-xs text-textStrong flex items-center gap-2">
            <Layers className="w-4 h-4 text-statusInfo shrink-0" />
            <span>{t('web.compositeNote', { children: childCourtNames.join(' + ') })}</span>
          </div>
        )}
      </div>

      {/* Main Slot Grid */}
      <div className="p-5 sm:p-7">
        {loading ? (
          <div className="py-16 text-center space-y-3" role="status">
            <RefreshCw className="w-8 h-8 text-accent animate-spin mx-auto" />
            <p className="text-textMuted text-sm">{t('common.loading')}</p>
          </div>
        ) : error ? (
          <div role="alert" className="text-center py-12 space-y-4">
            <div className="w-12 h-12 rounded-token-full bg-statusDanger-soft text-statusDanger flex items-center justify-center mx-auto border border-statusDanger-border">
              <AlertCircle className="w-6 h-6" />
            </div>
            <p className="text-textStrong font-semibold">{t('web.availabilityError')}</p>
            <Button variant="secondary" onClick={() => setRefresh(value => value + 1)}>
              <RefreshCw className="w-4 h-4 mr-2" />
              {t('web.retry')}
            </Button>
          </div>
        ) : !court ? (
          <p className="text-center py-10 text-textMuted">{t('web.emptyCourts')}</p>
        ) : !slots.length ? (
          <div className="text-center py-12 bg-panel-2 rounded-token-md border border-borderToken">
            <p className="text-textStrong font-semibold">{t('web.closed')}</p>
          </div>
        ) : (
          <>
            {/* Period Filter & Show Past */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                {periods.map(({ id, icon: Icon, label }) => {
                  const active = period === id;
                  return (
                    <button
                      key={id}
                      aria-pressed={active}
                      onClick={() => setPeriod(id)}
                      type="button"
                      className={`min-h-[44px] px-3.5 rounded-token-sm text-xs font-semibold flex items-center gap-1.5 ${
                        active
                          ? 'bg-accent text-textOnAccent font-bold'
                          : 'bg-panel-2 text-textBody hover:text-textStrong hover:bg-surfaceHover border border-borderToken'
                      }`}
                    >
                      <Icon className="w-4 h-4" strokeWidth={2} />
                      <span>{label}</span>
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-4 text-xs text-textMuted">
                <span>{t('web.minimum', { minutes: court.min_duration_mins })}</span>
                {slots.some(minute => statusOf(minute) === 'PAST') && (
                  <button
                    onClick={() => setShowPast(value => !value)}
                    type="button"
                    className="min-h-[44px] px-2 hover:text-textStrong underline underline-offset-4"
                  >
                    {t(showPast ? 'web.hidePast' : 'web.showPast')}
                  </button>
                )}
              </div>
            </div>

            {/* State Legend (Accessible with patterns & labels, zero reliance on color alone) */}
            <div className="flex flex-wrap items-center gap-3 sm:gap-5 mb-5 p-3.5 rounded-token-sm bg-panel-2/50 border border-borderToken text-xs text-textBody">
              <div className="flex items-center gap-1.5">
                <span className="w-3.5 h-3.5 rounded border border-dashed border-accent bg-panel-2" />
                <span>{t('web.free')}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3.5 h-3.5 rounded bg-accent" />
                <span className="text-textStrong font-medium">{t('web.selected')}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3.5 h-3.5 rounded bg-statusWarning-soft border border-statusWarning-border" />
                <span>{t('web.statusPENDING')}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3.5 h-3.5 rounded bg-accent-pressed border border-accent-border" />
                <span>{t('web.statusCONFIRMED')}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3.5 h-3.5 rounded court-maintenance-stripes border border-borderStrong" />
                <span>{t('web.maintenance')}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-statusWarning" />
                <span>{language === 'vi' ? 'Giờ vàng' : 'Peak hour'}</span>
              </div>
            </div>

            {!visibleSlots.length && (
              <p className="py-10 text-center text-textMuted text-sm">{t('web.noSlots')}</p>
            )}

            {/* Slot Cells */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
              {visibleSlots.map(minute => {
                const status = statusOf(minute);
                const price = priceOf(minute);
                const peak = isPeakHour(minute);
                const free = status === 'FREE' && price !== null;
                const selected = selectedSet.has(minute);

                let cellClasses =
                  'booking-slot min-w-0 overflow-hidden min-h-[100px] rounded-token-sm p-3 text-left relative flex flex-col justify-between ';
                let statusWord = '';
                let StatusIcon: React.ComponentType<{ className?: string }> | null = null;

                if (selected) {
                  cellClasses += 'bg-accent text-textOnAccent border-2 border-accent font-bold cursor-pointer shadow-md';
                  statusWord = t('web.selected');
                  StatusIcon = Check;
                } else if (status === 'PAST') {
                  cellClasses += 'bg-page border border-borderToken text-textMuted opacity-55 cursor-not-allowed';
                  statusWord = t('web.past');
                } else if (status === 'BLOCKED') {
                  cellClasses += 'court-maintenance-stripes border border-borderStrong text-textMuted cursor-not-allowed';
                  statusWord = t('web.maintenance');
                  StatusIcon = Wrench;
                } else if (status === 'PENDING') {
                  cellClasses += 'bg-statusWarning-soft border border-statusWarning-border text-statusWarning cursor-not-allowed';
                  statusWord = t('web.statusPENDING');
                  StatusIcon = Clock;
                } else if (status === 'CHECKED_IN') {
                  cellClasses += 'bg-accent-pressed border border-accent-border text-textStrong cursor-not-allowed';
                  statusWord = t('web.statusCHECKED_IN');
                  StatusIcon = UserCheck;
                } else if (status === 'COMPLETED') {
                  cellClasses += 'bg-panel-2 border border-borderToken text-textMuted cursor-not-allowed';
                  statusWord = t('web.statusCOMPLETED');
                  StatusIcon = Check;
                } else if (status === 'CANCELLED' || status === 'NO_SHOW') {
                  cellClasses += 'bg-statusDanger-soft border border-statusDanger-border text-statusDanger line-through cursor-not-allowed';
                  statusWord = t(`web.status${status}`);
                  StatusIcon = AlertCircle;
                } else if (free) {
                  cellClasses +=
                    'bg-panel-2 border border-dashed border-accent-border hover:border-accent hover:bg-surfaceHover text-textStrong cursor-pointer';
                  statusWord = t('web.free');
                } else {
                  cellClasses += 'bg-accent-pressed border border-accent-border text-textStrong cursor-not-allowed';
                  statusWord = t('web.statusCONFIRMED');
                  StatusIcon = Check;
                }

                return (
                  <button
                    key={minute}
                    type="button"
                    disabled={!free || submitting}
                    aria-pressed={selected}
                    onClick={() => choose(minute)}
                    className={cellClasses}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span
                        className={`text-sm font-bold tracking-tight tabular-nums ${
                          selected ? 'text-textOnAccent' : 'text-textStrong'
                        }`}
                      >
                        {toTime(minute)}
                      </span>
                      <div className="flex items-center gap-1">
                        {peak && free && !selected && (
                          <span
                            title={language === 'vi' ? 'Giờ vàng' : 'Peak hour'}
                            className="w-2.5 h-2.5 rounded-full bg-statusWarning"
                          />
                        )}
                        {StatusIcon && <StatusIcon className="w-4 h-4 shrink-0" />}
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-xs font-semibold mt-1 gap-1">
                      <span>{statusWord}</span>
                      {free && dealQuoteOf(minute).hasDeal && (
                        <span
                          className={`px-1.5 py-0.5 rounded text-[11px] font-extrabold ${
                            selected ? 'bg-page/25 text-textOnAccent' : 'bg-accent-soft text-accent border border-accent-border'
                          }`}
                        >
                          {t('deals.badge')}
                        </span>
                      )}
                    </div>

                    {free && (
                      <div className="mt-1.5 pt-1.5 border-t border-borderToken text-xs tabular-nums min-w-0">
                        {dealQuoteOf(minute).hasDeal && dealQuoteOf(minute).baseHourly && (
                          <span className={`block text-[11px] line-through leading-tight ${selected ? 'opacity-80 text-textOnAccent' : 'text-textMuted'}`}>
                            {money(Math.round(dealQuoteOf(minute).baseHourly! / 2))}
                          </span>
                        )}
                        <div className="flex flex-col items-start gap-1 min-w-0">
                          <span data-slot-price className={`text-xs sm:text-[13px] break-words ${selected ? 'text-textOnAccent font-extrabold' : 'text-accent font-bold'}`}>
                            {money(Math.round(price / 2))}
                          </span>
                          <span className={`shrink-0 text-[11px] font-medium ${selected ? 'text-textOnAccent/85' : 'text-textMuted'}`}>
                            {language === 'vi' ? '/30p' : '/30m'}
                          </span>
                        </div>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Elevated Summary & Multi-Slot Toggle Dock */}
      {activeSelectedMinutes.length > 0 && !loading && !error && court && (
        <div
          className="dock-enter bg-panel-2 p-5 sm:p-6 border-t border-borderStrong space-y-4"
          aria-live="polite"
        >
          {/* Quick Duration Preset Chips & Clear Selection */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-borderToken">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-textMuted font-semibold">{t('web.durationShortcut')}</span>
              {[60, 90, 120, 150].map(mins => {
                const enabled = canUsePreset(mins);
                const active = groupedIntervals.length === 1 && duration === mins;
                return (
                  <button
                    key={mins}
                    type="button"
                    disabled={!enabled}
                    onClick={() => applyDurationPreset(mins)}
                    className={`min-h-[38px] px-3 rounded-token-full text-xs font-bold tabular-nums border ${
                      active
                        ? 'bg-accent text-textOnAccent border-accent'
                        : enabled
                        ? 'bg-panel text-textStrong border-borderStrong hover:border-accent'
                        : 'bg-panel text-textMuted border-borderToken opacity-40 cursor-not-allowed'
                    }`}
                  >
                    {mins} {t('web.minutes')}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setSelectedMinutes([])}
              className="min-h-[36px] px-3 rounded-token-full bg-panel hover:bg-surfaceHover border border-borderStrong text-xs font-semibold text-textMuted hover:text-textStrong"
            >
              {language === 'en' ? 'Clear selection' : 'Bỏ chọn tất cả'}
            </button>
          </div>

          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
            <div className="space-y-2">
              <p className="text-xs text-textMuted font-semibold">
                {court.name_i18n?.[language] || court.name} · {date}
              </p>

              <div className="flex flex-wrap items-center gap-2 tabular-nums">
                {groupedIntervals.map((iv) => (
                  <span
                    key={iv.startMin}
                    className="inline-flex items-center gap-2 px-3 py-1 rounded-token-full bg-panel border border-accent-border text-sm sm:text-base font-extrabold text-textStrong"
                  >
                    <span>
                      {toTime(iv.startMin)} – {toTime(iv.endMin)}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedMinutes((prev) =>
                          prev.filter((m) => m < iv.startMin || m >= iv.endMin)
                        )
                      }
                      aria-label="Remove interval"
                      className="text-textMuted hover:text-statusDanger text-xs font-bold px-1"
                    >
                      ×
                    </button>
                  </span>
                ))}
                <span className="text-xs font-semibold text-accent px-2.5 py-1 rounded-token-full bg-accent-soft border border-accent-border">
                  {duration} {t('web.minutes')} ({activeSelectedMinutes.length} {language === 'en' ? 'slots' : 'ô'})
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-textBody pt-0.5 tabular-nums">
                <span>
                  {t('web.total')}: <strong className="text-textStrong font-bold">{money(total)}</strong>
                </span>
                <span className="text-borderStrong">|</span>
                <span>
                  {t('web.deposit')} ({depositPct}%):{' '}
                  <strong className="text-accent font-bold">{money(deposit)}</strong>
                </span>
                <span className="text-borderStrong">|</span>
                <span>
                  {t('web.dueAtVenue')}:{' '}
                  <strong className="text-textStrong font-semibold">{money(dueAtVenue)}</strong>
                </span>
              </div>
            </div>

            <Button
              size="lg"
              onClick={submit}
              disabled={!valid || submitting}
              className="w-full lg:w-auto shrink-0"
            >
              <span>{t(submitting ? 'web.booking' : 'hero.bookNow')}</span>
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
