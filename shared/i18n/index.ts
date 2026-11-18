import vi from './vi.json';
import en from './en.json';

export type Language = 'vi' | 'en';
export const DEFAULT_LANGUAGE: Language = 'vi';

export const dictionaries = { vi, en };

/**
 * Get translation by dot-notated key with parameter interpolation
 * Example: t('booking.holdCountdown', 'vi', { minutes: '09', seconds: '58' })
 */
export function t(keyPath: string, lang: Language = DEFAULT_LANGUAGE, params?: Record<string, string | number>): string {
  const parts = keyPath.split('.');
  let current: any = dictionaries[lang] || dictionaries.vi;

  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = current[part];
    } else {
      // Fallback to Vietnamese if English missing (Section 26.4 rule 6)
      let fallback: any = dictionaries.vi;
      for (const fPart of parts) {
        if (fallback && typeof fallback === 'object' && fPart in fallback) {
          fallback = fallback[fPart];
        } else {
          return keyPath; // Return raw key if completely not found
        }
      }
      current = fallback;
      break;
    }
  }

  if (typeof current !== 'string') {
    return keyPath;
  }

  if (!params) return current;

  // Interpolate {param}
  return current.replace(/\{(\w+)\}/g, (match, paramName) => {
    return paramName in params ? String(params[paramName]) : match;
  });
}
