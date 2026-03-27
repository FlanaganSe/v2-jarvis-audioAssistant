FROM node:22-alpine AS client-builder

WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY --from=builder /app/dist ./dist
COPY --from=client-builder /app/client/dist ./client/dist
COPY drizzle/ ./drizzle/

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/server/server.js"]
