import { MetadataRoute } from 'next';
import { customerApi } from '../lib/api';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  const entries: MetadataRoute.Sitemap = [
    {
      url: `${baseUrl}/`,
      lastModified: new Date(),
      changeFrequency: 'hourly',
      priority: 1.0,
    },
  ];

  const candidates = [
    `${customerApi}/seo/venues`,
    'http://127.0.0.1:4000/api/customer/v1/seo/venues',
  ];
  for (const url of candidates) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        for (const v of data.venues || []) {
          const city = v.city_slug || 'ha-noi';
          const sport = v.primary_sport || 'football';
          const slug = v.slug;
          if (!slug) continue;
          entries.push(
            {
              url: `${baseUrl}/vi/san/${city}/${sport}/${slug}`,
              lastModified: v.updated_at ? new Date(v.updated_at) : new Date(),
              changeFrequency: 'daily',
              priority: 0.9,
              alternates: {
                languages: {
                  vi: `${baseUrl}/vi/san/${city}/${sport}/${slug}`,
                  en: `${baseUrl}/en/san/${city}/${sport}/${slug}`,
                },
              },
            },
            {
              url: `${baseUrl}/en/san/${city}/${sport}/${slug}`,
              lastModified: v.updated_at ? new Date(v.updated_at) : new Date(),
              changeFrequency: 'daily',
              priority: 0.85,
            }
          );
        }
        break;
      }
    } catch {
      // Graceful fallback during offline static build
    }
  }

  return entries;
}
