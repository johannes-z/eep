ARG BUILD_FROM
FROM $BUILD_FROM
ARG BUN_VERSION=1.4.2

ENV LANG C.UTF-8
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN apk add --no-cache \
    curl \
    unzip \
    udev

RUN curl -fsSL https://bun.sh/install | bash -s -- bun-v${BUN_VERSION}
ENV PATH="/root/.bun/bin:${PATH}"

COPY . /
RUN cd / && bun install --production --frozen-lockfile

COPY run.sh /
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]
