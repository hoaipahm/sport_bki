'use client';

import React, { useEffect, useState } from 'react';
import { ChevronDown, Clock, ShieldCheck, MapPin, Phone, Info, AlertCircle } from 'lucide-react';
import { customerApi } from '../lib/api';
import { useLanguage } from '../context/LanguageContext';

interface Details {
  venue: {
    hold_duration_mins?: number;
    deposit_percent?: number;
    policy_i18n?: Record<string, string>;
    google_maps_url?: string;
    phone: string;
  };
  opening_hours: {
    day_of_week: number;
    open_time: string;
    close_time: string;
    is_closed: boolean;
  }[];
}

export function VenueDetails({ venueId }: { venueId: string }) {
  const { language, t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState<Details | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open || details) return;
    const controller = new AbortController();
    setError(false);
    fetch(`${customerApi}/venues/${venueId}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Venue details failed');
        setDetails(await response.json());
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [open, venueId, details]);

  const dayName = (day: number) =>
    new Intl.DateTimeFormat(language === 'vi' ? 'vi-VN' : 'en-US', {
      weekday: 'long',
      timeZone: 'Asia/Ho_Chi_Minh',
    }).format(new Date(Date.UTC(2026, 10, 15 + day, 5)));

  return (
    <details
      className="border-t border-borderToken/60 group pt-2"
      onToggle={event => setOpen(event.currentTarget.open)}
    >
      <summary className="list-none cursor-pointer min-h-[50px] py-3 flex items-center justify-between text-sm font-semibold text-textStrong hover:text-accent transition-colors select-none">
        <span className="flex items-center gap-2">
          <Info className="w-4 h-4 text-accent" />
          <span>{t('web.aboutVenue')}</span>
        </span>
        <div className="flex items-center gap-2 text-xs text-textMuted font-normal">
          <span>{open ? (language === 'vi' ? 'Thu gọn' : 'Collapse') : (language === 'vi' ? 'Xem chi tiết' : 'View details')}</span>
          <ChevronDown className="w-4 h-4 transition-transform duration-200 group-open:rotate-180" />
        </div>
      </summary>

      <div className="pt-4 pb-2 animate-in fade-in-50 duration-200">
        {error ? (
          <p role="alert" className="text-statusDanger text-xs">
            {t('web.networkError')}
          </p>
        ) : !details ? (
          <p role="status" className="text-xs text-textMuted py-4 text-center">
            {t('common.loading')}
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 bg-panel-2/50 rounded-token-md p-4 sm:p-5 border border-borderToken text-xs sm:text-sm min-w-0">
            {/* Left: Opening Hours */}
            <div>
              <h4 className="font-bold text-textStrong flex items-center gap-2 mb-3">
                <Clock className="w-4 h-4 text-accent" />
                <span>{t('web.hours')}</span>
              </h4>
              <dl className="space-y-1.5 divide-y divide-borderToken/40">
                {details.opening_hours.map(hour => (
                  <div key={hour.day_of_week} className="flex justify-between items-center pt-1.5">
                    <dt className="text-textBody">{dayName(hour.day_of_week)}</dt>
                    <dd className="font-mono font-medium text-textStrong">
                      {hour.is_closed ? (
                        <span className="text-textMuted">{t('web.closedDay')}</span>
                      ) : (
                        `${hour.open_time.slice(0, 5)} – ${hour.close_time.slice(0, 5)}`
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>

            {/* Right: Policy & Contact */}
            <div className="space-y-4">
              <div>
                <h4 className="font-bold text-textStrong flex items-center gap-2 mb-2">
                  <ShieldCheck className="w-4 h-4 text-accent" />
                  <span>{t('web.cancelPolicy')}</span>
                </h4>
                <p className="leading-relaxed text-textBody">
                  {details.venue.policy_i18n?.[language] ||
                    details.venue.policy_i18n?.vi ||
                    t('web.policyMissing')}
                </p>
                <p className="text-xs text-accent font-semibold mt-2">
                  {t('web.holdPolicy', {
                    minutes: details.venue.hold_duration_mins ?? 10,
                    percent: details.venue.deposit_percent ?? 30,
                  })}
                </p>
              </div>

              <div className="flex flex-wrap gap-4 pt-2 border-t border-borderToken/40">
                <a
                  className="inline-flex items-center gap-2 text-accent font-semibold hover:underline"
                  href={`tel:${details.venue.phone}`}
                >
                  <Phone className="w-4 h-4" />
                  <span>{t('web.callVenue')}</span>
                </a>
                {details.venue.google_maps_url?.startsWith('https://') && (
                  <a
                    href={details.venue.google_maps_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 text-textStrong hover:text-accent transition-colors"
                  >
                    <MapPin className="w-4 h-4 text-accent" />
                    <span>{t('common.address')}</span>
                  </a>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </details>
  );
}
