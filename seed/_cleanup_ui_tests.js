// seed/_cleanup_ui_tests.js — remove the throwaway customers created while
// testing the New customer page. The demo record (Ramesh Mondal) is kept.
import { connectDB, disconnectDB } from '../src/config/db.js';
import { Customer, Application } from '../src/models/index.js';

const run = async () => {
  await connectDB();

  const customers = await Customer.find({ name: /^Test / }).select('_id name customerId').lean();
  for (const row of customers) console.log(`- ${row.customerId} ${row.name}`);

  const ids = customers.map((row) => row._id);
  const apps = await Application.deleteMany({ customer: { $in: ids } });
  const gone = await Customer.deleteMany({ _id: { $in: ids } });

  console.log(`removed ${gone.deletedCount} customer(s) and ${apps.deletedCount} application(s)`);
  console.log(`remaining customers: ${await Customer.countDocuments()}`);
  console.log(`remaining applications: ${await Application.countDocuments()}`);

  await disconnectDB();
};

run().catch(async (error) => {
  console.error(error);
  await disconnectDB();
  process.exitCode = 1;
});
