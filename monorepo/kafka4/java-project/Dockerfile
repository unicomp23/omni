FROM openjdk:17-jdk-slim

# Install Maven
RUN apt-get update && apt-get install -y \
    maven \
    curl \
    bash \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /workspace

# Copy source code
COPY . .

# Build the project (dependencies will be downloaded during build)
RUN mvn clean compile dependency:copy-dependencies -q

# Keep container running
CMD ["tail", "-f", "/dev/null"] 