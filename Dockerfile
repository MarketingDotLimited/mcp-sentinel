FROM node:20-bookworm

# Install required system tools for Sentinel features
RUN apt-get update && apt-get install -y \
    sudo \
    procps \
    systemd \
    openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the application
COPY . .

# Setup environment variables (default configuration for Docker)
ENV PORT=4444
ENV HOST=0.0.0.0
ENV USE_HTTPS=false
ENV NODE_ENV=production

EXPOSE 4444

CMD ["npm", "start"]
