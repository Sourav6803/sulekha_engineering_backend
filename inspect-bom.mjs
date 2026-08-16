import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config({ path: './.env' });
const uri = process.env.MONGO_URI;
mongoose.set('serverSelectionTimeoutMS', 15000);
mongoose.set('connectTimeoutMS', 15000);
try {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000, connectTimeoutMS: 15000 });
} catch (e) { console.log('CONNECT FAILED:', e.message); process.exit(1); }
const db = mongoose.connection.db;
const names = await db.listCollections().toArray();
console.log('COLLECTIONS:', names.map(n=>n.name).join(', '));
const col = db.collection('bomtemplates');
console.log('COUNT BY roofType:', JSON.stringify(await col.aggregate([{$group:{_id:'$roofType',n:{$sum:1}}}]).toArray()));
console.log('DISTINCT roofType:', JSON.stringify(await col.distinct('roofType')));
console.log('--- TIN_SHED distinct systemSizeKW ---');
console.log(JSON.stringify(await col.distinct('systemSizeKW', {roofType:'tin_shed'})));
console.log('--- TIN_SHED distinct sections ---');
console.log(JSON.stringify(await col.distinct('section', {roofType:'tin_shed'})));
console.log('--- TIN_SHED templateNames ---');
console.log(JSON.stringify(await col.distinct('templateName', {roofType:'tin_shed'})));
console.log('--- TIN_SHED sample (2 docs, trimmed) ---');
const t = await col.find({roofType:'tin_shed'}).limit(2).toArray();
console.log(JSON.stringify(t.map(d=>({_id:d._id, templateName:d.templateName, section:d.section, systemSizeKW:d.systemSizeKW, material:d.material, qtyFormula:d.qtyFormula, materialName:d.materialName, materialCode:d.materialCode, isOptional:d.isOptional, isActive:d.isActive, createdBy:d.createdBy})), null, 1));
await mongoose.disconnect();
