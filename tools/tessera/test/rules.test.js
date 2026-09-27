import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sanitize } from '../src/main/config.js';
import { AGENT_HINT, buildCommand, ORCHESTRATION_HINT } from '../src/main/launch.js';
import { MAX_RULES, promptText, readRules, TEMPLATE, writeRules } from '../src/main/rules.js';
import { rulesHash, rulesUpdateMessage } from '../src/renderer/checkins.js';
import { readSaved } from '../src/renderer/tiles.js';

test('rules are read and written as plain text with LF endings', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tessera-rules-'));
  assert.equal(readRules(dir), null, 'no RULES.md yet');
  writeRules(dir, '# Rules\r\n\r\n- ask before submitting');
  assert.equal(fs.readFileSync(path.join(dir, 'RULES.md'), 'utf8'), '# Rules\n\n- ask before submitting\n');
  assert.equal(readRules(dir), '# Rules\n\n- ask before submitting\n');
  writeRules(dir, 'x'.repeat(MAX_RULES + 50));
  assert.equal(readRules(dir).length, MAX_RULES);
  assert.deepEqual(fs.readdirSync(dir), ['RULES.md'], 'no temp file left');
});

test('each role gets its own hint plus the rules', () => {
  const rules = '- Never submit to Kaggle yourself.';
  const hints = { orchestrator: ORCHESTRATION_HINT, agent: AGENT_HINT };
  const orch = promptText('orchestrator', rules, hints);
  assert.ok(orch.startsWith(ORCHESTRATION_HINT));
  assert.match(orch, /hold the agents to them/);
  assert.ok(orch.endsWith(rules));
  const agent = promptText('agent', rules, hints);
  assert.ok(agent.startsWith(AGENT_HINT) && !agent.includes(ORCHESTRATION_HINT));
  assert.ok(agent.endsWith(rules));
  assert.equal(promptText('agent', null, hints), AGENT_HINT, 'agents always learn about [tessera] messages');
  assert.equal(promptText('agent', null), '', 'nothing to add');
  assert.equal(promptText('agent', '   \n'), '');
  assert.equal(promptText('orchestrator', null, { orchestrator: '' }), '', 'orchestration switched off');
  assert.match(AGENT_HINT, /\[tessera\].*on the user's behalf/);
  assert.match(AGENT_HINT, /never from Tessera/);
  assert.match(AGENT_HINT, /orchestrator.*short summary/);
});

test('a rules update is one typed line, and the hash tells rules apart', () => {
  const msg = rulesUpdateMessage('# Rules\n\nIntro line.\n\n- one\n-   two  \n');
  assert.ok(!msg.includes('\n'), 'typed text must not contain Enter');
  assert.ok(msg.startsWith('[tessera] '));
  assert.match(msg, /: Intro line\. - one - two Follow them/);
  assert.ok(!msg.includes('# Rules'), 'headings are dropped');
  assert.match(rulesUpdateMessage(null), /removed/);
  assert.match(rulesUpdateMessage('# Rules\n'), /removed/, 'only a heading counts as no rules');
  assert.equal(rulesHash(null), rulesHash(''));
  assert.equal(rulesHash('- a\n'), rulesHash('- a'), 'trailing newline does not count');
  assert.notEqual(rulesHash('- a'), rulesHash('- b'));
  assert.match(rulesHash('x'.repeat(20000)), /^[0-9a-f]{1,8}$/);
});

test('saved sessions keep which rules each conversation has seen', () => {
  const saved = readSaved({ orchestrator: 'o', agents: [], rulesSeen: { o: 'abc', a: 5, b: 'x'.repeat(40) } });
  assert.deepEqual(saved.rulesSeen, { o: 'abc' });
  assert.deepEqual(readSaved({ rulesSeen: ['abc'] }).rulesSeen, {});
  assert.deepEqual(readSaved(null).rulesSeen, {});
});

test('the template starts with the current issues and stays short', () => {
  assert.ok(TEMPLATE.startsWith('# Rules'));
  assert.match(TEMPLATE, /Never submit to Kaggle yourself/);
  assert.ok(TEMPLATE.split('\n').length < 15);
});

test('a prompt file replaces the inline hint, unless claude.args has its own', () => {
  const env = { PATH: '' };
  const text = (c) => JSON.stringify(c);
  const config = sanitize({ claude: { command: process.execPath } }).config;
  const withFile = text(buildCommand({ role: 'orchestrator', promptFile: '/tmp/orch.md' }, config, env));
  assert.ok(withFile.includes('"--append-system-prompt-file","/tmp/orch.md"'));
  assert.ok(!withFile.includes(ORCHESTRATION_HINT.slice(0, 30)));
  assert.ok(text(buildCommand({ role: 'agent', promptFile: '/tmp/agent.md' }, config, env)).includes('/tmp/agent.md'));
  const own = sanitize({ claude: { command: process.execPath, args: ['--append-system-prompt', 'mine'] } }).config;
  assert.ok(!text(buildCommand({ role: 'agent', promptFile: '/tmp/agent.md' }, own, env)).includes('/tmp/agent.md'));
});
