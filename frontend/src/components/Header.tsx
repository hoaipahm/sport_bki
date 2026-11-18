'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CalendarDays, User, LogOut, Tag, MapPin, Trophy } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { Button } from './ui/Button';
import { TouchFeedback } from './TouchFeedback';
import { CourtMark } from './CourtMark';
import { MobileBottomNav } from './MobileBottomNav';

interface HeaderProps {
  onOpenAuthModal: () => void;
}

export function Header({ onOpenAuthModal }: HeaderProps) {
  const pathname = usePathname();
  const { language, toggleLanguage, t } = useLanguage();
  const { user, isAuthenticated, logout } = useAuth();

  const isBookingsPage = pathname?.startsWith('/my-bookings');
  const isProfilePage = pathname?.startsWith('/profile');
  const isMapPage = pathname?.startsWith('/map');
  const isHomePage = pathname === '/';

  const displayName = user?.full_name || user?.username || '';
  const initialLetter = displayName ? displayName.trim().charAt(0).toUpperCase() : 'U';

  return (
    <>
      <header className="customer-header sticky top-0 z-40 h-16 border-b border-borderToken text-textStrong select-none">
        <TouchFeedback />
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 h-full flex items-center justify-between gap-2">
          {/* Left: Brand */}
          <Link href="/" className="flex items-center space-x-2.5 group min-w-0 flex-1 lg:flex-none">
            <div className="brand-mark shrink-0 flex items-center justify-center">
              <CourtMark className="w-6 h-6 sm:w-7 sm:h-7" />
            </div>
            <div className="min-w-0">
              <span className="font-extrabold text-sm sm:text-lg tracking-tight text-textStrong block leading-snug truncate">
                <span className="hidden sm:inline">{t('common.appName')}</span>
                <span className="sm:hidden">{t('web.shortName')}</span>
              </span>
              <span className="text-xs text-textMuted hidden sm:block mt-1">
                {t('web.tagline')}
              </span>
            </div>
          </Link>

          {/* Center: Customer Navigation */}
          <nav className="hidden lg:flex items-center gap-1 p-1 rounded-token-full bg-panel border border-borderToken text-sm font-semibold">
            <Link
              href="/"
              className={`px-3.5 py-1.5 rounded-token-full flex items-center gap-1.5 ${
                isHomePage
                  ? 'bg-accent text-textOnAccent font-bold shadow-sm'
                  : 'text-textBody hover:text-textStrong hover:bg-surfaceHover'
              }`}
            >
              <span>{t('nav.book')}</span>
            </Link>
            <Link
              href="/#deals-section"
              className="px-3.5 py-1.5 rounded-token-full text-textBody hover:text-textStrong hover:bg-surfaceHover flex items-center gap-1.5"
            >
              <Tag className="w-3.5 h-3.5 text-accent" />
              <span>{t('nav.deals')}</span>
            </Link>
            <Link
              href="/map"
              className={`px-3.5 py-1.5 rounded-token-full flex items-center gap-1.5 ${
                isMapPage
                  ? 'bg-accent text-textOnAccent font-bold shadow-sm'
                  : 'text-textBody hover:text-textStrong hover:bg-surfaceHover'
              }`}
            >
              <MapPin className={`w-3.5 h-3.5 ${isMapPage ? 'text-textOnAccent' : 'text-accent'}`} />
              <span>{t('nav.map')}</span>
            </Link>
            <Link
              href="/#tournaments-section"
              className="px-3.5 py-1.5 rounded-token-full text-textBody hover:text-textStrong hover:bg-surfaceHover flex items-center gap-1.5"
            >
              <Trophy className="w-3.5 h-3.5 text-accent" />
              <span>{t('nav.tournaments')}</span>
            </Link>
            <Link
              href="/my-bookings"
              className={`px-3.5 py-1.5 rounded-token-full flex items-center gap-1.5 ${
                isBookingsPage
                  ? 'bg-accent text-textOnAccent font-bold shadow-sm'
                  : 'text-textBody hover:text-textStrong hover:bg-surfaceHover'
              }`}
            >
              <CalendarDays className="w-4 h-4" />
              <span>{t('web.tickets')}</span>
            </Link>
          </nav>

          {/* Right: Language Switch + Account Profile Pill */}
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2.5">
            <button
              onClick={toggleLanguage}
              className="min-h-[44px] whitespace-nowrap px-2.5 py-1.5 rounded-token-md text-xs sm:text-sm font-semibold text-textBody hover:text-textStrong hover:bg-surfaceHover"
              title={t('web.language')}
              type="button"
            >
              <span className={language === 'vi' ? 'text-accent font-bold' : 'text-textMuted'}>VI</span>
              <span className="mx-1 text-borderStrong">|</span>
              <span className={language === 'en' ? 'text-accent font-bold' : 'text-textMuted'}>EN</span>
            </button>

            {isAuthenticated && user ? (
              <div className="flex items-center gap-1 bg-panel pl-1.5 pr-1.5 py-1 rounded-token-full border border-borderStrong text-xs sm:text-sm">
                <Link
                  href="/profile"
                  className={`flex items-center gap-2 px-2 py-1 rounded-token-full min-h-[38px] ${
                    isProfilePage
                      ? 'bg-accent-soft text-accent font-bold'
                      : 'hover:bg-surfaceHover text-textStrong'
                  }`}
                >
                  {user.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={user.avatar_url}
                      alt={displayName}
                      className="w-7 h-7 rounded-token-full object-cover border border-accent-border shrink-0"
                    />
                  ) : (
                    <span className="w-7 h-7 rounded-token-full bg-accent text-textOnAccent font-extrabold text-xs flex items-center justify-center shrink-0">
                      {initialLetter}
                    </span>
                  )}
                  <span className="font-semibold max-w-[84px] sm:max-w-[136px] truncate">
                    {displayName}
                  </span>
                </Link>
                <button
                  onClick={logout}
                  className="hover:text-statusDanger text-textMuted min-h-[38px] min-w-[38px] flex items-center justify-center rounded-token-full hover:bg-surfaceHover"
                  title={t('auth.logout')}
                  aria-label={t('auth.logout')}
                  type="button"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <Button variant="primary" size="sm" onClick={onOpenAuthModal} type="button">
                <User className="w-4 h-4 mr-1.5 hidden sm:inline" />
                <span>{t('auth.login')}</span>
              </Button>
            )}
          </div>
        </div>
      </header>

      <MobileBottomNav onOpenAuthModal={onOpenAuthModal} />
    </>
  );
}
