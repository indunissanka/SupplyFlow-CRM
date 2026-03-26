#!/usr/bin/env node
// Reset a user's password directly in MongoDB — no current password needed.
// Usage: node scripts/reset-password.js <email> <new-password>
// Docker: docker exec mango-crm node scripts/reset-password.js admin@example.com newpass123

import { MongoClient } from 'mongodb';

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME   = process.env.MONGODB_DB_NAME || 'crmmango';

const encoder = new TextEncoder();
const bytesToHex = (b) => Array.from(b).map(x => x.toString(16).padStart(2,'0')).join('');
const hexToBytes = (h) => new Uint8Array(h.trim().match(/.{1,2}/g).map(b => parseInt(b,16)));

async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: hexToBytes(salt), iterations: 100_000 },
    key, 256
  );
  return `pbkdf2$100000$${bytesToHex(new Uint8Array(derived))}`;
}

async function main() {
  const [,, email, password] = process.argv;
  if (!email || !password) {
    console.error('Usage: node scripts/reset-password.js <email> <new-password>');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Password must be at least 8 characters');
    process.exit(1);
  }

  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);

  const normalizedEmail = email.trim().toLowerCase();
  const user = await db.collection('users').findOne({ email: normalizedEmail });
  if (!user) {
    console.error(`No user found with email: ${normalizedEmail}`);
    await client.close();
    process.exit(1);
  }

  const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const hash = await hashPassword(password, salt);

  await db.collection('users').updateOne(
    { email: normalizedEmail },
    { $set: { password_hash: hash, password_salt: salt } }
  );

  console.log(`Password reset for ${normalizedEmail} (role: ${user.role})`);
  await client.close();
}

main().catch(err => { console.error(err.message); process.exit(1); });
