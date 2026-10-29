# --------------------------------------
# Stage 1: build
# --------------------------------------
FROM node:20-alpine AS builder
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# --------------------------------------
# Stage 2: runtime
# --------------------------------------
FROM node:20-alpine
WORKDIR /usr/src/app
COPY --from=builder /usr/src/app/package*.json ./
RUN npm install --omit=dev && apk add --no-cache tzdata
ENV TZ=America/Mexico_City
ENV NODE_ENV=production
COPY --from=builder /usr/src/app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/main"]
