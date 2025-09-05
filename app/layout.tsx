import "./globals.css";
import { ToastProvider } from "@/components/ui/toast";

export const metadata = {
  title: "LinkLeap",
  description: "Co-op procedural platformer",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        {/* background grid & glow */}
        <div className="bg-grid fixed inset-0 pointer-events-none" />
        <ToastProvider>
          <div className="mx-auto max-w-5xl px-6 py-6">{children}</div>
        </ToastProvider>
      </body>
    </html>
  );
}
