ARG RUN

FROM node:lts as builderenv

WORKDIR /app

# some packages require a build step
RUN apt-get update && \
    apt-get install -y --no-install-recommends build-essential && \
    rm -rf /var/lib/apt/lists/*

# We use Tini to handle signals and PID1 (https://github.com/krallin/tini, read why here https://github.com/krallin/tini/issues/8)
ENV TINI_VERSION v0.19.0
ADD https://github.com/krallin/tini/releases/download/${TINI_VERSION}/tini /tini
RUN chmod +x /tini

# build the app
COPY . /app
RUN npm ci
RUN npm run build
RUN npm ci --only=production # remove devDependencies, keep only used dependencies

# Move to the specific path and build crdt-runner dependencies
WORKDIR /app/dependencies/crdt-runner
RUN npm ci
RUN npm run build
RUN npm ci --only=production

# Return to root app directory
WORKDIR /app

########################## END OF BUILD STAGE ##########################

FROM node:lts

# NODE_ENV is used to configure some runtime options, like JSON logger
ENV NODE_ENV production

WORKDIR /app
COPY --from=builderenv /app /app
COPY --from=builderenv /tini /tini
# Please _DO NOT_ use a custom ENTRYPOINT because it may prevent signals
# (i.e. SIGTERM) to reach the service
# Read more here: https://aws.amazon.com/blogs/containers/graceful-shutdowns-with-ecs/
#            and: https://www.ctl.io/developers/blog/post/gracefully-stopping-docker-containers/
ENTRYPOINT ["/tini", "--"]
# Run the program under Tini
CMD [ "/usr/local/bin/node", "--trace-warnings", "--abort-on-uncaught-exception", "--unhandled-rejections=strict", "dist/index.js" ]
