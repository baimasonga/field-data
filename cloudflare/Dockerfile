ARG NODE_VERSION=24.16.0

FROM node:${NODE_VERSION}-slim AS frontend
ARG APP_VERSION
WORKDIR /build
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl git \
    && rm -rf /var/lib/apt/lists/*
COPY central/ ./
RUN APP_VERSION="${APP_VERSION:-$(cat VERSION)}" \
    FRONTEND_BUILD_MODE=source FRONTEND_VERSION=v2026.2.0 \
    files/prebuild/write-version.sh \
    && FRONTEND_BUILD_MODE=source FRONTEND_VERSION=v2026.2.0 \
    files/prebuild/build-frontend.sh

FROM node:${NODE_VERSION}-slim AS backend
WORKDIR /usr/odk
COPY central/server/package*.json ./
RUN npm clean-install --omit=dev --no-audit --fund=false --update-notifier=false
COPY central/server/ ./

FROM node:${NODE_VERSION}-slim
ARG APP_VERSION
WORKDIR /usr/odk

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates cron curl nginx openssl postgresql-client procps netcat-openbsd \
    && rm -rf /var/lib/apt/lists/* \
    && rm -f /etc/nginx/sites-enabled/default

COPY --from=backend /usr/odk /usr/odk
COPY central/files/shared/envsub.awk /scripts/envsub.awk
COPY central/files/service/scripts/ /usr/odk/
COPY central/files/service/config.json.template /usr/share/odk/config.json.template
COPY central/files/service/crontab /etc/cron.d/odk
COPY central/files/service/odk-cmd /usr/bin/odk-cmd
COPY central/files/service/with-pgenvblock.pl /usr/bin/with-pgenvblock.pl
COPY --from=frontend /build/dist/ /usr/share/nginx/html/
COPY --from=frontend /tmp/version.txt /usr/share/nginx/html/version.txt
COPY central/VERSION /usr/share/odk/VERSION
COPY cloudflare/nginx.conf /usr/share/odk/cloudflare-nginx.conf.template
COPY cloudflare/entrypoint.sh /usr/local/bin/field-data-entrypoint

RUN VERSION="${APP_VERSION:-$(cat /usr/share/odk/VERSION)}" \
    && mkdir -p /usr/odk/sentry-versions /etc/secrets \
    && printf '%s\n' "$VERSION" | tee \
      /usr/odk/sentry-versions/central \
      /usr/odk/sentry-versions/server \
      /usr/odk/sentry-versions/client >/dev/null \
    && chmod 0755 /usr/local/bin/field-data-entrypoint /usr/odk/*.sh \
    && chmod 0644 /etc/cron.d/odk

EXPOSE 8080 8383
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=5 \
  CMD curl --fail http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["/usr/local/bin/field-data-entrypoint"]
