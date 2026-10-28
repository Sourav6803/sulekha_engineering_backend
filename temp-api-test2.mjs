import dns from "node:dns";
dns.setServers(["8.8.8.8","1.1.1.1"]);
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
await mongoose.connect(process.env.MONGO_URI);
const admin = await mongoose.connection.db.collection("users").findOne({ role: "admin" });
const token = jwt.sign({ id: admin._id.toString(), role: admin.role, typ: "access" }, process.env.JWT_SECRET, { expiresIn: "15m" });
const customer = await mongoose.connection.db.collection("customers").findOne({ customerId: "SE-0028" });
const call = async (method, path, body) => {
  const res = await fetch(`http://localhost:9000/api/v1${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  console.log(method, path, "->", res.status, text.slice(0, 260));
  try { return JSON.parse(text); } catch { return null; }
};
await call("POST", `/customers/${customer._id}/verify`, { status: "verified" });
const created = await call("POST", "/applications", { customer: customer._id.toString() });
const id = created?.data?._id;
if (id) await call("DELETE", `/applications/${id}`);
await mongoose.disconnect();
