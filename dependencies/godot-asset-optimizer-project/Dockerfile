FROM quay.io/decentraland/godot-explorer:next

USER root

# Xvfb already included in base image
# Install Node.js 20.x
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        tini \
        curl && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

# Godot executable at /app/decentraland.godot.client.x86_64 in base image

ARG COMMIT_HASH=local
ARG CURRENT_VERSION=Unknown

ENV COMMIT_HASH=${COMMIT_HASH:-local}
ENV CURRENT_VERSION=${CURRENT_VERSION:-Unknown}
ENV ASSET_SERVER_PORT=8080

# Use /service for node app to avoid conflict with /app (godot-explorer files)
WORKDIR /service
COPY package*.json yarn.lock ./
RUN npm i --global yarn && yarn --frozen-lockfile
COPY . .
RUN yarn build

# Set production mode after build
ENV NODE_ENV=production

COPY dependencies/godot-asset-optimizer-project/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/usr/bin/tini", "--", "/entrypoint.sh"]
