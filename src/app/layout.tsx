import type { Metadata } from "next";
import { Ubuntu } from "next/font/google";
import "./globals.css";

// Trei usa "Ubuntu" para titulos y navegacion en trei.cl; mantenemos la
// misma tipografia para que la app se sienta parte del mismo sitio.
const ubuntu = Ubuntu({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-ubuntu",
});

export const metadata: Metadata = {
  title: "AI Comercial Trei",
  description: "Asistente de inteligencia comercial de Trei Inmobiliaria",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className={ubuntu.variable}>
      <body className="min-h-screen bg-white font-sans text-neutral-800">
        {children}
      </body>
    </html>
  );
}
