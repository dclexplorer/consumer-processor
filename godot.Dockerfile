FROM quay.io/decentraland/godot-explorer:4f93d5c591dea36da17d70721a7ae1524fbdd79a

RUN apt-get update && apt-get upgrade -y
RUN apt-get install -y ca-certificates tini

# Install node
RUN curl -fsSL https://deb.nodesource.com/setup_20.x  | bash - && apt-get -y install nodejs

# Clean apt cache
RUN rm -rf /var/lib/apt/lists/* /var/cache/apt/*

ARG COMMIT_HASH=local
ARG CURRENT_VERSION=Unknown

ENV COMMIT_HASH=${COMMIT_HASH:-local}
ENV CURRENT_VERSION=${CURRENT_VERSION:-Unknown}

# build the app
WORKDIR /app
COPY . /app

RUN npm i --global yarn
RUN yarn --frozen-lockfile
RUN yarn build

ENV NODE_ENV production

# Please _DO NOT_ use a custom ENTRYPOINT because it may prevent signals
# (i.e. SIGTERM) to reach the service
# Read more here: https://aws.amazon.com/blogs/containers/graceful-shutdowns-with-ecs/
#            and: https://www.ctl.io/developers/blog/post/gracefully-stopping-docker-containers/
#ENTRYPOINT ["/usr/bin/tini", "--"]
# Run the program under Tini
ENTRYPOINT ["/usr/bin/tini", "--", "/app/godot-entrypoint.sh" ]
