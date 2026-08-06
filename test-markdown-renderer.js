#!/usr/bin/env node
/**
 * Focused verification for report Markdown rendering configuration.
 * Run: node test-markdown-renderer.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const https = require('node:https');
const vm = require('node:vm');

const page = fs.readFileSync(require.resolve('./index.html'), 'utf8');
const markedUrl = 'https://cdn.jsdelivr.net/npm/marked@18.0.9/lib/marked.umd.js';

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`GET ${url} returned ${response.statusCode}`));
        return;
      }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

async function main() {
  assert.match(
    page,
    /DOMPurify\.sanitize\(marked\.parse\(md, \{ gfm: true, singleTilde: false \}\)\)/,
    'report HTML must be sanitized after parsing with GFM tables and single tilde disabled'
  );

  const source = await fetchText(markedUrl);
  const sandbox = { module: { exports: {} }, exports: {} };
  vm.runInNewContext(source, sandbox, { filename: 'marked.umd.js' });
  const { marked } = sandbox.module.exports;
  const render = (markdown) => marked.parse(markdown, { gfm: true, singleTilde: false });

  assert.match(render('~8.36M'), /<p>~8\.36M<\/p>/);
  assert.match(render('**~\$31.04**'), /<p><strong>~\$31\.04<\/strong><\/p>/);
  assert.match(render('~~obsolete~~'), /<p><del>obsolete<\/del><\/p>/);
  assert.match(render('| Name | Value |\n| --- | --- |\n| A | 1 |'), /<table>/);

  console.log('Markdown renderer configuration and behavior verified.');
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
