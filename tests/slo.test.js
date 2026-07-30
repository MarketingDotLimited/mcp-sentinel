import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getSloDefinitions } from '../lib/slo.js';

describe('SLO contract', () => {
  it('publishes bounded objectives without claiming a local telemetry result', () => {
    const definitions = getSloDefinitions();
    assert.equal(definitions.length, 5);
    assert.ok(definitions.every(item => item.id && item.objective > 0 && item.objective <= 1));
    definitions[0].objective = 0;
    assert.equal(getSloDefinitions()[0].objective, 0.995);
  });
});
