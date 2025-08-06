FROM ubuntu:25.04

RUN apt-get update
RUN apt-get install -y ca-certificates tini xvfb curl unzip libfontconfig1 zip

# Install node
RUN curl -fsSL https://deb.nodesource.com/setup_20.x  | bash - && apt-get -y install nodejs

# Install Godot
ARG GODOT_VERSION=4.4.1-stable
ARG TARGETARCH

# Set Godot filename based on architecture
RUN if [ "$TARGETARCH" = "amd64" ]; then \
        # Use Decentraland fork for amd64
        GODOT_FILENAME="godot.4.4.1.stable.linux.editor.x86_64"; \
        GODOT_URL="https://github.com/decentraland/godotengine/releases/download/${GODOT_VERSION}/${GODOT_FILENAME}.zip"; \
    elif [ "$TARGETARCH" = "arm64" ]; then \
        # Use official Godot for arm64 as Decentraland fork doesn't have arm64 builds
        GODOT_FILENAME="Godot_v4.4.1-stable_linux.arm64"; \
        GODOT_URL="https://github.com/godotengine/godot/releases/download/4.4.1-stable/${GODOT_FILENAME}.zip"; \
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

# Clean apt cache
RUN rm -rf /var/lib/apt/lists/* /var/cache/apt/*

ARG COMMIT_HASH=local
ARG CURRENT_VERSION=Unknown

ENV COMMIT_HASH=${COMMIT_HASH:-local}
ENV CURRENT_VERSION=${CURRENT_VERSION:-Unknown}

# build the app
WORKDIR /app
COPY . /app
COPY dependencies/godot-runner/.env .env
COPY dependencies/godot-runner/godot-entrypoint.sh godot-entrypoint.sh
RUN chmod +x godot-entrypoint.sh

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
ENTRYPOINT ["/usr/bin/tini", "--", "/app/godot-entrypoint.sh" ]
