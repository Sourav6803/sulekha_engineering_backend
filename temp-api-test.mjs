import dns from "node:dns";
dns.setServers(["8.8.8.8","1.1.1.1"]);
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
await mongoose.connect(process.env.MONGO_URI);
const admin = await mongoose.connection.db.collection("users").findOne({ role: "admin" });
if (!admin) { console.log("no admin user"); process.exit(0); }
const token = jwt.sign({ id: admin._id.toString(), role: admin.role, typ: "access" }, process.env.JWT_SECRET, { expiresIn: "10m" });
const customer = await mongoose.connection.db.collection("customers").findOne({ customerId: "SE-0028" });
const res = await fetch("http://localhost:9000/api/v1/applications", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify({ customer: customer._id.toString() }),
});
console.log("STATUS", res.status);
console.log((await res.text()).slice(0, 600));
await mongoose.disconnect();

