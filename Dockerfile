FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY midnight/contract/package*.json ./midnight/contract/
COPY services/prover/package*.json ./services/prover/
RUN npm ci

COPY . .
RUN npm -w midnight/contract run build && npm -w services/prover run build && npm run build:web

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
COPY midnight/contract/package*.json ./midnight/contract/
COPY services/prover/package*.json ./services/prover/
RUN npm ci --omit=dev

COPY --from=builder /app/midnight/contract/dist ./midnight/contract/dist
COPY --from=builder /app/services/prover/dist ./services/prover/dist
COPY --from=builder /app/dist ./dist

EXPOSE 4000
CMD ["node", "services/prover/dist/index.js"]
