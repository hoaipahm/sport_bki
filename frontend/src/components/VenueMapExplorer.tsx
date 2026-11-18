'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  LocateFixed,
  MapPin,
  Navigation,
  Sun,
  Moon,
  ArrowRight,
  Phone,
  Plus,
  Minus,
  Compass,
  Maximize2,
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { API_BASE, formatVndCurrency } from '../lib/api';
import { resolveVenueGallery } from '../lib/media';
import { Button } from './ui/Button';

export interface MapVenueItem {
  id: string;
  name: string;
  name_i18n?: Record<string, string>;
  address: string;
  address_i18n?: Record<string, string>;
  phone: string;
  district?: string | null;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  google_maps_url?: string | null;
  cover_photo_url?: string | null;
  photos?: string[] | null;
  sports?: Array<{ code: string; name_i18n?: Record<string, string> }>;
  min_price?: number | string | null;
  court_count?: number;
}

interface VenueMapExplorerProps {
  venues: MapVenueItem[];
  selectedVenueId: string;
  onSelectVenue: (id: string) => void;
  onScrollToSchedule: (venueId?: string) => void;
  tallMap?: boolean;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
}

function lonToWorldX(lon: number, zoom: number): number {
  return ((lon + 180) / 360) * 256 * Math.pow(2, zoom);
}

function latToWorldY(lat: number, zoom: number): number {
  const clamped = Math.max(-85, Math.min(85, lat));
  const rad = (clamped * Math.PI) / 180;
  return (
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) *
    256 *
    Math.pow(2, zoom)
  );
}

function worldXToLon(wx: number, zoom: number): number {
  return (wx / (256 * Math.pow(2, zoom))) * 360 - 180;
}

