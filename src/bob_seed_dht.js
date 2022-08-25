const express = require('express')
const bodyParser = require('body-parser')
const os = require("os")
const fs = require('fs')
const Ip = require('ip')
const extIp = require('external-ip')();
const dns = require('dns')
const moment = require('moment')
const spawn = require('child_process').spawn
const colors = require('colors')
const k8s = require('@kubernetes/client-node')
const DHT = require('bittorrent-dht')
const randombytes = require('randombytes') // in dht
const simpleSha1 = require('simple-sha1') // in dht
const HashMap = require('hashmap');
const Parser = require('expr-eval').Parser;
const myenv = require('./env.js')
const binding = require('bindings')('agmpc_matcher_napi');

StateEnum = Object.freeze({"Ready":1, "NamespaceCreated":2, "MakeUserToo":3, "FullyProvisioned":4})

class Bob {
    constructor (opts = {}) {
        if(opts.dhtPort === undefined) throw new Error('dhtPort not given')
        if(opts.webPort === undefined) throw new Error('webPort not given')
        if(opts.mpcPort === undefined) throw new Error('mpcPort not given')
        if(opts.onErr === undefined) opts.onErr = process.exit
        if(opts.onSuc === undefined) opts.onSuc = process.exit
        if(opts.onInit === undefined) opts.onInit = () => {console.log('Bob initialized')}

        this.dhtPort = opts.dhtPort
        this.webPort = opts.webPort
        this.mpcPort = opts.mpcPort
        this.onErr = opts.onErr
        this.onSuc = opts.onSuc
        this.customerMap = new HashMap();
        this.crdMap = new HashMap();

        this.app = express()

        this.kc = new k8s.KubeConfig()
        this.kc.loadFromDefault()
        this.k8sApi = this.kc.makeApiClient(k8s.CoreV1Api)
        this.k8sCertApi = this.kc.makeApiClient(k8s.CertificatesV1Api)
        this.k8sNetworkApi = this.kc.makeApiClient(k8s.NetworkingV1Api)
        this.k8sRoleApi = this.kc.makeApiClient(k8s.RbacAuthorizationV1Api)
        // match APIs to function sigs https://github.com/kubernetes-client/javascript/tree/master/src/gen/api



        //// Setup webserver
        this.app.use(bodyParser.json())

        this.app.post('/csr', (req, res) => {
            console.log(`POST to /csr from ${req.hostname}`)
            var token = req.body.token
            var customer = this.customerMap.get(token)

            if (customer === undefined) {
                console.log('alice sent CSR without winning an auction');
                res.json({
                    kubeconfig: 'fail'
                })
                this.onErr(token)
            }

            customer.csr = req.body.csr
            customer.csrRes = res

            if (customer.state == StateEnum.NamespaceCreated) {
                this.provisionUser(token)
            } else {
                console.log('alice responded too quick - provision user after namespace')
                customer.state = StateEnum.MakeUserToo
                //this.customerMap.set(token, customer) // is this needed?
            }
        })

        this.app.post('/setup', (req, res) => {
            console.log(`POST to /setup from ${req.hostname}`)
            var token = req.body.token
            var crdHash = req.body.crdHash
            var parties = req.body.parties

            if (this.customerMap.get(token) !== undefined) {
                console.log('customer token reuse not allowed')
                res.json({
                    ready: false
                })
                return
            }
            if (this.crdMap.get(crdHash) === undefined) {
                console.log(`unknown crdHash: ${crdHash}`)
                res.json({
                    ready: false
                })
                return
            }

            if (this.crdMap.get(crdHash).secretQuantityRemaining == 0) {
                console.log(`CRD ${crdHash} has 0 units remaining`)
                res.json({
                    ready: false
                })
                return
            }
            res.json({
                ready: true
            })

            this.customerMap.set(token, {
                crdHash: crdHash,
                csr: undefined,
                csrRes: undefined,
                state: StateEnum.Ready
            })

            this.runMPC(token, parties)
        })

        this.server = this.app.listen(this.webPort, () => console.log(`Web service listening on port ${this.webPort}!`))



        //// Setup DHT (do not use host option)
        if (opts.bobNodeId === undefined) { // bobNodeId can be overridden
            opts.bobNodeId = randombytes(myenv.nodeIdLen)
        }
        if (opts.locHash !== undefined ) {
            if (typeof opts.locHash !== 'string') throw new Error('locHash must be string')
            opts.bobNodeId = myenv.prefixGeohash(opts.locHash, opts.bobNodeId)
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
                nodeId: opts.bobNodeId,
                timeBucketOutdated: 900000, // 15min
                maxAge: 900000, // 15min
            })
            console.log(`nodeId: ${this.dht.nodeId.toString('hex')}`)

