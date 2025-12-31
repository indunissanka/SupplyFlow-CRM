#!/usr/bin/env node

/**
 * Script to initialize admin user in Cloudflare D1 database
 * This can be run after deployment to ensure admin user exists
 */

import { createCipheriv } from 'crypto';

// Simple password hashing function matching the worker's hashPassword
const encoder = new TextEncoder();
const PASSWORD_HASH_PREFIX = "pbkdf2";
const PASSWORD_HASH_ITERATIONS = 120_000;

const hexToBytes = (hex) => {
  const cleaned = hex.trim();
  const pairs = cleaned.match(/.{1,2}/g) ?? [];
  return new Uint8Array(pairs.map((byte) => Number.parseInt(byte, 16)));
};

const bytesToHex = (bytes) =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const randomSalt = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

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
  const email = process.argv[2] || "mark.wu@taicounty.com.tw";
  const password = process.argv[3] || "admin";
  const name = process.argv[4] || "Admin";
  
  console.log(`Initializing admin user: ${email}`);
  console.log(`Note: This script is for reference. To actually run, you need to:`);
  console.log(`1. Connect to your Cloudflare D1 database`);
  console.log(`2. Run the SQL commands manually or via wrangler`);
  console.log(`\nSQL to check if user exists:`);
  console.log(`SELECT COUNT(*) as count FROM users WHERE email = '${email.toLowerCase()}';`);
  
  console.log(`\nSQL to create admin user (if not exists):`);
  const salt = randomSalt();
  const hash = await hashPassword(password, salt);
  const defaultAccessList = JSON.stringify(["tags", "companies", "contacts", "products", "pricing", "orders", "quotations", "invoices", "documents", "shipping", "sample_shipments", "tasks", "notes", "settings"]);
  
  console.log(`
INSERT OR IGNORE INTO users (email, name, role, access, access_list, password_hash, password_salt, enabled, created_at, updated_at)
VALUES (
  '${email.toLowerCase()}',
  '${name}',
  'Admin',
  '',
  '${defaultAccessList}',
  '${hash}',
  '${salt}',
  1,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);
  `);
  
  console.log(`\nTo run this via wrangler:`);
  console.log(`npx wrangler d1 execute crm-cloudflare-app-db --command "INSERT OR IGNORE INTO users ..."`);
}

main().catch(console.error);