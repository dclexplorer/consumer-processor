FROM ubuntu:25.04

# Install base packages and Node.js in combined layers
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        tini \
        unzip \
        curl \
        libfontconfig1 \
        zip && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

# Install Godot
ARG GODOT_VERSION=4.5.1.stable
ARG TARGETARCH
ARG GODOT_FILENAME

# Set Godot filename based on architecture
RUN if [ "$TARGETARCH" = "amd64" ]; then \
        # Use dclexplorer releases for amd64
        GODOT_FILENAME="godot.${GODOT_VERSION}.linux.editor.x86_64"; \
        GODOT_URL="https://godot-engine-releases.dclexplorer.com/${GODOT_VERSION}/editors/${GODOT_FILENAME}.zip"; \
    elif [ "$TARGETARCH" = "arm64" ]; then \
        # Use official Godot for arm64 as dclexplorer doesn't have arm64 builds
        GODOT_FILENAME="Godot_v4.5.1-stable_linux.arm64"; \
        GODOT_URL="https://github.com/godotengine/godot/releases/download/4.5.1-stable/${GODOT_FILENAME}.zip"; \
    else \
        echo "Unsupported architecture: $TARGETARCH" && exit 1; \
    fi && \
    echo "Using Godot from: $GODOT_URL" && \
    curl -fsSL "$GODOT_URL" -o /usr/local/bin/godot.zip && \
    unzip /usr/local/bin/godot.zip -d /usr/local/bin/ && \
    rm /usr/local/bin/godot.zip && \
    chmod +x /usr/local/bin/${GODOT_FILENAME} && \
    ln -s /usr/local/bin/${GODOT_FILENAME} /usr/local/bin/godot

ENV GODOT4_EDITOR=/usr/local/bin/godot

ARG COMMIT_HASH=local
ARG CURRENT_VERSION=Unknown

ENV COMMIT_HASH=${COMMIT_HASH:-local}
ENV CURRENT_VERSION=${CURRENT_VERSION:-Unknown}

# build the app
WORKDIR /app
COPY . /app

# TEMP
COPY dependencies/godot-asset-optimizer-project/entrypoint.sh /app/entrypoint.sh

RUN npm i --global yarn
RUN yarn --frozen-lockfile
RUN yarn build

ENV NODE_ENV=production

# Please _DO NOT_ use a custom ENTRYPOINT because it may prevent signals
# (i.e. SIGTERM) to reach the service
# Read more here: https://aws.amazon.com/blogs/containers/graceful-shutdowns-with-ecs/
#            and: https://www.ctl.io/developers/blog/post/gracefully-stopping-docker-containers/
#ENTRYPOINT ["/usr/bin/tini", "--"]
# Run the program under Tini
ENTRYPOINT ["/usr/bin/tini", "--", "/app/entrypoint.sh" ]
