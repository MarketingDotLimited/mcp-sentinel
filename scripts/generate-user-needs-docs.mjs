#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';

const JSON_FILE = path.join(process.cwd(), 'reports', 'testing', 'user-needs-coverage.json');
const MD_FILE = path.join(process.cwd(), 'docs', 'testing', 'USER_NEEDS_COVERAGE.md');

async function generate() {
  const raw = await fs.readFile(JSON_FILE, 'utf8');
  const data = JSON.parse(raw);

  let totalNeeds = 0;
  let fullyMet = 0;
  let partiallyMet = 0;
  let notMet = 0;
  let cannotValidate = 0;

  let md = '# MCP Sentinel — User Needs Coverage\n\n## Persona Analysis\n\n';

  data.personas.forEach((persona, index) => {
    md += `### ${index + 1}. ${persona.name}\n\n`;
    md += '| Need ID | Goal | Capability | Status | Gap |\n';
    md += '| ------- | ---- | ---------- | ------ | --- |\n';

    persona.needs.forEach(need => {
      totalNeeds++;
      if (need.status === 'fully_met') fullyMet++;
      else if (need.status === 'partially_met') partiallyMet++;
      else if (need.status === 'not_met') notMet++;
      else if (need.status === 'cannot_be_automatically_validated') cannotValidate++;

      const statusText =
        need.status === 'fully_met'
          ? 'Fully met'
          : need.status === 'partially_met'
            ? 'Partially met'
            : need.status === 'not_met'
              ? 'Not met'
              : 'Cannot be validated automatically';
      const gapText = need.gap || '—';

      md += `| ${need.id} | ${need.goal} | ${need.capability} | ${statusText} | ${gapText} |\n`;
    });

    md += '\n';
  });

  md += '## Product Gaps Identified\n\n';
  md += '| Gap ID | Need | Severity | Impact | Recommended Solution |\n';
  md += '| ------ | ---- | -------- | ------ | -------------------- |\n';

  data.gaps.forEach(gap => {
    md += `| ${gap.id} | ${gap.need} | ${gap.severity} | ${gap.impact} | ${gap.solution} |\n`;
  });

  md += '\n## Summary\n\n';
  const fullyMetPct = Math.round((fullyMet / totalNeeds) * 100);
  const partiallyMetPct = Math.round((partiallyMet / totalNeeds) * 100);
  const notMetPct = Math.round((notMet / totalNeeds) * 100);
  const cannotValidatePct = Math.round((cannotValidate / totalNeeds) * 100);

  md += `- **Total user needs identified**: ${totalNeeds}\n`;
  md += `- **Fully met**: ${fullyMet} (${fullyMetPct}%)\n`;
  md += `- **Partially met**: ${partiallyMet} (${partiallyMetPct}%)\n`;
  md += `- **Not met**: ${notMet} (${notMetPct}%)\n`;
  md += `- **Cannot be validated automatically**: ${cannotValidate} (${cannotValidatePct}%)\n`;
  md += `- **Product gaps filed**: ${data.gaps.length}\n`;

  // Update summary in json as well
  data.summary = {
    totalNeeds,
    fullyMet,
    partiallyMet,
    notMet,
    cannotValidateAutomatically: cannotValidate,
  };

  await fs.writeFile(JSON_FILE, JSON.stringify(data, null, 2) + '\n');
  await fs.writeFile(MD_FILE, md);

  console.log(
    `Generated ${MD_FILE} from ${JSON_FILE}. Total needs: ${totalNeeds}, Fully met: ${fullyMet} (${fullyMetPct}%).`
  );
}

await generate().catch(err => {
  console.error(err);
  process.exit(1);
});
