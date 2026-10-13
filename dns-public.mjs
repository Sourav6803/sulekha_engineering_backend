/**
 * Local-development DNS workaround (not part of the app).
 *
 * The router's DNS (10.225.241.89) refuses SRV queries, so Node's c-ares
 * resolver fails with:
 *     querySrv ECONNREFUSED _mongodb._tcp.cluster0.ffmnsa4.mongodb.net
 * and the MongoDB driver never connects. Windows' own resolver and the
 * public resolvers answer the same query fine.
 *
 * Point Node's resolver at public DNS for local runs only:
 *     node --dns-result-order=ipv4first --import ./dns-public.mjs src/server.js
 *
 * To remove this from the picture permanently either fix the router's DNS,
 * or replace MONGO_URI with the non-SRV form (the three shard hosts are
 * already listed in the SRV answer), so no SRV lookup is needed at all.
 */
import dns from 'node:dns';

dns.setServers(['8.8.8.8', '1.1.1.1']);
