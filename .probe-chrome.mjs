import puppeteer from 'puppeteer';
import fs from 'node:fs';

const candidates = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

console.log('puppeteer bundled path:', puppeteer.executablePath());
console.log('bundled exists:', fs.existsSync(puppeteer.executablePath()));

try {
  const b = await puppeteer.launch({ headless: true });
  console.log('LAUNCH_DEFAULT_OK', await b.version());
  await b.close();
} catch (error) {
  console.log('LAUNCH_DEFAULT_FAIL:', String(error).split('\n')[0]);
}

for (const candidate of candidates) {
  if (!fs.existsSync(candidate)) continue;
  try {
    const b = await puppeteer.launch({ headless: true, executablePath: candidate });
    console.log('LAUNCH_OK_WITH:', candidate, await b.version());
    await b.close();
    break;
  } catch (error) {
    console.log('LAUNCH_FAIL_WITH:', candidate, String(error).split('\n')[0]);
  }
}
