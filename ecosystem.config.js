module.exports = {
  apps: [
    {
      name: 'app-core',
      script: './dist/main.js',
      instances: 'max', // Or specific number, e.g., 2
      exec_mode: 'cluster', // Use cluster mode for better performance
      watch: false, // Don't watch in production
      env: {
        NODE_ENV: 'production',
        CORE_PORT: 3002,
      },
    },
  ],
};
