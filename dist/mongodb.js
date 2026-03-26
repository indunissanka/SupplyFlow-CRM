import { MongoClient, Db, Collection, ObjectId } from 'mongodb';
let env = {};
export function setMongoDBEnv(config) {
    env = config;
}
const getMongoDBUri = () => env.MONGODB_URI || 'mongodb://localhost:27017';
const getMongoDBName = () => env.MONGODB_DB_NAME || 'crmmango';
// MongoDB client singleton
let client = null;
let db = null;
export async function getMongoDB() {
    if (db)
        return db;
    if (!client) {
        client = new MongoClient(getMongoDBUri(), {
            maxPoolSize: 10,
            minPoolSize: 2,
            connectTimeoutMS: 10000,
            serverSelectionTimeoutMS: 10000,
        });
        await client.connect();
    }
    db = client.db(getMongoDBName());
    return db;
}
export async function closeMongoDB() {
    if (client) {
        await client.close();
        client = null;
        db = null;
    }
}
// Create a MongoDB queryable interface that mimics D1Queryable
export function createMongoDBQueryable(db) {
    return {
        collection(name) {
            return db.collection(name);
        },
        prepare(query, ...params) {
            // Parse SQL-like query to MongoDB operation
            // This is a simplified implementation - in reality, we'd need a proper SQL to MongoDB translator
            // For now, we'll use a custom format or direct MongoDB operations
            throw new Error('SQL prepare not supported for MongoDB. Use direct MongoDB operations instead.');
        },
        async batch(statements) {
            const results = [];
            for (const stmt of statements) {
                const collection = db.collection(stmt.collection);
                switch (stmt.operation) {
                    case 'find':
                        results.push(await collection.find(stmt.filter || {}, stmt.options).toArray());
                        break;
                    case 'findOne':
                        results.push(await collection.findOne(stmt.filter || {}, stmt.options));
                        break;
                    case 'insertOne':
                        if (!stmt.document || Array.isArray(stmt.document)) {
                            throw new Error('insertOne requires a single document');
                        }
                        results.push(await collection.insertOne(stmt.document));
                        break;
                    case 'insertMany':
                        if (!stmt.document || !Array.isArray(stmt.document)) {
                            throw new Error('insertMany requires an array of documents');
                        }
                        results.push(await collection.insertMany(stmt.document));
                        break;
                    case 'updateOne':
                        if (!stmt.filter || !stmt.update) {
                            throw new Error('updateOne requires filter and update');
                        }
                        results.push(await collection.updateOne(stmt.filter, stmt.update, stmt.options));
                        break;
                    case 'updateMany':
                        if (!stmt.filter || !stmt.update) {
                            throw new Error('updateMany requires filter and update');
                        }
                        results.push(await collection.updateMany(stmt.filter, stmt.update, stmt.options));
                        break;
                    case 'deleteOne':
                        if (!stmt.filter) {
                            throw new Error('deleteOne requires filter');
                        }
                        results.push(await collection.deleteOne(stmt.filter));
                        break;
                    case 'deleteMany':
                        if (!stmt.filter) {
                            throw new Error('deleteMany requires filter');
                        }
                        results.push(await collection.deleteMany(stmt.filter));
                        break;
                    case 'aggregate':
                        if (!stmt.pipeline) {
                            throw new Error('aggregate requires pipeline');
                        }
                        results.push(await collection.aggregate(stmt.pipeline).toArray());
                        break;
                    case 'count':
                        results.push(await collection.countDocuments(stmt.filter || {}));
                        break;
                    default:
                        throw new Error(`Unsupported operation: ${stmt.operation}`);
                }
            }
            return results;
        }
    };
}
// Helper function to convert SQL WHERE clause to MongoDB filter
export function sqlWhereToMongoFilter(whereClause, params) {
    // This is a simplified implementation
    // In a real application, you'd need a proper SQL parser
    const filter = {};
    // Simple equality conversion for now
    if (whereClause.includes('=')) {
        const [field, value] = whereClause.split('=').map(s => s.trim());
        const paramIndex = parseInt(value.replace('?', '')) - 1;
        if (!isNaN(paramIndex) && params[paramIndex] !== undefined) {
            filter[field] = params[paramIndex];
        }
    }
    return filter;
}
// Convert SQL schema to MongoDB collections
export async function initializeMongoDBSchema(db) {
    // Create collections based on SQL schema
    const collections = [
        'companies', 'contacts', 'products', 'orders', 'quotations', 'invoices',
        'tasks', 'shipping_schedules', 'sample_shipments', 'documents', 'notes',
        'tags', 'users', 'sessions', 'site_config', 'ai_config'
    ];
    for (const collectionName of collections) {
        try {
            await db.createCollection(collectionName);
            console.log(`Created collection: ${collectionName}`);
        }
        catch (error) {
            // Collection might already exist
            console.log(`Collection ${collectionName} already exists or error: ${error}`);
        }
    }
    // Create indexes
    await db.collection('companies').createIndex({ owner_email: 1 });
    await db.collection('contacts').createIndex({ owner_email: 1, company_id: 1 });
    await db.collection('orders').createIndex({ owner_email: 1, created_at: -1 });
    await db.collection('quotations').createIndex({ owner_email: 1, created_at: -1 });
    await db.collection('invoices').createIndex({ owner_email: 1, created_at: -1 });
    await db.collection('users').createIndex({ email: 1 }, { unique: true });
    await db.collection('sessions').createIndex({ token: 1 }, { unique: true });
    await db.collection('sessions').createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 }); // TTL index
    // Additional indexes for hot query paths
    await Promise.all([
        db.collection('quotation_items').createIndex({ owner_email: 1, quotation_id: 1 }),
        db.collection('invoices').createIndex({ owner_email: 1, status: 1 }),
        db.collection('invoices').createIndex({ owner_email: 1, due_date: 1 }),
        db.collection('quotations').createIndex({ owner_email: 1, status: 1 }),
        db.collection('orders').createIndex({ owner_email: 1, status: 1 }),
        db.collection('tasks').createIndex({ owner_email: 1, due_date: 1, status: 1 }),
        db.collection('shipping_schedules').createIndex({ owner_email: 1, created_at: -1 }),
        db.collection('sample_shipments').createIndex({ owner_email: 1, created_at: -1 }),
        db.collection('documents').createIndex({ owner_email: 1, created_at: -1 }),
        db.collection('notes').createIndex({ owner_email: 1, created_at: -1 }),
        db.collection('products').createIndex({ owner_email: 1, name: 1 }),
        db.collection('tag_links').createIndex({ owner_email: 1, entity_id: 1 }),
    ]);
    console.log('MongoDB schema initialized');
}
// ObjectId utilities
export function toObjectId(id) {
    if (id instanceof ObjectId)
        return id;
    if (typeof id === 'string' && ObjectId.isValid(id))
        return new ObjectId(id);
    if (typeof id === 'number')
        return new ObjectId(id.toString());
    throw new Error(`Invalid ID: ${id}`);
}
export function fromObjectId(id) {
    if (typeof id === 'string')
        return id;
    return id.toHexString();
}
