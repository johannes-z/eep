ARG BUILD_FROM
FROM $BUILD_FROM

ENV LANG C.UTF-8
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN apk add --no-cache \
    curl \
    unzip \
    udev

RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

COPY . /
RUN cd / && bun install --production

COPY run.sh /
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]
