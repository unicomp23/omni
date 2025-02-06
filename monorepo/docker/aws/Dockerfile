# Use Amazon Linux 2023 as the base image
FROM amazonlinux:2023

# Install necessary packages
RUN yum update -y && \
    yum install -y \
    gcc \
    gcc-c++ \
    cmake \
    make \
    git \
    python3 \
    which \
    libstdc++-devel \
    rpm-build \
    rpmdevtools \
    ninja-build \
    python3-devel \
    libedit-devel \
    swig \
    perl-core \
    zlib-devel \
    libxml2-devel \
    ncurses-devel \
    libcurl-devel \
    systemd-devel \
    binutils-devel \
    xz-devel \
    libcurl-devel \
    openssl-devel \
    libffi-devel \
    glibc-static

# Ensure all libraries are available in the expected directories, especially for ARM architecture
# This might require linking or additional installation steps specific to ARM

# Set environment variables
ENV CC=/usr/bin/gcc
ENV CXX=/usr/bin/g++

# Copy the LLVM project directory
COPY llvm-project /llvm-project

# Create a build directory
RUN mkdir /llvm-project/build

# Set the working directory
WORKDIR /llvm-project/build

# Configure the build with CMake to include Clang, libc++, libc++abi, libunwind, and other subprojects
# Add necessary flags for ARM architecture if cross-compiling or adjust for native ARM build
RUN cmake -G "Unix Makefiles" \
    -DLLVM_ENABLE_PROJECTS="clang;compiler-rt;lld;polly" \
    -DLLVM_ENABLE_RUNTIMES="libcxx;libcxxabi;libunwind" \
    -DCMAKE_BUILD_TYPE=Release \
    -DLLVM_ENABLE_LIBXML2=ON \
    -DLLVM_ENABLE_ZLIB=ON \
    -DLLVM_ENABLE_TERMINFO=OFF \
    -DLLVM_ENABLE_LIBEDIT=ON \
    -DLLVM_STATIC_LINK_CXX_STDLIB=ON \
    -DLIBCXXABI_USE_LLVM_UNWINDER=ON \
    -DCMAKE_CXX_FLAGS="-funwind-tables" \
    -DCMAKE_C_FLAGS="-funwind-tables" \
    ../llvm

# Build the project
RUN make -j$(nproc)

# Install the built LLVM and its subprojects
RUN make install

# Set the entrypoint to bash
ENTRYPOINT ["/bin/bash"]
