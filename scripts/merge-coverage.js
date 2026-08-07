import fs from 'node:fs';
import path from 'node:path';
import libCoverage from 'istanbul-lib-coverage';
import libReport from 'istanbul-lib-report';
import reports from 'istanbul-reports';

const nodeCoveragePath = path.resolve('coverage/node/coverage-final.json');
const browserCoveragePath = path.resolve('coverage/browser/istanbul/coverage.json');

const map = libCoverage.createCoverageMap();

if (fs.existsSync(nodeCoveragePath)) {
  const nodeCov = JSON.parse(fs.readFileSync(nodeCoveragePath, 'utf8'));
  map.merge(nodeCov);
} else {
  console.warn('Node coverage not found at ' + nodeCoveragePath);
}

if (fs.existsSync(browserCoveragePath)) {
  const browserCov = JSON.parse(fs.readFileSync(browserCoveragePath, 'utf8'));
  map.merge(browserCov);
} else {
  console.warn('Browser coverage not found at ' + browserCoveragePath);
}

// Generate reports
const context = libReport.createContext({
  dir: path.resolve('coverage/merged'),
  defaultSummarizer: 'nested',
  coverageMap: map,
});

reports.create('json').execute(context);
reports.create('json-summary').execute(context);
reports.create('lcov').execute(context);
reports.create('text').execute(context);
reports.create('html').execute(context);

console.log('Coverage merged successfully into coverage/merged');
