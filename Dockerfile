FROM node:22-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --production

# Copy application files
COPY server.js index.html cerebro-brain.jpg ./
COPY lib ./lib
COPY public ./public
COPY db ./db

# Use existing node user and set permissions
RUN chown -R node:node /app

USER node

EXPOSE 3460

CMD ["node", "server.js"]
