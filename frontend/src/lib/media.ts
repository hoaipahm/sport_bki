export const DEFAULT_HERO_SLIDES = [
  '/images/showcase/hero-stadium-night.webp',
  '/images/showcase/venue-football-turf.webp',
  '/images/showcase/venue-pickleball-court.webp',
  '/images/showcase/venue-badminton-arena.webp',
];

export const DEFAULT_AUTH_SLIDES = [
  '/images/showcase/auth-community-players.webp',
  '/images/showcase/ops-clubhouse-overlook.webp',
  '/images/showcase/hero-stadium-night.webp',
];

export const DEFAULT_OPS_SLIDES = [
  '/images/showcase/ops-clubhouse-overlook.webp',
  '/images/showcase/hero-stadium-night.webp',
  '/images/showcase/venue-badminton-arena.webp',
];

export function resolveSportCover(sportCode?: string | null): string {
  const code = (sportCode || '').toLowerCase();
  if (code.includes('badminton') || code.includes('volleyball') || code.includes('table')) {
    return '/images/showcase/venue-badminton-arena.webp';
  }
  if (code.includes('pickleball') || code.includes('tennis') || code.includes('basket')) {
    return '/images/showcase/venue-pickleball-court.webp';
  }
  if (code.includes('football') || code.includes('futsal')) {
    return '/images/showcase/venue-football-turf.webp';
  }
  return '/images/showcase/hero-stadium-night.webp';
}

export function resolveVenueGallery(venue?: {
  cover_photo_url?: string | null;
  photos?: string[] | null;
  sports?: Array<{ code?: string }>;
} | null): string[] {
  if (!venue) return DEFAULT_HERO_SLIDES;

  const uploaded = Array.from(
    new Set(
      [venue.cover_photo_url, ...(Array.isArray(venue.photos) ? venue.photos : [])].filter(
        (u): u is string => typeof u === 'string' && u.trim().length > 0
      )
    )
  );

  if (uploaded.length > 0) {
    return uploaded;
  }

  const primarySport = venue.sports?.[0]?.code || 'football';
  const lead = resolveSportCover(primarySport);
  return Array.from(
    new Set([
      lead,
      '/images/showcase/hero-stadium-night.webp',
      '/images/showcase/ops-clubhouse-overlook.webp',
    ])
  );
}
