/** @type {import('next').NextConfig} */
const nextConfig = {
  // Отключаем строгую проверку типов для API роутов
  typescript: {
    ignoreBuildErrors: true,
  },
  // Указываем, что mysql2 должен использоваться только на сервере
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        net: false,
        tls: false,
        fs: false,
        dns: false,
        child_process: false,
      };
    }
    return config;
  },
}

module.exports = nextConfig 