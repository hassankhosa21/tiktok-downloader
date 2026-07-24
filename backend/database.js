// backend/database.js (Unified - JSON for local, MongoDB for production)
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_FILE = path.join(__dirname, 'hassan_labs.json');

// ============================================
// JSON HELPERS (Local Development)
// ============================================
function readDB() {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify({ users: [] }, null, 2));
    }
    const data = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(data);
}

function writeDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// ============================================
// MONGODB (Production)
// ============================================
let mongoose;
let User;

if (process.env.NODE_ENV === 'production') {
    mongoose = require('mongoose');
    const userSchema = new mongoose.Schema({
        email: { type: String, required: true, unique: true },
        password_hash: { type: String, required: true },
        created_at: { type: Date, default: Date.now }
    });
    User = mongoose.model('User', userSchema);
}

// ============================================
// DATABASE FUNCTIONS (Works with both)
// ============================================
async function initializeDatabase() {
    if (process.env.NODE_ENV === 'production') {
        const mongoURI = process.env.MONGODB_URI;
        if (!mongoURI) {
            throw new Error('MONGODB_URI is not defined in .env file');
        }
        await mongoose.connect(mongoURI);
        console.log('✅ Connected to MongoDB Atlas (Production)');
    } else {
        readDB(); // ensure file exists
        console.log('✅ Using local JSON database (Development)');
    }
    return true;
}

async function getUserByEmail(email) {
    if (process.env.NODE_ENV === 'production') {
        return await User.findOne({ email });
    } else {
        const db = readDB();
        return db.users.find(user => user.email === email);
    }
}

async function createUser(email, password) {
    const hashedPassword = await bcrypt.hash(password, 10);
    if (process.env.NODE_ENV === 'production') {
        const existing = await getUserByEmail(email);
        if (existing) throw new Error('Email already registered');
        const user = new User({ email, password_hash: hashedPassword });
        await user.save();
        return { id: user._id, email: user.email };
    } else {
        const db = readDB();
        if (db.users.find(user => user.email === email)) {
            throw new Error('Email already registered');
        }
        const newUser = {
            id: Date.now(),
            email,
            password_hash: hashedPassword,
            created_at: new Date().toISOString()
        };
        db.users.push(newUser);
        writeDB(db);
        return { id: newUser.id, email: newUser.email };
    }
}

async function verifyUser(email, password) {
    const user = await getUserByEmail(email);
    if (!user) return null;
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) return null;
    return { id: user.id, email: user.email };
}

module.exports = { initializeDatabase, getUserByEmail, createUser, verifyUser };