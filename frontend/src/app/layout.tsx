import type { Metadata } from 'next';
import { Be_Vietnam_Pro } from 'next/font/google';
import './globals.css';
import { LanguageProvider } from '../context/LanguageContext';
import { AuthProvider } from '../context/AuthContext';
import { GlassInteractiveRuntime } from '../components/GlassInteractiveRuntime';
import { TouchFeedback } from '../components/TouchFeedback';

const fontSans = Be_Vietnam_Pro({
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-be-vietnam',
});

export const metadata: Metadata = {
  title: 'Đặt Sân Thể Thao - Sports Court Booking',
  description: 'Nền tảng đặt sân thể thao trực tuyến với thanh toán VietQR và xác nhận tức thì.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi" data-theme="dark" className={fontSans.variable}>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body className="min-h-screen bg-page text-textBody font-sans antialiased selection:bg-accent-soft selection:text-textStrong">
        <GlassInteractiveRuntime />
        <TouchFeedback />
        <LanguageProvider>
          <AuthProvider>{children}</AuthProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
