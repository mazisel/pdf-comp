FROM node:20-slim

ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends ghostscript \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY package.json package.json
RUN npm install --omit=dev

COPY src ./src

EXPOSE 4000

CMD ["node", "src/server.js"]
