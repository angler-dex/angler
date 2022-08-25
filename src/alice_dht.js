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
const binding = require('bindings')('agmpc_matcher_napi');

const csrPath = process.env.OPENSSL_PATH ? process.env.OPENSSL_PATH : `${__dirname}/openssl`

class Alice {
    constructor (opts = {}) {
        if(opts.dhtPort === undefined) throw new Error('dhtPort not given')
        if(opts.mpcPort === undefined) throw new Error('mpcPort not given')
        if(opts.msdelay === undefined) opts.msdelay = '0'
        if(opts.expectedNumPeers === undefined) opts.expectedNumPeers = 0
        if(opts.onErr === undefined) opts.onErr = () => {process.exit(1)}
        if(opts.onSuc === undefined) opts.onSuc = () => {process.exit(0)}
        if(opts.onInit === undefined) opts.onInit = console.log('Bob initialized')

        this.dhtPort = opts.dhtPort
        this.mpcPort = opts.mpcPort
        this.msdelay = opts.msdelay
        this.expectedNumPeers = opts.expectedNumPeers
        this.onErr = opts.onErr
        this.onSuc = opts.onSuc

        this.myHostAndPort = ip.address() + ':' + this.dhtPort // cant use hostname

        this.peers = []
        this.peersContacted=0
        this.backupPeers = []
        this.totalPeerCount=0
        this.e2ehrstart



        //// Setup DHT
        if (opts.aliceNodeId === undefined) {
            opts.aliceNodeId = randombytes(myenv.nodeIdLen)
        }
        // prefix alice node id with locHash
        if (opts.locHash !== undefined ) {
            if (typeof opts.locHash !== 'string') throw new Error('locHash must be string')
            opts.aliceNodeId = myenv.prefixGeohash(opts.locHash, opts.aliceNodeId)
        }

        dns.lookup(myenv.bootstrapHost, (err, result) => {
            var host = result
            if (err)
                host = myenv.bootstrapHost // assume it is IP
	    else if (myenv.bootstrapHost === "localhost")
	        host = "127.0.0.1" // force ipv4 because of
		// https://github.com/webtorrent/bittorrent-dht/issues/88

            console.log(`bootstrapping with ${host+":"+myenv.bootstrapPort}`)
            this.dht = new DHT({
                bootstrap: [ host+":"+myenv.bootstrapPort ],
                nodeId: opts.aliceNodeId,
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

    async sendCsr(token, parties, winnerIndex, winnerPrice) {
        var winnerIPPort = parties[winnerIndex-1]
        var winnerHost = winnerIPPort.split(':')[0]
        var winnerDhtPort = winnerIPPort.split(':')[1]
        var winnerWebPort = parseInt(winnerDhtPort) + 1

        // https://medium.com/better-programming/k8s-tips-give-access-to-your-clusterwith-a-client-certificate-dfb3b71a76fe
        console.log(`sending csr to ${winnerHost}:${winnerWebPort}`);

        var hrstartcert = process.hrtime()

        request.post({
            url: `http://${winnerHost}:${winnerWebPort}/csr`,
            json: {
                token: token,
                csr: fs.readFileSync(`${csrPath}/${token}.csr`).toString('base64')
            }
        }, (error, response, body) => {
            if (error) {
                console.log(`failure sending csr to ${winnerHost}:${winnerWebPort}`)
                console.log(error)
                this.shutdown(this.onErr)
                return
            }
            if (body.kubeconfig !== undefined) console.log('got response with kubeconfig!')
            if (body.kubeconfig === 'fail') {
                console.log('kubeconf failed on server side'.red)
                this.shutdown(this.onErr)
            }

            var hrendcert = process.hrtime(hrstartcert)
            console.log(`SeNtInAl,3dbar,nodejs,got_cert,${this.totalPeerCount},${this.msdelay},${hrendcert[0]+(hrendcert[1]/1e9)}`)

            var hrstart = process.hrtime()

            var key = fs.readFileSync(`${csrPath}/${token}.key`).toString('base64')
            var kubeconfString = body.kubeconfig.replace('SeNtInAl', key)

            var k8sApi
            try {
                const kc = new k8s.KubeConfig()
                kc.loadFromString(kubeconfString)
                k8sApi = kc.makeApiClient(k8s.CoreV1Api)
            } catch (err) {
                console.log('Creating k8s api object failed'.red)
                console.log(err)
                this.shutdown(this.onErr)
                return
            }

            // test
            k8sApi.listNamespacedPod(token).then(
                (response) => {
                    console.log('')
                    console.log('connection succeeded!')
                    console.log('a namespace has been provisioned and is ready to deploy an application!')
                    console.log('')
                    var hrend = process.hrtime(hrstart)
                    console.log(`SeNtInAl,3dbar,nodejs,connected,${this.totalPeerCount},${this.msdelay},${hrend[0]+(hrend[1]/1e9)}`)

                    var e2ehrend = process.hrtime(this.e2ehrstart)
                    console.log(`SeNtInAl,3dbar,nodejs,true_e2e,${this.totalPeerCount},${this.msdelay},${e2ehrend[0]+(e2ehrend[1]/1e9)}`)

                    this.shutdown(this.onSuc)
                },
                (err) => {
                    console.log('\n\nerror listing namespace pods'.yellow);
                    if (err && err.response && err.response.body && err.response.body.message) {
                        console.log(err.response.body.message);
                    } else {
                        console.log(err)
                        this.shutdown(this.onErr)
                        return
                    }
                },
            ).catch(function(reason) {
                console.log('\n\nerror connection to k8s failed')
                console.log(reason)
                this.shutdown(this.onErr)
                return
            })
        })
    }


    async runMPC(token, parties) {
        var hrstart = process.hrtime()

        const ips = [];
        const ports = [];
        for (var i=0; i<parties.length; i++) {
            const partyIpDhtport = parties[i].split(':')
            ips.push(partyIpDhtport[0])
            ports.push(parseInt(partyIpDhtport[1])+2) // mpc port is offset by 2
        }
        const requesterPartyNum = 1;
        const capacity = 5;
        const bid = 0; //ignored
        const res = binding.agmpc_matcher_napi(ips, ports, requesterPartyNum, capacity, bid, this.msdelay);
        const winnerIndex = res[0];
        const winnerPrice = res[1];
        if (!winnerIndex || !winnerPrice) {
            console.log('mpc failed with no output file')
            setTimeout(this.shutdown.bind(this, this.onErr), 30000)
            return
        }

        var hrend = process.hrtime(hrstart)
        console.log(`SeNtInAl,3dbar,nodejs,run_mpc,${this.totalPeerCount},${this.msdelay},${hrend[0]+(hrend[1]/1e9)}`)

        if (myenv.skipProvisioning) {
            setTimeout(this.shutdown.bind(this, this.onSuc), 500)
            return
        } else {
            this.sendCsr(token, parties, winnerIndex, winnerPrice)
        }
    }

    async setupMPC(token, crdHash, parties) {
        var hrstart = process.hrtime()

        parties.unshift(this.myHostAndPort)

        var respTimings = new Array(parties.length)
        respTimings[0] = 0
        var numPingResps = 0

        for (var i=1; i<parties.length; i++) {
            let pingParty = parties[i] // let for arrow func
            var partyHost = pingParty.split(':')[0]
            var partyDhtPort = pingParty.split(':')[1]
            var partyWebPort = parseInt(partyDhtPort) + 1

            tcpp.ping({
                address: partyHost,
                port: partyWebPort,
                timeout: 1000, //ms
                attempts: 3
            }, (error, data) => {
                numPingResps++
                let partyIndex = parties.indexOf(pingParty)
                if (error) {
                    console.log(`failure pinging party ${pingParty} (index ${partyIndex})`)
                    console.log(error)
                    parties.splice(partyIndex,1)
                    respTimings.splice(partyIndex,1)
                } else {
                    respTimings[partyIndex] = data.avg
                }

                if (numPingResps == parties.length-1) {
                    // use runtime prediction to remove peers
                    console.log(`all timing collected: ${respTimings}`)
                    function predictRuntimeus(t) {
                        return (29916.157507*t.length) + (22474.719529*Math.max.apply(Math, t)) -38622.408721 + 100000 // 100000 is offset for socket init (not included in regression)
                    }

                    var rt = predictRuntimeus(respTimings)
                    while (rt > myenv.targetRuntime && parties.length > 3) {
                        var furthestPeer = respTimings.indexOf(Math.max.apply(Math, respTimings))
                        if (furthestPeer == -1) break
                        console.log(`Removing slowest peer at index ${furthestPeer}: ${parties[furthestPeer]}`)
                        parties.splice(furthestPeer, 1)
                        respTimings.splice(furthestPeer, 1)
                        rt = predictRuntimeus(respTimings)
                        console.log(`New rt: ${rt}`)
                    }
                    console.log(`SeNtInAl,3dbar,nodejs,predicted_rt,${this.totalPeerCount},${this.msdelay},${rt}`)
                    console.log(`SeNtInAl,3dbar,nodejs,peer_scope,${this.totalPeerCount},${this.msdelay},${parties.length}`)

                    // setup for subset of parties
                    var numSetupResps = 0
                    for (var i=1; i<parties.length; i++) {
                        let setupParty = parties[i] // let for arrow func
                        var partyHost = setupParty.split(':')[0]
                        var partyDhtPort = setupParty.split(':')[1]
                        var partyWebPort = parseInt(partyDhtPort) + 1

                        request.post({
                            url: `http://${partyHost}:${partyWebPort}/setup`,
                            json: {
                                token: token,
                                crdHash: crdHash,
                                parties: parties
                            },
                            timeout: 1000, //ms
                            time: true
                        }, (error, response, body) => {
                            if (error || !body.ready) {
                                console.log(`failure finding party ${setupParty} (index ${partyIndex})`)
                                console.log(error);
                                setTimeout(this.shutdown.bind(this, this.onErr), 30000) // wait for bobs to kill this execution
                                return
                            } else {
                                numSetupResps ++
                            }
                            if (numSetupResps == parties.length-1) {
                                var hrend = process.hrtime(hrstart)
                                console.log(`SeNtInAl,3dbar,nodejs,setup_mpc,${this.totalPeerCount},${this.msdelay},${hrend[0]+(hrend[1]/1e9)}`)

                                this.runMPC(token, parties)
                            }
                        })
                    }
                }
            })
        }
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
                this.totalPeerCount = this.peers.length + this.backupPeers.length + 1

                // runtime estimation here
                console.log('loookup returned ' + numNodesWPeers + ' nodes with peers')
                console.log(this.peers)
                if (myenv.onlyLookup) {
                    console.log('onlyLookup enabled - quitting')
                    this.shutdown(this.onSuc)
                    return
                } else if (this.peers.length > 1) {
                    if (this.peersContacted < 10) {
                        console.log(`only contacted ${this.peersContacted}, something must be wrong`)
                        console.log(`SeNtInAl,3dbar,nodejs,failed_dht_lookup,${this.totalPeerCount},${this.msdelay},${hrend[0]+(hrend[1]/1e9)}`)
                        console.log(`SeNtInAl,barbox,nodejs,failed_dht_contacted,${this.totalPeerCount},${this.peersContacted}`)
                        console.log(`SeNtInAl,barbox,nodejs,failed_dht_visited,${this.totalPeerCount},${numNodesWPeers}`)
                        setTimeout(this.shutdown.bind(this, this.onErr), 30*1000)
                        return
                    } else if (this.expectedNumPeers == 0 || this.peers.length == this.expectedNumPeers-1 || this.peers.length == myenv.maxParticipants) { // -1 bc i am a peer
                        console.log(`SeNtInAl,3dbar,nodejs,dht_lookup,${this.totalPeerCount},${this.msdelay},${hrend[0]+(hrend[1]/1e9)}`)
                        console.log(`SeNtInAl,barbox,nodejs,dht_contacted,${this.totalPeerCount},${this.peersContacted}`)
                        console.log(`SeNtInAl,barbox,nodejs,dht_visited,${this.totalPeerCount},${numNodesWPeers}`)
                        this.setupMPC(token, crdHash, this.peers)
                    } else {
                        console.log('wrong number of peers found!')
                        console.log(`found:${this.peers.length}, expected:${this.expectedNumPeers-1}`)
                        console.log('shutting down in 30 sec...')
                        setTimeout(this.shutdown.bind(this, this.onErr), 30*1000)
                        return
                    }
                } else {
                    console.log('not enough peers found!')
                    this.shutdown(this.onErr)
                    return
                }
            }
        })
    }

    async genCsr(token, cb) {
        const csrConf=Buffer.from(`
        [ req ]
        default_bits = 2048
        prompt = no
        default_md = sha256
        distinguished_name = dn

        [ dn ]
        CN = ${token}admin
        O = ${token}group

        [ v3_ext ]
        authorityKeyIdentifier=keyid,issuer:always
        basicConstraints=CA:FALSE
        keyUsage=keyEncipherment,dataEncipherment
        extendedKeyUsage=serverAuth,clientAuth
        `, 'utf8')

        // generate certs while we wait for bootstrap
        fs.access(`${csrPath}/${token}.csr`, fs.F_OK, (err) => {
            if (err) {
                console.log(`csr at ${csrPath}/${token}.csr not found, generating now`.yellow);
                var hrstartgen = process.hrtime()
                openssl(['req', '-config', { name:'csr.conf', buffer: csrConf },
                        '-out', `${token}.csr`,
                        '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout',
                        `${token}.key`],
                    (buffer) => {
                        var hrendgen = process.hrtime(hrstartgen)
                        console.log(`SeNtInAl,3dbar,nodejs,gen_csr,${this.totalPeerCount},${this.msdelay},${hrendgen[0]+(hrendgen[1]/1e9)}`)
                        console.log('generated ssl cert for k8s cluster access');
                        if(cb !== undefined) cb()
                    }
                )
            } else {
                console.log(`using existing csr ${csrPath}/${token}.csr`.yellow);
                if(cb !== undefined) cb()
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

module.exports = Alice


// If called from the command line
if (require.main === module) {
    var cmdargs = process.argv.slice(2)
    if (cmdargs.length < 3 || cmdargs.length > 6) {
        console.log("Usage: " + process.argv[0] + process.argv[1] + " <port> <location hash> <lookup infohash> [nodeid] [msdelay for logger] [expected number of peers]")
        process.exit(1)
    }

    // a constant nodeid for debugging
    //myNodeId = Buffer.from(simpleSha1.sync(Buffer.from('alice').slice(0,myenv.nodeIdLen/2)), 'hex').toString('hex')

    var alice = new Alice({
        dhtPort: cmdargs[0],
        mpcPort: parseInt(cmdargs[0]) + 2,
        locHash: cmdargs[1],
        aliceNodeId: cmdargs.length >= 4 ? cmdargs[3] : undefined,
        msdelay: cmdargs.length >= 5 ? parseInt(cmdargs[4]) : undefined, // for debugging
        expectedNumPeers: cmdargs.length >= 6 ? parseInt(cmdargs[5]) : undefined, // for debugging
        onInit: () => {
            var token = randombytes(myenv.nodeIdLen).toString('hex')

            const go = () => {
                var lookupHash = cmdargs[2]

                // prefix lookup infohash with locHash
                if (cmdargs[1] !== undefined ) {
                    if (typeof cmdargs[1] !== 'string') throw new Error('location prefix must be string')
                    lookupHash = myenv.prefixGeohash(cmdargs[1], lookupHash).toString('hex')
                }

                setTimeout(() => { alice.lookup(token, lookupHash)}, 3*1000)
            }

            alice.genCsr(token, () => {
                go()
            })
        }
    })

    process.on('SIGTERM', () => { alice.shutdown(process.exit) })
    process.on('SIGINT', () => { alice.shutdown(process.exit) })
}
