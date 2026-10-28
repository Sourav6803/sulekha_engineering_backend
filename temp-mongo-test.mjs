import dns from "node:dns";
dns.setServers(["8.8.8.8","1.1.1.1"]);
const { MongoClient } = await import("mongodb");
const uri = process.env.MONGO_URI;
console.log("uri scheme:", String(uri).slice(0, 14));
const c = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
try { await c.connect(); console.log("CONNECTED"); await c.close(); }
catch (e) { console.log("FAIL:", e.name, "|", e.message.slice(0, 300)); process.exit(0); }
