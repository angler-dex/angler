const k8s = require('@kubernetes/client-node')
const angler = require('./index.js')
const DHT = require('bittorrent-dht')
const simpleSha1 = require('simple-sha1') // in dht
const colors = require('colors')
const fs = require('fs')
const HashMap = require('hashmap');

// example https://github.com/kubernetes-client/javascript/blob/master/examples/typescript/watch/watch-example.ts

const nodeIdLen = 20

class AkriDEXOperator {
    constructor() {
        this.kc = new k8s.KubeConfig()
        this.kc.loadFromDefault()
        this.k8sApi = this.kc.makeApiClient(k8s.CoreV1Api)
        this.k8sRoleApi = this.kc.makeApiClient(k8s.RbacAuthorizationV1Api)
        this.k8sExtensionsApi = this.kc.makeApiClient(k8s.ApiextensionsV1Api);

        var portStart = process.env.PORT_START ? process.env.PORT_START : 7700

        this.seedMap = new HashMap();

        this.bob = new angler.Bob({
            dhtPort: parseInt(portStart),
            webPort: parseInt(portStart) + 1,
            mpcPort: parseInt(portStart) + 2,
            locHash: process.env.LOC_PREFIX ? process.env.LOC_PREFIX : undefined,
            onSuc: (token) => {
                console.log("successful auction callback")
                // cleanup k8s - only for development purposes
                //setTimeout(() => { bob.cleanupK8s(token) }, 1000)
            }
        })

        // test kubeconfig (needs namespace read role in cluster)
        //this.k8sApi.readNamespace('default').then(
        //    (response) => {
        //        console.log(`k8s conf works`)
        //        //console.log(response)
        //    },
        //    (err) => {
        //        console.log('k8s conf does not work')
        //        return;
        //    },
        //).catch((reason) => {
        //    console.log('k8s conf does not work - exception thrown')
        //    return;
        //})

    }

    async start() {
        // Create CRD
        const crdFile = `${__dirname}/../kubernetes/PoolContributionCRDv1.yaml`
        const crdYaml = fs.readFileSync(crdFile, {encoding:'utf8', flag:'r'})
        const crdDef = k8s.loadYaml(crdYaml);
        // NOTE: Operator creating it's own CRD requires special ClusterRole.
        // Instead of requiring the user to give AkriDEX this powerful permission, let them create CRD themselves.
        //await this.k8sExtensionsApi.createCustomResourceDefinition(crdDef).catch((reason) => {
        //    console.log('could not create crd'.red)
        //    if (reason && reason.response && reason.response.body && reason.response.body.message) {
        //        console.log(reason.response.body.message);
        //    } else {
        //        console.log(reason)
        //    }
        //    return;
        //});

        console.log(`registered ${crdDef.metadata.name}`)
        console.log(`plural ${crdDef.spec.names.plural}`)
        console.log(`group ${crdDef.spec.group}`)
        console.log(`version ${crdDef.spec.versions[0].name}`)

        this.crdName = crdDef.metadata.name
        this.crdPlural = crdDef.spec.names.plural
        this.crdGroup = crdDef.spec.group
        this.crdVersion = crdDef.spec.versions[0].name

        var myBob = this.bob

        const watch = new k8s.Watch(this.kc)
        this.watchReq = watch.watch(`/apis/${this.crdGroup}/${this.crdVersion}/${this.crdPlural}`,
            {}, // optional query parameters
            (phase, apiObj, watchObj) => {
                if (!apiObj || !apiObj.spec) {
                    console.log('bad obj!')
                    return
                }

                const uid = apiObj.metadata.uid
                const cpu = apiObj.spec.cpu
                const mem = apiObj.spec.memory
                const loc = apiObj.spec.location
                const secretQuantity = apiObj.spec.secretQuantity
                const secretPriceFunc = apiObj.spec.secretPriceFunc

                var toHash = Buffer.concat([Buffer.from(cpu), Buffer.from(mem)])
                var infoHash = Buffer.from(simpleSha1.sync(toHash.slice(0,nodeIdLen/2)), 'hex')
                console.log(`unprefixed PoolUnit infoHash: ${infoHash.toString('hex')}`)
                infoHash = Buffer.concat([Buffer.from(loc), infoHash.slice(loc.length)]).toString('hex')
                console.log(`prefixed PoolUnit infoHash: ${infoHash}`)

                if (phase === 'ADDED') {
                    console.log('new object');
                    myBob.defineCrd(infoHash, cpu, mem, secretQuantity, secretPriceFunc)
                    myBob.seed(infoHash)
                    setTimeout(() => { this.bob.seed(infoHash)}, 2*1000)
                    setTimeout(() => { this.bob.seed(infoHash)}, 3*1000)
                    var timer = setInterval(() => { this.bob.seed(infoHash)}, 5*60*1000) // to stay in dht
                    this.seedMap.set(uid, timer)

                } else if (phase === 'MODIFIED') {
                    console.log('changed object');
                    console.log('not implemented');

                } else if (phase === 'DELETED') {
                    console.log('deleted object');
                    var timer = this.seedMap.get(uid)
                    clearInterval(timer) // stop seeding dht
                    this.seedMap.delete(uid)

                } else if (phase === 'BOOKMARK') {
                    console.log(`bookmark: ${watchObj.metadata.resourceVersion}`);

                } else {
                    console.log('got unknown phase: ' + phase);

                }
            },
            () => {
                console.log('done')
            },
            (err) => {
                if (err) {
                    console.log('watch error')
                    console.log(err)
                }
                console.log('done watching')
            }
        )
    }

    async stop(cb) {
        console.log("stoping")

        if (this.watchReq !== undefined) {
            this.watchReq.then((req) => {
                req.abort();
            })
            console.log('aborted watchReq')
        } else {
            console.log('no watchReq to abort')
        }

        // Delete CRD
        //if (this.crdName !== undefined) {
        //    await this.k8sExtensionsApi.deleteCustomResourceDefinition(this.crdName);
        //    console.log('deleted crd')
        //} else {
        //    console.log('no crd to delete')
        //}
        if(cb !== undefined) cb()
    }
}


const o = new AkriDEXOperator()
o.start()

process.on('SIGTERM', () => { o.stop(process.exit) })
process.on('SIGINT', () => { o.stop(process.exit) })
