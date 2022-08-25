#!/bin/bash
#
# This script demonstrates the MPC matching part of Angler. If it works
# correctly, the output from two of the three parties should show who won the
# matching function. The reamaining party should not have an output (-1)

sudo docker run -it --rm \
    --name mpc \
    --net=host \
    angler:latest \
    node src/run_local.js
