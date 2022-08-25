#!/bin/bash
#
# WARNING: If this script hangs, unstick with: sudo docker stop alice
#
# This script demonstrates a subset of Angler's full functionality.
# Specifically, it uses Angler's DHT-based discovery but does not use Angler's
# Kubernetes operator. All actors in the system are encapulated with containers
# so the only host dependencies are docker and stock Kubernetes which this
# script will install automatically.
#
# At a high level, this script performs the following.
#
# First, start a DHT bootstrap container and some passive "nodes" (processes)
# to participate in the DHT. These containers do not contribute resources to
# the dark pool. Their purpose is only to fill out the DHT.
#
# Next, spin up a stock Kubernetes cluster. This is where resources will be
# provisioned out of later.
#
# Then, start some providers who will contribute resources to the dark pool.
# Each provider advertises they offer a Kubernetes namespace with a allocation
# quantum of 200m CPU and 128Mi. Each provider has between 2 and 10 of these
# quanta available, chosen randomly at runtime. The number of resources (2-10)
# contributed to the global dark pool is secret. For demonstration purposes,
# the providers are all allocating resources from the single Kubernetes cluster
# defined above, but in practice each provider would have their own cluster.
#
# Finally, a container representing a customer is started and queries the dark
# pool. The request is for 5x of the 200m CPU 128MiB RAM i.e. 1CPU and .5GiB
# total. In this demo, a providers price depends on their randomly assigned
# capacity so the winning provider is random.
#
# After the request is matched to a provider, the provider would usually
# provision the namespace and send the customer a signed cert for access. But
# this script stops short. As such, the customer doesn't actually get the
# resources they expected. For the fully featured demo, see the operator demo.
# Note the kubernetes cluster is still required even though no cluster
# resources are actually allocated.
#
# Tested with fresh install of Ubuntu 20.04.

scriptpath="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NUM_PARTIES=3
PASSIVE_DHT_NUM_NODES=100 # must be >= 10
# location hash, choose your favorite network coordinates
LOC_HASH=dn5bpsbw
DHT_BOOTSTRAP_PORT=20000
# dht hash without location prefix i.e. hash(cpu: 200m memory: 128Mi)
LOOKUP_HASH=7d24eab233ed084b97ea2ae59865e6e838c0108b
# dht hash including location prefix
#lookup_hash=646e35627073627797ea2ae59865e6e838c0108b
QUERY_NODE_ID=522b276a356bdf39013dfabea2cd43e141ecc9e8


# Kill old running tests
killcontainers() {
    echo "killing containers..."
    for party in $(seq 2 $NUM_PARTIES); do
        sudo docker stop bob${party} &>/dev/null
    done
    sudo docker stop alice &>/dev/null
    sudo docker stop bootstrap &>/dev/null
    sudo docker stop passive &>/dev/null
    echo "...done"

    echo "stopping k8s"
    $scriptpath/k8s_stop.sh
}

killcontainers

echo "starting k8s cluster"
$scriptpath/k8s_start.sh

echo "starting dht bootstrap"
sudo docker run -d --rm \
    --name bootstrap \
    --net=host \
    --env DHT_BOOTSTRAP_HOST="localhost" \
    --env DHT_BOOTSTRAP_PORT=$DHT_BOOTSTRAP_PORT \
    angler:latest \
    node src/bootstrap_dht.js $DHT_BOOTSTRAP_PORT

echo "starting passive dht nodes"
sudo docker run -d --rm \
    --name passive \
    --net=host \
    --env DHT_BOOTSTRAP_HOST="localhost" \
    --env DHT_BOOTSTRAP_PORT=$DHT_BOOTSTRAP_PORT \
    angler:latest \
    node src/passive_dht.js 2000 ${PASSIVE_DHT_NUM_NODES}

echo "waiting to let DHT stablize"
sleep 30

for party in $(seq 2 ${NUM_PARTIES}); do
    echo "starting provider $party"
    sudo docker run -d --rm \
      --name bob${party} \
      --net=host \
      -v $HOME/.kube:/root/.kube \
      --env DHT_BOOTSTRAP_HOST="localhost" \
      --env DHT_BOOTSTRAP_PORT=$DHT_BOOTSTRAP_PORT \
      angler:latest \
      node src/bob_seed_dht.js $((30000 + 100*${party})) $LOC_HASH $LOOKUP_HASH
done

echo "waiting to let providers start up"
sleep 10

echo "starting customer to query the pool"
sudo docker run -it --rm \
    --name alice \
    --net=host \
    --env DHT_BOOTSTRAP_HOST="localhost" \
    --env DHT_BOOTSTRAP_PORT=$DHT_BOOTSTRAP_PORT \
    --env TIME="SeNtInAl,3dbar,bash,walltime,$NUM_PARTIES,0,%E
SeNtInAl,3dbar,bash,kerntime,$NUM_PARTIES,0,%S
SeNtInAl,3dbar,bash,usrtime,$NUM_PARTIES,0,%U
SeNtInAl,3dbar,bash,cpu,$NUM_PARTIES,0,%P
SeNtInAl,3dbar,bash,elapsed,$NUM_PARTIES,0,%e
SeNtInAl,3dbar,bash,maxram,$NUM_PARTIES,0,%M
SeNtInAl,3dbar,bash,majpfaults,$NUM_PARTIES,0,%F
SeNtInAl,3dbar,bash,minpfaults,$NUM_PARTIES,0,%R
SeNtInAl,3dbar,bash,contextsw-invol,$NUM_PARTIES,0,%c
SeNtInAl,3dbar,bash,contextsw-vol,$NUM_PARTIES,0,%w
SeNtInAl,3dbar,bash,sockrx,$NUM_PARTIES,0,%r
SeNtInAl,3dbar,bash,socktx,$NUM_PARTIES,0,%s" \
    angler:latest \
    time node src/alice_dht.js 40000 $LOC_HASH $LOOKUP_HASH $QUERY_NODE_ID 0 $NUM_PARTIES

killcontainers
