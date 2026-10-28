import dns from "node:dns";
dns.setServers(["8.8.8.8","1.1.1.1"]);
import mongoose from "mongoose";
await mongoose.connect(process.env.MONGO_URI);
const c = await mongoose.connection.db.collection("customers").findOne({ _id: new mongoose.Types.ObjectId("6ade52cec9ac0f7e95d64717") });
console.log(JSON.stringify({ name: c.name, category: c.category, siteType: c.siteType, siteNotes: c.siteNotes, roofArea: c.roofArea, loan: c.loan, creditCheck: c.creditCheck, deal: c.deal, nameMatch: c.nameMatch }, null, 1));
await mongoose.disconnect();
