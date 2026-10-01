import {readFileSync} from 'node:fs';
import {analyze, render} from './lab.mjs';
const args = process.argv.slice(2);
const html = args[0] === '--html';
if (html) args.shift();
if (!args.length) {console.error('Usage: node cli.mjs [--html] preset.json [preset2.json ...]'); process.exit(2);}
try {
  const reports = args.map(path => analyze(JSON.parse(readFileSync(path, 'utf8'))));
  console.log(html ? render(reports) : JSON.stringify(reports, null, 2));
} catch (error) {console.error(error.message); process.exit(2);}
