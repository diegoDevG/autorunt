import './globals.css';

export const metadata = { title: 'Formulario de tránsito' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-CO">
      <body>{children}</body>
    </html>
  );
}
