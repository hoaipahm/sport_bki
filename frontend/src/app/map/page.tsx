'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Search, RefreshCw } from 'lucide-react';
import { Header } from '../../components/Header';
import { AuthModal } from '../../components/AuthModal';
import { VenueMapExplorer, MapVenueItem } from '../../components/VenueMapExplorer';
import { Button } from '../../components/ui/Button';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { customerApi } from '../../lib/api';
import { DEFAULT_AUTH_SLIDES } from '../../lib/media';

interface SportTag {
  code: string;
  name_i18n?: Record<string, string>;
}

export default function DedicatedMapPage() {
  const router = useRouter();
  const { language, t } = useLanguage();
  const { sessionExpired, setSessionExpired } = useAuth();

  const [authOpen, setAuthOpen] = useState(false);
  const [authSlides, setAuthSlides] = useState<string[]>(DEFAULT_AUTH_SLIDES);
  const [venues, setVenues] = useState<MapVenueItem[]>([]);
  const [sports, setSports] = useState<SportTag[]>([]);
  const [selectedVenueId, setSelectedVenueId] = useState('');
  const [sportFilter, setSportFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (sessionExpired) setAuthOpen(true);
  }, [sessionExpired]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    (async () => {
      try {
        const [vRes, sRes, mRes] = await Promise.all([
          fetch(`${customerApi}/venues`, { signal: controller.signal }),
          fetch(`${customerApi}/sports`, { signal: controller.signal }).catch(() => null),
          fetch(`${customerApi}/media-showcase`, { signal: controller.signal }).catch(() => null),
        ]);
        if (vRes.ok) {
          const vData = await vRes.json();
          const list: MapVenueItem[] = vData.venues || [];
          setVenues(list);
          if (list[0]) setSelectedVenueId((curr) => curr || list[0].id);
        }
        if (sRes && sRes.ok) {
          const sData = await sRes.json();
          setSports(sData.sports || []);
        }
        if (mRes && mRes.ok) {
          const mData = await mRes.json();
          if (Array.isArray(mData.auth_slides) && mData.auth_slides.length > 0) {
            setAuthSlides(mData.auth_slides);
          }
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [reload]);

  const filteredVenues = useMemo(() => {
    const normalize = (val: string) =>
      val
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .toLowerCase();
    const q = normalize(search.trim());
    return venues.filter((item) => {
      const okSport =
        sportFilter === 'all' ||
        Boolean(item.sports?.some((s) => s.code?.toLowerCase() === sportFilter));
      const okSearch =
        !q ||
        normalize(
          `${item.name} ${item.name_i18n?.[language] || ''} ${item.address} ${item.district || ''}`
        ).includes(q);
      return okSport && okSearch;
    });
  }, [venues, sportFilter, search, language]);

  useEffect(() => {
    if (filteredVenues.length > 0 && !filteredVenues.some((v) => v.id === selectedVenueId)) {
      setSelectedVenueId(filteredVenues[0].id);
    }
  }, [filteredVenues, selectedVenueId]);

  const sportChips = useMemo(() => {
    const base = [{ id: 'all', label: t('web.allSports') }];
    for (const sp of sports) {
      base.push({
        id: sp.code,
        label: sp.name_i18n?.[language] || sp.name_i18n?.vi || sp.code,
      });
    }
    return base;
  }, [sports, language, t]);

  return (
    <div className="customer-shell min-h-screen text-textBody pb-24 lg:pb-12">
      <Header onOpenAuthModal={() => setAuthOpen(true)} />

      <main className="max-w-[1200px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8 space-y-6 overflow-x-clip">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm font-semibold text-textMuted hover:text-textStrong w-fit"
          >
            <ArrowLeft className="w-4 h-4 text-accent" />
            <span>{t('nav.book')}</span>
          </Link>

          <div className="relative sm:w-80">
            <Search className="absolute left-3.5 top-3.5 w-4 h-4 text-textMuted" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('web.search')}
              className="w-full min-h-[44px] bg-panel rounded-token-full pl-10 pr-4 text-textStrong border border-borderStrong placeholder:text-textMuted text-sm outline-none focus:border-accent"
            />
          </div>
        </div>

        {/* Dynamic Sport Filter Pills */}
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('web.allSports')}>
          {sportChips.map((chip) => {
            const active = sportFilter === chip.id;
            return (
              <button
                key={chip.id}
                type="button"
                aria-pressed={active}
                onClick={() => setSportFilter(chip.id)}
                className={`min-h-[40px] px-4 rounded-token-full text-xs sm:text-sm font-semibold border ${
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
          <div className="h-[460px] rounded-token-lg skeleton-shimmer border border-borderToken" />
        ) : filteredVenues.length === 0 ? (
          <div className="bg-panel p-10 rounded-token-lg text-center border border-borderStrong space-y-3">
            <p className="text-textMuted">{t('web.noVenues')}</p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setSportFilter('all');
                setSearch('');
                setReload((c) => c + 1);
              }}
            >
              <RefreshCw className="w-4 h-4 mr-1.5" />
              <span>{t('web.allSports')}</span>
            </Button>
          </div>
        ) : (
          <VenueMapExplorer
            venues={filteredVenues}
            selectedVenueId={selectedVenueId}
            onSelectVenue={(id) => setSelectedVenueId(id)}
            onScrollToSchedule={(vid) => {
              const target = vid || selectedVenueId;
              router.push(`/?venue=${encodeURIComponent(target)}#court-booking-section`);
            }}
            tallMap={true}
          />
        )}
      </main>

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
    </div>
  );
}
