import mongoose from 'mongoose';

const uri = 'mongodb+srv://rick07539:iw5HHRv4JdunwlUR@cluster0.ffmnsa4.mongodb.net/sulekha?retryWrites=true&w=majority';
const options = {
  maxPoolSize: 100,
  minPoolSize: 10,
  connectTimeoutMS: 30000,
  socketTimeoutMS: 45000,
  readPreference: 'secondaryPreferred',
  retryWrites: true,
  retryReads: true,
  w: 'majority',
  autoIndex: true,
  autoCreate: true,
  useNewUrlParser: true,
  useUnifiedTopology: true,
};

console.log('Starting mongoose.connect with ESM...');
try {
  await mongoose.connect(uri, options);
  console.log('MongoDB connected');
  await mongoose.disconnect();
} catch (err) {
  console.error('MongoDB error:', err.message);
}
