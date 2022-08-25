module.exports = {
  bootstrapHost: process.env.DHT_BOOTSTRAP_HOST ? process.env.DHT_BOOTSTRAP_HOST : 'localhost',
  // IPv6 addresses (or hostnames which resolve to IPv6) do not work. See
  // https://github.com/webtorrent/bittorrent-dht/issues/88
  bootstrapPort: process.env.DHT_BOOTSTRAP_PORT ? process.env.DHT_BOOTSTRAP_PORT : 20000,
  maxParticipants: 10,
  targetRuntime: Infinity, //us
  //targetRuntime: 600*1000, //us
  nodeIdLen: 20,
  onlyLookup: false,
  skipProvisioning: false,
  prefixGeohash: (geohash, str) => {
      return Buffer.concat([Buffer.from(geohash), Buffer.from(str, 'hex').slice(geohash.length)])
  }
}
