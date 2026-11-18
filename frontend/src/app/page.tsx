'use client';

import React, { useEffect, useState, useMemo, useDeferredValue, useRef } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  MapPin,
  Phone,
  ShieldCheck,
  Clock,
  Search,
  RefreshCw,
  Star,
  ScanLine,
  Timer,
  CalendarPlus2,
  Sparkles,
  CheckCircle2,
  ExternalLink,
  CloudRain,
} from 'lucide-react';
import { VenueDetails } from '../components/VenueDetails';
import { VenueReviewsSection } from '../components/VenueReviewsSection';
import { Header } from '../components/Header';
import { PhoneMockup } from '../components/PhoneMockup';
import { CourtCalendarGrid, BookingSelectionPayload } from '../components/CourtCalendarGrid';
import { VietQrModal, VietQrBookingData } from '../components/VietQrModal';
import { AuthModal } from '../components/AuthModal';
import { CourtMark } from '../components/CourtMark';
import { LoopingPhotoCarousel } from '../components/LoopingPhotoCarousel';
import { VenueMapExplorer } from '../components/VenueMapExplorer';
import { CustomerDealsAndTournaments, LiveDealOffer } from '../components/CustomerDealsAndTournaments';
import { Button } from '../components/ui/Button';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { customerApi, createIdempotencyKey, formatVndCurrency } from '../lib/api';
import { DEFAULT_HERO_SLIDES, DEFAULT_AUTH_SLIDES, resolveVenueGallery } from '../lib/media';

interface Amenity {
  code: string;
  vi: string;
  en: string;
}

interface SportTag {
  code: string;
  name_i18n?: Record<string, string>;
}

interface Venue {
  id: string;
  name: string;
  name_i18n?: Record<string, string>;
  address: string;
  address_i18n?: Record<string, string>;
  phone: string;
  slug?: string | null;
  city_slug?: string | null;
  district?: string | null;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  google_maps_url?: string | null;
  weather_closure_banner?: { active?: boolean; vi?: string; en?: string } | null;
  cover_photo_url?: string | null;
  photos?: string[] | null;
  min_price?: number | string | null;
  court_count?: number;
  amenities?: Amenity[];
  sports?: SportTag[];
  sample_hours?: { open_time: string; close_time: string } | null;
  review_count?: number;
  avg_rating?: number | string | null;
}

