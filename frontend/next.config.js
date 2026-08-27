/** @type {import('next').NextConfig} */
const API = process.env.BACKEND_URL || "http://127.0.0.1:8000";
module.exports = {
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API}/api/:path*` }];
  },
};
