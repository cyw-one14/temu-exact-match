import sharp from 'sharp';
import {fileURLToPath} from 'node:url';
const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="28" fill="#d85b18"/><rect x="25" y="26" width="56" height="57" rx="9" fill="none" stroke="white" stroke-width="8"/><circle cx="75" cy="74" r="21" fill="#d85b18" stroke="white" stroke-width="8"/><path d="m90 89 17 17" stroke="white" stroke-width="9" stroke-linecap="round"/></svg>';
for(const size of [16,48,128])await sharp(Buffer.from(svg)).resize(size,size).png().toFile(fileURLToPath(new URL('../extension/icon-'+size+'.png',import.meta.url)));
console.log('Extension icons generated.');
