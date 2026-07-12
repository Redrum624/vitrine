const fs = require('fs');
const path = require('path');

// Replace in index.css
let cssPath = path.join('src', 'index.css');
let cssContent = fs.readFileSync(cssPath, 'utf8');
cssContent = cssContent.replace(/#00e5ff/g, '#e5e5e5');
cssContent = cssContent.replace(/#67e8f9/g, '#ffffff');
cssContent = cssContent.replace(/#06b6d4/g, '#d4d4d8');
cssContent = cssContent.replace(/rgba\(0,\s*229,\s*255,\s*0\.4\)/g, 'rgba(255, 255, 255, 0.4)');
fs.writeFileSync(cssPath, cssContent);

// Replace in components
function walkSync(dir, filelist = []) {
  if (!fs.existsSync(dir)) return filelist;
  fs.readdirSync(dir).forEach(file => {
    const dirFile = path.join(dir, file);
    if (fs.statSync(dirFile).isDirectory()) {
      filelist = walkSync(dirFile, filelist);
    } else if (dirFile.endsWith('.tsx') || dirFile.endsWith('.ts')) {
      filelist.push(dirFile);
    }
  });
  return filelist;
}

let files = walkSync('src/components');
let modified = 0;

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let orig = content;

  content = content.replace(/bg-cyan-400/g, 'bg-gray-200');
  content = content.replace(/bg-cyan-300/g, 'bg-white');

  if (content !== orig) {
    fs.writeFileSync(file, content);
    modified++;
  }
});

console.log(`Updated index.css and ${modified} components.`);
