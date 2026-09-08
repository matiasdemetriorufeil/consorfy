import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Mono, Inter } from "next/font/google";

import { Toaster } from "@/components/ui/sonner";

import "./globals.css";

const fontDisplay = Archivo({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

const fontBody = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-body",
  display: "swap",
});

const fontMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Consorfy",
    template: "%s · Consorfy",
  },
  description:
    "Gestión de consorcios: reclamos, edificios, comunicados y eventos en un solo panel para administradores.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Zoom deshabilitado en todo el sitio (pedido explícito): el layout ya
  // está pensado mobile-first y responsive, así que el pinch-to-zoom no
  // hace falta para usarlo. Nota: iOS Safari IGNORA `userScalable: false`
  // desde iOS 10 (Apple lo fuerza por accesibilidad), así que en iPhone el
  // gesto de zoom sigue disponible; `maximumScale`/`minimumScale` sí lo
  // acota en Android. Es una restricción de accesibilidad (WCAG 1.4.4) --
  // se aplica porque así se pidió, no porque sea lo recomendado.
  minimumScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#f3f5f4",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es-AR"
      className={`${fontDisplay.variable} ${fontBody.variable} ${fontMono.variable} h-full antialiased`}
    >
      <body className="bg-canvas text-ink flex min-h-full flex-col">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