function worldYToLat(wy: number, zoom: number): number {
  const n = Math.PI - (2 * Math.PI * wy) / (256 * Math.pow(2, zoom));
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

export function VenueMapExplorer({
  venues,
  selectedVenueId,
  onSelectVenue,
  onScrollToSchedule,
  tallMap = false,
}: VenueMapExplorerProps) {
  const { language, t } = useLanguage();
  const isEn = language === 'en';
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoNotice, setGeoNotice] = useState('');
  const [mapStyle, setMapStyle] = useState<'standard' | 'dark'>('standard');
  const [zoom, setZoom] = useState(14);

  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewSize, setViewSize] = useState({ w: 720, h: tallMap ? 480 : 400 });

  const enrichedVenues = useMemo(() => {
    const list = venues.map((v, idx) => {
      const lat = typeof v.latitude === 'number' ? v.latitude : 21.0338 - idx * 0.022;
      const lng = typeof v.longitude === 'number' ? v.longitude : 105.8001 + idx * 0.02;
      const distanceKm = userCoords ? haversineKm(userCoords.lat, userCoords.lng, lat, lng) : null;
      return { ...v, lat, lng, distanceKm };
    });
    if (userCoords) {
      list.sort((a, b) => (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999));
    }
    return list;
  }, [venues, userCoords]);

  const activeVenue = enrichedVenues.find((v) => v.id === selectedVenueId) || enrichedVenues[0];

  const [center, setCenter] = useState<{ lat: number; lng: number }>(() => ({
    lat: activeVenue?.lat ?? 21.028,
    lng: activeVenue?.lng ?? 105.805,
  }));

  useEffect(() => {
    if (activeVenue) {
      setCenter({ lat: activeVenue.lat, lng: activeVenue.lng });
    }
  }, [activeVenue?.id, activeVenue?.lat, activeVenue?.lng]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        setViewSize({ w: Math.round(r.width), h: Math.round(r.height) });
      }
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  const dragRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    baseWx: number;
    baseWy: number;
  }>({
    active: false,
    startX: 0,
    startY: 0,
    baseWx: 0,
    baseWy: 0,
  });

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, a')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      baseWx: lonToWorldX(center.lng, zoom),
      baseWy: latToWorldY(center.lat, zoom),
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    const nextWx = dragRef.current.baseWx - dx;
    const nextWy = dragRef.current.baseWy - dy;
    setCenter({
      lat: Math.max(-80, Math.min(80, worldYToLat(nextWy, zoom))),
      lng: Math.max(-179, Math.min(179, worldXToLon(nextWx, zoom))),
    });
  };

  const handlePointerUp = () => {
    dragRef.current.active = false;
  };

  const fitAllVenues = () => {
    if (enrichedVenues.length === 0) return;
    const lats = enrichedVenues.map((v) => v.lat);
    const lngs = enrichedVenues.map((v) => v.lng);
    const avgLat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const avgLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
    setCenter({ lat: avgLat, lng: avgLng });
    setZoom(enrichedVenues.length > 1 ? 13 : 15);
  };

  const currency = useMemo(
    () => ({
      format: (val: number | string) => formatVndCurrency(val, language),
    }),
    [language]
  );

  // Consent-aware geolocation: ONLY runs on explicit user click (Audit C-02)
  const requestUserLocation = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeoNotice(t('map.locationDenied'));
      return;
    }
    setLocating(true);
    setGeoNotice('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserCoords(coords);
        setLocating(false);
        let bestId = '';
        let bestDist = Infinity;
        for (const v of venues) {
          if (typeof v.latitude === 'number' && typeof v.longitude === 'number') {
            const d = haversineKm(coords.lat, coords.lng, v.latitude, v.longitude);
            if (d < bestDist) {
              bestDist = d;
              bestId = v.id;
            }
          }
        }
        if (bestId) onSelectVenue(bestId);
      },
      () => {
        setLocating(false);
        setGeoNotice(t('map.locationDenied'));
      },
      { enableHighAccuracy: false, timeout: 7000 }
    );
  };

  const streetScene = useMemo(() => {
    const centerWx = lonToWorldX(center.lng, zoom);
    const centerWy = latToWorldY(center.lat, zoom);
    const topLeftWx = centerWx - viewSize.w / 2;
    const topLeftWy = centerWy - viewSize.h / 2;

    const minTx = Math.floor(topLeftWx / 256);
    const maxTx = Math.floor((topLeftWx + viewSize.w) / 256);
    const minTy = Math.floor(topLeftWy / 256);
    const maxTy = Math.floor((topLeftWy + viewSize.h) / 256);
    const maxTileIdx = Math.pow(2, zoom) - 1;

    const tiles: Array<{ key: string; url: string; left: number; top: number }> = [];

    for (let tx = minTx; tx <= maxTx; tx++) {
      for (let ty = minTy; ty <= maxTy; ty++) {
        if (ty < 0 || ty > maxTileIdx) continue;
        const wrappedTx = ((tx % (maxTileIdx + 1)) + (maxTileIdx + 1)) % (maxTileIdx + 1);
        const key = `${zoom}/${wrappedTx}/${ty}`;
        tiles.push({
          key,
          url: `${API_BASE}/map-tiles/osm/${zoom}/${wrappedTx}/${ty}.png`,
          left: Math.round(tx * 256 - topLeftWx),
          top: Math.round(ty * 256 - topLeftWy),
        });
      }
    }

    const pins = enrichedVenues.map((v) => ({
      venue: v,
      x: Math.round(lonToWorldX(v.lng, zoom) - topLeftWx),
      y: Math.round(latToWorldY(v.lat, zoom) - topLeftWy),
    }));

    const userPin = userCoords
      ? {
          x: Math.round(lonToWorldX(userCoords.lng, zoom) - topLeftWx),
          y: Math.round(latToWorldY(userCoords.lat, zoom) - topLeftWy),
        }
      : null;

    return { tiles, pins, userPin };
  }, [center.lat, center.lng, zoom, viewSize.w, viewSize.h, enrichedVenues, userCoords, mapStyle]);

  if (enrichedVenues.length === 0) return null;

  const directionsHref = activeVenue
    ? activeVenue.google_maps_url?.startsWith('https://')
      ? activeVenue.google_maps_url
      : `https://www.google.com/maps/dir/?api=1&destination=${activeVenue.lat},${activeVenue.lng}`
    : '#';

  const activePinInStreet = streetScene.pins.find((p) => p.venue.id === activeVenue?.id);
  const mapHeightClass = tallMap
    ? 'min-h-[380px] sm:min-h-[500px]'
    : 'min-h-[340px] sm:min-h-[420px]';

  return (
    <section
      id="map-section"
      className="bg-panel rounded-token-lg border border-borderStrong p-4 sm:p-7 shadow-token-card space-y-5 min-w-0"
    >
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-textStrong tracking-tight">
            {t('map.title')}
          </h2>
          <p className="text-sm text-textMuted mt-1 max-w-[65ch]">{t('map.subtitle')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={requestUserLocation}
            disabled={locating}
          >
            <LocateFixed className="w-4 h-4 mr-1.5 text-accent" />
            <span>{locating ? t('map.locating') : t('map.locateMe')}</span>
          </Button>

          <button
            type="button"
            onClick={fitAllVenues}
            className="min-h-[40px] px-3.5 rounded-token-full bg-panel-2 hover:bg-surfaceHover border border-borderStrong text-xs sm:text-sm font-semibold text-textStrong inline-flex items-center gap-1.5"
          >
            <Maximize2 className="w-3.5 h-3.5 text-accent" />
            <span>{isEn ? 'Show all venues' : 'Xem tất cả sân'}</span>
          </button>

          <button
            type="button"
            onClick={() => setMapStyle((s) => (s === 'standard' ? 'dark' : 'standard'))}
            className="min-h-[40px] px-3.5 rounded-token-full bg-panel-2 hover:bg-surfaceHover border border-borderStrong text-xs sm:text-sm font-semibold text-textStrong inline-flex items-center gap-1.5"
          >
            {mapStyle === 'standard' ? (
              <>
                <Moon className="w-3.5 h-3.5 text-accent" />
                <span>{isEn ? 'Dark street map' : 'Bản đồ nền tối'}</span>
              </>
            ) : (
              <>
                <Sun className="w-3.5 h-3.5 text-accent" />
                <span>{isEn ? 'Standard street map' : 'Bản đồ đường phố chuẩn'}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {geoNotice && (
        <p
          role="status"
          className="text-xs sm:text-sm text-statusWarning bg-statusWarning-soft border border-statusWarning-border rounded-token-md p-3.5"
        >
          {geoNotice}
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1.45fr_1fr] gap-5 items-stretch min-w-0">
        {/* Real Interactive Street Map Canvas (Cached & Served Cleanly via Backend) */}
        <div
          ref={viewportRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className={`relative rounded-token-md overflow-hidden bg-panel-2 border border-borderStrong ${mapHeightClass} flex flex-col min-w-0 select-none cursor-grab active:cursor-grabbing`}
        >
          <div className={`relative flex-1 w-full h-full ${mapHeightClass} overflow-hidden`}>
            {/* Crisp Real Street Map Tiles */}
            {streetScene.tiles.map((tile) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={tile.key}
                src={tile.url}
                alt=""
                draggable={false}
                className={`absolute w-[256px] h-[256px] max-w-none pointer-events-none ${
                  mapStyle === 'dark' ? 'emerald-street-tile' : ''
                }`}
                style={{ left: `${tile.left}px`, top: `${tile.top}px` }}
              />
            ))}

            {/* Route Line from User GPS to Active Venue */}
            {streetScene.userPin && activePinInStreet && (
              <svg
                className="absolute inset-0 w-full h-full pointer-events-none z-[5]"
                aria-hidden="true"
              >
                <line
                  x1={streetScene.userPin.x}
                  y1={streetScene.userPin.y}
                  x2={activePinInStreet.x}
                  y2={activePinInStreet.y}
                  stroke="var(--accent)"
                  strokeWidth="3"
                  strokeDasharray="7 6"
                />
              </svg>
            )}

            {/* User GPS Dot */}
            {streetScene.userPin && (
              <div
                className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none z-10"
                style={{ left: `${streetScene.userPin.x}px`, top: `${streetScene.userPin.y}px` }}
              >
                <span className="block w-4 h-4 rounded-full bg-statusInfo border-2 border-qrSurface shadow-md" />
              </div>
            )}

            {/* Interactive Venue Pins */}
            {streetScene.pins.map(({ venue: item, x, y }) => {
              const isSelected = activeVenue?.id === item.id;
              const displayName = item.name_i18n?.[language] || item.name;
              const minPrice = Number(item.min_price || 0);
              return (
                <div
                  key={item.id}
                  style={{ left: `${x}px`, top: `${y}px` }}
                  className={`absolute -translate-x-1/2 -translate-y-full pb-1 ${
                    isSelected ? 'z-20' : 'z-10'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onSelectVenue(item.id);
                      setZoom((z) => Math.max(z, 15));
                    }}
                    className="flex flex-col items-center focus:outline-none"
                  >
                    <div
                      className={`px-3 py-1.5 rounded-token-full border text-xs font-extrabold whitespace-nowrap shadow-token-elevated flex items-center gap-1.5 ${
                        isSelected
                          ? 'bg-accent text-textOnAccent border-qrSurface'
                          : 'bg-overlay backdrop-blur-sm text-textStrong border-borderStrong hover:border-accent'
                      }`}
                    >
                      <MapPin className="w-3.5 h-3.5 shrink-0" />
                      <span className="max-w-[155px] truncate">{displayName}</span>
                      {minPrice > 0 && (
                        <span
                          className={`text-[11px] px-1.5 py-0.5 rounded-token-full tabular-nums ${
                            isSelected ? 'bg-qrSurface text-textOnAccent font-extrabold' : 'bg-accent-soft text-accent'
                          }`}
                        >
                          {currency.format(minPrice)}
                        </span>
                      )}
                    </div>
                    <span
                      className={`w-3.5 h-3.5 rounded-full border-2 shadow-md mt-1 ${
                        isSelected
                          ? 'bg-accent border-qrSurface'
                          : 'bg-panel border-accent'
                      }`}
                    />
                  </button>
                </div>
              );
            })}

            {/* Zoom & Re-Center Controls */}
            <div className="absolute top-3.5 right-3.5 z-20 flex flex-col gap-1 bg-overlay backdrop-blur-sm border border-borderStrong rounded-token-md p-1 shadow-token-card">
              <button
                type="button"
                aria-label="Zoom in"
                onClick={() => setZoom((z) => Math.min(18, z + 1))}
                className="w-9 h-9 rounded-token-sm hover:bg-surfaceHover flex items-center justify-center text-textStrong"
              >
                <Plus className="w-4 h-4" />
              </button>
              <button
                type="button"
                aria-label="Zoom out"
                onClick={() => setZoom((z) => Math.max(11, z - 1))}
                className="w-9 h-9 rounded-token-sm hover:bg-surfaceHover flex items-center justify-center text-textStrong"
              >
                <Minus className="w-4 h-4" />
              </button>
              <button
                type="button"
                aria-label="Center on selected venue"
                onClick={() => {
                  if (activeVenue) {
                    setCenter({ lat: activeVenue.lat, lng: activeVenue.lng });
                    setZoom(15);
                  }
                }}
                className="w-9 h-9 rounded-token-sm hover:bg-surfaceHover flex items-center justify-center text-accent"
              >
                <Compass className="w-4 h-4" />
              </button>
            </div>

            {/* OpenStreetMap Attribution Badge */}
            <div className="absolute bottom-2 right-2.5 z-20 px-2 py-0.5 rounded bg-overlay text-[10px] text-textMuted pointer-events-none">
              © OpenStreetMap contributors
            </div>
          </div>

          {/* Bottom Coordinate & Distance Bar */}
          {activeVenue && (
            <div className="relative z-20 px-4 py-2.5 bg-panel border-t border-borderStrong flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <MapPin className="w-4 h-4 text-accent shrink-0" />
                <span className="font-bold text-textStrong truncate">
                  {activeVenue.address_i18n?.[language] || activeVenue.address}
                </span>
              </div>
              {activeVenue.distanceKm !== null && (
                <span className="px-2.5 py-0.5 rounded-token-full bg-accent-soft text-accent border border-accent-border font-bold tabular-nums">
                  {t('map.distanceAway', { km: activeVenue.distanceKm })}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Right: Venue Cards with Thumbnails & Direct Booking Action */}
        <div className="flex flex-col justify-between gap-4 min-w-0">
          <div className="space-y-3 max-h-[340px] overflow-y-auto pr-1">
            {enrichedVenues.map((item) => {
              const isSelected = activeVenue?.id === item.id;
              const minPrice = Number(item.min_price || 0);
              const thumb = resolveVenueGallery(item)[0];
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => {
                    onSelectVenue(item.id);
                    setCenter({ lat: item.lat, lng: item.lng });
                    setZoom(15);
                  }}
                  className={`w-full min-w-0 text-left p-3.5 rounded-token-md border flex items-center gap-3 ${
                    isSelected
                      ? 'bg-accent-soft border-accent shadow-sm'
                      : 'bg-panel-2 border-borderToken hover:bg-surfaceHover hover:border-borderStrong'
                  }`}
                >
                  <div className="w-16 h-14 rounded-token-sm overflow-hidden border border-borderStrong shrink-0 bg-panel">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={thumb} alt="" className="w-full h-full object-cover" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 min-w-0">
                      <span className="font-bold text-sm text-textStrong truncate">
                        {item.name_i18n?.[language] || item.name}
                      </span>
                      {item.distanceKm !== null ? (
                        <span className="shrink-0 px-2 py-0.5 rounded-token-full bg-panel text-accent border border-accent-border text-[11px] font-bold tabular-nums">
                          {t('map.distanceAway', { km: item.distanceKm })}
                        </span>
                      ) : minPrice > 0 ? (
                        <span className="shrink-0 text-xs font-extrabold text-accent tabular-nums">
                          {currency.format(minPrice)}
                        </span>
                      ) : null}
                    </div>
                    <span className="block text-xs text-textMuted line-clamp-2 mt-0.5">
                      {item.address_i18n?.[language] || item.address}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {activeVenue && (
            <div className="bg-panel-2 rounded-token-md p-4 border border-borderStrong space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-textBody">
                <a
                  href={`tel:${activeVenue.phone}`}
                  className="inline-flex items-center gap-1.5 font-semibold text-textStrong hover:text-accent tabular-nums"
                >
                  <Phone className="w-3.5 h-3.5 text-accent" />
                  <span>{activeVenue.phone}</span>
                </a>
                <a
                  href={directionsHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 font-semibold text-accent hover:text-accent-hover"
                >
                  <Navigation className="w-3.5 h-3.5" />
                  <span>{t('map.openDirections')}</span>
                </a>
              </div>

              <Button
                type="button"
                variant="primary"
                className="w-full"
                onClick={() => {
                  onSelectVenue(activeVenue.id);
                  onScrollToSchedule(activeVenue.id);
                }}
              >
                <span>{t('map.selectVenueOnMap')}</span>
                <ArrowRight className="w-4 h-4 ml-1.5" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
