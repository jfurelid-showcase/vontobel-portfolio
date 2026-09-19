FROM mcr.microsoft.com/playwright:v1.47.0-jammy

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY worker.mjs ./

# Set these in your host's environment/secrets, not here:
#   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, REFRESH_INTERVAL_MS
CMD ["node", "worker.mjs"]
