import assert from 'node:assert/strict';
import test from 'node:test';
import { canReadImageAsset } from './image-authorization.js';

test('approved images are public', () => {
  assert.equal(canReadImageAsset('approved', undefined, undefined), true);
});

test('pending images are visible only to their contributor or an admin', () => {
  assert.equal(canReadImageAsset('pending_review', 'contributor-1', undefined), false);
  assert.equal(canReadImageAsset('pending_review', 'contributor-1', {
    role: 'contributor',
    profile: { id: 'contributor-2' },
  }), false);
  assert.equal(canReadImageAsset('pending_review', 'contributor-1', {
    role: 'contributor',
    profile: { id: 'contributor-1' },
  }), true);
  assert.equal(canReadImageAsset('pending_review', 'contributor-1', { role: 'admin' }), true);
});
