#!/usr/bin/env node
/**
 * gen-readme-txt.cjs
 * Converts README.md to a readable plain-text README.txt for distribution.
 * Usage: node scripts/gen-readme-txt.cjs [output-path]
 * Default output: release/Vitrine <version> README.txt
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Resolve output path
let outPath = process.argv[2];
if (!outPath) {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  outPath = path.join(ROOT, 'release', `Vitrine ${pkg.version} README.txt`);
}

const src = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');

function convert(md) {
  const lines = md.split('\n');
  const out = [];
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Code fences: drop the fence markers, keep code indented
    if (/^```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      out.push('    ' + line);
      continue;
    }

    // Drop image/badge lines  ![...](...) — entire line
    if (/^\s*!\[/.test(line)) {
      continue;
    }

    // Headings: # H1 -> UPPERCASE title + underline, ## -> underline with =, ### -> underline with -
    const h1 = line.match(/^# (.+)/);
    if (h1) {
      const text = stripInline(h1[1]);
      out.push(text.toUpperCase());
      out.push('='.repeat(text.length));
      continue;
    }
    const h2 = line.match(/^## (.+)/);
    if (h2) {
      const text = stripInline(h2[1]);
      out.push('');
      out.push(text);
      out.push('='.repeat(text.length));
      continue;
    }
    const h3 = line.match(/^### (.+)/);
    if (h3) {
      const text = stripInline(h3[1]);
      out.push('');
      out.push(text);
      out.push('-'.repeat(text.length));
      continue;
    }
    const h4 = line.match(/^#### (.+)/);
    if (h4) {
      const text = stripInline(h4[1]);
      out.push('  ' + text.toUpperCase());
      continue;
    }

    // Horizontal rules
    if (/^---+$/.test(line.trim())) {
      out.push('-'.repeat(60));
      continue;
    }

    // Apply inline transformations then push
    out.push(stripInline(line));
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function stripInline(text) {
  // **bold** / __bold__ -> plain
  text = text.replace(/\*\*(.+?)\*\*/g, '$1');
  text = text.replace(/__(.+?)__/g, '$1');
  // *italic* / _italic_ -> plain
  text = text.replace(/\*(.+?)\*/g, '$1');
  text = text.replace(/_(.+?)_/g, '$1');
  // `code` -> plain
  text = text.replace(/`([^`]+)`/g, '$1');
  // [text](url) -> text (url)
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
  // ![alt](url) -> (drop)
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  return text;
}

const result = convert(src);

// Ensure parent dir exists
const dir = path.dirname(outPath);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

fs.writeFileSync(outPath, result, 'utf8');
console.log('Written:', outPath);
// Print first 10 non-empty lines as a smoke preview
const preview = result.split('\n').filter(l => l.trim()).slice(0, 10);
console.log('\nPreview (first 10 non-empty lines):');
preview.forEach(l => console.log('  ' + l));
