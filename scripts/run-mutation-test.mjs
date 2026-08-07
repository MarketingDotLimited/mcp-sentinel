#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';

const TARGET_FILES = [
  'lib/remote-operation-policy.js',
  'lib/ssh-policy.js',
  'lib/policy.js',
  'lib/oauth-token-policy.js',
];

async function runMutationTests() {
  console.log('Running security & authorization policy mutation testing...');

  const mutants = [];
  let killed = 0;
  let totalMutations = 0;

  for (const relFile of TARGET_FILES) {
    const fullPath = path.join(process.cwd(), relFile);
    const originalContent = await fs.readFile(fullPath, 'utf8');

    const mutationOps = [
      { search: '===', replace: '!==', name: 'invert equality' },
      { search: '&&', replace: '||', name: 'invert logical AND' },
      { search: 'return true;', replace: 'return false;', name: 'invert boolean return true' },
      { search: 'return false;', replace: 'return true;', name: 'invert boolean return false' },
    ];

    for (const m of mutationOps) {
      if (!originalContent.includes(m.search)) continue;

      totalMutations++;
      const mutatedContent = originalContent.replace(m.search, m.replace);
      await fs.writeFile(fullPath, mutatedContent);

      let testFailed = false;
      try {
        execSync(
          'node --experimental-test-module-mocks --test tests/security*.test.js tests/policy*.test.js tests/ssh-policy.test.js tests/remote-operation-policy.test.js tests/oauth-token-policy.test.js',
          { stdio: 'pipe' }
        );
      } catch (err) {
        testFailed = true; // Mutant killed!
      }

      await fs.writeFile(fullPath, originalContent); // Restore original file

      if (testFailed) {
        killed++;
      } else {
        mutants.push({
          file: relFile,
          mutation: m.name,
          search: m.search,
          replace: m.replace,
          survived: true,
        });
      }
    }
  }

  const score = totalMutations > 0 ? Math.round((killed / totalMutations) * 100) : 100;
  console.log(`Mutation Analysis Complete: ${killed}/${totalMutations} mutants killed (${score}% score).`);

  const reportPath = path.join(process.cwd(), 'reports', 'testing', 'surviving-mutants.json');
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(mutants, null, 2));

  const mdPath = path.join(process.cwd(), 'docs', 'testing', 'MUTATION_ANALYSIS.md');
  const md = `# MCP Sentinel — Mutation Testing Analysis Report

**Date**: 2026-08-07
**Target Modules**: Critical Security & Authorization Policies (${TARGET_FILES.join(', ')})
**Total Mutations Executed**: ${totalMutations}
**Mutants Killed**: ${killed}
**Mutation Score**: ${score}%

## Evaluation Results

- **Critical Authorization Mutation Score**: ${score}%
- **Surviving Mutants Count**: ${mutants.length}

${mutants.length > 0 ? '### Surviving Mutants List\n```json\n' + JSON.stringify(mutants, null, 2) + '\n```' : '🎉 All security policy mutations were killed by the test suite! 100% mutation detection score achieved.'}
`;

  await fs.writeFile(mdPath, md);

  if (score < 95) {
    console.error(`❌ Mutation score (${score}%) below required threshold (95%)`);
    process.exit(1);
  }
}

runMutationTests().catch(err => {
  console.error(err);
  process.exit(1);
});
