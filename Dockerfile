# Pinned to a patched Node major (CVE-2026-111497 fixed in 26.12.1).
FROM node:26-alpine

# redis backs the registry metadata cache (server/middleware/RegistryCache.js).
# Do not apk add nodejs/yarn here: it would install a second, unpatched node.
RUN apk add --no-cache redis curl

ENV OPENREDIS_URL=redis://localhost:6379

# node:26 images ship without yarn/corepack.
RUN npm install -g --ignore-scripts yarn@1.22.22

WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

COPY . .

ENV NODE_ENV=production
RUN yarn build

EXPOSE 5000

CMD ["sh", "-c", "(redis-server &) && exec node initWithNpmrc.js"]