            // get my ip
            extIp(function (err, ip) {
                if (err) {
                    // every service in the list has failed, set ip to localip (cant use hostname)
                    this.myHostAndPort = Ip.address() + ':' + this.dhtPort
                }
                this.myHostAndPort = ip + ':' + this.dhtPort
                console.log(`my ip and port: ${this.myHostAndPort}`);
            }.bind(this));

            opts.onInit() // init finished
        })
    }

    readNamespaceUntilFail(name, retries=40) {
        return new Promise((resolve, reject) => {
            return this.k8sApi.readNamespace(name).then(
                (response) => {
                    setTimeout(() => {
                        console.log(`read still works - re-reading - ${retries} retries left`)
                        if (retries < 1) return reject('max retries exceeded')
                        return this.readNamespaceUntilFail(name, retries-1).then(resolve,reject)
                    }, 500)
                },
                (err) => {
                    return resolve('namespace read failed successfully')
                },
            ).catch((reason) => {
                return reject('\n\ncatch while waiting for k8s to die')
            })
        })
    }

    cleanupK8s(token) {
        this.k8sApi.deleteNamespace(token, undefined, undefined, 0, undefined, 'Foreground').then(
            (response) => {
                console.log('deleted namespace');
                return this.k8sCertApi.deleteCertificateSigningRequest(token)
            },
            (err) => {
                console.log('\n\nerror deleting namespace'.yellow);
                console.log(err.response.body.message);
            },
        ).then(
            (response) => {
                console.log('deleted csr');
                return this.readNamespaceUntilFail(token)
            },
            (err) => {
                console.log('\n\nerror deleting csr'.yellow);
                console.log(err.response.body.message);
            },
        ).then(() => {
                console.log('namespace fully deleted');
        }).catch(err => {
            console.log('\n\nerror deleting things'.yellow)
            console.log(err)
        })
    }

    provisionUser(token) {
        var customer = this.customerMap.get(token)
        var csr = customer.csr
        var res = customer.csrRes

        var hrstart = process.hrtime()

        //// privision user - https://docs.bitnami.com/tutorials/configure-rbac-in-your-kubernetes-cluster/
        //// provision user - https://kubernetes.io/docs/reference/access-authn-authz/certificate-signing-requests/
        console.log("Provisioning user with csr: " + csr)

        const csrRequest=`
        apiVersion: certificates.k8s.io/v1
        kind: CertificateSigningRequest
        metadata:
          name: ${token}
        spec:
          groups:
          - system:authenticated
          signerName: kubernetes.io/kube-apiserver-client
          request: "${csr}"
          usages:
          - client auth
        `
        const yamlCsrRequest = k8s.loadYaml(csrRequest);

        const csrApprove=`
        ${csrRequest}
        status:
          conditions:
          - message: "Approved by Angler"
            reason: "ApprovedByAngler"
            type: "Approved"
            status: "True"
        `
        const yamlCsrApprove = k8s.loadYaml(csrApprove);

        const role=`
        kind: Role
        apiVersion: rbac.authorization.k8s.io/v1
        metadata:
          namespace: ${token}
          name: ${token}
        rules:
        - apiGroups: ["", "extensions", "apps"]
          resources: ["deployments", "replicasets", "pods"]
          verbs: ["*"]
        `
        const yamlRole = k8s.loadYaml(role);

        const roleBinding=`
        kind: RoleBinding
        apiVersion: rbac.authorization.k8s.io/v1
        metadata:
          name: ${token}-binding
          namespace: ${token}
        subjects:
        - kind: User
          name: ${token}admin # user account
          apiGroup: ""
        roleRef:
          kind: Role
          name: ${token}
          apiGroup: ""
        `
        const yamlRoleBinding = k8s.loadYaml(roleBinding);


        this.k8sCertApi.createCertificateSigningRequest(yamlCsrRequest).then(
            (response) => {
                console.log('created CSR');
                return this.k8sCertApi.replaceCertificateSigningRequestApproval(token, yamlCsrApprove)
            },
        ).then(
            (response) => {
                console.log('updated CSR approval');
                return this.k8sRoleApi.createNamespacedRole(token, yamlRole)
            },
        ).then(
            (response) => {
                console.log('created namespace role');
                return this.k8sRoleApi.createNamespacedRoleBinding(token, yamlRoleBinding)
            },
        ).then(
            (response) => {
                console.log('created namespace role binding');
                return this.k8sCertApi.readCertificateSigningRequestStatus(token)
            },
        ).then(
            (response) => {
                console.log('got client cert');

                var user = `${token}admin`
                var clusterName = this.kc.contexts[0].cluster
                var clientCert = response.body.status.certificate
                var clusterCa = this.kc.clusters[0].caData
                if (clusterCa === undefined) {
                    if (this.kc.clusters[0].caFile !== undefined) {
                        clusterCa = fs.readFileSync(this.kc.clusters[0].caFile).toString('base64')
                        console.log(clusterCa)
                    } else {
                        console.log('cant access ca data'.red)
                        this.onErr(token)
                    }
                }
                var clusterEndpoint = this.kc.clusters[0].server

                const kubeconfTemplate=`
                apiVersion: v1
                kind: Config
                clusters:
                - cluster:
                    certificate-authority-data: "${clusterCa}"
                    server: "${clusterEndpoint}"
                  name: "${clusterName}"
                users:
                - name: "${user}"
                  user:
                    client-certificate-data: "${clientCert}"
                    client-key-data: "SeNtInAl"
                contexts:
                - context:
                    cluster: "${clusterName}"
                    user: "${user}"
                  name: "${user}-${clusterName}"
                current-context: "${user}-${clusterName}"
                `
                //console.log("kubeconfig: " + kubeconfTemplate)

                var hrend = process.hrtime(hrstart)
                console.log(`SeNtInAl,barbox,nodejs,provision_user,Bob,${hrend[0]+(hrend[1]/1e9)}`)

                console.log('Sending client signed cert');
                res.json({
                    kubeconfig: kubeconfTemplate
                })
                //res.send("Here is kubeconfig from " + hostname)

                //var customer = this.customerMap.get(token) // is this needed?
                customer.state = StateEnum.FullyProvisioned
                //this.customerMap.set(token, customer) // is this needed?
                this.onSuc(token)
            },
        ).catch(reason => {
            console.log('error in user provisioning promise chain'.red)
            if (reason && reason.response && reason.response.body && reason.response.body.message) {
                console.log(reason.response.body.message);
            } else {
                console.log(reason)
            }
            res.json({
                kubeconfig: 'fail'
            })
        })
    }

    async provisionNamespace(token, parties, winnerIndex, winnerPrice) {
        var customer = this.customerMap.get(token)
        var crdDef = this.crdMap.get(customer.crdHash)
        var hrstart = process.hrtime()

        console.log(`Provisioning namespace ${token}`)
        // https://platform9.com/blog/kubernetes-multi-tenancy-best-practices/

        const namespace=`
        apiVersion: v1
        kind: Namespace
        metadata:
          name: ${token}
        `
        const yamlNamespace = k8s.loadYaml(namespace);

        const networkPolicy=`
        kind: NetworkPolicy
        apiVersion: networking.k8s.io/v1
        metadata:
          name: block-external-namepsace-traffic
        spec:
          podSelector:
            matchLabels:
          ingress:
          - from:
            - podSelector: {}
        `
        const yamlNetworkPolicy = k8s.loadYaml(networkPolicy);

        const resourceQuota=`
        kind: ResourceQuota
        apiVersion: v1
        metadata:
          name: ${token}
        spec:
          hard:
            limits.cpu: ${crdDef.cpuLimit}
            limits.memory: ${crdDef.memLimit}
        `
        const yamlResourceQuota = k8s.loadYaml(resourceQuota);

        this.k8sApi.createNamespace(yamlNamespace).then(
            (response) => {
                console.log('created namespace');
                return this.k8sNetworkApi.createNamespacedNetworkPolicy(token, yamlNetworkPolicy)
            },
        ).then(
            (response) => {
                console.log('created namespace network policy');
                return this.k8sApi.createNamespacedResourceQuota(token, yamlResourceQuota)
            },
        ).then(
            (response) => {
                console.log('created resource quota');
                var hrend = process.hrtime(hrstart)
                console.log(`SeNtInAl,barbox,nodejs,provision_ns,Bob,${hrend[0]+(hrend[1]/1e9)}`)

                //var customer = this.customerMap.get(token)

                if (customer.state == StateEnum.Ready) {
                    customer.state = StateEnum.NamespaceCreated
                    //this.customerMap.set(token, customer) // is this needed?
                } else if (customer.state == StateEnum.MakeUserToo) {
                    this.provisionUser(token)
                    console.log('finished post mode recovery')
                } else {
                    console.log('\n\nerror unknown state after creating namespace')
                }
            },
        ).catch(reason => {
            console.log('\n\nerror in namespace provisioning promise chain'.red)
            if (reason && reason.response && reason.response.body && reason.response.body.message) {
                console.log(reason.response.body.message);
            } else {
                console.log(reason)
            }
        })
    }


    async runMPC(token, parties) {
        console.log('running MPC with:')
        console.log(parties)

        var customer = this.customerMap.get(token)
        var crdDef = this.crdMap.get(customer.crdHash)

        var bid = Parser.evaluate(crdDef.secretPriceFunc, { q: crdDef.secretQuantity, r: crdDef.secretQuantityRemaining });
        console.log(`bidding: ${bid}`)

        var hrstart = process.hrtime()

        var myIndex = parties.indexOf(this.myHostAndPort) + 1 // 1 indexed :(
        if (myIndex == 0) {
            console.log(`cant find myself (${this.myHostAndPort}) in list of MPC participants`)
            console.log('trying looking for localhost...')
            myIndex = parties.indexOf(`${Ip.address()}:${this.dhtPort}`) + 1 // 1 indexed :(
            if (myIndex == 0) {
                console.log(`cant find myself (${Ip.address()}:${this.dhtPort}) in list of MPC participants`)

                console.log('trying localhost...')
                myIndex = parties.indexOf(`127.0.0.1:${this.dhtPort}`) + 1 // 1 indexed :(
                if (myIndex == 0) {
                    console.log(`cant find myself 127.0.0.1:${this.dhtPort} in list of MPC participants`)
                    console.log(`fatal... shutting down`)
                    this.shutdown(this.onErr(token))
                    return
                }
            }
        }

        const ips = [];
        const ports = [];
        for (var i=0; i<parties.length; i++) {
            const partyIpDhtport = parties[i].split(':')
            ips.push(partyIpDhtport[0])
            ports.push(parseInt(partyIpDhtport[1])+2) // mpc port is offset by 2
        }
        const capacity = crdDef.secretQuantityRemaining;
        console.log(`capacity: ${capacity}`)
        const res = binding.agmpc_matcher_napi(ips, ports, myIndex, parseInt(capacity), parseInt(bid));
        const winnerIndex = res[0];
        const winnerPrice = res[1];
        if (!winnerIndex || !winnerPrice) {
            console.log('mpc failed')
            setTimeout(this.shutdown.bind(this, this.onErr), 30000)
            return
        } else if (winnerIndex == myIndex) {
            this.provisionNamespace(token, parties, winnerIndex, winnerPrice)
        }
    }

    listen(cb) {
        this.dht.listen(this.dhtPort, cb)
    }

    defineCrd(crdHash, cpuLimit, memLimit, secretQuantity, secretPriceFunc) { // TODO: lease time
        this.crdMap.set(crdHash, {
            cpuLimit: cpuLimit,
            memLimit: memLimit,
            secretQuantity: secretQuantity,
            secretQuantityRemaining: secretQuantity,
            secretPriceFunc: secretPriceFunc
        });
    }

    seed(crdHash) {
        if (this.crdMap.get(crdHash) === undefined) {
            console.error('crd not defined!')
            return
        }

        console.log('doing preseed lookup')
        this.dht.lookup(crdHash, (err, numNodesWPeers) => {
            if (err) {
                console.log('lookup error')
                console.log(err)
            }
            console.log(`seeding room: ${crdHash}`)
            this.dht.announce(crdHash, parseInt(this.dhtPort), () => {console.log(`annoucement complete on ${this.dhtPort}`)})
        })
    }

    shutdown(cb) {
        console.log("shutting down");

        setTimeout(() => {
            console.error('Could not finish in time, forcefully shutting down'.red)
            if(cb !== undefined) cb()
        }, 10000)

        this.server.close(() => {
            console.log('closed express app')

            this.dht.destroy( () => {
                console.log("DHT destroyed")
                if(cb !== undefined) cb()
            })
        })
    }
}

