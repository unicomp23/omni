FROM ubuntu as dev

# nvm requirements
RUN apt-get update
RUN apt-get install -y curl wget

# nvm env vars
RUN mkdir -p /usr/local/nvm
ENV NVM_DIR /usr/local/nvm

# IMPORTANT: set the exact version
ENV NODE_VERSION v16.17.1
RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.1/install.sh | bash
RUN /bin/bash -c "source $NVM_DIR/nvm.sh && nvm install $NODE_VERSION && nvm use --delete-prefix $NODE_VERSION"

# add node and npm to the PATH
ENV NODE_PATH $NVM_DIR/versions/node/$NODE_VERSION/bin
ENV PATH $NODE_PATH:$PATH

#COPY . /root/web
WORKDIR /root/app/examples/web.chat
RUN npm -v
RUN node -v
