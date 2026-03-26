#!/usr/bin/env node

import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';
import { parse } from 'path';

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DB_NAME || 'crmcloudflare';

// Read SQL schema
const sqlSchema = readFileSync('./schema.sql', 'utf8');

// Parse SQL schema to extract table structures
function parseSQLSchema(sql) {
  const tables = {};
  const lines = sql.split('\n');
  let currentTable = null;
  let currentColumns = [];
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Start of CREATE TABLE
    if (trimmed.toUpperCase().startsWith('CREATE TABLE')) {
      const match = trimmed.match(/CREATE TABLE (?:IF NOT EXISTS )?(\w+)/i);
      if (match) {
        currentTable = match[1];
        currentColumns = [];
        tables[currentTable] = { columns: [] };
      }
    }
    // Column definition
    else if (currentTable && trimmed.startsWith('(')) {
      // Skip opening parenthesis
    }
    else if (currentTable && !trimmed.startsWith(')') && !trimmed.startsWith('--') && trimmed.length > 0) {
      if (trimmed.endsWith(',')) {
        currentColumns.push(trimmed.slice(0, -1).trim());
      } else {
        currentColumns.push(trimmed.trim());
      }
    }
    // End of CREATE TABLE
    else if (trimmed.startsWith(')') && currentTable) {
      tables[currentTable].columns = currentColumns;
      currentTable = null;
      currentColumns = [];
    }
  }
  
  return tables;
}

// Convert SQL column definition to MongoDB field type
function sqlTypeToMongoType(sqlType) {
  if (sqlType.includes('INTEGER') || sqlType.includes('INT')) return 'number';
  if (sqlType.includes('REAL') || sqlType.includes('FLOAT') || sqlType.includes('DOUBLE')) return 'number';
  if (sqlType.includes('TEXT') || sqlType.includes('VARCHAR') || sqlType.includes('CHAR')) return 'string';
  if (sqlType.includes('BOOLEAN') || sqlType.includes('BOOL')) return 'boolean';
  if (sqlType.includes('TIMESTAMP') || sqlType.includes('DATETIME')) return 'date';
  return 'string';
}

// Create MongoDB collections from SQL schema
async function createMongoCollections(client, tables) {
  const db = client.db(DB_NAME);
  
  console.log('Creating MongoDB collections from SQL schema...');
  
  for (const [tableName, tableInfo] of Object.entries(tables)) {
    console.log(`Creating collection: ${tableName}`);
    
    try {
      await db.createCollection(tableName);
      console.log(`  ✓ Created collection: ${tableName}`);
    } catch (error) {
      if (error.codeName === 'NamespaceExists') {
        console.log(`  ⚠ Collection already exists: ${tableName}`);
      } else {
        console.log(`  ✗ Error creating collection ${tableName}:`, error.message);
      }
    }
    
    // Create indexes for common query patterns
    if (tableName === 'companies') {
      await db.collection(tableName).createIndex({ owner_email: 1 });
      await db.collection(tableName).createIndex({ name: 1 });
      console.log(`  ✓ Created indexes for ${tableName}`);
    }
    else if (tableName === 'contacts') {
      await db.collection(tableName).createIndex({ owner_email: 1 });
      await db.collection(tableName).createIndex({ company_id: 1 });
      await db.collection(tableName).createIndex({ email: 1 });
      console.log(`  ✓ Created indexes for ${tableName}`);
    }
    else if (tableName === 'orders' || tableName === 'quotations' || tableName === 'invoices') {
      await db.collection(tableName).createIndex({ owner_email: 1 });
      await db.collection(tableName).createIndex({ created_at: -1 });
      await db.collection(tableName).createIndex({ status: 1 });
      console.log(`  ✓ Created indexes for ${tableName}`);
    }
    else if (tableName === 'users') {
      await db.collection(tableName).createIndex({ email: 1 }, { unique: true });
      console.log(`  ✓ Created unique index for ${tableName}`);
    }
    else if (tableInfo.columns.some(col => col.includes('owner_email'))) {
      await db.collection(tableName).createIndex({ owner_email: 1 });
      console.log(`  ✓ Created owner_email index for ${tableName}`);
    }
  }
  
  // Create additional indexes for relationships
  await db.collection('contacts').createIndex({ owner_email: 1, company_id: 1 });
  await db.collection('orders').createIndex({ owner_email: 1, company_id: 1 });
  await db.collection('quotations').createIndex({ owner_email: 1, company_id: 1 });
  await db.collection('invoices').createIndex({ owner_email: 1, order_id: 1 });
  
  console.log('\nMongoDB schema creation completed!');
}

// Main migration function
async function migrateToMongoDB() {
  console.log('Starting migration from D1 SQLite to MongoDB...');
  console.log(`MongoDB URI: ${MONGODB_URI}`);
  console.log(`Database: ${DB_NAME}`);
  
  let client;
  try {
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    console.log('Connected to MongoDB');
    
    // Parse SQL schema
    console.log('\nParsing SQL schema...');
    const tables = parseSQLSchema(sqlSchema);
    console.log(`Found ${Object.keys(tables).length} tables:`, Object.keys(tables).join(', '));
    
    // Create MongoDB collections
    await createMongoCollections(client, tables);
    
    console.log('\nMigration completed successfully!');
    console.log('\nNext steps:');
    console.log('1. Update your environment variables to use MONGODB_URI and MONGODB_DB_NAME');
    console.log('2. Update wrangler.toml to remove D1 binding and add MongoDB environment variables');
    console.log('3. Update your application code to use MongoDB instead of D1');
    
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    if (client) {
      await client.close();
    }
  }
}

// Run migration
if (import.meta.url === `file://${process.argv[1]}`) {
  migrateToMongoDB().catch(console.error);
}

export { migrateToMongoDB };