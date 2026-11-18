'use client';

import React from 'react';
import Image from 'next/image';
import { Check, QrCode, Wifi, Battery, Clock, ChevronRight } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

export interface PhoneMockupProps {
  step: 1 | 2 | 3;
  active?: boolean;
  onSelect?: () => void;
  src?: string;
  alt?: string;
  children?: React.ReactNode;
}

export function PhoneMockup({ step, active = false, onSelect, src, alt = '', children }: PhoneMockupProps) {
  const { t } = useLanguage();

  return (
    <div
      aria-hidden="true"
      data-active={active ? 'true' : 'false'}
      onClick={onSelect}
      className="phone-device relative aspect-[9/19] overflow-hidden flex flex-col p-2.5 text-textBody select-none cursor-pointer"
    >
      {src ? (
        <Image src={src} alt={alt} fill sizes="156px" className="object-cover" />
      ) : (
        <>
          <div className="flex justify-between items-center gap-1 text-[7px] leading-none shrink-0 pb-2.5">
            <span className="whitespace-nowrap font-semibold text-textStrong tabular-nums">09:41</span>
            <span className="w-6 h-1 rounded-full bg-panel-2" />
            <span className="flex gap-0.5 text-textStrong">
              <Wifi size={7} />
              <Battery size={8} />
            </span>
          </div>

          {children || (
            <div className="flex-1 min-h-0 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-1 text-[8px] text-accent font-semibold min-w-0">
                <span className="flex items-center gap-1 min-w-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                  <span className="truncate">{t('web.shortName')}</span>
                </span>
                <span className="px-1.5 py-0.5 rounded-full bg-accent-soft text-accent tabular-nums">
                  {step}/3
                </span>
              </div>

              <p className="text-[9px] leading-tight font-bold text-textStrong truncate">
                {t(step === 1 ? 'web.stepCourt' : step === 2 ? 'web.stepTime' : 'web.stepPay')}
              </p>

              <div className="flex-1 min-h-0 flex flex-col justify-center gap-1.5">
                {step === 1 && (
                  <>
                    <div className="relative h-10 rounded-lg overflow-hidden border border-borderStrong shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src="/images/showcase/venue-football-turf.webp"
                        alt=""
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-page/80 via-transparent to-transparent" />
                    </div>
                    {['5A', '7A'].map((name, index) => (
                      <div
                        key={name}
                        className={`rounded-lg p-1.5 bg-panel border transition-colors ${
                          index ? 'border-accent bg-accent-soft' : 'border-borderToken'
                        }`}
                      >
                        <p className="flex justify-between gap-1 items-center text-[9px] leading-tight font-semibold text-textStrong">
                          <span className="truncate">
                            {t('common.court')} {name}
                          </span>
                          {index === 1 && <Check size={10} className="text-accent" />}
                        </p>
                        <p className="text-[8px] leading-tight mt-0.5 text-textMuted truncate">
                          {t(index ? 'web.selected' : 'web.free')}
                        </p>
                      </div>
                    ))}
                  </>
                )}

                {step === 2 && (
                  <>
                    <div className="relative h-8 rounded-lg overflow-hidden border border-borderToken shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src="/images/showcase/hero-stadium-night.webp"
                        alt=""
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-page/75 via-transparent to-transparent" />
                    </div>
                    <div className="grid grid-cols-2 gap-1">
                      {['17:00', '17:30', '18:00', '18:30', '19:00', '19:30'].map((time, index) => (
                        <span
                          key={time}
                          className={`text-[8px] leading-none py-1.5 rounded text-center whitespace-nowrap tabular-nums ${
                            index === 2 || index === 3
                              ? 'bg-accent text-textOnAccent font-bold'
                              : 'bg-panel-2 text-textBody'
                          }`}
                        >
                          {time}
                        </span>
                      ))}
                    </div>
                    <div className="bg-panel rounded-lg p-1.5 border border-borderToken">
                      <p className="text-[7px] leading-tight text-textMuted truncate">{t('web.total')}</p>
                      <p className="text-[9px] leading-tight mt-0.5 text-textStrong font-bold whitespace-nowrap tabular-nums">
                        450.000 ₫
                      </p>
                    </div>
                  </>
                )}

                {step === 3 && (
                  <div className="flex flex-col items-center gap-1.5">
                    <span className="text-[8px] text-statusWarning flex items-center gap-1 tabular-nums font-semibold">
                      <Clock size={9} />
                      09:42
                    </span>
                    <div className="bg-qrSurface rounded-lg p-2 shadow-sm">
                      <QrCode size={38} className="text-textOnAccent" strokeWidth={1.8} />
                    </div>
                    <p className="text-[8px] leading-tight text-textMuted">{t('web.deposit')}</p>
                    <p className="text-[9px] text-accent font-bold leading-tight whitespace-nowrap tabular-nums">
                      135.000 ₫
                    </p>
                  </div>
                )}
              </div>

              <div className="shrink-0 min-h-[20px] bg-accent text-textOnAccent rounded-lg flex items-center justify-center gap-1 px-1 py-1 text-[8px] leading-tight font-bold">
                <span className="truncate">{t('web.continue')}</span>
                <ChevronRight size={9} />
              </div>
            </div>
          )}

          <div className="h-0.5 w-8 rounded-full bg-panel-3 mx-auto mt-2 shrink-0" />
        </>
      )}
    </div>
  );
}
