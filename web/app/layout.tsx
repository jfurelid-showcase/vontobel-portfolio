import "./globals.css";

export const metadata = {
  title: "Portfolio Tracker",
  description: "Live Vontobel ETP portfolio tracker",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-neutral-950">{children}</body>
    </html>
  );
}
