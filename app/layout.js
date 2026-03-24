import "./globals.css";

export const metadata = {
  title: "ADG Staffing — Payroll Dashboard",
  description: "Weekly payroll & billing consolidation with Paychex SPI export",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
