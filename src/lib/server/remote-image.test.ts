/** @license SPDX-License-Identifier: Apache-2.0 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchRemoteImage } from './remote-image.js';

test('remote image ingestion requires HTTPS and rejects URL credentials', async () => {
  await assert.rejects(fetchRemoteImage('http://127.0.0.1/image.webp'), /must use HTTPS/u);
  await assert.rejects(fetchRemoteImage('https://user:password@127.0.0.1/image.webp'), /must not contain credentials/u);
});

test('remote image ingestion rejects private network destinations before connecting', async () => {
  await assert.rejects(fetchRemoteImage('https://127.0.0.1/admin'), /public internet addresses/u);
  await assert.rejects(fetchRemoteImage('https://[::1]/admin'), /public internet addresses/u);
});
