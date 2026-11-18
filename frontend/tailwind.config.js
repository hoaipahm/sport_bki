/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        page: 'var(--bg-page)',
        panel: {
          DEFAULT: 'var(--bg-panel)',
          2: 'var(--bg-panel-2)',
          3: 'var(--bg-panel-3)',
        },
        surfaceHover: 'var(--bg-hover)',
        textStrong: 'var(--text-strong)',
        textBody: 'var(--text-body)',
        textMuted: 'var(--text-muted)',
        textOnAccent: 'var(--text-on-accent)',
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          pressed: 'var(--accent-pressed)',
          soft: 'var(--accent-soft)',
          border: 'var(--accent-border)',
        },
        statusWarning: {
          DEFAULT: 'var(--warning)',
          soft: 'var(--warning-soft)',
          border: 'var(--warning-border)',
        },
        statusDanger: {
          DEFAULT: 'var(--danger)',
          soft: 'var(--danger-soft)',
          border: 'var(--danger-border)',
        },
        statusInfo: {
          DEFAULT: 'var(--info)',
          soft: 'var(--info-soft)',
        },
        borderToken: 'var(--border)',
        borderStrong: 'var(--border-strong)',
        overlay: 'var(--bg-overlay)',
        qrSurface: 'var(--qr-surface)',
      },
      borderRadius: {
        'token-sm': 'var(--radius-sm)',
        'token-md': 'var(--radius-md)',
        'token-lg': 'var(--radius-lg)',
        'token-full': 'var(--radius-full)',
      },
      boxShadow: {
        'token-card': 'var(--shadow-card)',
        'token-elevated': 'var(--shadow-elevated)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
