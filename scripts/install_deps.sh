#!/bin/bash

# fail if anything fails
#set -e

[ ! -z "$(command -v sudo)" ] || apt-get update && apt-get install -y sudo
[ ! -z "$(command -v git)" ] || sudo apt-get install -y git
[ ! -z "$(command -v curl)" ] || sudo apt-get install -y wget
[ ! -z "$(command -v make)" ] || sudo apt-get install -y build-essential
[ ! -z "$(command -v apt-add-repository)" ] || sudo apt-get install -y software-properties-common
[ ! -z "$(command -v cmake)" ] || sudo apt-get install -y cmake
#[ ! -z "$(command -v python)" ] || sudo apt-get install -y python
[ ! -z "$(command -v tc)" ] || sudo apt-get install -y iproute2
sudo apt-get install -y libboost-dev libgmp-dev libssl-dev
sudo apt-get install -y libboost-{chrono,log,program-options,date-time,thread,system,filesystem,regex,test}-dev




# If you want to make flamegraphs
#sudo apt install libstdc++6-dbgsym libc6-dbg coreutils-dbgsym
