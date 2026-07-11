const test = require('node:test');
const assert = require('node:assert/strict');

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test_key';

const { buildInstagramPost, buildTiktokPost } = require('../src/captionWriter');

test('buildInstagramPost appends hashtags on a new line, normalizes # prefix', () => {
  assert.equal(
    buildInstagramPost('Great hair day', ['nails', '#salon']),
    'Great hair day\n\n#nails #salon'
  );
});

test('buildTiktokPost appends hashtags inline, normalizes # prefix', () => {
  assert.equal(buildTiktokPost('Quick reel', ['fyp', '#viral']), 'Quick reel #fyp #viral');
});
