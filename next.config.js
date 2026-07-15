/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Nunca exponer variables sensibles vía env aquí.
  // Solo variables con prefijo NEXT_PUBLIC_ llegan al cliente.
};

module.exports = nextConfig;
