const os = require("os")
const fs = require('fs')
const ip = require('ip')
const dns = require('dns')
const spawn = require('child_process').spawn
const colors = require('colors')
const request = require('request')
const openssl = require('openssl-nodejs')
const k8s = require('@kubernetes/client-node')
const DHT = require('bittorrent-dht')
const randombytes = require('randombytes') // in dht
const simpleSha1 = require('simple-sha1') // in dht
const tcpp = require('tcp-ping');
const myenv = require('./env.js')

const csrPath = `${__dirname}/openssl`;

class DHTTest {
    constructor (opts = {}) {
        if(opts.dhtPort === undefined) throw new Error('dhtPort not given')
        if(opts.mpcPort === undefined) throw new Error('mpcPort not given')
        if(opts.numnodes === undefined) opts.numnodes = '0'
        if(opts.onErr === undefined) opts.onErr = process.exit
        if(opts.onSuc === undefined) opts.onSuc = process.exit
        if(opts.onInit === undefined) opts.onInit = console.log('Bob initialized')

        this.dhtPort = opts.dhtPort
        this.mpcPort = opts.mpcPort
        this.numnodes = opts.numnodes
        this.onErr = opts.onErr
        this.onSuc = opts.onSuc

        this.myHostAndPort = ip.address() + ':' + this.dhtPort // cant use hostname

        this.peers = []
        this.peersContacted=0
        this.backupPeers = []
        this.totalPeerCount=0
        this.e2ehrstart



        //// Setup DHT
        if (opts.dhtNodeId === undefined) {
            opts.dhtNodeId = randombytes(myenv.nodeIdLen)
        }
        // prefix alice node id with geohash
        if (opts.geoHash !== undefined ) {
            if (typeof opts.geoHash !== 'string') throw new Error('geoHash must be string')
            opts.dhtNodeId = myenv.prefixGeohash(opts.geoHash, opts.dhtNodeId)
        }

        dns.lookup(myenv.bootstrapHost, (err, result) => {
            var host = result
            if (err)
                host = myenv.bootstrapHost // assume it is IP, localhost

            console.log(`bootstrapping with ${host+":"+myenv.bootstrapPort}`)
            this.dht = new DHT({
                bootstrap: [ host+":"+myenv.bootstrapPort ],
                nodeId: opts.dhtNodeId,
                timeBucketOutdated: 900000, // 15min
                maxAge: 900000, // 15min
            })
            console.log(`nodeId: ${this.dht.nodeId.toString('hex')}`)

            this.dht.on('warning', (err) => { console.log(err) })

            this.dht.on('peer', (peer, infoHash, from) => {
                if (peer && from) {
                    this.peersContacted++;
                    console.log(`found peer ${peer.host}:${peer.port} through ${from.address}:${from.port}`)

                    var newPeer = peer.host+':'+peer.port
                    if (this.peers.length >= myenv.maxParticipants) {
                        if (!this.peers.includes(newPeer) && !this.backupPeers.includes(newPeer)) {
                            this.backupPeers.push(newPeer)
                        }
                        console.log(`skipping peer ${peer.host}:${peer.port}, list at capacity of ${myenv.maxParticipants}`)
                    } else if (!this.peers.includes(newPeer)) {
                        this.peers.push(newPeer)
                    }
                } else {
                    console.log('malformed peer response')
                }
            })

            this.dht.on('ready', () => {
                opts.onInit()
            })

            this.dht.listen(this.dhtPort, () => {
                console.log('dht is listening')
            })
        })
    }


    async lookup (token, crdHash) {
        this.peers = []
        this.peersContacted=0
        this.backupPeers = []

        this.e2ehrstart = process.hrtime()
        var hrstart = process.hrtime()

        console.log(`lookup room: ${crdHash}`)
        this.dht.lookup(crdHash, (err, numNodesWPeers) => {
            if (err) {
                console.log('lookup error')
                console.log(err)
                this.shutdown(this.onErr)
                return
            } else {
                var hrend = process.hrtime(hrstart)
                //let logPlotLabel = myenv.useGeoHash ? 'dht_lookup' : 'nogeo_dht_lookup'
                if (this.peersContacted < 10) {
                    console.log(`ERROR: heard from ${this.peersContacted} peer(s)! ${numNodesWPeers} were visited.`)
                    console.log(`SeNtInAl,grouped_bar,nodejs,failed_dht_lookup_cdf,${this.numnodes},${hrend[0]+(hrend[1]/1e9)}`)
                    console.log(`SeNtInAl,grouped_bar,nodejs,failed_dht_contacted,${this.numnodes},${this.peersContacted}`)
                    console.log(`SeNtInAl,grouped_bar,nodejs,failed_dht_visited,${this.numnodes},${numNodesWPeers}`)
                    setTimeout(this.shutdown.bind(this, this.onErr), 30*1000)
                    return
                }

                console.log(`SeNtInAl,grouped_bar,nodejs,dht_lookup_cdf,${this.numnodes},${hrend[0]+(hrend[1]/1e9)}`)
                console.log(`SeNtInAl,grouped_bar,nodejs,dht_contacted,${this.numnodes},${this.peersContacted}`)
                console.log(`SeNtInAl,grouped_bar,nodejs,dht_visited,${this.numnodes},${numNodesWPeers}`)
                console.log(this.peers)
                this.shutdown(this.onSuc)
                return
            }
        })
    }

    async shutdown(cb) {
        console.log("shutting down")

        setTimeout(() => {
            console.error('Could not finish in time, forcefully shutting down')
            if(cb !== undefined) cb()

        }, 10000)

        this.dht.destroy( function() {
            console.log("DHT destroyed")
            if(cb !== undefined) cb()
        })
    }
}

module.exports = DHTTest


// If called from the command line
if (require.main === module) {
    var cmdargs = process.argv.slice(2)
    if (cmdargs.length < 3 || cmdargs.length > 6) {
        console.log("Usage: " + process.argv[0] + process.argv[1] + " <port> <geohash> <lookup infohash> [nodeid] [numnodes for logger] [expected number of peers]")
        process.exit(1)
    }

    // a constant nodeid for debugging
    //myNodeId = Buffer.from(simpleSha1.sync(Buffer.from('alice').slice(0,myenv.nodeIdLen/2)), 'hex').toString('hex')

    var dhtTest = new DHTTest({
        dhtPort: cmdargs[0],
        mpcPort: parseInt(cmdargs[0]) + 2,
        geoHash: cmdargs[1],
        dhtNodeId: cmdargs.length >= 4 ? cmdargs[3] : undefined,
        numnodes: cmdargs.length >= 5 ? parseInt(cmdargs[4]) : undefined, // for debugging
        expectedNumPeers: cmdargs.length >= 6 ? parseInt(cmdargs[5]) : undefined, // for debugging
        onInit: () => {
            var token = randombytes(myenv.nodeIdLen).toString('hex')

            var lookupHash = cmdargs[2]

            // prefix lookup infohash with geohash
            if (cmdargs[1] !== undefined ) {
                if (typeof cmdargs[1] !== 'string') throw new Error('geoHash must be string')
                lookupHash = myenv.prefixGeohash(cmdargs[1], lookupHash).toString('hex')
            }

            setTimeout(() => { dhtTest.lookup(token, lookupHash)}, 3*1000)
        }
    })

    process.on('SIGTERM', () => { dhtTest.shutdown(process.exit) })
    process.on('SIGINT', () => { dhtTest.shutdown(process.exit) })
}
