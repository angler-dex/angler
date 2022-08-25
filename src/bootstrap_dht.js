const DHT = require('bittorrent-dht')
const myenv = require('./env.js')

const dht = new DHT({
    bootstrap: false,
    //timeBucketOutdated: 900000, // 15min
    //maxAge: 900000, // 15min
})

dht.listen(myenv.bootstrapPort, function () {
  console.log('now listening')
})

dht.on('peer', function (peer, infoHash, from) {
  console.log('found potential peer: ' + peer.host + ':' + peer.port + ' through ' + from.address + ':' + from.port)
})

dht.on('warning', function (err) { console.log(err) })

dht.on('announce', function (peer, infoHash) {
    if (peer && peer.host && peer.port) {
        console.log(`got announce from ${peer.host}:${peer.port}`)
    } else {
        console.log('got malformed announce')
    }
})

//dht.on('announce_peer', function (infoHash, peer) {
//    console.log(`got announce_peer from ${peer.host}:${peer.port}`)
//})

function dhtstate () {
    const nodes = dht.toJSON().nodes
    if (nodes.length < 20) {
        console.log('dht nodes:')
        console.log(nodes)
    } else {
        console.log(`number of dht nodes: ${nodes.length}`)
    }
    // values does not include IPs from annouces, just BEP44 data
    //const values = dht.toJSON().values
    //console.log(values)
}
setInterval(dhtstate, 5*1000)

function shutdown() {
    console.log("shutting down");

    setTimeout(() => {
        console.error('Could not finish in time, forcefully shutting down');
        process.exit(0);
    }, 10000)

    dht.destroy( function() {
        console.log("DHT destroyed")
        process.exit(0)
    })
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
