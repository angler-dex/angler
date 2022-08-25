#!/bin/bash
#
# This script demonstrates Angler: resource allocation from dark pools.
# All actors in the demo are encapsulated with containers so the only host
# dependencies are docker and stock Kubernetes which this script will install
# automatically.
#
# At a high level, this script performs the following.
#
# First, start a DHT bootstrap container and some passive "nodes" (processes)
# to participate in the DHT. These do not contribute resources to the dark
# pool. Their purpose is only to fill out the DHT for discovery purposes.
#
# Next, spin up a stock Kubernetes cluster. This is where resources will be
# provisioned out of later.
#
# Then, start some fake infrastructure providers who will advertise resources
# to the dark pool.  Each provider advertises they offer a Kubernetes namespace
# with a allocation quantum of 200m CPU and 128Mi. These providers are
# configured to always be very expensive and will never be selected to satisfy
# requests for resources from the dark pool.
#
# Next, start the final provider as the Angler Kubernetes operator. This is how
# an infrastructure provider would run Angler in the real world. The operator
# runs in the cluster as a Deployment and is configured with Kubernetes
# resources, i.e. CRD.  The Angler operator is configured to advertise
# resources to the dark pool, just like the other providers, but it is cheaper
# than all the others so it is always chosen to satisfy requests of the pool.
# When satisfying a request, the operator will create the namespace for the
# tenant with associated resource quota, and credentials (certificate).
#
# Finally, a container representing a customer is started and queries the dark
# pool. The request is for 5x of the 200m CPU 128MiB RAM i.e. 1CPU and .5GiB
# total. In this demo, there is always one 
#
# Tested on fresh install of Ubuntu 20.04.

scriptpath="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NUM_PARTIES=5
PASSIVE_DHT_NUM_NODES=100
LOC_HASH=dn5bpsbw
DHT_BOOTSTRAP_PORT=20000
# dht hash without location prefix i.e. sha1(200m128Mi)
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

echo "starting bootstrap"
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
    node src/passive_dht.js 10000 ${PASSIVE_DHT_NUM_NODES}

sleep 10 # let dht stablize

for party in $(seq 2 $((${NUM_PARTIES} - 1))); do
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

# Deploy the one special provider with a cheaper price
# than all the others.
kubectl apply -f $scriptpath/../kubernetes/rbac.yaml
kubectl apply -f $scriptpath/../kubernetes/PoolContributionCRDv1.yaml
kubectl apply -f $scriptpath/../kubernetes/deployment.yaml
kubectl apply -f $scriptpath/RentableNamespace.yaml
kubectl rollout status deployment angler-operator


sleep 10 # let providers start up

echo "starting alice"
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

echo "done. cleaning up"
sleep 60
killcontainers
