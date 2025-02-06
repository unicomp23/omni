FROM ubuntu:20.04

# Install dependencies
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && \
    apt-get upgrade -y && \
    apt-get install -y --no-install-recommends \
    build-essential \
    git \
    libssl-dev \
    libsasl2-dev \
    librdkafka-dev \
    librdkafka1 \
    uuid-dev && \
    apt-get clean

# Copy and build the C example
COPY example_producer.cpp /app/example_producer.cpp
WORKDIR /app
RUN gcc example_producer.cpp -o example_producer -lrdkafka -luuid

ENTRYPOINT ["./example_producer"]
