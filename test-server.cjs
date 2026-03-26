// Test script for the converted Node.js server
const { spawn } = require('child_process');
const http = require('http');

console.log('Testing converted Node.js server...');

// Create a simple test to check if server starts
const serverProcess = spawn('node', ['dist/server.js'], {
  env: {
    ...process.env,
    PORT: '3001',
    MONGODB_URI: 'mongodb://localhost:27017',
    MONGODB_DB_NAME: 'crmcloudflare',
    AUTH_SECRET: 'test-secret-key-for-testing-only',
    NODE_ENV: 'test'
  },
  stdio: 'pipe'
});

let serverOutput = '';
let errorOutput = '';

serverProcess.stdout.on('data', (data) => {
  serverOutput += data.toString();
  console.log('Server stdout:', data.toString().trim());
});

serverProcess.stderr.on('data', (data) => {
  errorOutput += data.toString();
  console.error('Server stderr:', data.toString().trim());
});

// Give server time to start
setTimeout(() => {
  // Test health endpoint
  const options = {
    hostname: 'localhost',
    port: 3001,
    path: '/api/health',
    method: 'GET',
    timeout: 5000
  };

  const req = http.request(options, (res) => {
    console.log(`Health check status: ${res.statusCode}`);
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    res.on('end', () => {
      console.log('Health check response:', data);
      serverProcess.kill();
      process.exit(res.statusCode === 200 ? 0 : 1);
    });
  });

  req.on('error', (err) => {
    console.error('Health check failed:', err.message);
    serverProcess.kill();
    process.exit(1);
  });

  req.on('timeout', () => {
    console.error('Health check timeout');
    req.destroy();
    serverProcess.kill();
    process.exit(1);
  });

  req.end();
}, 3000);

// Kill server if test takes too long
setTimeout(() => {
  console.error('Test timeout');
  serverProcess.kill();
  process.exit(1);
}, 10000);