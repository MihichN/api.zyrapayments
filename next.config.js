/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/v1/create',
        destination: '/v1/create',
      },
    ]
  },
  // Отключаем строгую проверку типов для API роутов
  typescript: {
    ignoreBuildErrors: true,
  },
}

module.exports = nextConfig 