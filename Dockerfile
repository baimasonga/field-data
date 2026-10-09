# syntax=docker/dockerfile:1
ARG NODE_VERSION=24.16.0

FROM node:${NODE_VERSION}-bookworm-slim AS frontend
ARG APP_VERSION
WORKDIR /build
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl git \
    && rm -rf /var/lib/apt/lists/*
COPY central/client/ ./client/
COPY central/VERSION ./VERSION
COPY central/files/prebuild/ ./files/prebuild/
RUN chmod 0755 files/prebuild/write-version.sh files/prebuild/build-frontend.sh
# Optional BuildKit trust bundle for environments with a TLS inspection proxy.
# The secret is mounted only while installing and never copied into the image.
RUN --mount=type=secret,id=build-ca \
    if [ -f /run/secrets/build-ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build-ca; fi; \
    APP_VERSION="${APP_VERSION:-$(cat VERSION)}" \
    FRONTEND_BUILD_MODE=source FRONTEND_VERSION=v2026.2.0 \
    files/prebuild/write-version.sh \
    && FRONTEND_BUILD_MODE=source FRONTEND_VERSION=v2026.2.0 \
    files/prebuild/build-frontend.sh

FROM node:${NODE_VERSION}-bookworm-slim AS backend
WORKDIR /usr/odk
COPY central/server/package*.json ./
RUN --mount=type=secret,id=build-ca \
    if [ -f /run/secrets/build-ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build-ca; fi; \
    npm clean-install --omit=dev --no-audit --fund=false --update-notifier=false
COPY central/server/ ./

FROM python:3.12-slim-bookworm AS form-compiler
ENV VIRTUAL_ENV=/opt/field-data-form-compiler/venv
RUN python -m venv "$VIRTUAL_ENV"
ENV PATH="$VIRTUAL_ENV/bin:$PATH"
COPY cloudflare/form-compiler/requirements.txt /tmp/form-compiler-requirements.txt
RUN --mount=type=secret,id=build-ca \
    if [ -f /run/secrets/build-ca ]; then export PIP_CERT=/run/secrets/build-ca; fi; \
    pip install --no-cache-dir --disable-pip-version-check \
      -r /tmp/form-compiler-requirements.txt

# Stage small runtime files separately so VFS-backed development builders do
# not copy the full dependency tree for every individual configuration file.
FROM scratch AS runtime-files
COPY cloudflare/certs/supabase-root-2021.crt /usr/local/share/ca-certificates/supabase-root-2021.crt
COPY cloudflare/form-compiler/app.py cloudflare/form-compiler/data_exports.py \
     cloudflare/form-compiler/xlsform_fixtures.py cloudflare/form-compiler/verify_runtime.py \
     /opt/field-data-form-compiler/
COPY central/files/shared/envsub.awk /scripts/envsub.awk
COPY central/files/service/scripts/ /usr/odk/
COPY central/files/service/config.json.template /usr/share/odk/config.json.template
COPY central/files/service/crontab /etc/cron.d/odk
# Re-rendered at startup with the environment-block path the runtime allows.
COPY central/files/service/crontab /usr/share/odk/crontab.template
COPY central/files/service/odk-cmd /usr/bin/odk-cmd
COPY central/files/service/with-pgenvblock.pl /usr/bin/with-pgenvblock.pl
COPY central/VERSION /usr/share/odk/VERSION
COPY cloudflare/nginx.conf /usr/share/odk/cloudflare-nginx.conf.template
COPY cloudflare/entrypoint.sh /usr/local/bin/field-data-entrypoint

FROM node:${NODE_VERSION}-bookworm-slim
ARG APP_VERSION
WORKDIR /usr/odk

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates cron curl nginx openssl postgresql-client procps netcat-openbsd \
      openjdk-17-jre-headless \
    && rm -rf /var/lib/apt/lists/* \
    && rm -f /etc/nginx/sites-enabled/default

# Public CA from Supabase's dashboard certificate download.
# https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt
COPY --from=runtime-files / /
RUN update-ca-certificates
ENV NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/supabase-root-2021.crt

COPY --from=backend /usr/odk /usr/odk
COPY --from=form-compiler /usr/local /usr/local
COPY --from=form-compiler /opt/field-data-form-compiler/venv /opt/field-data-form-compiler/venv
# Python was copied from another stage; register its shared library and
# fail the build if the compiler cannot load in the final runtime image.
RUN ldconfig \
    && cd /opt/field-data-form-compiler \
    && ./venv/bin/python -c "from app import application; assert application.test_client().get('/healthz').status_code == 200"
# pyxform validates every XLSForm with ODK Validate, a Java program, and finds
# `java` on PATH. Prove it in this image, the one that serves traffic: the build
# fails if Java is missing or a real form does not validate and compile.
RUN java -version \
    && cd /opt/field-data-form-compiler \
    && ./venv/bin/python verify_runtime.py
COPY --from=frontend /build/dist/ /usr/share/nginx/html/
COPY --from=frontend /tmp/version.txt /usr/share/nginx/html/version.txt

RUN VERSION="${APP_VERSION:-$(cat /usr/share/odk/VERSION)}" \
    && mkdir -p /usr/odk/sentry-versions /etc/secrets \
    && printf '%s\n' 'field-data-native-web-forms' > /etc/secrets/enketo-api-key \
    && chmod 0600 /etc/secrets/enketo-api-key \
    && printf '%s\n' "$VERSION" | tee \
      /usr/odk/sentry-versions/central \
      /usr/odk/sentry-versions/server \
      /usr/odk/sentry-versions/client >/dev/null \
    && chmod 0755 /usr/local/bin/field-data-entrypoint /usr/odk/*.sh /scripts/envsub.awk /usr/bin/odk-cmd /usr/bin/with-pgenvblock.pl \
    && chmod 0644 /etc/cron.d/odk

EXPOSE 8080 8383
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=5 \
  CMD curl --fail http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["/usr/local/bin/field-data-entrypoint"]
