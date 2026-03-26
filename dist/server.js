import express from 'express';
import cors from 'cors';
import { getMongoDB, closeMongoDB, createMongoDBQueryable } from './mongodb.js';
import dotenv from 'dotenv';
import { ObjectId } from 'mongodb';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);
dotenv.config();
// ── Password helpers ──────────────────────────────────────────────────────────
const PASSWORD_HASH_PREFIX = 'pbkdf2';
const PASSWORD_HASH_ITERATIONS = 100_000;
const encoder = new TextEncoder();
const hexToBytes = (hex) => {
    const pairs = hex.trim().match(/.{1,2}/g) ?? [];
    return new Uint8Array(pairs.map((b) => parseInt(b, 16)));
};
const bytesToHex = (bytes) => Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
const randomToken = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return bytesToHex(bytes);
};
const hashPassword = async (password, salt, iterations = PASSWORD_HASH_ITERATIONS) => {
    const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
    const derived = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: hexToBytes(salt), iterations }, key, 256);
    return `${PASSWORD_HASH_PREFIX}$${iterations}$${bytesToHex(new Uint8Array(derived))}`;
};
const hashPasswordLegacy = async (password, salt) => {
    const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`${salt}:${password}`));
    return bytesToHex(new Uint8Array(digest));
};
const verifyPassword = async (password, salt, hash) => {
    if (!hash)
        return false;
    if (hash.startsWith(`${PASSWORD_HASH_PREFIX}$`)) {
        const [, iterPart] = hash.split('$');
        const iterations = parseInt(iterPart, 10);
        if (!Number.isFinite(iterations) || iterations <= 0)
            return false;
        return (await hashPassword(password, salt, iterations)) === hash;
    }
    return (await hashPasswordLegacy(password, salt)) === hash;
};
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const normalizeEmail = (v) => v.trim().toLowerCase();
const adminRole = 'Admin';
const defaultAccessList = [
    'tags', 'companies', 'contacts', 'products', 'pricing', 'analytics',
    'orders', 'quotations', 'invoices', 'documents', 'shipping',
    'sample_shipments', 'tasks', 'notes', 'settings'
];
const normalizeAccessList = (raw) => {
    if (Array.isArray(raw))
        return raw.filter(Boolean);
    if (typeof raw === 'string' && raw.trim()) {
        try {
            const p = JSON.parse(raw);
            if (Array.isArray(p))
                return p;
        }
        catch { }
        return raw.split(',').map((s) => s.trim()).filter(Boolean);
    }
    return [];
};
const buildUserResponse = (row) => {
    const accessList = normalizeAccessList(row.access_list ?? row.access);
    return {
        id: row._id ? row._id.toString() : undefined,
        email: normalizeEmail(row.email || ''),
        name: row.name || '',
        role: row.role || adminRole,
        access: row.access || '',
        accessList: accessList.length ? accessList : row.role === adminRole ? [...defaultAccessList] : [],
        enabled: row.enabled !== 0
    };
};
// ── ID helpers ────────────────────────────────────────────────────────────────
// Records are returned with id = _id.toString(). PUT/DELETE look up by _id.
const toMongoId = (id) => {
    try {
        return new ObjectId(id);
    }
    catch {
        return null;
    }
};
const serializeDoc = (doc) => {
    if (!doc)
        return doc;
    const { _id, ...rest } = doc;
    return { id: _id ? _id.toString() : undefined, ...rest };
};
function generateDateRef(prefix) {
    const now = new Date();
    const Y = now.getFullYear();
    const M = String(now.getMonth() + 1).padStart(2, '0');
    const D = String(now.getDate()).padStart(2, '0');
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    return `${prefix}-${Y}${M}${D}-${h}${m}${s}`;
}
// Express 5 returns string | string[] for params/query — always cast to string
const p = (v) => (Array.isArray(v) ? v[0] : v) ?? '';
// ── Allowed tables ────────────────────────────────────────────────────────────
const allowedTables = new Set([
    'companies', 'contacts', 'products', 'orders', 'quotations', 'invoices',
    'documents', 'shipping_schedules', 'sample_shipments', 'tasks', 'notes',
    'tags', 'tag_links', 'doc_types', 'quotation_items'
]);
// ── Express app ───────────────────────────────────────────────────────────────
const app = express();
const port = process.env.PORT || 3000;
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
    credentials: false,
    allowedHeaders: ['content-type', 'authorization', 'x-user-email'],
    maxAge: 86400
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
// Security headers
app.use((req, res, next) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'same-origin');
    res.setHeader('x-frame-options', 'DENY');
    res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    const ct = String(res.getHeader('content-type') || '');
    if (ct.includes('text/html')) {
        res.setHeader('content-security-policy', [
            "default-src 'self'",
            "script-src 'self' https://unpkg.com https://cdn.tailwindcss.com",
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "font-src https://fonts.gstatic.com",
            "img-src 'self' data:",
            "connect-src 'self'",
            "frame-ancestors 'none'"
        ].join('; '));
    }
    next();
});
// MongoDB connection middleware
app.use(async (req, res, next) => {
    try {
        const db = await getMongoDB();
        req.db = db;
        req.dbQueryable = createMongoDBQueryable(db);
        next();
    }
    catch (error) {
        console.error('MongoDB connection error:', error);
        res.status(500).json({ error: 'Database connection failed' });
    }
});
// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
// ── Login ─────────────────────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
    try {
        const email = normalizeEmail(typeof req.body.email === 'string' ? req.body.email : '');
        const password = typeof req.body.password === 'string' ? req.body.password : '';
        if (!email || !password)
            return res.status(400).json({ error: 'Email and password required' });
        const db = req.db;
        const usersCol = db.collection('users');
        const sessionsCol = db.collection('sessions');
        const user = await usersCol.findOne({ email });
        if (!user)
            return res.status(401).json({ error: 'Invalid credentials' });
        if (user.enabled === 0)
            return res.status(403).json({ error: 'This account is disabled. Contact an admin.' });
        const salt = user.password_salt || '';
        const hash = user.password_hash || '';
        const valid = salt && hash ? await verifyPassword(password, salt, hash) : false;
        if (!valid)
            return res.status(401).json({ error: 'Invalid credentials' });
        if (hash && !hash.startsWith(`${PASSWORD_HASH_PREFIX}$`)) {
            const ns = randomToken();
            const nh = await hashPassword(password, ns);
            await usersCol.updateOne({ email }, { $set: { password_hash: nh, password_salt: ns } });
        }
        const token = randomToken();
        await sessionsCol.insertOne({ token, email, expires_at: new Date(Date.now() + SESSION_TTL_MS) });
        return res.json({ ok: true, user: buildUserResponse(user), token });
    }
    catch (err) {
        console.error('Login failed', err);
        return res.status(500).json({ error: 'Internal error' });
    }
});
// ── Auth middleware ───────────────────────────────────────────────────────────
app.use(async (req, res, next) => {
    const path = req.path;
    if (!path.startsWith('/api/'))
        return next();
    if (path === '/api/health' || path === '/api/auth/login')
        return next();
    if (path.startsWith('/api/files/'))
        return next();
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token)
        return res.status(401).json({ error: 'Missing authentication token' });
    const db = req.db;
    const session = await db.collection('sessions').findOne({ token });
    if (!session)
        return res.status(401).json({ error: 'Invalid or expired session' });
    if (session.expires_at < new Date()) {
        await db.collection('sessions').deleteOne({ token });
        return res.status(401).json({ error: 'Session expired' });
    }
    const ownerEmail = normalizeEmail(session.email);
    const user = await db.collection('users').findOne({ email: ownerEmail });
    if (!user || user.enabled === 0)
        return res.status(403).json({ error: 'Account disabled or not found' });
    req.ownerEmail = ownerEmail;
    req.currentUser = user;
    next();
});
// ── Logout ────────────────────────────────────────────────────────────────────
app.post('/api/auth/logout', async (req, res) => {
    const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
    if (token)
        await req.db.collection('sessions').deleteOne({ token });
    res.json({ ok: true });
});
// ── Change own password / email ───────────────────────────────────────────────
app.post('/api/auth/password', async (req, res) => {
    const ownerEmail = req.ownerEmail;
    const db = req.db;
    const { currentPassword, newPassword, newEmail } = req.body;
    const user = await db.collection('users').findOne({ email: ownerEmail });
    if (!user)
        return res.status(404).json({ error: 'User not found' });
    const valid = await verifyPassword(currentPassword || '', user.password_salt || '', user.password_hash || '');
    if (!valid)
        return res.status(401).json({ error: 'Current password is incorrect' });
    const updates = {};
    if (newPassword) {
        if (newPassword.length < 8)
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        const salt = randomToken();
        updates.password_hash = await hashPassword(newPassword, salt);
        updates.password_salt = salt;
    }
    if (newEmail) {
        const ne = normalizeEmail(newEmail);
        const exists = await db.collection('users').findOne({ email: ne });
        if (exists)
            return res.status(409).json({ error: 'Email already in use' });
        updates.email = ne;
        // Update all records owned by old email
        for (const table of allowedTables) {
            await db.collection(table).updateMany({ owner_email: ownerEmail }, { $set: { owner_email: ne } });
        }
        // Update session
        await db.collection('sessions').updateMany({ email: ownerEmail }, { $set: { email: ne } });
    }
    if (Object.keys(updates).length) {
        await db.collection('users').updateOne({ email: ownerEmail }, { $set: updates });
    }
    return res.json({ ok: true });
});
// ── User management (admin) ───────────────────────────────────────────────────
app.get('/api/auth/users', async (req, res) => {
    const currentUser = req.currentUser;
    if (currentUser.role !== adminRole)
        return res.status(403).json({ error: 'Admin access required' });
    const db = req.db;
    const docs = await db.collection('users').find({}).toArray();
    res.json({ users: docs.map(buildUserResponse) });
});
app.post('/api/auth/users', async (req, res) => {
    const currentUser = req.currentUser;
    if (currentUser.role !== adminRole)
        return res.status(403).json({ error: 'Admin access required' });
    const db = req.db;
    const { email: rawEmail, password, name, role, access, accessList } = req.body;
    const email = normalizeEmail(rawEmail || '');
    if (!email || !password)
        return res.status(400).json({ error: 'Email and password required' });
    if (password.length < 8)
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
    if (await db.collection('users').findOne({ email }))
        return res.status(409).json({ error: 'User already exists' });
    const salt = randomToken();
    const hash = await hashPassword(password, salt);
    const al = normalizeAccessList(accessList ?? access);
    await db.collection('users').insertOne({
        email, name: name || email.split('@')[0], role: role || 'Salesperson',
        access: access || '', access_list: JSON.stringify(al),
        password_hash: hash, password_salt: salt, enabled: 1
    });
    const user = await db.collection('users').findOne({ email });
    res.json({ user: user ? buildUserResponse(user) : null });
});
app.put('/api/auth/users/:id', async (req, res) => {
    const currentUser = req.currentUser;
    if (currentUser.role !== adminRole)
        return res.status(403).json({ error: 'Admin access required' });
    const db = req.db;
    const oid = toMongoId(p(req.params.id));
    if (!oid)
        return res.status(400).json({ error: 'Invalid id' });
    const { name, role, access, accessList, enabled } = req.body;
    const updates = {};
    if (name !== undefined)
        updates.name = name;
    if (role !== undefined)
        updates.role = role;
    if (access !== undefined)
        updates.access = access;
    if (accessList !== undefined)
        updates.access_list = JSON.stringify(normalizeAccessList(accessList));
    if (enabled !== undefined)
        updates.enabled = enabled ? 1 : 0;
    await db.collection('users').updateOne({ _id: oid }, { $set: updates });
    const user = await db.collection('users').findOne({ _id: oid });
    res.json({ user: user ? buildUserResponse(user) : null });
});
app.delete('/api/auth/users/:id', async (req, res) => {
    const currentUser = req.currentUser;
    if (currentUser.role !== adminRole)
        return res.status(403).json({ error: 'Admin access required' });
    const db = req.db;
    const oid = toMongoId(p(req.params.id));
    if (!oid)
        return res.status(400).json({ error: 'Invalid id' });
    await db.collection('users').deleteOne({ _id: oid });
    res.json({ ok: true });
});
app.post('/api/auth/users/:id/password', async (req, res) => {
    const currentUser = req.currentUser;
    if (currentUser.role !== adminRole)
        return res.status(403).json({ error: 'Admin access required' });
    const db = req.db;
    const oid = toMongoId(p(req.params.id));
    if (!oid)
        return res.status(400).json({ error: 'Invalid id' });
    const { password } = req.body;
    if (!password || password.length < 8)
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const salt = randomToken();
    const hash = await hashPassword(password, salt);
    await db.collection('users').updateOne({ _id: oid }, { $set: { password_hash: hash, password_salt: salt } });
    res.json({ ok: true });
});
// ── Site config ───────────────────────────────────────────────────────────────
app.get('/api/settings/site-config', async (req, res) => {
    const db = req.db;
    const doc = await db.collection('site_config').findOne({});
    const config = doc ? serializeDoc(doc) : {};
    res.json({ config });
});
app.put('/api/settings/site-config', async (req, res) => {
    const db = req.db;
    const update = { ...(req.body || {}), updated_at: new Date().toISOString() };
    await db.collection('site_config').updateOne({}, { $set: update }, { upsert: true });
    res.json({ ok: true });
});
// ── Dashboard ─────────────────────────────────────────────────────────────────
app.get('/api/dashboard', async (req, res) => {
    const ownerEmail = req.ownerEmail;
    const db = req.db;
    try {
        const [companies, contacts, orders, quotations, invoices, tasks] = await Promise.all([
            db.collection('companies').countDocuments({ owner_email: ownerEmail }),
            db.collection('contacts').countDocuments({ owner_email: ownerEmail }),
            db.collection('orders').countDocuments({ owner_email: ownerEmail }),
            db.collection('quotations').countDocuments({ owner_email: ownerEmail }),
            db.collection('invoices').countDocuments({ owner_email: ownerEmail }),
            db.collection('tasks').countDocuments({ owner_email: ownerEmail })
        ]);
        // Pipeline data: recent orders + unpaid invoices
        const [recentOrders, recentInvoices, quotationPipeline, unpaidAgg, activeOrderCount, recentTasks] = await Promise.all([
            db.collection('orders').find({ owner_email: ownerEmail }).sort({ created_at: -1 }).limit(5).toArray(),
            db.collection('invoices').find({ owner_email: ownerEmail, status: { $in: ['Unpaid', 'Open', 'Overdue'] } }).sort({ created_at: -1 }).limit(4).toArray(),
            db.collection('quotations').countDocuments({ owner_email: ownerEmail, status: { $in: ['Draft', 'Sent'] } }),
            db.collection('invoices').aggregate([
                { $match: { owner_email: ownerEmail, status: { $in: ['Unpaid', 'Open', 'Overdue'] } } },
                { $group: { _id: null, total: { $sum: { $toDouble: { $ifNull: ['$total_amount', '$amount'] } } } } }
            ]).toArray(),
            db.collection('orders').countDocuments({ owner_email: ownerEmail, status: { $nin: ['Completed', 'Cancelled', 'Delivered'] } }),
            db.collection('tasks').find({ owner_email: ownerEmail, status: { $ne: 'Done' } }).sort({ due_date: 1 }).limit(5).toArray()
        ]);
        const toStatusType = (status) => {
            const s = (status || '').toLowerCase();
            if (['paid', 'completed', 'delivered'].includes(s))
                return 'success';
            if (['overdue', 'cancelled', 'rejected'].includes(s))
                return 'danger';
            if (['pending', 'draft', 'unpaid', 'open', 'factory exit'].includes(s))
                return 'warning';
            return 'info';
        };
        // For orders with no total_amount, look up sum from quotation_items via quotation_id
        const zeroOrders = recentOrders.filter((o) => !Number(o.total_amount || o.amount) && o.quotation_id);
        let orderQuoteTotals = {};
        if (zeroOrders.length) {
            const qIds = zeroOrders.map((o) => o.quotation_id);
            const qAgg = await db.collection('quotation_items').aggregate([
                { $match: { owner_email: ownerEmail, quotation_id: { $in: qIds } } },
                { $group: { _id: '$quotation_id', total: { $sum: { $toDouble: '$line_total' } } } }
            ]).toArray();
            qAgg.forEach((row) => { orderQuoteTotals[String(row._id)] = row.total; });
        }
        const orderItems = recentOrders.map((o) => {
            const directTotal = Number(o.total_amount || o.amount || 0);
            const amount = directTotal || orderQuoteTotals[String(o.quotation_id)] || 0;
            return {
                id: o._id.toString(),
                type: 'order',
                ref: o.reference || o.order_reference || (o.legacy_id ? `SO-${o.legacy_id}` : 'Order'),
                account: o.company_name || '-',
                amount,
                currency: o.currency || 'USD',
                status: o.status || 'Draft',
                statusType: toStatusType(o.status),
                date: o.created_at || ''
            };
        });
        const invoiceItems = recentInvoices.map((inv) => ({
            id: inv._id.toString(),
            type: 'invoice',
            ref: inv.reference || (inv.legacy_id ? `INV-${inv.legacy_id}` : 'Invoice'),
            account: inv.company_name || '-',
            amount: Number(inv.total_amount ?? inv.amount ?? 0),
            currency: inv.currency || 'USD',
            status: inv.status || 'Unpaid',
            statusType: toStatusType(inv.status),
            date: inv.created_at || ''
        }));
        const pipeline = [...orderItems, ...invoiceItems]
            .sort((a, b) => (b.date > a.date ? 1 : -1))
            .slice(0, 8);
        const unpaidAmount = unpaidAgg.length ? unpaidAgg[0].total || 0 : 0;
        res.json({
            stats: { companies, contacts, orders, quotations, invoices, tasks },
            pipeline,
            pipelineSummary: { quotations: quotationPipeline, orders: activeOrderCount, unpaidAmount },
            activity: recentTasks.map(serializeDoc)
        });
    }
    catch (err) {
        console.error('Dashboard error', err);
        res.status(500).json({ error: 'Internal error' });
    }
});
// ── Search ────────────────────────────────────────────────────────────────────
app.get('/api/search', async (req, res) => {
    const ownerEmail = req.ownerEmail;
    const db = req.db;
    const q = (req.query.q || '').trim();
    if (!q)
        return res.json({ results: [] });
    const regex = { $regex: q, $options: 'i' };
    const searchTables = {
        companies: [{ name: regex }, { country: regex }],
        contacts: [{ first_name: regex }, { last_name: regex }, { email: regex }],
        products: [{ name: regex }, { sku: regex }],
        orders: [{ order_number: regex }, { status: regex }],
        tasks: [{ title: regex }]
    };
    try {
        const results = [];
        await Promise.all(Object.entries(searchTables).map(async ([table, orClauses]) => {
            const docs = await db.collection(table)
                .find({ owner_email: ownerEmail, $or: orClauses })
                .limit(5).toArray();
            docs.forEach((d) => results.push({ table, ...serializeDoc(d) }));
        }));
        res.json({ results });
    }
    catch (err) {
        console.error('Search error', err);
        res.status(500).json({ error: 'Internal error' });
    }
});
// ── Database status ───────────────────────────────────────────────────────────
app.get('/api/db/status', async (req, res) => {
    try {
        const db = req.db;
        const [dbStats, collectionInfos] = await Promise.all([
            db.command({ dbStats: 1, scale: 1024 }),
            db.listCollections().toArray()
        ]);
        const collNames = collectionInfos.map((c) => c.name).filter((n) => !n.startsWith('system.'));
        const counts = await Promise.all(collNames.map(async (name) => {
            const count = await db.collection(name).estimatedDocumentCount();
            return { name, count };
        }));
        const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
        const hostPart = uri.replace(/mongodb(\+srv)?:\/\/[^@]*@?/, '').replace(/\/.*$/, '');
        res.json({
            dbName: db.databaseName,
            host: hostPart,
            storageSize: dbStats.storageSize,
            dataSize: dbStats.dataSize,
            collections: counts.sort((a, b) => b.count - a.count)
        });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// ── Backup (MongoDB / mongodump) ──────────────────────────────────────────────
const BACKUP_DIR = '/home/ubuntu/backups/mongodb';
const BACKUP_SCRIPT = path.resolve(process.cwd(), 'scripts/backup-mongodb.sh');
const MONGO_URI_ENV = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const MONGO_DB_ENV = process.env.MONGODB_DB_NAME || 'crmmango';
function safeBackupFilename(filename) {
    const base = path.basename(filename);
    return base.endsWith('.tar.gz') ? base : null;
}
// GET /api/backup/list
app.get('/api/backup/list', async (req, res) => {
    try {
        const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.tar.gz'));
        const backups = files.map(f => {
            const stat = fs.statSync(path.join(BACKUP_DIR, f));
            return { filename: f, size: stat.size, created_at: stat.mtime.toISOString() };
        }).sort((a, b) => b.created_at.localeCompare(a.created_at));
        res.json({ backups });
    }
    catch {
        res.json({ backups: [] });
    }
});
// POST /api/backup/create
app.post('/api/backup/create', async (req, res) => {
    try {
        const { stdout, stderr } = await execAsync(`bash "${BACKUP_SCRIPT}"`, { timeout: 120000 });
        res.json({ ok: true, log: stdout || stderr });
    }
    catch (err) {
        console.error('Backup create failed', err);
        res.status(500).json({ error: err.message || 'Backup failed' });
    }
});
// GET /api/backup/download/:filename
app.get('/api/backup/download/:filename', (req, res) => {
    const filename = safeBackupFilename(String(req.params.filename));
    if (!filename)
        return res.status(400).json({ error: 'Invalid filename' });
    const filePath = path.join(BACKUP_DIR, filename);
    if (!fs.existsSync(filePath))
        return res.status(404).json({ error: 'Not found' });
    res.download(filePath, filename);
});
// DELETE /api/backup/:filename
app.delete('/api/backup/:filename', (req, res) => {
    const filename = safeBackupFilename(String(req.params.filename));
    if (!filename)
        return res.status(400).json({ error: 'Invalid filename' });
    const filePath = path.join(BACKUP_DIR, filename);
    if (!fs.existsSync(filePath))
        return res.status(404).json({ error: 'Not found' });
    try {
        fs.unlinkSync(filePath);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// POST /api/backup/restore/:filename
app.post('/api/backup/restore/:filename', async (req, res) => {
    const filename = safeBackupFilename(String(req.params.filename));
    if (!filename)
        return res.status(400).json({ error: 'Invalid filename' });
    const filePath = path.join(BACKUP_DIR, filename);
    if (!fs.existsSync(filePath))
        return res.status(404).json({ error: 'Not found' });
    const stamp = filename.replace('.tar.gz', '');
    const uploadsTarget = path.join(__dirname, '..', 'uploads');
    try {
        const cmd = [
            `TMPDIR=$(mktemp -d)`,
            `tar xzf "${filePath}" -C "$TMPDIR"`,
            `mongorestore --uri="${MONGO_URI_ENV}" --db="${MONGO_DB_ENV}" --gzip --drop "$TMPDIR/${stamp}/${MONGO_DB_ENV}"`,
            `if [ -d "$TMPDIR/${stamp}/uploads" ]; then rm -rf "${uploadsTarget}" && cp -r "$TMPDIR/${stamp}/uploads" "${uploadsTarget}"; fi`,
            `rm -rf "$TMPDIR"`
        ].join(' && ');
        const { stdout, stderr } = await execAsync(cmd, { timeout: 300000 });
        res.json({ ok: true, log: stdout || stderr });
    }
    catch (err) {
        console.error('Restore failed', err);
        res.status(500).json({ error: err.message || 'Restore failed' });
    }
});
// POST /api/backup/upload-restore  — upload a .tar.gz from client then restore it
const _backupUploadStorage = multer.diskStorage({
    destination: (_req, _file, cb) => { fs.mkdirSync(BACKUP_DIR, { recursive: true }); cb(null, BACKUP_DIR); },
    filename: (_req, file, cb) => { cb(null, path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_')); }
});
const _backupUpload = multer({
    storage: _backupUploadStorage,
    limits: { fileSize: 500 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => { cb(null, file.originalname.endsWith('.tar.gz')); }
});
app.post('/api/backup/upload-restore', _backupUpload.single('backup'), async (req, res) => {
    const file = req.file;
    if (!file)
        return res.status(400).json({ error: 'No file uploaded or file is not a .tar.gz' });
    const filename = safeBackupFilename(file.filename);
    if (!filename) {
        fs.unlinkSync(file.path);
        return res.status(400).json({ error: 'Invalid filename' });
    }
    const filePath = path.join(BACKUP_DIR, filename);
    const stamp = filename.replace('.tar.gz', '');
    const uploadsTarget = path.join(__dirname, '..', 'uploads');
    try {
        const cmd = [
            `TMPDIR=$(mktemp -d)`,
            `tar xzf "${filePath}" -C "$TMPDIR"`,
            `mongorestore --uri="${MONGO_URI_ENV}" --db="${MONGO_DB_ENV}" --gzip --drop "$TMPDIR/${stamp}/${MONGO_DB_ENV}"`,
            `if [ -d "$TMPDIR/${stamp}/uploads" ]; then rm -rf "${uploadsTarget}" && cp -r "$TMPDIR/${stamp}/uploads" "${uploadsTarget}"; fi`,
            `rm -rf "$TMPDIR"`
        ].join(' && ');
        const { stdout, stderr } = await execAsync(cmd, { timeout: 300000 });
        res.json({ ok: true, log: stdout || stderr });
    }
    catch (err) {
        console.error('Upload-restore failed', err);
        res.status(500).json({ error: err.message || 'Restore failed' });
    }
});
// ── Bulk import / CSV export ──────────────────────────────────────────────────
const bulkTables = new Set(['products', 'companies', 'contacts']);
// CSV field definitions per table
const csvHeaders = {
    products: ['name', 'sku', 'category', 'price', 'currency', 'status', 'description'],
    companies: ['name', 'company_code', 'website', 'email', 'phone', 'owner', 'industry', 'status', 'address'],
    contacts: ['first_name', 'last_name', 'email', 'phone', 'role', 'status', 'company_id', 'company_name'],
};
// POST /api/:table/bulk — insert array of records
app.post('/api/:table/bulk', async (req, res) => {
    const table = p(req.params.table);
    if (!bulkTables.has(table))
        return res.status(404).json({ error: 'Unknown table' });
    const ownerEmail = req.ownerEmail;
    const db = req.db;
    const records = Array.isArray(req.body) ? req.body : [];
    if (!records.length)
        return res.status(400).json({ error: 'No records provided' });
    const now = new Date().toISOString();
    const docs = records.map((r) => {
        const { _id, id, owner_email, ...fields } = r;
        return { ...fields, owner_email: ownerEmail, created_at: now, updated_at: now };
    });
    try {
        const result = await db.collection(table).insertMany(docs);
        res.json({ inserted: result.insertedCount });
    }
    catch (err) {
        console.error(`Error bulk inserting ${table}`, err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// GET /api/:table/csv — export as CSV download
app.get('/api/:table/csv', async (req, res) => {
    const table = p(req.params.table);
    if (!bulkTables.has(table))
        return res.status(404).json({ error: 'Unknown table' });
    const ownerEmail = req.ownerEmail;
    const db = req.db;
    try {
        const rows = await db.collection(table).find({ owner_email: ownerEmail }).toArray();
        const fields = csvHeaders[table] ?? [];
        const escape = (v) => {
            const s = v == null ? '' : String(v);
            return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const lines = [fields.join(',')];
        for (const row of rows) {
            lines.push(fields.map((f) => escape(row[f])).join(','));
        }
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${table}.csv"`);
        res.send(lines.join('\r\n'));
    }
    catch (err) {
        console.error(`Error exporting ${table} CSV`, err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// ── Shipping schedules: enrich with company/order/invoice names ───────────────
const enrichShippingSchedule = async (db, ownerEmail, doc) => {
    const enriched = { ...doc };
    // Resolve company_name from company_id; clear stale name when id is absent
    if (doc.company_id) {
        if (!doc.company_name) {
            const oid = toMongoId(String(doc.company_id));
            const company = oid
                ? await db.collection('companies').findOne({ _id: oid, owner_email: ownerEmail })
                : await db.collection('companies').findOne({ legacy_id: doc.company_id, owner_email: ownerEmail });
            if (company)
                enriched.company_name = company.name;
        }
    }
    else {
        enriched.company_name = null;
    }
    // Resolve order_reference from order_id; clear stale reference when id is absent
    if (doc.order_id) {
        if (!doc.order_reference) {
            const oid = toMongoId(String(doc.order_id));
            const order = oid
                ? await db.collection('orders').findOne({ _id: oid, owner_email: ownerEmail })
                : null;
            if (order)
                enriched.order_reference = order.reference;
        }
    }
    else {
        enriched.order_reference = null;
    }
    // Resolve invoice_reference from invoice_id; clear stale reference when id is absent
    if (doc.invoice_id) {
        if (!doc.invoice_reference) {
            const oid = toMongoId(String(doc.invoice_id));
            const invoice = oid
                ? await db.collection('invoices').findOne({ _id: oid, owner_email: ownerEmail })
                : null;
            if (invoice)
                enriched.invoice_reference = invoice.reference;
        }
    }
    else {
        enriched.invoice_reference = null;
    }
    return enriched;
};
// GET shipping_schedules with enrichment
app.get('/api/shipping_schedules', async (req, res) => {
    const ownerEmail = req.ownerEmail;
    const db = req.db;
    const limit = Math.min(parseInt(p(req.query.limit)) || 50, 200);
    const offset = parseInt(p(req.query.offset)) || 0;
    try {
        const rows = await db.collection('shipping_schedules')
            .find({ owner_email: ownerEmail }).sort({ created_at: -1 }).skip(offset).limit(limit).toArray();
        const enriched = await Promise.all(rows.map(r => enrichShippingSchedule(db, ownerEmail, r)));
        res.json({ rows: enriched.map(serializeDoc) });
    }
    catch (err) {
        console.error('Error fetching shipping_schedules', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// POST shipping_schedule with enrichment
app.post('/api/shipping_schedules', async (req, res) => {
    const ownerEmail = req.ownerEmail;
    const db = req.db;
    const { _id, id, ...fields } = req.body || {};
    const now = new Date().toISOString();
    const doc = await enrichShippingSchedule(db, ownerEmail, {
        ...fields, owner_email: ownerEmail,
        created_at: fields.created_at || now, updated_at: now
    });
    try {
        const result = await db.collection('shipping_schedules').insertOne(doc);
        const created = await db.collection('shipping_schedules').findOne({ _id: result.insertedId });
        res.status(201).json({ row: serializeDoc(created) });
    }
    catch (err) {
        console.error('Error creating shipping_schedule', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// PUT shipping_schedule with enrichment
app.put('/api/shipping_schedules/:id', async (req, res) => {
    const ownerEmail = req.ownerEmail;
    const db = req.db;
    const id = p(req.params.id);
    const oid = toMongoId(id);
    if (!oid)
        return res.status(400).json({ error: 'Invalid id' });
    const { _id, id: _bodyId, ...fields } = req.body || {};
    const enriched = await enrichShippingSchedule(db, ownerEmail, fields);
    const updates = { ...enriched, updated_at: new Date().toISOString() };
    try {
        await db.collection('shipping_schedules').updateOne({ _id: oid, owner_email: ownerEmail }, { $set: updates });
        const updated = await db.collection('shipping_schedules').findOne({ _id: oid });
        if (!updated)
            return res.status(404).json({ error: 'Not found' });
        res.json({ row: serializeDoc(updated) });
    }
    catch (err) {
        console.error('Error updating shipping_schedule', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// ── Enrich invoices / orders with company_name + contact_name ─────────────────
const enrichWithNames = async (db, ownerEmail, doc) => {
    const enriched = { ...doc };
    if (doc.company_id && !doc.company_name) {
        const oid = toMongoId(String(doc.company_id));
        const company = oid
            ? await db.collection('companies').findOne({ _id: oid, owner_email: ownerEmail })
            : await db.collection('companies').findOne({ legacy_id: doc.company_id, owner_email: ownerEmail });
        if (company)
            enriched.company_name = company.name;
    }
    if (doc.contact_id && !doc.contact_name) {
        const oid = toMongoId(String(doc.contact_id));
        const contact = oid
            ? await db.collection('contacts').findOne({ _id: oid, owner_email: ownerEmail })
            : await db.collection('contacts').findOne({ legacy_id: doc.contact_id, owner_email: ownerEmail });
        if (contact)
            enriched.contact_name = `${contact.first_name || ''} ${contact.last_name || ''}`.trim();
    }
    if (doc.doc_type_id && !doc.doc_type_name) {
        const oid = toMongoId(String(doc.doc_type_id));
        const docType = oid
            ? await db.collection('doc_types').findOne({ _id: oid })
            : await db.collection('doc_types').findOne({ legacy_id: doc.doc_type_id });
        if (docType)
            enriched.doc_type_name = docType.name;
    }
    if (doc.product_id && !doc.product_name) {
        const oid = toMongoId(String(doc.product_id));
        const product = oid
            ? await db.collection('products').findOne({ _id: oid, owner_email: ownerEmail })
            : await db.collection('products').findOne({ legacy_id: doc.product_id, owner_email: ownerEmail });
        if (product)
            enriched.product_name = product.name;
    }
    return enriched;
};
const makeEnrichedListRoute = (table) => {
    app.get(`/api/${table}`, async (req, res) => {
        const ownerEmail = req.ownerEmail;
        const db = req.db;
        const limit = Math.min(parseInt(p(req.query.limit)) || 50, 200);
        const offset = parseInt(p(req.query.offset)) || 0;
        try {
            const sortKey = (table === 'invoices' || table === 'orders') ? [['reference', -1]] : [['created_at', -1]];
            const rows = await db.collection(table).find({ owner_email: ownerEmail }).sort(sortKey).skip(offset).limit(limit).toArray();
            const enriched = await Promise.all(rows.map(r => enrichWithNames(db, ownerEmail, r)));
            res.json({ rows: enriched.map(serializeDoc) });
        }
        catch (err) {
            console.error(`Error fetching ${table}`, err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });
    app.post(`/api/${table}`, async (req, res) => {
        const ownerEmail = req.ownerEmail;
        const db = req.db;
        const { _id, id, ...fields } = req.body || {};
        const now = new Date().toISOString();
        const doc = await enrichWithNames(db, ownerEmail, {
            ...fields, owner_email: ownerEmail,
            created_at: fields.created_at || now, updated_at: now
        });
        if (!doc.reference) {
            if (table === 'invoices')
                doc.reference = generateDateRef('INV');
            else if (table === 'orders')
                doc.reference = generateDateRef('SO');
        }
        try {
            const result = await db.collection(table).insertOne(doc);
            const created = await db.collection(table).findOne({ _id: result.insertedId });
            res.status(201).json({ row: serializeDoc(created) });
        }
        catch (err) {
            console.error(`Error creating ${table}`, err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });
    app.put(`/api/${table}/:id`, async (req, res) => {
        const ownerEmail = req.ownerEmail;
        const db = req.db;
        const id = p(req.params.id);
        const oid = toMongoId(id);
        if (!oid)
            return res.status(400).json({ error: 'Invalid id' });
        const { _id, id: _bodyId, ...fields } = req.body || {};
        const enriched = await enrichWithNames(db, ownerEmail, fields);
        const updates = { ...enriched, updated_at: new Date().toISOString() };
        try {
            await db.collection(table).updateOne({ _id: oid, owner_email: ownerEmail }, { $set: updates });
            const updated = await db.collection(table).findOne({ _id: oid });
            if (!updated)
                return res.status(404).json({ error: 'Not found' });
            res.json({ row: serializeDoc(updated) });
        }
        catch (err) {
            console.error(`Error updating ${table}`, err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });
};
makeEnrichedListRoute('invoices');
makeEnrichedListRoute('orders');
makeEnrichedListRoute('documents');
makeEnrichedListRoute('sample_shipments');
// Quotations GET — enriched with company/contact names + product_names from items
app.get('/api/quotations', async (req, res) => {
    const ownerEmail = req.ownerEmail;
    const db = req.db;
    const limit = Math.min(parseInt(p(req.query.limit)) || 50, 200);
    const offset = parseInt(p(req.query.offset)) || 0;
    try {
        const rows = await db.collection('quotations').find({ owner_email: ownerEmail }).sort({ created_at: -1 }).skip(offset).limit(limit).toArray();
        const enriched = await Promise.all(rows.map(r => enrichWithNames(db, ownerEmail, r)));
        // Attach product_names from quotation_items (match by legacy_id or MongoDB string id)
        const legacyIds = enriched.filter(r => r.legacy_id != null).map(r => r.legacy_id);
        const mongoIds = enriched.filter(r => r.legacy_id == null).map(r => String(r._id || r.id)).filter(Boolean);
        const allQueryIds = [...legacyIds, ...mongoIds];
        const allItems = allQueryIds.length
            ? await db.collection('quotation_items').find({ owner_email: ownerEmail, quotation_id: { $in: allQueryIds } }).toArray()
            : [];
        const itemsByQuoteId = {};
        allItems.forEach(item => {
            const key = String(item.quotation_id);
            if (!itemsByQuoteId[key])
                itemsByQuoteId[key] = [];
            if (item.product_name && !itemsByQuoteId[key].includes(item.product_name)) {
                itemsByQuoteId[key].push(item.product_name);
            }
        });
        const result = enriched.map(r => {
            // 1. Names from quotation_items by legacy integer id
            const names = r.legacy_id != null ? (itemsByQuoteId[String(r.legacy_id)] || []).slice() : [];
            // 2. Names from quotation_items by MongoDB string id (new quotations)
            if (!names.length) {
                const mongoKey = String(r._id || '');
                if (mongoKey && itemsByQuoteId[mongoKey])
                    names.push(...itemsByQuoteId[mongoKey]);
            }
            // 3. Fallback: embedded items array
            if (!names.length && Array.isArray(r.items)) {
                r.items.forEach((item) => {
                    if (item?.product_name && !names.includes(item.product_name))
                        names.push(item.product_name);
                });
            }
            return { ...r, product_names: names.join(', ') || null };
        });
        res.json({ rows: result.map(serializeDoc) });
    }
    catch (err) {
        console.error('Error fetching quotations', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Helper: save line items array to quotation_items collection
const saveQuotationItems = async (db, ownerEmail, quotationId, lineItems) => {
    const now = new Date().toISOString();
    const validItems = lineItems.filter(i => i && (i.product_name || i.product_id));
    if (!validItems.length)
        return;
    await db.collection('quotation_items').insertMany(validItems.map((item) => ({
        quotation_id: quotationId,
        product_id: item.product_id || null,
        product_name: item.product_name || '',
        qty: item.qty || 0,
        unit_price: item.unit_price || 0,
        drums_price: item.drums_price || 0,
        bank_charge_price: item.bank_charge_price || 0,
        shipping_price: item.shipping_price || 0,
        customer_commission: item.customer_commission || 0,
        line_total: item.line_total || 0,
        owner_email: ownerEmail,
        created_at: now
    })));
};
// Quotations POST/PUT
app.post('/api/quotations', async (req, res) => {
    const ownerEmail = req.ownerEmail;
    const db = req.db;
    const { _id, id, items: lineItems, ...fields } = req.body || {};
    const now = new Date().toISOString();
    const doc = await enrichWithNames(db, ownerEmail, {
        ...fields, owner_email: ownerEmail,
        created_at: fields.created_at || now, updated_at: now
    });
    if (!doc.reference)
        doc.reference = generateDateRef('QT');
    try {
        const result = await db.collection('quotations').insertOne(doc);
        const quotationMongoId = result.insertedId.toString();
        // Save line items to quotation_items collection
        if (Array.isArray(lineItems) && lineItems.length) {
            await saveQuotationItems(db, ownerEmail, quotationMongoId, lineItems);
        }
        const created = await db.collection('quotations').findOne({ _id: result.insertedId });
        res.status(201).json({ row: serializeDoc(created) });
    }
    catch (err) {
        console.error('Error creating quotation', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.put('/api/quotations/:id', async (req, res) => {
    const ownerEmail = req.ownerEmail;
    const db = req.db;
    const id = p(req.params.id);
    const oid = toMongoId(id);
    if (!oid)
        return res.status(400).json({ error: 'Invalid id' });
    const { _id, id: _bodyId, items: lineItems, ...fields } = req.body || {};
    // Fetch legacy_id before update so we can purge legacy items too
    const existing = await db.collection('quotations').findOne({ _id: oid, owner_email: ownerEmail });
    const legacyId = existing?.legacy_id ?? null;
    const enriched = await enrichWithNames(db, ownerEmail, fields);
    const updates = { ...enriched, updated_at: new Date().toISOString() };
    // Always sync embedded items array so record.items stays current
    if (Array.isArray(lineItems))
        updates.items = lineItems;
    try {
        await db.collection('quotations').updateOne({ _id: oid, owner_email: ownerEmail }, { $set: updates });
        // Replace line items in quotation_items collection (delete by both MongoDB string id and legacy integer id)
        if (Array.isArray(lineItems)) {
            await db.collection('quotation_items').deleteMany({ quotation_id: id, owner_email: ownerEmail });
            if (legacyId != null) {
                await db.collection('quotation_items').deleteMany({ quotation_id: legacyId, owner_email: ownerEmail });
            }
            if (lineItems.length)
                await saveQuotationItems(db, ownerEmail, id, lineItems);
        }
        const updated = await db.collection('quotations').findOne({ _id: oid });
        if (!updated)
            return res.status(404).json({ error: 'Not found' });
        res.json({ row: serializeDoc(updated) });
    }
    catch (err) {
        console.error('Error updating quotation', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// ── File upload (must be before generic POST /api/:table) ─────────────────────
import multer from 'multer';
const _uploadsDir = path.resolve(process.cwd(), 'uploads');
const _multerStorage = multer.diskStorage({
    destination: (_req, _file, cb) => {
        fs.mkdirSync(_uploadsDir, { recursive: true });
        cb(null, _uploadsDir);
    },
    filename: (_req, file, cb) => {
        const uid = crypto.randomUUID();
        const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        cb(null, `${uid}-${safe}`);
    }
});
const _upload = multer({ storage: _multerStorage, limits: { fileSize: 50 * 1024 * 1024 } });
app.post('/api/upload', _upload.array('file', 20), async (req, res) => {
    const files = req.files;
    if (!files || files.length === 0)
        return res.status(400).json({ error: 'No file uploaded' });
    const ownerEmail = req.ownerEmail;
    const db = req.db;
    const now = new Date().toISOString();
    const title = (req.body.title || '').toString().trim() || 'Untitled';
    const rawCompanyId = req.body.company_id;
    const rawContactId = req.body.contact_id;
    const rawInvoiceId = req.body.invoice_id;
    const rawDocTypeId = req.body.doc_type_id;
    const contentType = req.body.contentType || '';
    const tagsRaw = Array.isArray(req.body.tags) ? req.body.tags : (req.body.tags ? [req.body.tags] : []);
    const tags = tagsRaw.map(Number).filter(Number.isFinite);
    const toId = (v) => {
        if (!v)
            return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : (v ? String(v) : null);
    };
    try {
        const results = [];
        for (const file of files) {
            const storageKey = `uploads/${file.filename}`;
            const docTitle = files.length === 1 ? title : `${title} — ${file.originalname}`;
            const doc = await enrichWithNames(db, ownerEmail, {
                title: docTitle,
                company_id: toId(rawCompanyId),
                contact_id: toId(rawContactId),
                invoice_id: toId(rawInvoiceId),
                doc_type_id: toId(rawDocTypeId),
                content_type: contentType || file.mimetype,
                storage_key: storageKey,
                file_url: `/api/files/${file.filename}`,
                file_size: file.size,
                original_name: file.originalname,
                tags: tags.length ? tags : undefined,
                owner_email: ownerEmail,
                created_at: now,
                updated_at: now
            });
            await db.collection('documents').insertOne(doc);
            results.push({ key: storageKey, url: `/api/files/${file.filename}`, size: file.size, mime: file.mimetype });
        }
        res.json({ uploaded: results.length, files: results });
    }
    catch (err) {
        console.error('Error uploading documents', err);
        res.status(500).json({ error: 'Upload failed. Please try again.' });
    }
});
// ── Generic CRUD ──────────────────────────────────────────────────────────────
// Routes registered later (analytics) need to be skipped here
const analyticsRouteNames = new Set(['kpis', 'timeseries', 'breakdown', 'forecast', 'data-quality']);
// GET list
app.get('/api/:table', async (req, res, next) => {
    const table = p(req.params.table);
    if (analyticsRouteNames.has(table))
        return next();
    if (!allowedTables.has(table))
        return res.status(404).json({ error: 'Unknown table' });
    const ownerEmail = req.ownerEmail;
    const db = req.db;
    const limit = Math.min(parseInt(p(req.query.limit)) || 50, 200);
    const offset = parseInt(p(req.query.offset)) || 0;
    // Build filter from query params (skip known meta params)
    const meta = new Set(['limit', 'offset', 'cache', '_']);
    const filter = { owner_email: ownerEmail };
    for (const [k, v] of Object.entries(req.query)) {
        if (!meta.has(k) && typeof v === 'string') {
            // Coerce numeric strings to numbers so integer fields match correctly
            const num = Number(v);
            filter[k] = (v !== '' && Number.isFinite(num)) ? num : v;
        }
    }
    // Sort products alphabetically; everything else newest first
    const sort = table === 'products' ? { name: 1 } : { created_at: -1 };
    try {
        const rows = await db.collection(table).find(filter).sort(sort).skip(offset).limit(limit).toArray();
        res.json({ rows: rows.map(serializeDoc) });
    }
    catch (err) {
        console.error(`Error fetching ${table}`, err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// GET one
app.get('/api/:table/:id', async (req, res) => {
    const table = p(req.params.table);
    const id = p(req.params.id);
    if (!allowedTables.has(table))
        return res.status(404).json({ error: 'Unknown table' });
    const ownerEmail = req.ownerEmail;
    const db = req.db;
    const oid = toMongoId(id);
    if (!oid)
        return res.status(400).json({ error: 'Invalid id' });
    const doc = await db.collection(table).findOne({ _id: oid, owner_email: ownerEmail });
    if (!doc)
        return res.status(404).json({ error: 'Not found' });
    res.json({ row: serializeDoc(doc) });
});
// POST create
app.post('/api/:table', async (req, res) => {
    const table = p(req.params.table);
    if (!allowedTables.has(table))
        return res.status(404).json({ error: 'Unknown table' });
    const ownerEmail = req.ownerEmail;
    const db = req.db;
    const body = req.body || {};
    // Strip _id / id from body, ensure owner_email
    const { _id, id, ...fields } = body;
    const now = new Date().toISOString();
    const doc = {
        ...fields,
        owner_email: ownerEmail,
        created_at: fields.created_at || now,
        updated_at: now
    };
    try {
        const result = await db.collection(table).insertOne(doc);
        const created = await db.collection(table).findOne({ _id: result.insertedId });
        res.status(201).json({ row: serializeDoc(created) });
    }
    catch (err) {
        console.error(`Error creating ${table}`, err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// PUT update
app.put('/api/:table/:id', async (req, res) => {
    const table = p(req.params.table);
    const id = p(req.params.id);
    if (!allowedTables.has(table))
        return res.status(404).json({ error: 'Unknown table' });
    const ownerEmail = req.ownerEmail;
    const db = req.db;
    const oid = toMongoId(id);
    if (!oid)
        return res.status(400).json({ error: 'Invalid id' });
    const { _id, id: _stripId, owner_email, ...fields } = req.body || {};
    if (!Object.keys(fields).length)
        return res.status(400).json({ error: 'No fields to update' });
    fields.updated_at = new Date().toISOString();
    try {
        const result = await db.collection(table).updateOne({ _id: oid, owner_email: ownerEmail }, { $set: fields });
        if (result.matchedCount === 0)
            return res.status(404).json({ error: 'Not found' });
        const updated = await db.collection(table).findOne({ _id: oid });
        res.json({ row: serializeDoc(updated) });
    }
    catch (err) {
        console.error(`Error updating ${table}`, err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// DELETE
app.delete('/api/:table/:id', async (req, res) => {
    const table = p(req.params.table);
    const id = p(req.params.id);
    if (!allowedTables.has(table))
        return res.status(404).json({ error: 'Unknown table' });
    const ownerEmail = req.ownerEmail;
    const db = req.db;
    const oid = toMongoId(id);
    if (!oid)
        return res.status(400).json({ error: 'Invalid id' });
    try {
        const result = await db.collection(table).deleteOne({ _id: oid, owner_email: ownerEmail });
        if (result.deletedCount === 0)
            return res.status(404).json({ error: 'Not found' });
        res.json({ ok: true });
    }
    catch (err) {
        console.error(`Error deleting ${table}`, err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// ── File serving ──────────────────────────────────────────────────────────────
const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');
// Files root is the parent of uploads/ so storage_key "uploads/foo.pdf" resolves correctly
const FILES_ROOT = path.resolve(process.cwd());
app.get('/api/files/*', (req, res) => {
    // req.params[0] gives everything after /api/files/
    const rawKey = req.params[0] || '';
    // Decode URL encoding and strip leading slashes
    let filePath;
    try {
        filePath = decodeURIComponent(rawKey).replace(/^\/+/, '');
    }
    catch {
        filePath = rawKey.replace(/^\/+/, '');
    }
    // Security: prevent path traversal
    const resolved = path.resolve(FILES_ROOT, filePath);
    if (!resolved.startsWith(FILES_ROOT + path.sep) && resolved !== FILES_ROOT) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    if (!fs.existsSync(resolved)) {
        return res.status(404).json({ error: 'File not found' });
    }
    const ext = path.extname(resolved).toLowerCase();
    const mimeMap = {
        '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
    const mime = mimeMap[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `inline; filename="${path.basename(resolved)}"`);
    res.sendFile(resolved);
});
// ── Analytics helpers ─────────────────────────────────────────────────────────
function parseAnalyticsDateRange(query) {
    const now = new Date();
    const endDate = query.end ? new Date(query.end) : now;
    const startDate = query.start
        ? new Date(query.start)
        : new Date(endDate.getTime() - 90 * 24 * 60 * 60 * 1000);
    return { startDate, endDate };
}
function toISOWeek(d) {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}
function toISOMonth(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function bucketDate(d, grain) {
    if (grain === 'month')
        return toISOMonth(d);
    return toISOWeek(d);
}
function enumerateBuckets(start, end, grain) {
    const buckets = [];
    const cur = new Date(start);
    while (cur <= end) {
        const b = bucketDate(cur, grain);
        if (!buckets.includes(b))
            buckets.push(b);
        cur.setDate(cur.getDate() + (grain === 'month' ? 28 : 7));
    }
    // ensure end bucket is included
    const endBucket = bucketDate(end, grain);
    if (!buckets.includes(endBucket))
        buckets.push(endBucket);
    return buckets;
}
function linearForecast(series, horizon) {
    if (series.length < 2) {
        const forecast = Array.from({ length: horizon }, (_, i) => ({ date: `+${i + 1}`, value: 0 }));
        const confidence = forecast.map(() => ({ lower: 0, upper: 0 }));
        return { forecast, confidence };
    }
    // Simple linear regression
    const n = series.length;
    const sumX = (n * (n - 1)) / 2;
    const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
    const sumY = series.reduce((a, p) => a + p.value, 0);
    const sumXY = series.reduce((a, p, i) => a + i * p.value, 0);
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    // Residual std dev for confidence bands
    const residuals = series.map((p, i) => p.value - (intercept + slope * i));
    const mse = residuals.reduce((a, r) => a + r * r, 0) / n;
    const std = Math.sqrt(mse);
    // Infer next bucket labels from last label in series
    const lastLabel = series[series.length - 1].date;
    const isWeek = /W\d+/.test(lastLabel);
    const isMonth = /^\d{4}-\d{2}$/.test(lastLabel);
    const forecast = [];
    const confidence = [];
    for (let h = 1; h <= horizon; h++) {
        const predicted = Math.max(0, intercept + slope * (n - 1 + h));
        let dateLabel = `+${h}`;
        if (isWeek) {
            const [yr, wk] = lastLabel.split('-W').map(Number);
            const totalWeek = wk + h;
            const newYr = yr + Math.floor((totalWeek - 1) / 52);
            const newWk = ((totalWeek - 1) % 52) + 1;
            dateLabel = `${newYr}-W${String(newWk).padStart(2, '0')}`;
        }
        else if (isMonth) {
            const [yr, mo] = lastLabel.split('-').map(Number);
            const totalMonth = mo + h - 1;
            const newYr = yr + Math.floor(totalMonth / 12);
            const newMo = (totalMonth % 12) + 1;
            dateLabel = `${newYr}-${String(newMo).padStart(2, '0')}`;
        }
        forecast.push({ date: dateLabel, value: Math.round(predicted * 100) / 100 });
        confidence.push({
            lower: Math.max(0, Math.round((predicted - 1.96 * std) * 100) / 100),
            upper: Math.round((predicted + 1.96 * std) * 100) / 100
        });
    }
    return { forecast, confidence };
}
// ── Analytics routes (registered before generic :table handler) ───────────────
// (Route implementations follow below; helper functions are hoisted)
app.get('/api/kpis', async (req, res) => {
    try {
        const owner = req.ownerEmail;
        const db = req.db;
        const { startDate, endDate } = parseAnalyticsDateRange(req.query);
        const invoicesCol = db.collection('invoices');
        const ordersCol = db.collection('orders');
        const quotationsCol = db.collection('quotations');
        const companiesCol = db.collection('companies');
        const tasksCol = db.collection('tasks');
        const dateFilter = { $gte: startDate.toISOString().slice(0, 10), $lte: endDate.toISOString().slice(0, 10) + 'T23:59:59.999Z' };
        const [revenueAgg, openInvoiceAgg, pipelineAgg, orderCount, invoiceCount, quotationCount, activeCompanies, overdueInvoices, tasksDue7d, tasksOverdue] = await Promise.all([
            invoicesCol.aggregate([
                { $match: { owner_email: owner, status: 'Paid', created_at: dateFilter } },
                { $group: { _id: null, total: { $sum: { $toDouble: '$total_amount' } } } }
            ]).toArray(),
            invoicesCol.aggregate([
                { $match: { owner_email: owner, status: { $in: ['Unpaid', 'Open', 'Overdue'] } } },
                { $group: { _id: null, total: { $sum: { $toDouble: '$total_amount' } } } }
            ]).toArray(),
            // Pipeline computed from quotation_items (total_amount not stored on quotation docs)
            (async () => {
                const pipelineQuotes = await quotationsCol.find({ owner_email: owner, status: { $in: ['Draft', 'Sent'] } }, { projection: { _id: 1, legacy_id: 1 } }).toArray();
                const qIds = pipelineQuotes.flatMap((q) => [q._id.toString(), ...(q.legacy_id != null ? [q.legacy_id] : [])]);
                if (!qIds.length)
                    return [{ _id: null, total: 0 }];
                return db.collection('quotation_items').aggregate([
                    { $match: { owner_email: owner, quotation_id: { $in: qIds } } },
                    { $group: { _id: null, total: { $sum: { $toDouble: '$line_total' } } } }
                ]).toArray();
            })(),
            ordersCol.countDocuments({ owner_email: owner, created_at: dateFilter }),
            invoicesCol.countDocuments({ owner_email: owner, created_at: dateFilter }),
            quotationsCol.countDocuments({ owner_email: owner, created_at: dateFilter }),
            companiesCol.countDocuments({ owner_email: owner, status: 'Active' }),
            invoicesCol.countDocuments({ owner_email: owner, status: { $in: ['Unpaid', 'Open', 'Overdue'] }, due_date: { $lt: new Date().toISOString().slice(0, 10) } }),
            tasksCol.countDocuments({ owner_email: owner, status: { $nin: ['Done', 'Closed'] }, due_date: { $gte: new Date().toISOString().slice(0, 10), $lte: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10) } }),
            tasksCol.countDocuments({ owner_email: owner, status: { $nin: ['Done', 'Closed'] }, due_date: { $lt: new Date().toISOString().slice(0, 10) } })
        ]);
        // Previous period (same duration, shifted back) for trend badges
        let prevRevenueAgg = [], prevOrderCount = 0, prevInvoiceCount = 0, prevQuotationCount = 0;
        try {
            const duration = endDate.getTime() - startDate.getTime();
            const prevEnd = new Date(startDate.getTime() - 1);
            const prevStart = new Date(startDate.getTime() - duration);
            const prevDateFilter = { $gte: prevStart.toISOString().slice(0, 10), $lte: prevEnd.toISOString().slice(0, 10) + 'T23:59:59.999Z' };
            [prevRevenueAgg, prevOrderCount, prevInvoiceCount, prevQuotationCount] = await Promise.all([
                invoicesCol.aggregate([
                    { $match: { owner_email: owner, status: 'Paid', created_at: prevDateFilter } },
                    { $group: { _id: null, total: { $sum: { $toDouble: '$total_amount' } } } }
                ]).toArray(),
                ordersCol.countDocuments({ owner_email: owner, created_at: prevDateFilter }),
                invoicesCol.countDocuments({ owner_email: owner, created_at: prevDateFilter }),
                quotationsCol.countDocuments({ owner_email: owner, created_at: prevDateFilter })
            ]);
        }
        catch (prevErr) {
            console.warn('KPI prev-period query failed (non-fatal):', prevErr);
        }
        res.json({
            total_revenue: revenueAgg[0]?.total ?? 0,
            invoice_total_open: openInvoiceAgg[0]?.total ?? 0,
            quotation_pipeline: pipelineAgg[0]?.total ?? 0,
            order_count: orderCount,
            invoice_count: invoiceCount,
            quotation_count: quotationCount,
            company_count_active: activeCompanies,
            overdue_invoice_count: overdueInvoices,
            tasks_due_7d: tasksDue7d,
            tasks_overdue: tasksOverdue,
            prev_total_revenue: prevRevenueAgg[0]?.total ?? 0,
            prev_order_count: prevOrderCount,
            prev_invoice_count: prevInvoiceCount,
            prev_quotation_count: prevQuotationCount
        });
    }
    catch (err) {
        console.error('KPIs error', err);
        res.status(500).json({ error: 'Failed to load KPIs' });
    }
});
// ── GET /api/timeseries ───────────────────────────────────────────────────────
app.get('/api/timeseries', async (req, res) => {
    try {
        const owner = req.ownerEmail;
        const db = req.db;
        const metric = req.query.metric || 'revenue';
        const grain = req.query.grain || 'week';
        const statusFilter = req.query.status;
        const { startDate, endDate } = parseAnalyticsDateRange(req.query);
        const buckets = enumerateBuckets(startDate, endDate, grain);
        const bucketMap = {};
        buckets.forEach(b => { bucketMap[b] = 0; });
        if (metric === 'revenue') {
            const docs = await db.collection('invoices').find({
                owner_email: owner,
                status: 'Paid',
                created_at: { $gte: startDate.toISOString().slice(0, 10), $lte: endDate.toISOString().slice(0, 10) + 'T23:59:59.999Z' }
            }).toArray();
            docs.forEach(doc => {
                const d = doc.created_at ? new Date(doc.created_at) : null;
                if (!d || isNaN(d.getTime()))
                    return;
                const b = bucketDate(d, grain);
                if (b in bucketMap)
                    bucketMap[b] = (bucketMap[b] || 0) + (parseFloat(doc.total_amount) || 0);
            });
        }
        else if (metric === 'invoices') {
            const match = { owner_email: owner, created_at: { $gte: startDate.toISOString().slice(0, 10), $lte: endDate.toISOString().slice(0, 10) + 'T23:59:59.999Z' } };
            if (statusFilter)
                match.status = statusFilter;
            const docs = await db.collection('invoices').find(match).toArray();
            docs.forEach(doc => {
                const d = doc.created_at ? new Date(doc.created_at) : null;
                if (!d || isNaN(d.getTime()))
                    return;
                const b = bucketDate(d, grain);
                if (b in bucketMap)
                    bucketMap[b] = (bucketMap[b] || 0) + 1;
            });
        }
        else if (metric === 'samples') {
            // Use orders as "samples" metric
            const docs = await db.collection('orders').find({
                owner_email: owner,
                created_at: { $gte: startDate.toISOString().slice(0, 10), $lte: endDate.toISOString().slice(0, 10) + 'T23:59:59.999Z' }
            }).toArray();
            docs.forEach(doc => {
                const d = doc.created_at ? new Date(doc.created_at) : null;
                if (!d || isNaN(d.getTime()))
                    return;
                const b = bucketDate(d, grain);
                if (b in bucketMap)
                    bucketMap[b] = (bucketMap[b] || 0) + 1;
            });
        }
        const data = buckets.map(b => ({ date: b, value: bucketMap[b] || 0 }));
        res.json({ data });
    }
    catch (err) {
        console.error('Timeseries error', err);
        res.status(500).json({ error: 'Failed to load timeseries' });
    }
});
// ── GET /api/breakdown ────────────────────────────────────────────────────────
app.get('/api/breakdown', async (req, res) => {
    try {
        const owner = req.ownerEmail;
        const db = req.db;
        const entity = req.query.entity || 'status';
        const source = req.query.source || 'invoices';
        const metricType = req.query.metric || 'count';
        const { startDate, endDate } = parseAnalyticsDateRange(req.query);
        const dateField = source === 'tasks' ? 'due_date'
            : (source === 'invoices' || source === 'shipping_schedules' || source === 'orders' || source === 'quotations') ? 'created_at'
                : 'date';
        const endStr = dateField === 'due_date' ? endDate.toISOString().slice(0, 10) : endDate.toISOString().slice(0, 10) + 'T23:59:59.999Z';
        const dateStr = { $gte: startDate.toISOString().slice(0, 10), $lte: endStr };
        const col = db.collection(source);
        const docs = await col.find({ owner_email: owner, [dateField]: dateStr }).toArray();
        const groupMap = {};
        if (source === 'quotations' && metricType === 'revenue') {
            // total_amount not stored on quotations — revenue lives in quotation_items.line_total
            const qIds = docs.flatMap((q) => [q._id.toString(), ...(q.legacy_id != null ? [q.legacy_id] : [])]);
            const items = qIds.length
                ? await db.collection('quotation_items').find({ owner_email: owner, quotation_id: { $in: qIds } }).toArray()
                : [];
            const totalsMap = {};
            items.forEach((item) => {
                const k = String(item.quotation_id);
                totalsMap[k] = (totalsMap[k] || 0) + (parseFloat(item.line_total) || 0);
            });
            docs.forEach((doc) => {
                const groupKey = doc[entity] || 'Unknown';
                const qTotal = (totalsMap[doc._id.toString()] || 0) + (doc.legacy_id != null ? (totalsMap[String(doc.legacy_id)] || 0) : 0);
                groupMap[groupKey] = (groupMap[groupKey] || 0) + qTotal;
            });
        }
        else {
            docs.forEach(doc => {
                const key = doc[entity] || 'Unknown';
                if (metricType === 'revenue') {
                    groupMap[key] = (groupMap[key] || 0) + (parseFloat(doc.total_amount) || 0);
                }
                else {
                    groupMap[key] = (groupMap[key] || 0) + 1;
                }
            });
        }
        const data = Object.entries(groupMap)
            .map(([label, value]) => ({ label, value }))
            .sort((a, b) => b.value - a.value);
        res.json({ data });
    }
    catch (err) {
        console.error('Breakdown error', err);
        res.status(500).json({ error: 'Failed to load breakdown' });
    }
});
// ── GET /api/invoice-aging ────────────────────────────────────────────────────
app.get('/api/invoice-aging', async (req, res) => {
    const owner = req.ownerEmail;
    const db = req.db;
    try {
        const today = new Date();
        const invoices = await db.collection('invoices')
            .find({ owner_email: owner, status: { $in: ['Unpaid', 'Open', 'Overdue'] } })
            .toArray();
        const buckets = { '< 30d': 0, '30–60d': 0, '61–90d': 0, '> 90d': 0 };
        invoices.forEach((inv) => {
            const refDate = inv.due_date || inv.created_at;
            if (!refDate)
                return;
            const normalised = String(refDate).replace(' ', 'T');
            const d = new Date(normalised);
            if (isNaN(d.getTime()))
                return;
            const days = Math.floor((today.getTime() - d.getTime()) / 86400000);
            if (days < 0)
                return;
            if (days < 30)
                buckets['< 30d']++;
            else if (days < 60)
                buckets['30–60d']++;
            else if (days < 90)
                buckets['61–90d']++;
            else
                buckets['> 90d']++;
        });
        res.json({ data: Object.entries(buckets).map(([label, value]) => ({ label, value })) });
    }
    catch (err) {
        console.error('Invoice aging error', err);
        res.status(500).json({ error: 'Failed to load invoice aging' });
    }
});
// ── GET /api/forecast ─────────────────────────────────────────────────────────
app.get('/api/forecast', async (req, res) => {
    try {
        const owner = req.ownerEmail;
        const db = req.db;
        const metric = req.query.metric || 'revenue';
        const grain = req.query.grain || 'month';
        const horizon = parseInt(req.query.horizon) || 6;
        const { startDate, endDate } = parseAnalyticsDateRange(req.query);
        const buckets = enumerateBuckets(startDate, endDate, grain);
        const bucketMap = {};
        buckets.forEach(b => { bucketMap[b] = 0; });
        if (metric === 'revenue') {
            const docs = await db.collection('invoices').find({
                owner_email: owner,
                status: 'Paid',
                created_at: { $gte: startDate.toISOString().slice(0, 10), $lte: endDate.toISOString().slice(0, 10) + 'T23:59:59.999Z' }
            }).toArray();
            docs.forEach(doc => {
                const d = doc.created_at ? new Date(doc.created_at) : null;
                if (!d || isNaN(d.getTime()))
                    return;
                const b = bucketDate(d, grain);
                if (b in bucketMap)
                    bucketMap[b] = (bucketMap[b] || 0) + (parseFloat(doc.total_amount) || 0);
            });
        }
        else if (metric === 'tasks') {
            const docs = await db.collection('tasks').find({
                owner_email: owner,
                due_date: { $gte: startDate.toISOString().slice(0, 10), $lte: endDate.toISOString().slice(0, 10) }
            }).toArray();
            docs.forEach(doc => {
                const d = doc.due_date ? new Date(doc.due_date) : null;
                if (!d || isNaN(d.getTime()))
                    return;
                const b = bucketDate(d, grain);
                if (b in bucketMap)
                    bucketMap[b] = (bucketMap[b] || 0) + 1;
            });
        }
        else if (metric === 'shipping') {
            const docs = await db.collection('shipping_schedules').find({
                owner_email: owner,
                created_at: { $gte: startDate.toISOString().slice(0, 10), $lte: endDate.toISOString().slice(0, 10) + 'T23:59:59.999Z' }
            }).toArray();
            docs.forEach(doc => {
                const d = doc.created_at ? new Date(doc.created_at) : null;
                if (!d || isNaN(d.getTime()))
                    return;
                const b = bucketDate(d, grain);
                if (b in bucketMap)
                    bucketMap[b] = (bucketMap[b] || 0) + 1;
            });
        }
        const series = buckets.map(b => ({ date: b, value: bucketMap[b] || 0 }));
        const { forecast, confidence } = linearForecast(series, horizon);
        res.json({ series, forecast, confidence });
    }
    catch (err) {
        console.error('Forecast error', err);
        res.status(500).json({ error: 'Failed to load forecast' });
    }
});
// ── GET /api/data-quality ─────────────────────────────────────────────────────
app.get('/api/data-quality', async (req, res) => {
    try {
        const owner = req.ownerEmail;
        const db = req.db;
        const [companiesNoEmail, companiesNoPhone, contactsNoEmail, contactsNoCompany, invoicesNoCompany, invoicesNoContact, ordersNoCompany, tasksNoAssignee] = await Promise.all([
            db.collection('companies').countDocuments({ owner_email: owner, $or: [{ email: { $exists: false } }, { email: '' }, { email: null }] }),
            db.collection('companies').countDocuments({ owner_email: owner, $or: [{ phone: { $exists: false } }, { phone: '' }, { phone: null }] }),
            db.collection('contacts').countDocuments({ owner_email: owner, $or: [{ email: { $exists: false } }, { email: '' }, { email: null }] }),
            db.collection('contacts').countDocuments({ owner_email: owner, $or: [{ company_id: { $exists: false } }, { company_id: '' }, { company_id: null }] }),
            db.collection('invoices').countDocuments({ owner_email: owner, $or: [{ company_id: { $exists: false } }, { company_id: '' }, { company_id: null }] }),
            db.collection('invoices').countDocuments({ owner_email: owner, $or: [{ contact_id: { $exists: false } }, { contact_id: '' }, { contact_id: null }] }),
            db.collection('orders').countDocuments({ owner_email: owner, $or: [{ company_id: { $exists: false } }, { company_id: '' }, { company_id: null }] }),
            db.collection('tasks').countDocuments({ owner_email: owner, $or: [{ assignee: { $exists: false } }, { assignee: '' }, { assignee: null }] })
        ]);
        res.json({
            data: {
                missing_fields: {
                    companies_without_email: companiesNoEmail,
                    companies_without_phone: companiesNoPhone,
                    contacts_without_email: contactsNoEmail,
                    invoices_without_company: invoicesNoCompany,
                    invoices_without_contact: invoicesNoContact,
                    orders_without_company: ordersNoCompany,
                    tasks_without_assignee: tasksNoAssignee
                },
                orphans: {
                    contacts_without_company: contactsNoCompany
                }
            }
        });
    }
    catch (err) {
        console.error('Data quality error', err);
        res.status(500).json({ error: 'Failed to load data quality' });
    }
});
// ── Static files / SPA fallback ───────────────────────────────────────────────
app.use(express.static('public'));
app.get('*', (req, res) => {
    res.sendFile('index.html', { root: 'public' });
});
// ── Server start ──────────────────────────────────────────────────────────────
async function seedAdminUser() {
    try {
        const db = await getMongoDB();
        const usersCol = db.collection('users');
        if (await usersCol.countDocuments() > 0)
            return;
        const email = normalizeEmail(process.env.ADMIN_EMAIL || 'admin@example.com');
        const password = process.env.ADMIN_PASSWORD || 'admin123';
        const salt = randomToken();
        const hash = await hashPassword(password, salt);
        await usersCol.insertOne({
            email, name: 'Admin', role: adminRole, access: '',
            access_list: JSON.stringify(defaultAccessList),
            password_hash: hash, password_salt: salt, enabled: 1
        });
        console.log('');
        console.log('╔══════════════════════════════════════════╗');
        console.log('║          Default admin created           ║');
        console.log(`║  Email   : ${email.padEnd(30)}║`);
        console.log(`║  Password: ${password.padEnd(30)}║`);
        console.log('║  Change your password after first login  ║');
        console.log('╚══════════════════════════════════════════╝');
        console.log('');
    }
    catch (err) {
        console.error('Failed to seed admin user:', err);
    }
}
const server = app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    seedAdminUser();
});
process.on('SIGTERM', async () => {
    server.close(async () => { await closeMongoDB(); process.exit(0); });
});
export default app;