export default function HomePage() {
  const { language, t } = useLanguage();
  const {
    isAuthenticated,
    authenticatedFetch,
    sessionExpired,
    setSessionExpired,
    handleSessionExpired,
  } = useAuth();

  const [authOpen, setAuthOpen] = useState(false);
  const [activeMockup, setActiveMockup] = useState<1 | 2 | 3>(2);
  const [mockupPaused, setMockupPaused] = useState(false);
  const [payment, setPayment] = useState<VietQrBookingData | null>(null);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [catalogSports, setCatalogSports] = useState<SportTag[]>([]);
  const [heroSlides, setHeroSlides] = useState<string[]>(DEFAULT_HERO_SLIDES);
  const [authSlides, setAuthSlides] = useState<string[]>(DEFAULT_AUTH_SLIDES);
  const [venueId, setVenueId] = useState('');
  const [search, setSearch] = useState('');
  const [sportFilter, setSportFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [bookingError, setBookingError] = useState('');
  const [bookingBusy, setBookingBusy] = useState(false);
  const [reload, setReload] = useState(0);

  const lastIdemSignature = useRef('');
  const lastIdemKey = useRef('');

  useEffect(() => {
    if (sessionExpired) {
      setAuthOpen(true);
    }
  }, [sessionExpired]);

  // Gentle auto-progression on the 3-step PhoneMockup showcase (pauses on interaction or reduced-motion)
  useEffect(() => {
    if (mockupPaused) return;
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    const timer = setInterval(() => {
      setActiveMockup((prev) => (prev === 3 ? 1 : ((prev + 1) as 1 | 2 | 3)));
    }, 4200);
    return () => clearInterval(timer);
  }, [mockupPaused]);

  const query = useDeferredValue(search.trim().toLocaleLowerCase(language));

  const visibleVenues = useMemo(() => {
    const normalize = (text: string) =>
      text
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .toLowerCase();

    return venues.filter((item) => {
      const matchesSport =
        sportFilter === 'all' ||
        Boolean(item.sports?.some((s) => s.code?.toLowerCase() === sportFilter));
      const matchesQuery =
        !query ||
        normalize(
          `${item.name} ${item.name_i18n?.[language] || ''} ${item.address} ${item.district || ''}`
        ).includes(normalize(query));
      return matchesSport && matchesQuery;
    });
  }, [venues, query, sportFilter, language]);

  const venue = visibleVenues.find((item) => item.id === venueId) || visibleVenues[0];
  const venueName = venue?.name_i18n?.[language] || venue?.name || '';

  useEffect(() => {
    if (visibleVenues.length && !visibleVenues.some((item) => item.id === venueId)) {
      setVenueId(visibleVenues[0].id);
    }
  }, [visibleVenues, venueId]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(false);
    (async () => {
      try {
        const [response, spRes, mediaRes] = await Promise.all([
          fetch(`${customerApi}/venues`, {
            signal: controller.signal,
            headers: { 'Accept-Language': language },
          }),
          fetch(`${customerApi}/sports`, { signal: controller.signal }).catch(() => null),
          fetch(`${customerApi}/media-showcase`, { signal: controller.signal }).catch(() => null),
        ]);
        if (spRes && spRes.ok) {
          const spData = await spRes.json();
          setCatalogSports(spData.sports || []);
        }
        if (mediaRes && mediaRes.ok) {
          const mData = await mediaRes.json();
          if (Array.isArray(mData.hero_slides) && mData.hero_slides.length > 0) {
            setHeroSlides(mData.hero_slides);
          }
          if (Array.isArray(mData.auth_slides) && mData.auth_slides.length > 0) {
            setAuthSlides(mData.auth_slides);
          }
        }
        if (!response.ok) throw new Error('Venue request failed');
        const data = await response.json();
        const results: Venue[] = data.venues || [];
        setVenues(results);
        const requested =
          typeof window !== 'undefined'
            ? new URLSearchParams(window.location.search).get('venue') || ''
            : '';
        setVenueId((current) => {
          if (requested && results.some((item) => item.id === requested)) return requested;
          return results.some((item) => item.id === current) ? current : results[0]?.id || '';
        });
      } catch {
        if (!controller.signal.aborted) {
          setLoadError(true);
          setVenues([]);
          setVenueId('');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
    // Do not refetch venues merely when switching UI language
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload]);

  const scrollTo = (id: string) =>
    document.getElementById(id)?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });

  const holdBooking = async (
    selection: BookingSelectionPayload,
    explicitVenueId?: string
  ) => {
    const targetVenueId = explicitVenueId || venue?.id;
    if (bookingBusy || !targetVenueId) return;
    if (!isAuthenticated) {
      setBookingError(t('web.loginRequired'));
      setAuthOpen(true);
      return;
    }

    const intervalsKey = selection.intervals
      ? selection.intervals.map((iv) => `${iv.start_at}-${iv.end_at}`).join('|')
      : `${selection.startAt}-${selection.endAt}`;
    const sig = `${targetVenueId}:${selection.courtId}:${intervalsKey}`;
    if (lastIdemSignature.current !== sig) {
      lastIdemSignature.current = sig;
      lastIdemKey.current = createIdempotencyKey('cust-hold');
    }

    setBookingBusy(true);
    setBookingError('');
    try {
      const response = await authenticatedFetch(`${customerApi}/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept-Language': language,
          'Idempotency-Key': lastIdemKey.current,
        },
        body: JSON.stringify({
          venue_id: targetVenueId,
          court_id: selection.courtId,
          start_at: selection.startAt,
          end_at: selection.endAt,
          intervals: selection.intervals,
        }),
      });
      if (response.status === 401) {
        handleSessionExpired();
        return;
      }
      const data = await response.json();
      if (!response.ok) {
        lastIdemSignature.current = '';
        setBookingError(data.message || t('web.bookingError'));
        return;
      }
      const booking = data.booking;
      setPayment({
        bookingId: booking.id,
        bookingCode: booking.booking_code,
        allBookingIds: booking.all_booking_ids,
        allBookingCodes: booking.all_booking_codes,
        slotsLabel: selection.slotsLabel,
        courtName: selection.courtName,
        startAt: selection.startAt,
        endAt: selection.endAt,
        totalAmount: Number(booking.total_amount),
        depositAmount: Number(booking.deposit_amount),
        paidAmount: Number(booking.paid_amount || 0),
        paymentMode: booking.payment_mode,
        emailMode: booking.email_mode,
        vietqrUrl: booking.vietqr_url,
        bankAccount: booking.bank_account,
        holdExpiresAt: booking.hold_expires_at,
      });
    } catch (err: any) {
      if (err?.message !== 'SESSION_EXPIRED') {
        setBookingError(t('web.networkError'));
      }
    } finally {
      setBookingBusy(false);
    }
  };

  const handleClaimDealSlot = (offer: LiveDealOffer) => {
    setVenueId(offer.venue_id);
    void holdBooking(
      {
        courtId: offer.court_id,
        courtName: offer.court_name_i18n?.[language] || offer.court_name,
        startAt: offer.start_at,
        endAt: offer.end_at,
        durationMins: 60,
        totalAmount: offer.deal_price_vnd,
        depositAmount: Math.round(offer.deal_price_vnd * 0.3),
      },
      offer.venue_id
    );
  };

  const currency = useMemo(
    () => ({
      format: (val: number | string) => formatVndCurrency(val, language),
    }),
    [language]
  );

  const benefits = [
    { icon: ShieldCheck, title: 'benefits.neverDoubleBooked', hint: 'web.safeHint' },
    { icon: ScanLine, title: 'benefits.payQrInstant', hint: 'web.paymentHint' },
    { icon: Timer, title: 'benefits.hold10Min', hint: 'web.heldHint' },
    { icon: CalendarPlus2, title: 'benefits.addCalendar', hint: 'web.calendarHint' },
  ];

  const sportChips = useMemo(() => {
    const base = [{ id: 'all', label: t('web.allSports') }];
    if (catalogSports.length > 0) {
      for (const sp of catalogSports) {
        base.push({
          id: sp.code,
          label: sp.name_i18n?.[language] || sp.name_i18n?.vi || sp.code,
        });
      }
      return base;
    }
    return [
      ...base,
      { id: 'football', label: t('web.sportFootball') },
      { id: 'badminton', label: t('web.sportBadminton') },
      { id: 'pickleball', label: t('web.sportPickleball') },
    ];
  }, [catalogSports, language, t]);

  const primarySportSlug = venue?.sports?.[0]?.code || 'football';
  const seoVenueHref =
    venue?.slug
      ? `/${language}/san/${venue.city_slug || 'ha-noi'}/${primarySportSlug}/${venue.slug}`
      : null;

  return (
    <div className="customer-shell min-h-screen text-textBody pb-20 lg:pb-0">
      <Header onOpenAuthModal={() => setAuthOpen(true)} />

      <main className="max-w-[1200px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-10 space-y-12 lg:space-y-20 overflow-x-clip">
        {/* Stage 1: Hero with Looping Stadium Backdrop & Interactive 3-Step PhoneMockup Showcase */}
        <section className="stage-enter-1 relative overflow-hidden bg-panel rounded-token-lg p-5 sm:p-10 lg:p-14 shadow-token-elevated border border-borderStrong min-w-0">
          {/* Ambient Looping Stadium Backdrop */}
          <div className="absolute inset-0 pointer-events-none opacity-30">
            <LoopingPhotoCarousel
              images={heroSlides}
              alt=""
              intervalMs={5200}
              className="w-full h-full"
              showControls={false}
              showCounter={false}
              showDots={false}
              overlayClassName="hero-backdrop-mask"
            />
          </div>

          <div className="relative z-[2] grid grid-cols-1 lg:grid-cols-[1.12fr_1fr] items-center gap-8 lg:gap-14">
            <div
              className="order-2 lg:order-1 min-w-0"
              onMouseEnter={() => setMockupPaused(true)}
              onMouseLeave={() => setMockupPaused(false)}
              onFocus={() => setMockupPaused(true)}
              onBlur={() => setMockupPaused(false)}
            >
              <div className="phone-showcase">
                <div className="phone-showcase-row">
                  <PhoneMockup
                    step={1}
                    active={activeMockup === 1}
                    onSelect={() => {
                      setActiveMockup(1);
                      scrollTo('venues');
                    }}
                  />
                  <PhoneMockup
                    step={2}
                    active={activeMockup === 2}
                    onSelect={() => {
                      setActiveMockup(2);
                      scrollTo('court-booking-section');
                    }}
                  />
                  <PhoneMockup
                    step={3}
                    active={activeMockup === 3}
                    onSelect={() => setActiveMockup(3)}
                  />
                </div>
              </div>
              <p className="text-xs text-textMuted text-center mt-3 flex items-center justify-center gap-1.5">
                <Sparkles size={14} className="text-accent" />
                <span>{t('web.illustration')}</span>
              </p>
            </div>

            <div className="order-1 lg:order-2 space-y-6 min-w-0">
              <h1 className="text-3xl sm:text-5xl lg:text-[54px] leading-[1.18] font-extrabold tracking-tight text-textStrong">
                {t('hero.title')}
              </h1>
              <p className="text-base sm:text-lg leading-relaxed text-textBody max-w-[44ch]">
                {t('hero.description')}
              </p>
              <div className="flex flex-wrap gap-3.5 pt-2">
                <Button size="lg" onClick={() => scrollTo('court-booking-section')}>
                  <span>{t('hero.bookNow')}</span>
                  <ArrowRight className="w-5 h-5 ml-2" />
                </Button>
                <Link
                  href="/map"
                  className="inline-flex items-center justify-center min-h-[50px] px-6 rounded-token-full bg-panel-2 hover:bg-surfaceHover border border-borderStrong text-textStrong font-bold text-sm sm:text-base"
                >
                  <MapPin className="w-4 h-4 mr-2 text-accent" />
                  <span>{t('nav.map')}</span>
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* Stage 2: Plain Customer Benefit Strip */}
        <section
          className="stage-enter-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5"
          aria-label={t('web.tagline')}
        >
          {benefits.map(({ icon: Icon, title, hint }) => (
            <div
              key={title}
              className="card-interactive bg-panel rounded-token-md p-5 border border-borderToken flex items-start gap-3.5"
            >
              <div className="benefit-icon">
                <Icon className="w-5 h-5" strokeWidth={2} />
              </div>
              <div>
                <p className="font-bold text-sm sm:text-base text-textStrong leading-snug">
                  {t(title)}
                </p>
                <p className="text-xs sm:text-sm text-textMuted mt-1">{t(hint)}</p>
              </div>
            </div>
          ))}
        </section>

        {/* Stage 3: Venue Discovery, Sport Filters & Real Venue Card */}
        <section id="venues" className="stage-enter-3 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-textStrong tracking-tight">
                {t('web.discover')}
              </h2>
              <p className="mt-1 text-sm text-textMuted">{t('web.results')}</p>
            </div>

            {/* Search Input */}
            <div className="relative sm:w-80">
              <label className="sr-only" htmlFor="venue-search">
                {t('web.searchLabel')}
              </label>
              <Search className="absolute left-3.5 top-3.5 w-4 h-4 text-textMuted" />
              <input
                id="venue-search"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('web.search')}
                className="w-full min-h-[44px] bg-panel rounded-token-full pl-10 pr-4 text-textStrong border border-borderStrong placeholder:text-textMuted text-sm outline-none focus:border-accent"
              />
            </div>
          </div>

          {/* Dynamic Full-Width Sport Filter Pills */}
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('web.allSports')}>
            {sportChips.map((chip) => {
              const active = sportFilter === chip.id;
              return (
                <button
                  key={chip.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSportFilter(chip.id)}
                  className={`min-h-[42px] px-4 rounded-token-full text-xs sm:text-sm font-semibold border ${
                    active
                      ? 'bg-accent text-textOnAccent border-accent font-bold'
                      : 'bg-panel text-textBody border-borderToken hover:text-textStrong hover:bg-surfaceHover'
                  }`}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>

          {loading ? (
            <div className="grid sm:grid-cols-2 gap-4" role="status" aria-label={t('common.loading')}>
              <div className="h-64 rounded-token-lg skeleton-shimmer border border-borderToken sm:col-span-2" />
            </div>
          ) : loadError ? (
            <div role="alert" className="bg-panel p-8 rounded-token-lg text-center border border-borderStrong space-y-4">
              <p className="text-textStrong font-semibold">{t('web.unavailable')}</p>
              <Button variant="secondary" onClick={() => setReload((value) => value + 1)}>
                <RefreshCw className="w-4 h-4 mr-2" />
                {t('web.retry')}
              </Button>
            </div>
          ) : !visibleVenues.length ? (
            <div className="bg-panel p-10 rounded-token-lg text-center border border-borderToken space-y-3">
              <p className="text-textMuted">{t('web.noVenues')}</p>
              {sportFilter !== 'all' || search ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setSportFilter('all');
                    setSearch('');
                  }}
                >
                  {t('web.allSports')}
                </Button>
              ) : null}
            </div>
          ) : (
            <>
              {/* Multi-Venue Switcher Cards with Court Photo Thumbnails */}
              {visibleVenues.length > 1 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 min-w-0">
                  {visibleVenues.map((item) => {
                    const active = venue?.id === item.id;
                    const itemMinPrice = Number(item.min_price || 0);
                    const itemPhotos = resolveVenueGallery(item);
                    const thumbSrc = itemPhotos[0];
                    return (
                      <button
                        key={item.id}
                        aria-pressed={active}
                        onClick={() => setVenueId(item.id)}
                        type="button"
                        className={`min-w-0 w-full text-left p-3.5 sm:p-4 rounded-token-md border flex items-center justify-between gap-3 ${
                          active
                            ? 'border-accent bg-accent-soft shadow-sm'
                            : 'border-borderToken bg-panel hover:bg-surfaceHover hover:border-borderStrong'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="relative w-16 h-12 sm:w-20 sm:h-14 rounded-token-sm overflow-hidden border border-borderStrong shrink-0 bg-panel-2">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={thumbSrc} alt="" className="w-full h-full object-cover" />
                            {itemPhotos.length > 1 && (
                              <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-page/80 text-[10px] font-bold text-textStrong tabular-nums">
                                {itemPhotos.length}
                              </span>
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-base text-textStrong truncate">
                              {item.name_i18n?.[language] || item.name}
                            </p>
                            <p className="text-xs text-textMuted truncate mt-0.5">
                              {item.address_i18n?.[language] || item.address}
                            </p>
                          </div>
                        </div>
                        {itemMinPrice > 0 && (
                          <div className="text-right shrink-0 tabular-nums">
                            <span className="text-xs text-textMuted block">{t('venue.fromPrice')}</span>
                            <span className="text-sm font-extrabold text-accent">
                              {currency.format(itemMinPrice)}
                            </span>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Selected Venue Showcase Card */}
              {venue && (
                <article className="bg-panel rounded-token-lg overflow-hidden shadow-token-card border border-borderStrong">
                  {venue.weather_closure_banner?.active && (
                    <div className="px-6 py-3 bg-statusWarning-soft border-b border-statusWarning-border text-statusWarning flex items-center gap-2.5 text-sm font-semibold">
                      <CloudRain className="w-4 h-4 shrink-0" />
                      <span>{venue.weather_closure_banner[language] || venue.weather_closure_banner.vi}</span>
                    </div>
                  )}

                  {/* Multi-Photo Looping Court Banner with << / >> Controls */}
                  <LoopingPhotoCarousel
                    key={venue.id}
                    images={resolveVenueGallery(venue)}
                    alt={venueName}
                    intervalMs={4400}
                    className="aspect-[16/9] sm:aspect-[21/8] border-b border-borderToken"
                    overlayClassName="carousel-vignette"
                  >
                    {/* Live factual badges overlaid cleanly */}
                    <div className="absolute bottom-4 left-4 right-4 sm:left-6 sm:right-6 flex flex-wrap items-center justify-between gap-2 pointer-events-auto">
                      <div className="flex flex-wrap items-center gap-2">
                        {venue.sports?.map((sp) => (
                          <span
                            key={sp.code}
                            className="px-3 py-1 rounded-token-full text-xs font-semibold bg-overlay backdrop-blur-sm text-accent border border-accent-border"
                          >
                            {sp.name_i18n?.[language] || sp.code}
                          </span>
                        ))}
                        {Number(venue.court_count || 0) > 0 && (
                          <span className="px-3 py-1 rounded-token-full text-xs font-medium bg-overlay backdrop-blur-sm text-textStrong border border-borderStrong">
                            {t('web.courtsCountLabel', { count: venue.court_count || 0 })}
                          </span>
                        )}
                        {Number(venue.review_count || 0) > 0 && venue.avg_rating && (
                          <span className="px-3 py-1 rounded-token-full text-xs font-semibold bg-overlay backdrop-blur-sm text-textStrong border border-borderStrong inline-flex items-center gap-1 tabular-nums">
                            <Star className="w-3.5 h-3.5 text-statusWarning" />
                            <span>
                              {venue.avg_rating} · {venue.review_count} {t('venue.reviews')}
                            </span>
                          </span>
                        )}
                      </div>

                      {seoVenueHref && (
                        <Link
                          href={seoVenueHref}
                          className="px-3 py-1 rounded-token-full text-xs font-semibold bg-overlay hover:bg-surfaceHover backdrop-blur-sm text-textStrong border border-borderStrong inline-flex items-center gap-1.5"
                        >
                          <span>{t('seo.venuePageBadge')}</span>
                          <ExternalLink className="w-3.5 h-3.5 text-accent" />
                        </Link>
                      )}
                    </div>
                  </LoopingPhotoCarousel>

                  <div className="p-6 sm:p-8 space-y-6">
                    <div className="flex flex-col lg:flex-row justify-between gap-6 lg:items-center">
                      <div className="space-y-3">
                        <h3 className="font-extrabold text-2xl sm:text-3xl text-textStrong tracking-tight">
                          {venueName}
                        </h3>

                        <div className="flex flex-col sm:flex-row flex-wrap gap-3 sm:gap-6 text-sm text-textBody">
                          <p className="flex items-start gap-2">
                            <MapPin className="text-accent w-4 h-4 shrink-0 mt-0.5" />
                            <span>{venue.address_i18n?.[language] || venue.address}</span>
                          </p>

                          {venue.sample_hours && (
                            <p className="flex items-center gap-2 tabular-nums">
                              <Clock className="text-accent w-4 h-4 shrink-0" />
                              <span>
                                {t('web.openHoursLabel', {
                                  open: venue.sample_hours.open_time,
                                  close: venue.sample_hours.close_time,
                                })}
                              </span>
                            </p>
                          )}

                          <a
                            href={`tel:${venue.phone}`}
                            className="flex items-center gap-2 hover:text-textStrong tabular-nums"
                          >
                            <Phone className="text-accent w-4 h-4 shrink-0" />
                            <span>{venue.phone}</span>
                          </a>
                        </div>

                        {Array.isArray(venue.amenities) && venue.amenities.length > 0 && (
                          <div className="flex flex-wrap gap-2 pt-1">
                            {venue.amenities.map((am) => (
                              <span
                                key={am.code}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-token-sm bg-panel-2 border border-borderToken text-xs text-textBody"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5 text-accent shrink-0" />
                                <span>{language === 'en' ? am.en : am.vi}</span>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Real Derived Price Block */}
                      <div className="bg-panel-2 p-4 sm:p-5 rounded-token-md border border-borderStrong flex flex-wrap items-center justify-between sm:justify-end gap-3 sm:gap-5 shrink-0">
                        {Number(venue.min_price || 0) > 0 && (
                          <div className="tabular-nums whitespace-nowrap">
                            <span className="text-xs text-textMuted block">{t('venue.fromPrice')}</span>
                            <div className="flex items-baseline gap-1 mt-0.5">
                              <span className="text-xl sm:text-2xl font-extrabold text-textStrong">
                                {currency.format(Number(venue.min_price))}
                              </span>
                              <span className="text-xs text-textMuted">{t('venue.perHour')}</span>
                            </div>
                          </div>
                        )}
                        <Button
                          variant="primary"
                          onClick={() => scrollTo('court-booking-section')}
                          className="shrink-0"
                        >
                          <span>{t('venue.chooseTime')}</span>
                          <ArrowRight className="w-4 h-4 ml-1.5" />
                        </Button>
                      </div>
                    </div>

                    <VenueDetails key={venue.id} venueId={venue.id} />

                    <VenueReviewsSection
                      key={`reviews-${venue.id}`}
                      venueId={venue.id}
                      onOpenAuthModal={() => setAuthOpen(true)}
                      onSummaryUpdated={(sum) => {
                        setVenues((prev) =>
                          prev.map((v) =>
                            v.id === venue.id
                              ? {
                                  ...v,
                                  review_count: sum.review_count,
                                  avg_rating: sum.avg_rating,
                                }
                              : v
                          )
                        );
                      }}
                    />
                  </div>
                </article>
              )}

              {/* C-02 Interactive Venue Map & Consent-Aware Distance Explorer */}
              <VenueMapExplorer
                venues={visibleVenues}
                selectedVenueId={venue?.id || ''}
                onSelectVenue={(id) => setVenueId(id)}
                onScrollToSchedule={() => scrollTo('court-booking-section')}
              />
            </>
          )}
        </section>

        {/* Stage 4: Live Court Availability & Booking Grid */}
        <section id="court-booking-section" className="stage-enter-4 space-y-5" aria-busy={bookingBusy}>
          <div>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-textStrong tracking-tight">
              {t('web.schedule')}
            </h2>
            <p className="mt-1 text-sm text-textMuted max-w-[65ch]">{t('web.scheduleHelp')}</p>
          </div>

          {bookingError && (
            <div
              role="alert"
              className="text-statusDanger p-4 bg-statusDanger-soft border border-statusDanger-border rounded-token-md text-sm font-medium"
            >
              {bookingError}
            </div>
          )}

          {bookingBusy && (
            <div className="flex items-center gap-2 text-accent text-sm font-semibold" role="status">
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>{t('web.booking')}</span>
            </div>
          )}

          {venue && !loading ? (
            <CourtCalendarGrid
              key={venue.id}
              venueId={venue.id}
              venueName={venueName}
              onInitiateBooking={(sel) => holdBooking(sel, venue.id)}
            />
          ) : (
            <p className="p-8 bg-panel rounded-token-lg border border-borderToken text-center text-textMuted">
              {t('web.chooseVenue')}
            </p>
          )}
        </section>

        {/* Stage 5: C-21 Discounted Deals Feed & A-31 Public Tournaments */}
        <CustomerDealsAndTournaments
          sportFilter={sportFilter}
          searchQuery={query}
          onClaimDealSlot={handleClaimDealSlot}
        />
      </main>

      <footer className="border-t border-borderToken mt-20 py-8 bg-panel/60">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs sm:text-sm text-textMuted">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-accent" />
            <span className="text-textStrong font-bold">{t('common.appName')}</span>
            <span>· {t('web.footer')}</span>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs">
            <Link href="/staff" className="hover:text-textStrong underline underline-offset-4">
              {t('portals.staff')}
            </Link>
            <Link href="/admin" className="hover:text-textStrong underline underline-offset-4">
              {t('portals.admin')}
            </Link>
            <Link href="/platform" className="hover:text-textStrong underline underline-offset-4">
              {t('portals.platform')}
            </Link>
          </div>
        </div>
      </footer>

      <AuthModal
        isOpen={authOpen}
        onClose={() => {
          setAuthOpen(false);
          setSessionExpired(false);
        }}
        initialTab="LOGIN"
        sessionExpiredNotice={sessionExpired}
        slides={authSlides}
      />
      <VietQrModal
        isOpen={Boolean(payment)}
        onClose={() => setPayment(null)}
        bookingData={payment}
      />
    </div>
  );
}
