

// Proxy /api/* para o backend Fastify (Caddy ou Compose definem o host).
const nextConfig = {
  output: 'standalone',
  async rewrites() {
    const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://api:8080';
    return [{ source: '/api/:path*', destination: `${api}/api/:path*` }];
  },
};
export default nextConfig;
