import type { Metadata, Viewport } from 'next';
import './globals.css';
import { TRPCProvider } from '@/lib/trpc/client';
import { ToastProvider } from '@/components/ui';

export const metadata: Metadata = {
  title: 'ScottyLabs Talent',
  description:
    'A boutique recruiting platform operated by ScottyLabs. Evidence beats claims, curation beats flooding, reciprocity beats extraction.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          rel="stylesheet"
          href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700,900&display=swap"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
        />
      </head>
      <body>
        <TRPCProvider>
          <ToastProvider>{children}</ToastProvider>
        </TRPCProvider>
      </body>
    </html>
  );
}
