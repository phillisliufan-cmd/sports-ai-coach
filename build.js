const fs = require('fs');

let html = fs.readFileSync('index.html', 'utf8');
const key = process.env.ANTHROPIC_API_KEY || '';
html = html.replace('__ANTHROPIC_API_KEY__', key);
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/index.html', html);
console.log('Build complete. Key injected:', key ? 'YES' : 'NO (empty)');
