import React from 'react';
import { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { MapPin, Phone, Clock, ShieldCheck, Star, ArrowRight, CheckCircle2, CloudRain } from 'lucide-react';
import { customerApi } from '../../../../../../lib/api';
import { LoopingPhotoCarousel } from '../../../../../../components/LoopingPhotoCarousel';
import { resolveVenueGallery } from '../../../../../../lib/media';

type RouteParamsObj = {
  lang: string;
  city: string;
  sport: string;
  slug: string;
};

interface SeoRouteParams {
  params: Promise<RouteParamsObj> | RouteParamsObj;
}

async function fetchSeoVenue(slug: string) {
  const candidates = [
    `${customerApi}/seo/venue/${encodeURIComponent(slug)}`,
    `http://127.0.0.1:4000/api/customer/v1/seo/venue/${encodeURIComponent(slug)}`,
  ];
  for (const url of candidates) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) return await res.json();
      if (res.status === 404) return null;
    } catch {
      // Try next candidate
    }
  }
  return null;
}

export async function generateMetadata({ params: rawParams }: SeoRouteParams): Promise<Metadata> {
  const params = await Promise.resolve(rawParams);
  const lang = params.lang === 'en' ? 'en' : 'vi';
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  const data = await fetchSeoVenue(params.slug);

  if (!data || data.noindex || data.is_draft_or_locked || !data.venue) {
    return {
      title: lang === 'en' ? 'Venue Not Publicly Listed' : 'Cơ sở chưa xuất bản công khai',
      robots: { index: false, follow: false },
    };
  }

  const v = data.venue;
  const citySlug = v.city_slug || params.city || 'ha-noi';
  const sportSlug = params.sport || 'football';
  const canonicalSlug = v.slug || params.slug;

  // SEO-03: Fallback to Vietnamese when English translation is empty
  const titleName = v.name_i18n?.[lang] || v.name_i18n?.vi || v.name;
  const desc =
    v.description_i18n?.[lang] ||
    v.description_i18n?.vi ||
    v.address_i18n?.[lang] ||
    v.address;

  const viUrl = `${siteUrl}/vi/san/${citySlug}/${sportSlug}/${canonicalSlug}`;
  const enUrl = `${siteUrl}/en/san/${citySlug}/${sportSlug}/${canonicalSlug}`;

  return {
    title: `${titleName} — ${lang === 'en' ? 'Online Court Booking' : 'Đặt Sân Trực Tuyến'}`,
    description: desc,
    alternates: {
      canonical: lang === 'en' ? enUrl : viUrl,
      languages: {
        vi: viUrl,
        en: enUrl,
      },
    },
    openGraph: {
      title: titleName,
      description: desc,
      url: lang === 'en' ? enUrl : viUrl,
      locale: lang === 'en' ? 'en_US' : 'vi_VN',
      type: 'website',
      ...(v.cover_photo_url ? { images: [{ url: v.cover_photo_url }] } : {}),
    },
  };
}

