#!/bin/bash
scriptpath="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[ ! -z "$(command -v docker)" ] || bash <(curl -fsSL https://get.docker.com)

cd $scriptpath/..

sudo docker build \
    -f demo/Dockerfile \
    -t angler:latest \
    .

# Export the container to containerd so kubernetes demos can find it.
sudo docker save angler | sudo ctr -n=k8s.io images import -
