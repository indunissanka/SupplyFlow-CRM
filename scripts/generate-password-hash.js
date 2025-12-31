#!/usr/bin/env node

/**
 * Password hash generator for CRM Cloudflare App
 * Generates password hash compatible with the worker's hashPassword function
 */

const encoder = new TextEncoder();

const PASSWORD_HASH_PREFIX = "pbkdf2";
const PASSWORD_HASH_ITERATIONS = 120000;

function hexToBytes(hex) {
  const cleaned = hex.trim();
  const pairs = cleaned.match(/.{1,2}/g) ?? [];
  return new Uint8Array(pairs.map((byte) => parseInt(byte, 16)));
}

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomSalt() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hashPassword(password, salt, iterations = PASSWORD_HASH_ITERATIONS) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: hexToBytes(salt),
      iterations
    },
    key,
    256
  );
  const hash = bytesToHex(new Uint8Array(derived));
  return `${PASSWORD_HASH_PREFIX}$${iterations}$${hash}`;
}

async function main() {
  const password = process.argv[2] || "1@Nissanka";
  const email = process.argv[3] || "mark.wu@taicounty.com.tw";
  const name = process.argv[4] || "Admin";
  
  console.log(`Generating password hash for: ${password}`);
  
  const salt = randomSalt();
  const hash = await hashPassword(password, salt);
  
  console.log("\nGenerated credentials:");
  console.log(`Email: ${email}`);
  console.log(`Password: ${password}`);
  console.log(`Salt: ${salt}`);
  console.log(`Hash: ${hash}`);
  
  console.log("\nSQL to create/update user:");
  const defaultAccessList = JSON.stringify(["tags", "companies", "contacts", "products", "pricing", "orders", "quotations", "invoices", "documents", "shipping", "sample_shipments", "tasks", "notes", "settings"]);
  
  console.log(`
-- Check if user exists
SELECT * FROM users WHERE email = '${email.toLowerCase()}';

-- Create or update user
INSERT OR REPLACE INTO users (email, name, role, access, access_list, password_hash, password_salt, enabled, created_at, updated_at)
VALUES (
  '${email.toLowerCase()}',
  '${name}',
  'Admin',
  '',
  '${defaultAccessList}',
  '${hash}',
  '${salt}',
  1,
  COALESCE((SELECT created_at FROM users WHERE email = '${email.toLowerCase()}'), CURRENT_TIMESTAMP),
  CURRENT_TIMESTAMP
);
  `);
  
  console.log("\nTo execute via wrangler:");
  console.log(`npx wrangler d1 execute crm-cloudflare-app-db --command "INSERT OR REPLACE INTO users ..."`);
  
  console.log("\nAlternative: Update password only if user exists:");
  console.log(`UPDATE users SET password_hash = '${hash}', password_salt = '${salt}', updated_at = CURRENT_TIMESTAMP WHERE email = '${email.toLowerCase()}';`);
}

// Check if running in Node.js with crypto support
if (typeof crypto === 'undefined') {
  console.error("Error: crypto module not available. Running in Node.js?");
  console.error("Try: node scripts/generate-password-hash.js");
  process.exit(1);
}

main().catch(console.error);