export default async function VenueSeoPage({ params: rawParams }: SeoRouteParams) {
  const params = await Promise.resolve(rawParams);
  const lang = params.lang === 'en' ? 'en' : 'vi';
  const data = await fetchSeoVenue(params.slug);

  if (!data) {
    notFound();
  }

  // SEO-02: Permanent 301 redirect when venue was renamed and accessed via old slug
  if (data.redirect_301 && data.canonical_slug) {
    permanentRedirect(
      `/${lang}/san/${data.city_slug || params.city}/${data.primary_sport || params.sport}/${data.canonical_slug}`
    );
  }

  // SEO-01: Draft or suspended venue renders safe notice with noindex metadata
  if (data.noindex || data.is_draft_or_locked || !data.venue) {
    return (
      <main lang={lang} className="min-h-screen bg-page text-textBody flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-panel rounded-token-lg border border-borderStrong p-8 text-center space-y-4">
          <h1 className="text-xl font-bold text-textStrong">
            {lang === 'en' ? 'Venue Currently Unavailable' : 'Cơ sở đang ở chế độ nháp'}
          </h1>
          <p className="text-sm text-textMuted">
            {lang === 'en'
              ? 'This venue is in draft or temporarily offline and is excluded from search indexing.'
              : 'Cơ sở này chưa được xuất bản công khai và không lập chỉ mục tìm kiếm.'}
          </p>
          <Link
            href="/"
            className="inline-flex items-center justify-center min-h-[44px] px-5 rounded-token-full bg-accent text-textOnAccent font-bold text-sm"
          >
            {lang === 'en' ? 'Browse Active Venues' : 'Xem danh sách sân đang mở'}
          </Link>
        </div>
      </main>
    );
  }

  const v = data.venue;
  const venueTitle = v.name_i18n?.[lang] || v.name_i18n?.vi || v.name;
  const venueDesc = v.description_i18n?.[lang] || v.description_i18n?.vi || '';
  const venueAddr = v.address_i18n?.[lang] || v.address_i18n?.vi || v.address;
  const currency = new Intl.NumberFormat(lang === 'vi' ? 'vi-VN' : 'en-US', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  });

  // Truthful Schema.org SportsActivityLocation JSON-LD (never fabricates ratings!)
  const jsonLd: Record<string, any> = {
    '@context': 'https://schema.org',
    '@type': 'SportsActivityLocation',
    name: venueTitle,
    description: venueDesc || venueAddr,
    telephone: v.phone,
    address: {
      '@type': 'PostalAddress',
      streetAddress: venueAddr,
      addressLocality: v.district || '',
      addressRegion: v.city || 'Hà Nội',
      addressCountry: 'VN',
    },
  };
  if (typeof v.latitude === 'number' && typeof v.longitude === 'number') {
    jsonLd.geo = {
      '@type': 'GeoCoordinates',
      latitude: v.latitude,
      longitude: v.longitude,
    };
  }
  if (Number(v.review_count || 0) > 0 && v.avg_rating) {
    jsonLd.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: Number(v.avg_rating),
      reviewCount: Number(v.review_count),
    };
  }

  const otherLang = lang === 'vi' ? 'en' : 'vi';
  const switchHref = `/${otherLang}/san/${v.city_slug || params.city}/${params.sport}/${v.slug}`;

  return (
    <div lang={lang} className="min-h-screen bg-page text-textBody">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <header className="h-16 border-b border-borderToken bg-panel/90 px-4 sm:px-8 flex items-center justify-between max-w-[1120px] mx-auto">
        <Link href="/" className="font-extrabold text-textStrong text-base sm:text-lg hover:text-accent">
          {lang === 'en' ? '← Sports Court Booking' : '← Hệ Thống Đặt Sân Thể Thao'}
        </Link>
        <Link
          href={switchHref}
          className="min-h-[40px] px-3.5 py-2 rounded-token-full bg-panel-2 border border-borderStrong text-xs font-bold text-accent inline-flex items-center"
        >
          {lang === 'vi' ? 'Switch to English (EN)' : 'Chuyển sang Tiếng Việt (VI)'}
        </Link>
      </header>

      <main className="max-w-[1120px] mx-auto px-4 sm:px-8 py-8 space-y-8">
        {v.weather_closure_banner?.active && (
          <div className="p-4 rounded-token-md bg-statusWarning-soft border border-statusWarning-border text-statusWarning flex items-center gap-3 text-sm font-semibold">
            <CloudRain className="w-5 h-5 shrink-0" />
            <span>{v.weather_closure_banner[lang] || v.weather_closure_banner.vi}</span>
          </div>
        )}

        <article className="bg-panel rounded-token-lg border border-borderStrong overflow-hidden shadow-token-card">
          <LoopingPhotoCarousel
            images={resolveVenueGallery({
              cover_photo_url: v.cover_photo_url,
              photos: v.photos,
              sports: [{ code: params.sport || 'football' }],
            })}
            alt={venueTitle}
            className="aspect-[16/9] sm:aspect-[21/8] border-b border-borderToken"
          />

          <div className="p-6 sm:p-10 space-y-6">
            <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
              <div className="space-y-3">
                <h1 className="text-3xl sm:text-4xl font-extrabold text-textStrong tracking-tight">
                  {venueTitle}
                </h1>
                {venueDesc && <p className="text-base text-textBody leading-relaxed max-w-[65ch]">{venueDesc}</p>}

                <div className="flex flex-wrap items-center gap-5 text-sm text-textBody pt-1 tabular-nums">
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="w-4 h-4 text-accent" />
                    <span>{venueAddr}</span>
                  </span>
                  <a href={`tel:${v.phone}`} className="inline-flex items-center gap-1.5 hover:text-accent">
                    <Phone className="w-4 h-4 text-accent" />
                    <span>{v.phone}</span>
                  </a>
                  {Number(v.review_count || 0) > 0 && v.avg_rating && (
                    <span className="inline-flex items-center gap-1 font-bold text-textStrong">
                      <Star className="w-4 h-4 text-statusWarning" />
                      <span>
                        {v.avg_rating} ({v.review_count})
                      </span>
                    </span>
                  )}
                </div>
              </div>

              <div className="bg-panel-2 rounded-token-md p-5 border border-borderStrong space-y-3 shrink-0 tabular-nums">
                {Number(v.min_price || 0) > 0 && (
                  <div>
                    <span className="text-xs text-textMuted block">
                      {lang === 'en' ? 'Starting from' : 'Giá thuê từ'}
                    </span>
                    <strong className="text-2xl font-extrabold text-accent">
                      {currency.format(Number(v.min_price))}
                    </strong>
                    <span className="text-xs text-textMuted"> / {lang === 'en' ? 'hour' : 'giờ'}</span>
                  </div>
                )}
                <Link
                  href={`/?venue=${v.id}#court-booking-section`}
                  className="inline-flex items-center justify-center w-full min-h-[46px] px-5 rounded-token-full bg-accent hover:bg-accent-hover text-textOnAccent font-bold text-sm"
                >
                  <span>{lang === 'en' ? 'Book Live Slot Now' : 'Chọn Giờ & Đặt Sân Ngay'}</span>
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Link>
              </div>
            </div>

            {Array.isArray(v.amenities) && v.amenities.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-2">
                {v.amenities.map((am: any) => (
                  <span
                    key={am.code}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-token-full bg-panel-2 border border-borderToken text-xs text-textStrong"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-accent" />
                    <span>{lang === 'en' ? am.en || am.vi : am.vi}</span>
                  </span>
                ))}
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-6 pt-4 border-t border-borderToken">
              <div>
                <h2 className="font-bold text-lg text-textStrong mb-3 flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-accent" />
                  <span>{lang === 'en' ? 'Available Courts' : 'Danh sách sân hoạt động'} ({data.courts?.length || 0})</span>
                </h2>
                <div className="grid sm:grid-cols-2 gap-2.5">
                  {(data.courts || []).map((c: any) => (
                    <div key={c.id} className="p-3 rounded-token-sm bg-panel-2 border border-borderToken text-sm">
                      <p className="font-bold text-textStrong">{c.name_i18n?.[lang] || c.name}</p>
                      <p className="text-xs text-textMuted mt-0.5">
                        {c.court_type} · {c.is_outdoor ? (lang === 'en' ? 'Outdoor' : 'Ngoài trời') : lang === 'en' ? 'Indoor' : 'Trong nhà'}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h2 className="font-bold text-lg text-textStrong mb-3 flex items-center gap-2">
                  <Clock className="w-5 h-5 text-accent" />
                  <span>{lang === 'en' ? 'Opening Hours & Policy' : 'Giờ mở cửa & Chính sách hoàn cọc'}</span>
                </h2>
                <p className="text-sm text-textBody leading-relaxed mb-3">
                  {v.policy_i18n?.[lang] || v.policy_i18n?.vi || ''}
                </p>
                {Array.isArray(data.opening_hours) && data.opening_hours[0] && (
                  <p className="text-xs text-accent font-bold tabular-nums">
                    {String(data.opening_hours[0].open_time).slice(0, 5)} –{' '}
                    {String(data.opening_hours[0].close_time).slice(0, 5)} (GMT+7)
                  </p>
                )}
              </div>
            </div>

            {Array.isArray(data.reviews) && data.reviews.length > 0 && (
              <div className="pt-6 border-t border-borderToken space-y-4">
                <h2 className="font-bold text-lg text-textStrong flex items-center gap-2">
                  <Star className="w-5 h-5 text-statusWarning fill-current" />
                  <span>
                    {lang === 'en' ? 'Player Reviews' : 'Đánh giá từ người chơi'} ({v.review_count || data.reviews.length})
                  </span>
                </h2>
                <div className="grid sm:grid-cols-2 gap-4">
                  {data.reviews.map((rev: any) => (
                    <div key={rev.id} className="p-4 rounded-token-md bg-panel-2 border border-borderToken space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <strong className="text-sm text-textStrong">{rev.author_name || 'Khách đặt sân'}</strong>
                        <div className="flex items-center gap-0.5">
                          {[1, 2, 3, 4, 5].map((s) => (
                            <Star
                              key={s}
                              className={`w-3.5 h-3.5 ${
                                s <= Number(rev.rating) ? 'text-statusWarning fill-current' : 'text-textMuted'
                              }`}
                            />
                          ))}
                        </div>
                      </div>
                      <p className="text-sm text-textBody">{rev.comment}</p>
                      {rev.owner_reply && (
                        <div className="p-2.5 rounded-token-sm bg-panel border border-accent-border text-xs space-y-0.5">
                          <strong className="text-accent block">
                            {lang === 'en' ? 'Owner reply:' : 'Phản hồi từ Chủ sân:'}
                          </strong>
                          <span className="text-textStrong">{rev.owner_reply}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </article>
      </main>
    </div>
  );
}
