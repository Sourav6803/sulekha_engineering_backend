// Read-only: who exists, and where the three applications came from.
import { connectDB, disconnectDB } from '../src/config/db.js';
import { User, Application } from '../src/models/index.js';

const run = async () => {
  await connectDB();

  const users = await User.find({}).select('name email role isActive').lean();
  const byRole = users.reduce((acc, u) => {
    acc[u.role] = (acc[u.role] || 0) + 1;
    return acc;
  }, {});

  console.log('USERS', users.length, JSON.stringify(byRole));
  for (const u of users) console.log(`  ${u.role.padEnd(16)} ${String(u.email).padEnd(34)} ${u.name}${u.isActive === false ? ' (inactive)' : ''}`);

  const apps = await Application.find({}).select('applicationNo status agent createdAt').populate('agent', 'name email').lean();
  console.log('\nAPPLICATIONS', apps.length);
  for (const a of apps) {
    console.log(`  ${a.applicationNo} | ${a.status} | agent=${a.agent ? a.agent.email : a.agent} | ${a.createdAt?.toISOString?.()}`);
  }

  await disconnectDB();
};

run().catch(async (e) => {
  console.error('ERR', e.message);
  await disconnectDB().catch(() => {});
  process.exit(1);
});
