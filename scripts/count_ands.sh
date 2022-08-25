#!/bin/bash
scriptpath="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
binpath="$scriptpath/../build/bin"
for numParties in $(seq 2 10); do
    circuitPath="${binpath}/agmpc_matcher_${numParties}_circuit.txt"
    echo "$circuitPath:"
    echo "Number of AND gates: $(grep -c "AND" $circuitPath)"
    echo "Number of XOR gates: $(grep -c "XOR" $circuitPath)"
done
