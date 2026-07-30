const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password_hash: { type: String, required: true },
  created_at: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

async function initializeDatabase() {
  const mongoURI = process.env.MONGODB_URI;
  if (!mongoURI) throw new Error('MONGODB_URI missing');
  await mongoose.connect(mongoURI);
  console.log('✅ Connected to MongoDB Atlas');
}

async function getUserByEmail(email) {
  return await User.findOne({ email: email.toLowerCase() });
}

async function createUser(email, password) {
  const existing = await getUserByEmail(email);
  if (existing) throw new Error('Email already registered');
  const hash = await bcrypt.hash(password, 10);
  const user = new User({ email: email.toLowerCase(), password_hash: hash });
  await user.save();
  return { id: user._id, email: user.email };
}

async function verifyUser(email, password) {
  const user = await getUserByEmail(email);
  if (!user) return null;
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return null;
  return { id: user._id, email: user.email };
}

module.exports = { initializeDatabase, getUserByEmail, createUser, verifyUser };