module.exports = Bob


// If called from the command line
if (require.main === module) {
    var cmdargs = process.argv.slice(2)
    if (cmdargs.length != 3) {
        console.log("Usage: " + process.argv[0] + process.argv[1] + " <port> <dht prefix> <seed infohash>")
        process.exit(1);
    }

    var bob = new Bob({
        dhtPort: cmdargs[0],
        webPort: parseInt(cmdargs[0]) + 1,
        mpcPort: parseInt(cmdargs[0]) + 2,
        locHash: cmdargs[1],
        onInit: () => {
            bob.dht.on('peer', (peer, infoHash, from) => {
                if (peer && from) {
                    console.log(`found peer ${peer.host}:${peer.port} through ${from.address}:${from.port}`)
                }
            })

            bob.listen( () => {
                var myInfoHash = myenv.prefixGeohash(cmdargs[1], cmdargs[2]).toString('hex')
                bob.defineCrd(myInfoHash, '200m', '128Mi', Math.floor(Math.random() * 8)+6, '(2*(q-r))+20')
                for (var i=0; i<20; i++) {
                    setTimeout(() => { bob.seed(myInfoHash)}, i*1000)
                }
                setInterval(() => { bob.seed(myInfoHash)}, 5*60*1000) // to stay in dht
            })
        },
        onSuc: (token) => {
            // remove from customer map
            bob.customerMap.delete(token)
            // cleanup k8s - only for development purposes
            setTimeout(() => { bob.cleanupK8s(token) }, 1000)
        },
        onErr: (token) => {
            if (token !== undefined) {
                // remove from customer map
                bob.customerMap.delete(token)
            }
        }
    })

    process.on('SIGTERM', () => { bob.shutdown(process.exit) })
    process.on('SIGINT', () => { bob.shutdown(process.exit) })
}
