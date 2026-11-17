FROM node:24-slim AS deps
# concurrently stops the server and the client through tree-kill, which needs ps; without it, stopping dev leaves both running.
RUN apt-get update \
  && apt-get install -y --no-install-recommends procps \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN chown node:node /app
USER node
COPY --chown=node:node package.json package-lock.json .npmrc ./
COPY --chown=node:node shared/package.json shared/
COPY --chown=node:node server/package.json server/
COPY --chown=node:node client/package.json client/
# The workspace node_modules folders must exist and belong to node before the dev service mounts named volumes on them,
# otherwise Docker creates them owned by root and installs inside the container fail.
RUN mkdir -p node_modules shared/node_modules server/node_modules client/node_modules \
  && npm ci --no-audit --no-fund

FROM deps AS app
COPY --chown=node:node . .
ENV CLIENT_HOST=0.0.0.0
EXPOSE 4200
CMD ["npm", "run", "dev"]

FROM deps AS dev
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
USER root
RUN npx playwright install-deps chromium \
  && mkdir -p /ms-playwright \
  && chown node:node /ms-playwright \
  && rm -rf /var/lib/apt/lists/*
USER node
RUN npx playwright install chromium
ENV CLIENT_HOST=0.0.0.0
EXPOSE 4200
CMD ["npm", "run", "dev"]
