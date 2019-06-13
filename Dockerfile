FROM node:alpine

RUN apk update
# RUN apk add redis

RUN apk add --update curl && \
    rm -rf /var/cache/apk/*

ENV OPENREDIS_URL redis://localhost:6379
RUN npm -g install yarn

WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn

COPY . .

ENV NODE_ENV production
RUN yarn build

EXPOSE 5000
# EXPOSE 6379

# (redis-server &) && 
CMD node initWithNpmrc.js
