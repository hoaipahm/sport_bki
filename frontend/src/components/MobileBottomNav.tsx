'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CalendarDays, Compass, MapPin, User } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';

export function MobileBottomNav({ onOpenAuthModal }: { onOpenAuthModal: () => void }) {
  const pathname = usePathname();
  const { t } = useLanguage();
  const { isAuthenticated, user } = useAuth();

  const isHome = pathname === '/';
  const isMap = pathname?.startsWith('/map');
  const isBookings = pathname?.startsWith('/my-bookings');
  const isProfile = pathname?.startsWith('/profile');

  return (
    <nav
      aria-label="Mobile Navigation"
      className="mobile-bottom-dock lg:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-borderStrong"
    >
      <div className="grid grid-cols-4 gap-1 px-2 py-1.5 max-w-md mx-auto">
        <Link
          href="/"
          className={`min-h-[48px] rounded-token-sm flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${
            isHome ? 'text-accent bg-accent-soft font-bold' : 'text-textMuted hover:text-textStrong'
          }`}
        >
          <Compass className="w-5 h-5" />
          <span>{t('nav.book')}</span>
        </Link>

        <Link
          href="/map"
          className={`min-h-[48px] rounded-token-sm flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${
            isMap ? 'text-accent bg-accent-soft font-bold' : 'text-textMuted hover:text-textStrong'
          }`}
        >
          <MapPin className="w-5 h-5" />
          <span>{t('nav.map')}</span>
        </Link>

        <Link
          href="/my-bookings"
          className={`min-h-[48px] rounded-token-sm flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${
            isBookings ? 'text-accent bg-accent-soft font-bold' : 'text-textMuted hover:text-textStrong'
          }`}
        >
          <CalendarDays className="w-5 h-5" />
          <span>{t('nav.tickets')}</span>
        </Link>

        {isAuthenticated ? (
          <Link
            href="/profile"
            className={`min-h-[48px] rounded-token-sm flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${
              isProfile ? 'text-accent bg-accent-soft font-bold' : 'text-textMuted hover:text-textStrong'
            }`}
          >
            {user?.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.avatar_url}
                alt={user.full_name || user.username}
                className="w-5 h-5 rounded-token-full object-cover border border-accent-border"
              />
            ) : (
              <User className="w-5 h-5" />
            )}
            <span>{t('nav.profile')}</span>
          </Link>
        ) : (
          <button
            type="button"
            onClick={onOpenAuthModal}
            className="min-h-[48px] rounded-token-sm flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold text-textMuted hover:text-textStrong"
          >
            <User className="w-5 h-5" />
            <span>{t('auth.login')}</span>
          </button>
        )}
      </div>
    </nav>
  );
}
