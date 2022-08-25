#!/bin/bash
scriptpath="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
set -e

# emp-tool has to be first to put common.cmake in /usr/local
dirz="${scriptpath}/../mpc/emp-tool/
${scriptpath}/../mpc/emp-ot/
${scriptpath}/../mpc/emp-agmpc/
${scriptpath}/../mpc/emp-sh2pc/"
#${scriptpath}/../mpc/emp-ag2pc/

echo "$dirz" | while read libdir; do
    cd $libdir
    rm -f CMakeCache.txt
    echo "Running for dir $libdir "
    cmake .
    #cmake -DCMAKE_BUILD_TYPE=Debug
    #cmake -DCMAKE_BUILD_TYPE=Debug -DUSE_RANDOM_DEVICE=ON
    make -j8
    sudo make install
    cd -
done


