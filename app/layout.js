import "./globals.css";
import Sidebar from "../components/Sidebar";

export const metadata = {
  title: "Travello Lead Finder",
  description: "South African Travel Business Research Engine",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-theme="dark">
      <body>
        <div className="app">
          <Sidebar />
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
