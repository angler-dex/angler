# Angler
*Resource Allocation from Dark Pools*

Dark pool resource allocation is a way to consume multi-provider infrastructure
in a privacy preserving way, e.g. without broadcasting how many CPUs are
requested and without providers needing to share how many CPUs they have. The
goal is to support a "dark pool" of resources where no one knows exactly how
much infrastructure the pool contains and requests of the pool are fulfilled
sharing the minimum amount of required information. This repo contains the
source code of Angler, accompanying [this paper](https://doi.org/10.1145/3583740.3628440).

This repo contains the source and a demonstration of Angler. The goal of the
demo is to show a dark pool of managed Kubernetes-as-a-Service. Multiple
infrastructure providers each contribute a portion of their own kubernetes
cluster to the Angler dark pool, e.g. 10 vCPUs at a certain price per hour. A
request of the dark pool is made for 1 vCPU and the lowest cost provider who
can meet the request is selected to satisfy it. No one learns how many
resources a provider has contributed to the pool, and only the matched provider
learns how big the request is for.

In more detail, the demo starts a kubernetes cluster and 5 infrastructure
providers who contribute resources to the dark pool. In real life, each
operator would have their own cluster but in this demo they all share one
cluster. Then, a request is made of the pool for X vCPUs. The requestor and all
the operators engage in a multiparty computation protocol to determine the
lowest cost operator who can fulfill the request (capacity > X). The winning
operator privisions a Kubernetes namespace and resource quota for X vCPUs, then
grants the requestor access. See the scripts in `demo/` for more information.

**DISCLAIMER** This code was written for research purposes and is not verified
for production use.

## Getting Started
Initialize this repo's submodules.
```bash
git submodule update --init --recursive
```

Build the Container.
**WARNING**: This will install Docker if not already installed.
```bash
./demo/build_container.sh
```

Run the demo.
**WARNING**: This script will install Kubernetes and dependencies. It will also turn off swap and enable containerd.
```bash
./demo/run_operator_example.sh
```

Run the demo without the Angler Operator. Configuring the Angler Operator with
Kubernetes Custom Resource Definitions (CRD) is not supported.
```bash
./demo/run_k8s_example.sh
```

Run the demo without anything to do with kubernetes, just run the matching
function. Namespaces will not be automatically provisioned and configuration
via CRD is not supported.
```bash
./demo/run_mpc_example.sh
```

## Compiling on Host
Run the following.
```
npm install -g cmake-js
npm run deps
npm run libs
npm run compile
```
See `demo/Dockerfile` for more details.

To set cmake flags, see the following.
```
npm config set cmake_USE_RANDOM_DEVICE=OFF
npm config edit
```

## Note: Port Allocation
Angler needs outbound and inbound ports available on the host system(s). When
running Angler with port x, the following ports are used.
```
DHT port = x
web server port = x+1
MPC starting port = x+2
MPC ending port = x+2+2*<number of participants>
```

When running multiple AkriDEX containers/processes on the same system, ensure
each party's port numbers are spaced far enough apart.

