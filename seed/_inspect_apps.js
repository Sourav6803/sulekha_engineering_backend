// Read-only: why the list count differs from the raw collection.
import { connectDB, disconnectDB } from '../src/config/db.js';
import { Application, User } from '../src/models/index.js';

const run = async () => {
  await connectDB();

  const all = await Application.find({}).select('applicationNo status agent deletedAt isDeleted createdAt').lean();
  console.log('TOTAL', all.length);
  const flags = all.filter((a) => a.deletedAt || a.isDeleted);
  console.log('soft-deleted', flags.length);

  const users = await User.find({}).select('name email role').lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));

  const grouped = {};
  for (const a of all) {
    const key = String(a.agent);
    grouped[key] = grouped[key] || { count: 0, statuses: [], no: [] };
    grouped[key].count += 1;
    grouped[key].statuses.push(a.status);
    grouped[key].no.push(a.applicationNo);
  }

  console.log('\nBY AGENT');
  for (const [id, info] of Object.entries(grouped)) {
    const u = byId.get(id);
    console.log(`  ${u ? `${u.email} (${u.role})` : id} → ${info.count} :: ${info.no.join(', ')} :: ${info.statuses.join(', ')}`);
  }

  await disconnectDB();
};

run().catch(async (e) => {
  console.error('ERR', e.message);
  await disconnectDB().catch(() => {});
  process.exit(1);
});
