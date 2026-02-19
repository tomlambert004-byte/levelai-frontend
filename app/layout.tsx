import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import {
  ClerkProvider,
  SignedIn,
  SignedOut,
  SignInButton,
  UserButton,
} from "@clerk/nextjs";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Level AI",
  description: "AI-powered dental insurance verification",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
          <SignedOut>
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: "100vh",
              background: "#0a0f0a",
              flexDirection: "column",
              gap: 16,
            }}>
              <div style={{ color: "#a3e635", fontSize: 28, fontWeight: 900, letterSpacing: "-0.02em" }}>
                Level AI
              </div>
              <div style={{ color: "#6b7280", fontSize: 14, marginBottom: 8 }}>
                Sign in to access the dashboard
              </div>
              <SignInButton mode="modal">
                <button style={{
                  padding: "12px 32px",
                  borderRadius: 10,
                  border: "none",
                  background: "#a3e635",
                  color: "#0a0f0a",
                  fontWeight: 800,
                  fontSize: 15,
                  cursor: "pointer",
                }}>
                  Sign In
                </button>
              </SignInButton>
            </div>
          </SignedOut>
          <SignedIn>
            {children}
          </SignedIn>
        </body>
      </html>
    </ClerkProvider>
  );
}
