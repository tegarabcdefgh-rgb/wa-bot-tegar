FROM node:20-bullseye-slim

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install --production

COPY . .

ENV NODE_ENV=production

CMD ["npm", "run", "start"]

FROM node:20-slim

# Install font Noto dan font dasar lainnya
RUN apt-get update && apt-get install -y \
    fonts-noto \
    fontconfig \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

CMD ["npm", "start"]