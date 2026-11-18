'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import viDict from '../../../shared/i18n/vi.json';
import enDict from '../../../shared/i18n/en.json';

export type Language = 'vi' | 'en';

const dictionaries: Record<Language, any> = {
  vi: viDict,
  en: enDict,
};

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  toggleLanguage: () => void;
  t: (keyPath: string, params?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>('vi');

  useEffect(() => {
    // Read saved preference from localStorage or cookie
    const saved = localStorage.getItem('court_booking_lang') as Language;
    if (saved && (saved === 'vi' || saved === 'en')) {
      setLanguageState(saved);
    }
  }, []);

  useEffect(() => { document.documentElement.lang = language; }, [language]);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem('court_booking_lang', lang);
    document.cookie = `lang=${lang}; path=/; max-age=31536000`;
  };

  const toggleLanguage = () => {
    setLanguage(language === 'vi' ? 'en' : 'vi');
  };

  const t = (keyPath: string, params?: Record<string, string | number>): string => {
    const parts = keyPath.split('.');
    let current: any = dictionaries[language] || dictionaries.vi;

    for (const part of parts) {
      if (current && typeof current === 'object' && part in current) {
        current = current[part];
      } else {
        // Fallback to Vietnamese
        let fallback: any = dictionaries.vi;
        for (const fPart of parts) {
          if (fallback && typeof fallback === 'object' && fPart in fallback) {
            fallback = fallback[fPart];
          } else {
            return keyPath;
          }
        }
        current = fallback;
        break;
      }
    }

    if (typeof current !== 'string') return keyPath;

    if (!params) return current;

    return current.replace(/\{(\w+)\}/g, (match, paramName) => {
      return paramName in params ? String(params[paramName]) : match;
    });
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, toggleLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}
