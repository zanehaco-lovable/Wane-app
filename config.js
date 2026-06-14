// Central config from environment. Nothing secret is hard-coded.
export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  databaseUrl: process.env.DATABASE_URL || 'postgresql://wane:wane@db:5432/wane',
  jwtSecret: process.env.JWT_SECRET || 'dev_only_change_me',
  jwtExpiry: process.env.JWT_EXPIRY || '7d',
  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'http://localhost:4000',
  verifyBaseUrl: process.env.VERIFY_BASE_URL || 'http://localhost:8080/verify.html',
  certSecret: process.env.CERT_SECRET || 'dev_cert_pepper_change_me',
  // External providers (live only when keys are present):
  ai: {
    apiKey: process.env.AI_API_KEY || '',
    baseUrl: process.env.AI_BASE_URL || 'https://api.openai.com/v1',
    model: process.env.AI_MODEL || 'gpt-4o',
  },
  speech: {
    apiKey: process.env.SPEECH_API_KEY || '',
    baseUrl: process.env.SPEECH_BASE_URL || '',
  },
  zoom: {
    accountId: process.env.ZOOM_ACCOUNT_ID || '',
    clientId: process.env.ZOOM_CLIENT_ID || '',
    clientSecret: process.env.ZOOM_CLIENT_SECRET || '',
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN || '',
  },
  seedOnBoot: (process.env.SEED_ON_BOOT || 'true') === 'true',
};
