import { ClerkProvider } from '@clerk/nextjs';
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Level AI — Insurance Made Easy',
  description: 'AI-powered dental insurance verification and benefits management',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
    ],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Debug log to confirm key is loading
  console.log('Clerk Key:', process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? 'Loaded' : 'MISSING');

  return (
    <ClerkProvider publishableKey={process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}>
      <html lang="en">
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}