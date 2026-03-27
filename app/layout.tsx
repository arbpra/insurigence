import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import './globals.css';
import "./assets/main.css";
import "slick-carousel/slick/slick.css";
import ScrollToTop from "@/app/components/footer/ScrollToTop";

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'Insurigence - Insurance Placement Intelligence',
  description: 'Smarter placement decisions for insurance agencies. Evaluate risks, find carriers, and create professional proposals.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
        {children}
        <ScrollToTop />
      </body>
    </html>
  );
}
