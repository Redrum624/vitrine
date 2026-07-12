const fs = require('fs');
const path = require('path');

const targetDirs = ['src/components'];

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

let files = [];
targetDirs.forEach(dir => {
  files = files.concat(walkSync(dir));
});

let modifiedFiles = 0;

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let originalContent = content;

  // 1. Replace Slider Thumb Colors with vibrant cyan
  content = content.replace(/\[&::-webkit-slider-thumb\]:bg-[a-z]+-[0-9]+/g, '[&::-webkit-slider-thumb]:bg-cyan-400');
  content = content.replace(/\[&::-webkit-slider-thumb\]:hover:bg-[a-z]+-[0-9]+/g, '[&::-webkit-slider-thumb]:hover:bg-cyan-300');

  // 2. Replace Peer-checked backgrounds (Toggle switches)
  content = content.replace(/peer-checked:bg-[a-z]+-[0-9]+/g, 'peer-checked:bg-gray-400');

  // 3. Replace text colors for alerts/status
  content = content.replace(/text-(blue|purple|green|red|yellow|indigo|pink|orange|emerald|teal)-[0-9]+/g, 'text-gray-300');

  // 4. Backgrounds
  content = content.replace(/bg-(blue|purple|green|red|yellow|indigo|pink|orange|emerald|teal)-[0-9]+\/?[0-9]*/g, 'bg-gray-800');
  content = content.replace(/hover:bg-(blue|purple|green|red|yellow|indigo|pink|orange|emerald|teal)-[0-9]+/g, 'hover:bg-gray-700');
  content = content.replace(/from-(blue|purple|green|red|yellow|indigo|pink|orange|emerald|teal)-[0-9]+\/?[0-9]*/g, 'from-gray-900');
  content = content.replace(/to-(blue|purple|green|red|yellow|indigo|pink|orange|emerald|teal)-[0-9]+\/?[0-9]*/g, 'to-black');

  // 5. Borders
  content = content.replace(/border-(blue|purple|green|red|yellow|indigo|pink|orange|emerald|teal)-[0-9]+\/?[0-9]*/g, 'border-gray-600');
  content = content.replace(/focus:border-(blue|purple|green|red|yellow|indigo|pink|orange|emerald|teal)-[0-9]+/g, 'focus:border-white');
  content = content.replace(/focus:ring-(blue|purple|green|red|yellow|indigo|pink|orange|emerald|teal)-[0-9]+\/?[0-9]*/g, 'focus:ring-gray-400');

  if (content !== originalContent) {
    fs.writeFileSync(file, content, 'utf8');
    modifiedFiles++;
  }
});

console.log(`Modified ${modifiedFiles} files in components.`);
