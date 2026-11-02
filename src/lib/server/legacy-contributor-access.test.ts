import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isAuthenticatedContributorRoute,
  isLegacyContributorRoute,
} from './legacy-contributor-access.js';

test('legacy contributors can read the dish inventory and submit images', () => {
  assert.equal(isLegacyContributorRoute('GET', '/dataset/targets'), true);
  assert.equal(isLegacyContributorRoute('GET', '/menu-tasks'), true);
  assert.equal(isLegacyContributorRoute('GET', '/canonical-dishes'), true);
  assert.equal(isLegacyContributorRoute('POST', '/images/upload'), true);
  assert.equal(isLegacyContributorRoute('POST', '/images/upload/authorize'), true);
  assert.equal(isLegacyContributorRoute('POST', '/images/process-url'), true);
});

test('legacy contributors cannot review, edit, or delete owner data', () => {
  assert.equal(isLegacyContributorRoute('GET', '/images/review-queue'), false);
  assert.equal(isLegacyContributorRoute('POST', '/images/review-queue/asset/decision'), false);
  assert.equal(isLegacyContributorRoute('PATCH', '/images/catalog/asset/status'), false);
  assert.equal(isLegacyContributorRoute('DELETE', '/dataset/targets/target'), false);
  assert.equal(isLegacyContributorRoute('POST', '/dataset/targets/import'), false);
  assert.equal(isLegacyContributorRoute('POST', '/admin/contributors/id/access'), false);
});

test('authenticated contributors can still read the approved catalog', () => {
  assert.equal(isAuthenticatedContributorRoute('GET', '/images/catalog', 'approved'), true);
  assert.equal(isAuthenticatedContributorRoute('GET', '/images/catalog', 'pending_review'), false);
});
