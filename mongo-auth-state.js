const { MongoClient } = require('mongodb');
const { initAuthCreds } = require('@whiskeysockets/baileys');

const MONGODB_URI = process.env.MONGODB_URI;
const COLLECTION_NAME = 'baileys_auth';

if (!MONGODB_URI) throw new Error('MONGODB_URI required');

let client;
let database;
const locks = new Map();

const lock = (key, fn) => {
    const prev = locks.get(key) || Promise.resolve();
    let release;
    const next = new Promise((resolve) => { release = resolve; });
    locks.set(key, next);
    return prev.then(() => fn()).finally(() => { release(); if (locks.get(key) === next) locks.delete(key); });
};

const getDbName = () => {
    try {
        const url = new URL(MONGODB_URI);
        const path = url.pathname.replace(/^\//, '');
        return path || 'baileys';
    } catch { return 'baileys'; }
};

const connect = async () => {
    if (!client) client = new MongoClient(MONGODB_URI);
    await client.connect();
    if (!database) database = client.db(getDbName());
    return database;
};

const getCol = async () => {
    const db = await connect();
    return db.collection(COLLECTION_NAME);
};

// 🔧 Encode: semua Buffer jadi { __type: 'Buffer', data: base64 }
const encode = (obj) => {
    return JSON.stringify(obj, (k, v) => {
        if (Buffer.isBuffer(v)) return { __type: 'Buffer', data: v.toString('base64') };
        return v;
    });
};

// 🔧 Decode: balikin jadi Buffer
const decode = (str) => {
    return JSON.parse(str, (k, v) => {
        if (v && v.__type === 'Buffer') return Buffer.from(v.data, 'base64');
        return v;
    });
};

const fixFileName = (file) => file.replace(/\//g, '__').replace(/:/g, '-');

const readData = async (file) => {
    const col = await getCol();
    const doc = await col.findOne({ _id: fixFileName(file) });
    if (!doc?.value) return null;
    return decode(doc.value);
};

const writeData = async (data, file) => {
    const col = await getCol();
    const value = encode(data);
    await col.updateOne({ _id: fixFileName(file) }, { $set: { value, updatedAt: new Date() } }, { upsert: true });
};

const removeData = async (file) => {
    const col = await getCol();
    await col.deleteOne({ _id: fixFileName(file) });
};

const readAuthData = async (file) => lock(file, () => readData(file));
const writeAuthData = async (data, file) => lock(file, () => writeData(data, file));
const deleteAuthData = async (file) => lock(file, () => removeData(file));

const clearAuthData = async () => {
    const col = await getCol();
    await col.deleteMany({});
};

const useMongoAuthState = async () => {
    const creds = (await readAuthData('creds.json')) || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(ids.map(async (id) => {
                        const stored = await readAuthData(`${type}-${id}.json`);
                        data[id] = stored;
                    }));
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const file = `${category}-${id}.json`;
                            if (value) tasks.push(writeAuthData(value, file));
                            else tasks.push(deleteAuthData(file));
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: async () => writeAuthData(creds, 'creds.json'),
        clear: clearAuthData
    };
};

module.exports = { useMongoAuthState };