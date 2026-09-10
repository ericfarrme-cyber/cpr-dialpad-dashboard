import './globals.css';
import ThemeProvider from '@/components/ThemeProvider';

export const metadata = { title: 'CPR Dialpad Analytics', description: 'Call intelligence dashboard for CPR stores' };

// ThemeProvider lives here, at the root, so EVERY page gets the CSS variables.
// It used to be mounted only on /appointments, which meant the main dashboard
// had no --bg-card, --border or --text-* defined at all: every component styled
// with those tokens lost its background and borders and rendered flat.
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
