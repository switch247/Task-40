FROM node:20-alpine

WORKDIR /app
# open ssl is necessary for prisma to work in production
RUN apk add  openssl

ENV PORT=3000
ENV DATABASE_URL=postgresql://sentineldesk:sentineldesk@postgres:5432/sentineldesk?schema=public
ENV REDIS_URL=redis://redis:6379
ENV FIELD_ENCRYPTION_KEY=change-this-local-key
ENV SIMHASH_MAX_HAMMING=8
ENV MINHASH_MIN_SIMILARITY=0.82
ENV LICENSED_STORY_BUNDLE_CENTS=2500
ENV DEFAULT_RATE_LIMIT_RPM=60
ENV CHANNEL_SECRET_PREPAID_BALANCE=prepaid-local-secret
ENV CHANNEL_SECRET_INVOICE_CREDIT=invoice-local-secret
ENV CHANNEL_SECRET_PURCHASE_ORDER_SETTLEMENT=po-local-secret

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
RUN npx prisma generate
RUN npm run build
RUN sed -i 's/\r$//' scripts/docker-entrypoint.sh && chmod +x scripts/docker-entrypoint.sh

EXPOSE 3000
CMD ["sh", "scripts/docker-entrypoint.sh"]
