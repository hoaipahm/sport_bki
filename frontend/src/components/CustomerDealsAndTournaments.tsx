'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { Tag, Clock, Trophy, ArrowRight, Flame, CalendarDays } from 'lucide-react';
import { customerApi, formatVndCurrency } from '../lib/api';
import { DEFAULT_HERO_SLIDES, resolveSportCover } from '../lib/media';
import { LoopingPhotoCarousel } from './LoopingPhotoCarousel';
import { useLanguage } from '../context/LanguageContext';
import { Button } from './ui/Button';

export interface LiveDealOffer {
  offer_key: string;
  deal_id: string;
  kind: 'OFFPEAK' | 'LAST_MINUTE';
  title_vi: string;
  title_en: string;
  venue_id: string;
  venue_name: string;
  venue_name_i18n?: Record<string, string>;
  court_id: string;
  court_name: string;
  court_name_i18n?: Record<string, string>;
  sport_code: string;
  date: string;
  time_label: string;
  start_at: string;
  end_at: string;
  original_price_vnd: number;
  deal_price_vnd: number;
  saved_percent: number;
}

interface CustomerDealsAndTournamentsProps {
  sportFilter: string;
  searchQuery: string;
  onClaimDealSlot: (offer: LiveDealOffer) => void;
}

export function CustomerDealsAndTournaments({
  sportFilter,
  searchQuery,
  onClaimDealSlot,
}: CustomerDealsAndTournamentsProps) {
  const { language, t } = useLanguage();
  const [deals, setDeals] = useState<LiveDealOffer[]>([]);
  const [tournaments, setTournaments] = useState<any[]>([]);
  const [loadingDeals, setLoadingDeals] = useState(true);

  const currency = useMemo(
    () => ({
      format: (val: number | string) => formatVndCurrency(val, language),
    }),
    [language]
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoadingDeals(true);
    const params = new URLSearchParams();
    if (sportFilter && sportFilter !== 'all') params.set('sport', sportFilter);
    if (searchQuery) params.set('search', searchQuery);

    fetch(`${customerApi}/deals?${params.toString()}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : { deals: [] }))
      .then((d) => {
        if (!controller.signal.aborted) setDeals(d.deals || []);
      })
      .catch(() => {
        if (!controller.signal.aborted) setDeals([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingDeals(false);
      });

    return () => controller.abort();
  }, [sportFilter, searchQuery]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${customerApi}/tournaments`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : { tournaments: [] }))
      .then((d) => {
        if (!controller.signal.aborted) setTournaments(d.tournaments || []);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  return (
    <div className="space-y-14">
      {/* C-21 CUSTOMER DEALS TAB / SECTION */}
      <section id="deals-section" className="space-y-5">
        <div>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-textStrong tracking-tight">
            {t('deals.sectionTitle')}
          </h2>
          <p className="text-sm text-textMuted mt-1 max-w-[68ch]">{t('deals.sectionSubtitle')}</p>
        </div>

        {loadingDeals ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-44 rounded-token-lg skeleton-shimmer border border-borderToken" />
            ))}
          </div>
        ) : deals.length === 0 ? (
          <div className="bg-panel rounded-token-lg p-7 border border-borderToken text-sm text-textMuted">
            {t('deals.emptyDeals')}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {deals.slice(0, 6).map((offer) => (
              <article
                key={offer.offer_key}
                className="card-interactive min-w-0 bg-panel rounded-token-lg overflow-hidden border border-borderStrong flex flex-col justify-between"
              >
                <div className="relative h-28 bg-panel-2 overflow-hidden border-b border-borderToken">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={resolveSportCover(offer.sport_code)}
                    alt=""
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-panel via-page/30 to-transparent" />
                  <div className="absolute bottom-2.5 left-4 right-4 flex flex-wrap items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-token-full bg-page/85 backdrop-blur-sm border border-accent-border text-accent text-xs font-bold">
                      {offer.kind === 'LAST_MINUTE' ? (
                        <Flame className="w-3.5 h-3.5" />
                      ) : (
                        <Tag className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {offer.kind === 'LAST_MINUTE' ? t('deals.lastMinuteTag') : t('deals.offpeakTag')}
                      </span>
                    </span>
                    <span className="px-2.5 py-0.5 rounded-token-full bg-accent text-textOnAccent text-xs font-extrabold tabular-nums">
                      {t('deals.savePct', { pct: offer.saved_percent })}
                    </span>
                  </div>
                </div>

                <div className="p-5 flex-1 flex flex-col justify-between gap-4">
                  <div className="space-y-2">
                    <h3 className="font-bold text-base text-textStrong leading-snug">
                      {language === 'en' ? offer.title_en : offer.title_vi}
                    </h3>

                    <div className="text-xs sm:text-sm text-textBody space-y-1 tabular-nums">
                      <p className="font-semibold text-textStrong">
                        {offer.venue_name_i18n?.[language] || offer.venue_name} ·{' '}
                        {offer.court_name_i18n?.[language] || offer.court_name}
                      </p>
                      <p className="flex items-center gap-1.5 text-textMuted">
                        <Clock className="w-3.5 h-3.5 text-accent shrink-0" />
                        <span>
                          {offer.date} · {offer.time_label}
                        </span>
                      </p>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-borderToken flex items-end justify-between gap-3 tabular-nums">
                    <div>
                      <span className="text-xs text-textMuted line-through block">
                        {currency.format(offer.original_price_vnd)}
                      </span>
                      <strong className="text-xl font-extrabold text-accent">
                        {currency.format(offer.deal_price_vnd)}
                      </strong>
                    </div>

                    <Button size="sm" onClick={() => onClaimDealSlot(offer)}>
                      <span>{t('deals.bookDealNow')}</span>
                      <ArrowRight className="w-4 h-4 ml-1" />
                    </Button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* A-31 PUBLIC BILINGUAL TOURNAMENTS & LIVE STANDINGS */}
      <section id="tournaments-section" className="space-y-5">
        <div>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-textStrong tracking-tight">
            {t('tournaments.sectionTitle')}
          </h2>
          <p className="text-sm text-textMuted mt-1 max-w-[68ch]">{t('tournaments.sectionSubtitle')}</p>
        </div>

        {tournaments.length === 0 ? (
          <div className="bg-panel rounded-token-lg p-7 border border-borderToken flex items-center gap-3 text-sm text-textMuted">
            <Trophy className="w-5 h-5 text-accent shrink-0" />
            <span>
              {language === 'en'
                ? 'No public tournaments are currently open. Live brackets and standings appear here automatically once published by a venue.'
                : 'Hiện chưa có giải đấu công khai nào đang mở đăng ký. Lịch thi đấu và bảng xếp hạng trực tiếp sẽ tự động hiển thị tại đây khi cơ sở công bố giải.'}
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {tournaments.map((tr) => (
              <article
                key={tr.id}
                className="min-w-0 bg-panel rounded-token-lg overflow-hidden border border-borderStrong"
              >
                <LoopingPhotoCarousel
                  images={DEFAULT_HERO_SLIDES}
                  alt={language === 'en' ? tr.name_en || tr.name_vi : tr.name_vi}
                  intervalMs={4800}
                  className="h-36 border-b border-borderToken"
                  showCounter={false}
                  overlayClassName="bg-gradient-to-t from-panel via-page/30 to-transparent"
                />
                <div className="p-6 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg sm:text-xl font-extrabold text-textStrong flex items-center gap-2">
                      <Trophy className="w-5 h-5 text-accent shrink-0" />
                      <span>{language === 'en' ? tr.name_en || tr.name_vi : tr.name_vi}</span>
                    </h3>
                    <p className="text-xs text-textMuted mt-1">
                      {tr.venue_name_i18n?.[language] || tr.venue_name} ·{' '}
                      {tr.format === 'KNOCKOUT' ? t('tournaments.knockout') : t('tournaments.roundRobin')}
                    </p>
                  </div>
                  <span className="px-3 py-1 rounded-token-full bg-accent-soft border border-accent-border text-accent text-xs font-bold">
                    {tr.status}
                  </span>
                </div>

                {Array.isArray(tr.standings) && tr.standings.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs sm:text-sm tabular-nums">
                      <thead>
                        <tr className="border-b border-borderToken text-textMuted">
                          <th className="py-2 pr-2">{t('tournaments.team')}</th>
                          <th className="py-2 px-2 text-center">{t('tournaments.played')}</th>
                          <th className="py-2 px-2 text-center">{t('tournaments.won')}</th>
                          <th className="py-2 px-2 text-center">{t('tournaments.drawn')}</th>
                          <th className="py-2 px-2 text-center">{t('tournaments.lost')}</th>
                          <th className="py-2 pl-2 text-right">{t('tournaments.points')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-borderToken/50">
                        {tr.standings.map((st: any) => (
                          <tr key={st.id}>
                            <td className="py-2 pr-2 font-semibold text-textStrong">{st.team_name}</td>
                            <td className="py-2 px-2 text-center">{st.played}</td>
                            <td className="py-2 px-2 text-center text-accent">{st.wins}</td>
                            <td className="py-2 px-2 text-center">{st.draws}</td>
                            <td className="py-2 px-2 text-center text-statusDanger">{st.losses}</td>
                            <td className="py-2 pl-2 text-right font-extrabold text-accent">{st.points}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {Array.isArray(tr.matches) && tr.matches.length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-borderToken">
                    <p className="text-xs font-bold text-textMuted">{t('tournaments.matches')}</p>
                    {tr.matches.slice(0, 4).map((m: any) => (
                      <div
                        key={m.id}
                        className="p-2.5 rounded-token-sm bg-panel-2 flex flex-wrap items-center justify-between gap-2 text-xs tabular-nums"
                      >
                        <span className="font-semibold text-textStrong">
                          {m.home_team_name || 'TBD'}{' '}
                          <span className="px-2 py-0.5 rounded bg-panel font-mono text-accent">
                            {m.status === 'COMPLETED' ? `${m.home_score} - ${m.away_score}` : 'vs'}
                          </span>{' '}
                          {m.away_team_name || 'TBD'}
                        </span>
                        {m.start_at && (
                          <span className="text-textMuted inline-flex items-center gap-1">
                            <CalendarDays className="w-3.5 h-3.5 text-accent" />
                            <span>
                              {m.court_name ? `${m.court_name} · ` : ''}
                              {new Date(m.start_at).toLocaleString(language === 'vi' ? 'vi-VN' : 'en-US', {
                                dateStyle: 'short',
                                timeStyle: 'short',
                                timeZone: 'Asia/Ho_Chi_Minh',
                              })}
                            </span>
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
