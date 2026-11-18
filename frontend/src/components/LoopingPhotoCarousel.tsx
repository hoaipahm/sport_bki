'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Images } from 'lucide-react';

export interface LoopingPhotoCarouselProps {
  images: string[];
  alt: string;
  intervalMs?: number;
  className?: string;
  imgClassName?: string;
  showControls?: boolean;
  showCounter?: boolean;
  showDots?: boolean;
  overlayClassName?: string;
  children?: React.ReactNode;
}

export function LoopingPhotoCarousel({
  images,
  alt,
  intervalMs = 4400,
  className = 'aspect-[16/9] sm:aspect-[21/7]',
  imgClassName = 'object-cover',
  showControls = true,
  showCounter = true,
  showDots = true,
  overlayClassName = 'carousel-vignette',
  children,
}: LoopingPhotoCarouselProps) {
  const validImages = images.filter((u) => typeof u === 'string' && u.trim().length > 0);
  const count = validImages.length;

  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const touchStartX = useRef<number | null>(null);

  // Keep index in bounds when venue or image list changes
  const safeIndex = count > 0 ? index % count : 0;

  useEffect(() => {
    setIndex(0);
  }, [validImages.join('|')]);

  const goNext = useCallback(() => {
    if (count <= 1) return;
    setIndex((prev) => (prev + 1) % count);
  }, [count]);

  const goPrev = useCallback(() => {
    if (count <= 1) return;
    setIndex((prev) => (prev - 1 + count) % count);
  }, [count]);

  useEffect(() => {
    if (count <= 1 || paused) return;
    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }
    const timer = setInterval(goNext, intervalMs);
    return () => clearInterval(timer);
  }, [count, paused, intervalMs, goNext]);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null || count <= 1) return;
    const endX = e.changedTouches[0]?.clientX ?? touchStartX.current;
    const delta = endX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(delta) >= 36) {
      if (delta < 0) goNext();
      else goPrev();
    }
  };

  return (
    <div
      className={`relative bg-panel-2 overflow-hidden select-none group ${className}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {validImages.map((src, i) => {
        const active = i === safeIndex;
        return (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={`${src}-${i}`}
            src={src}
            alt={active ? alt : ''}
            aria-hidden={!active}
            loading={i === 0 ? 'eager' : 'lazy'}
            className={`absolute inset-0 w-full h-full ${imgClassName} transition-all duration-700 ease-out ${
              active ? 'opacity-100 scale-100 z-[1]' : 'opacity-0 scale-[1.03] z-0 pointer-events-none'
            }`}
          />
        );
      })}

      {overlayClassName && (
        <div className={`absolute inset-0 z-[2] pointer-events-none ${overlayClassName}`} />
      )}

      {/* Top-right slide counter + subtle indicator */}
      {showCounter && count > 1 && (
        <div className="absolute top-3.5 right-4 z-[4] inline-flex items-center gap-1.5 px-2.5 py-1 rounded-token-full bg-overlay backdrop-blur-sm border border-borderStrong text-xs font-bold text-textStrong tabular-nums">
          <Images className="w-3.5 h-3.5 text-accent" />
          <span>
            {safeIndex + 1} / {count}
          </span>
        </div>
      )}

      {/* Left / Right Looping Navigation Controls */}
      {showControls && count > 1 && (
        <>
          <div className="absolute inset-y-0 left-3 sm:left-4 z-[4] flex items-center pointer-events-none">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                goPrev();
              }}
              aria-label="Previous photo"
              className="pointer-events-auto min-h-[42px] min-w-[42px] rounded-token-full bg-overlay hover:bg-accent text-textStrong hover:text-textOnAccent border border-borderStrong hover:border-accent backdrop-blur-sm flex items-center justify-center shadow-md transition-colors"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          </div>
          <div className="absolute inset-y-0 right-3 sm:right-4 z-[4] flex items-center pointer-events-none">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                goNext();
              }}
              aria-label="Next photo"
              className="pointer-events-auto min-h-[42px] min-w-[42px] rounded-token-full bg-overlay hover:bg-accent text-textStrong hover:text-textOnAccent border border-borderStrong hover:border-accent backdrop-blur-sm flex items-center justify-center shadow-md transition-colors"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </>
      )}

      {/* Top-left interactive dots */}
      {showDots && count > 1 && (
        <div className="absolute top-4 left-4 z-[4] flex items-center gap-1.5 px-2.5 py-1.5 rounded-token-full bg-overlay backdrop-blur-sm border border-borderStrong">
          {validImages.map((_, i) => {
            const active = i === safeIndex;
            return (
              <button
                key={i}
                type="button"
                aria-label={`Slide ${i + 1}`}
                aria-pressed={active}
                onClick={(e) => {
                  e.stopPropagation();
                  setIndex(i);
                }}
                className={`h-2 rounded-token-full transition-all ${
                  active ? 'w-6 bg-accent' : 'w-2 bg-textMuted hover:bg-textStrong'
                }`}
              />
            );
          })}
        </div>
      )}

      {children && <div className="relative z-[3] w-full h-full pointer-events-none">{children}</div>}
    </div>
  );
}
