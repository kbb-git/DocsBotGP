import type { Metadata } from 'next';
import './styles/globals.css';
import ClientThemeProvider from './components/ClientThemeProvider';

export const metadata: Metadata = {
  title: 'Global Payments Docs Helper',
  description: 'AI Agent to help with Global Payments Inc. documentation',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon.ico' },
    ],
    shortcut: '/favicon.svg',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <ClientThemeProvider>
          <main>{children}</main>
        </ClientThemeProvider>
      </body>
    </html>
  );
} 
