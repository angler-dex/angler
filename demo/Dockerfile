FROM ubuntu:20.04

SHELL ["/bin/bash", "-c"]

RUN apt-get update && DEBIAN_FRONTEND=noninteractive TZ=Etc/UTC apt-get install -y \
    time \
    tzdata \
    linux-tools-generic \
    libcap2-bin \
    wget \
    ca-certificates \
    curl \
    openssl \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*
    #linux-tools-5.4.0-54-generic \

ENV NVM_DIR /usr/local/nvm
ENV NODE_VERSION "v17.0.1"

RUN mkdir -p $NVM_DIR && cd $NVM_DIR && \
    wget -q -O - https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.1/install.sh | /bin/bash - && \
    export NVM_DIR="/usr/local/nvm" && \
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" && \
    nvm install $NODE_VERSION && \
    nvm alias default $NODE_VERSION && \
    nvm use default

ENV NODE_PATH $NVM_DIR/$NODE_VERSION/lib/node_modules
ENV PATH $NVM_DIR/versions/node/$NODE_VERSION/bin:$PATH
ENV OPENSSL_PATH /akridex/openssl

WORKDIR /akridex
RUN mkdir $OPENSSL_PATH

COPY . .

RUN npm install -g cmake-js && \
    npm install && \
    npm run deps && \
    npm run libs && \
    npm run compile

#ENTRYPOINT ["./sh2pc_auction_benchmark"]
#CMD ["node", "app.js"]

