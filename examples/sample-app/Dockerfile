# Public mirror of the official node image (docker.io/library/node:20-alpine),
# reachable in networks where Docker Hub is blocked.
FROM public.ecr.aws/docker/library/node:20-alpine
WORKDIR /app

# Install deps first for layer caching (this app has none, but the pattern holds).
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY . .

EXPOSE 3000
ENV PORT=3000
CMD ["node", "server.js"]
