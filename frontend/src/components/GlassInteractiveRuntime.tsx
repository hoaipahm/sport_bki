'use client';

import { useEffect } from 'react';

const WIN1252_EXTRA: Record<number, number> = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
};

const MOJIBAKE_RE = /(?:Ã[\x80-\xBFa-zA-Z]|Æ[¡°]|á»|Ä[\x80-\xBF‘])/;

function healMojibakeText(input: string): string {
  if (!input || !MOJIBAKE_RE.test(input)) return input;
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code <= 0xff) {
      bytes.push(code);
    } else if (WIN1252_EXTRA[code] !== undefined) {
      bytes.push(WIN1252_EXTRA[code]);
    } else {
      return input;
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    return input;
  }
}

function healStorageValue(val: unknown): unknown {
  if (typeof val === 'string') return healMojibakeText(val);
  if (Array.isArray(val)) return val.map(healStorageValue);
  if (val && typeof val === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val)) {
      out[k] = healStorageValue(v);
    }
    return out;
  }
  return val;
}

/** Silent UTF-8 localStorage sanitizer — zero visual DOM elements. */
export function GlassInteractiveRuntime() {
  useEffect(() => {
    try {
      for (const key of [
        'court_admin_user',
        'court_staff_user',
        'court_platform_user',
        'court_user',
        'customer_user',
      ]) {
        const raw = localStorage.getItem(key);
        if (raw && MOJIBAKE_RE.test(raw)) {
          try {
            localStorage.setItem(key, JSON.stringify(healStorageValue(JSON.parse(raw))));
          } catch {
            localStorage.setItem(key, healMojibakeText(raw));
          }
        }
      }
    } catch {
      // Ignore storage access errors
    }
  }, []);

  return null;
}
