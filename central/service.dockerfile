ARG node_version=24.16.0



FROM node:${node_version}-slim AS pgdg
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        gpg \
    && rm -rf /var/lib/apt/lists/* \
    && update-ca-certificates
RUN echo "deb http://apt.postgresql.org/pub/repos/apt/ $(grep -oP 'VERSION_CODENAME=\K\w+' /etc/os-release)-pgdg main" \
      | tee /etc/apt/sources.list.d/pgdg.list \
    && curl https://www.postgresql.org/media/keys/ACCC4CF8.asc \
      | gpg --dearmor > /etc/apt/trusted.gpg.d/apt.postgresql.org.gpg



FROM node:${node_version}-slim AS intermediate

# For this customized build, do not depend on Git metadata being available
# inside the Docker build context. This makes the image build reliably from
# ZIP downloads, copied folders, forks, and Windows workspaces.
ARG APP_VERSION=1.0.0

RUN mkdir -p /tmp/sentry-versions \
    && echo "$APP_VERSION" > /tmp/sentry-versions/central \
    && echo "$APP_VERSION" > /tmp/sentry-versions/server \
    && echo "$APP_VERSION" > /tmp/sentry-versions/client



FROM node:${node_version}-slim

ARG node_version
LABEL org.opencontainers.image.source="https://github.com/getodk/central"

WORKDIR /usr/odk

COPY server/package*.json ./
COPY --from=pgdg /etc/apt/sources.list.d/pgdg.list \
    /etc/apt/sources.list.d/pgdg.list
COPY --from=pgdg /etc/apt/trusted.gpg.d/apt.postgresql.org.gpg \
    /etc/apt/trusted.gpg.d/apt.postgresql.org.gpg
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        gpg \
        cron \
        procps \
        postgresql-client-14 \
        netcat-traditional \
        openssl \
    && rm -rf /var/lib/apt/lists/* \
    && npm clean-install --omit=dev --no-audit \
        --fund=false --update-notifier=false

COPY server/ ./
COPY files/shared/envsub.awk /scripts/
COPY files/service/scripts/ ./

COPY files/service/config.json.template /usr/share/odk/
COPY files/service/crontab /etc/cron.d/odk
COPY files/service/odk-cmd /usr/bin/
COPY files/service/with-pgenvblock.pl /usr/bin/

COPY --from=intermediate /tmp/sentry-versions/ ./sentry-versions

EXPOSE 8383
