FROM ubuntu:25.04

RUN apt-get update
RUN apt-get install -y ca-certificates tini unzip curl libfontconfig1 zip

# Install node
RUN curl -fsSL https://deb.nodesource.com/setup_20.x  | bash - && apt-get -y install nodejs

# Install Godot
ARG GODOT_VERSION=4.4.1-stable
ARG GODOT_FILENAME=godot.linux.editor.x86_64

RUN curl -fsSL https://github.com/decentraland/godotengine/releases/download/${GODOT_VERSION}/${GODOT_FILENAME} -o /usr/local/bin/${GODOT_FILENAME}
RUN chmod +x /usr/local/bin/${GODOT_FILENAME}

ENV GODOT4_EDITOR=/usr/local/bin/${GODOT_FILENAME}

# Clean apt cache
RUN rm -rf /var/lib/apt/lists/* /var/cache/apt/*

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
