const binding = require('bindings')('agmpc_matcher_napi');
const { Worker, workerData, parentPort } = require('worker_threads')
//var async = require("async")

const numParties = 3;

const ips = [];
const ports = [];
for (var i=1; i<=numParties; ++i) {
  ips.push("127.0.0.1");
  ports.push(i*100 + 3000);
}

function runService(workerData) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(process.argv[1], { workerData });
    worker.on('message', resolve);
    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (code !== 0)
        reject(new Error(`Worker stopped with exit code ${code}`));
    })
  })
}

async function run() {
  const procs = [];
  for (var party=1; party<=ips.length; ++party) {
    console.log("starting party " + party);
    procs.push(runService([party, party*2]));
  }
  for (var party=1; party<=ips.length; ++party) {
    await procs[party];
  }
}

if (workerData) {
  const party = parseInt(workerData[0]);
  var bid;
  var capacity;
  if (party == 1) {
    bid = 0;
    capacity = 10;
  } else {
    bid = parseInt(workerData[1]);
    capacity = bid*2;
  }
  const res = binding.agmpc_matcher_napi(ips, ports, party, capacity, bid, 0);
  const winningParty = res[0];
  const winningBid = res[1];
  console.log(`JS got result: ${winningParty} ${winningBid}`)
  parentPort.postMessage(res);
} else {
  run().catch(err => console.error(err))
}
