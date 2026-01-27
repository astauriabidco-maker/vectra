
const { Client } = require('pg');

const credentials = [
    { user: 'admin', password: 'secret_dev', db: 'whatsapp_hub' },
    { user: 'postgres', password: 'password', db: 'postgres' },
    { user: 'postgres', password: 'your_secure_password_here', db: 'postgres' },
    { user: 'postgres', password: 'your_secure_password_here', db: 'whatsapp_hub' },
    { user: 'postgres', password: 'secret_dev', db: 'whatsapp_hub' },
    { user: 'admin', password: 'your_secure_password_here', db: 'whatsapp_hub' },
    { user: 'postgres', password: 'password', db: 'whatsapp_hub' },
    { user: 'postgres', password: 'mysecretpassword', db: 'postgres' }, // Common docker default
    { user: 'postgres', password: 'postgres', db: 'postgres' },
    { user: 'postgres', password: '', db: 'postgres' },
    { user: process.env.USER, password: '', db: 'postgres' }, // System user
    { user: 'root', password: '', db: 'postgres' },
];

async function testConnection(cred) {
    const client = new Client({
        host: 'localhost',
        port: 5432,
        user: cred.user,
        password: cred.password,
        database: cred.db,
        connectionTimeoutMillis: 2000,
    });

    try {
        await client.connect();
        console.log(`✅ SUCCESS: Connected with user="${cred.user}", password="${cred.password}", db="${cred.db}"`);
        await client.end();
        return true;
    } catch (err) {
        console.log(`❌ FAILED: user="${cred.user}", password="${cred.password}", db="${cred.db}" - ${err.message}`);
        return false;
    }
}

async function run() {
    console.log('--- Testing Postgres Credentials ---');
    for (const cred of credentials) {
        const success = await testConnection(cred);
        if (success) {
            console.log('\n!!! FOUND WORKING CREDENTIALS !!!');
            console.log(JSON.stringify(cred, null, 2));
            process.exit(0);
        }
    }
    console.log('\n--- All attempts failed ---');
    process.exit(1);
}

run();
