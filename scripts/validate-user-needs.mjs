#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';

const JSON_FILE = path.join(process.cwd(), 'reports', 'testing', 'user-needs-coverage.json');
const MD_FILE = path.join(process.cwd(), 'docs', 'testing', 'USER_NEEDS_COVERAGE.md');

async function validate() {
  const jsonRaw = await fs.readFile(JSON_FILE, 'utf8');
  const json = JSON.parse(jsonRaw);

  const mdContent = await fs.readFile(MD_FILE, 'utf8');

  // Verify total personas
  if (json.personas.length !== 7) {
    console.error(`❌ Persona count mismatch: expected 7, got ${json.personas.length}`);
    process.exit(1);
  }

  // Verify total needs count
  let totalNeeds = 0;
  json.personas.forEach(p => (totalNeeds += p.needs.length));

  if (!mdContent.includes(`Total user needs identified**: ${totalNeeds}`)) {
    console.error(`❌ Markdown summary out of sync with user-needs-coverage.json!`);
    process.exit(1);
  }

  console.log('✅ User needs matrix reconciliation validated successfully.');
}

validate().catch(err => {
  console.error(err);
  process.exit(1);
});
