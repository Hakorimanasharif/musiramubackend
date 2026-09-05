import mongoose from 'mongoose';
const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/musiramu';
console.log('Connecting to', uri.replace(/:([^@]+)@/, ':****@'));
await mongoose.connect(uri);
const db = mongoose.connection.db;
const cols = await db.listCollections().toArray();
console.log('Before:', cols.map(c=>c.name).join(', '));
for (const name of ['customers','loans','logs','counters','users','shopprofiles']) {
  try { const r = await db.collection(name).deleteMany({}); console.log(`Wiped ${name}: ${r.deletedCount}`);} catch(e){ console.log(`skip ${name}`, e.message)}
}
const cols2 = await db.listCollections().toArray();
console.log('After:', cols2.map(c=>c.name).join(', '));
await mongoose.disconnect();
console.log('wipe all done for', uri.includes('cluster0') ? 'Atlas' : 'local');
