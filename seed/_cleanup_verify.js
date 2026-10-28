// seed/_cleanup_verify.js — remove anything the verification run left behind.
import { connectDB, disconnectDB } from '../src/config/db.js';
import { Customer, Application } from '../src/models/index.js';

const TEST_PHONE = '9000000001';

const run = async () => {
  await connectDB();

  // Match on every identifier the verification data uses: a crashed run can
  // leave a record whose phone differs but whose Aadhaar is the same.
  const apps = await Application.deleteMany({
    $or: [
      { phone: TEST_PHONE },
      { aadhaarNumber: '123456789012' },
      { consumerName: /^VERIFY Customer / },
    ],
  });
  const cust = await Customer.deleteMany({
    $or: [
      { phone: TEST_PHONE },
      { aadhaarNumber: '123456789012' },
      { name: /^VERIFY Customer / },
    ],
  });

  console.log(`removed ${apps.deletedCount} application(s), ${cust.deletedCount} customer(s)`);
  await disconnectDB();
};

run().catch(async (error) => {
  console.error(error);
  await disconnectDB();
  process.exitCode = 1;
});
