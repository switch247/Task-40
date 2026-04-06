FROM node:20-bookworm-slim

WORKDIR /app
RUN set -eux; \
	apt-get update; \
	apt-get install -y --no-install-recommends chromium; \
	rm -rf /var/lib/apt/lists/*
ENV VITE_API_BASE_URL=http://localhost:3000/api

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

EXPOSE 5173
CMD ["npm", "run", "dev"]
