// tests/queue.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import config from '../src/config/env.js';

/**
 * Regression guard for the Upstash quota burn.
 *
 * `src/jobs/queue.js` used to construct five BullMQ Queues and five BullMQ
 * Workers at import time, unconditionally. A Worker polls its queue in a loop
 * forever, and Upstash meters every command — five idle workers consumed the
 * whole 500k/month free tier in one day and then rejected every other Redis
 * call, which (because server.js connected Redis inside its main try block)
 * stopped the API from booting at all.
 *
 * These tests pin the fix: with ENABLE_QUEUE_WORKERS unset, importing the module
 * must not stand up a single real queue or worker, and none of the job producers
 * may reach Redis.
 */

const queueModule = await import('../src/jobs/queue.js');

test('queue: workers are off by default', () => {
  assert.equal(
    config.ENABLE_QUEUE_WORKERS,
    false,
    'ENABLE_QUEUE_WORKERS must default to false — an opt-in, because every worker poll costs Redis commands'
  );
});

test('queue: importing the module creates no real BullMQ workers', () => {
  const workers = {
    pdfWorker: queueModule.pdfWorker,
    lowStockWorker: queueModule.lowStockWorker,
    notificationWorker: queueModule.notificationWorker,
    reportWorker: queueModule.reportWorker,
    emailWorker: queueModule.emailWorker,
  };

  for (const [name, worker] of Object.entries(workers)) {
    assert.ok(worker, `${name} should still be exported`);
    assert.equal(worker.isStub, true, `${name} must be an inert stub, not a live polling worker`);
    assert.equal(worker.isRunning(), false, `${name} must not be running`);
  }
});

test('queue: importing the module creates no live queues', () => {
  const queues = {
    pdfQueue: queueModule.pdfQueue,
    lowStockQueue: queueModule.lowStockQueue,
    notificationQueue: queueModule.notificationQueue,
    reportQueue: queueModule.reportQueue,
    emailQueue: queueModule.emailQueue,
  };

  for (const [name, queue] of Object.entries(queues)) {
    assert.equal(queue.isStub, true, `${name} must not open a Redis connection`);
  }
});

test('queue: initialisation is skipped, so no clean() commands are spent at boot', async () => {
  const result = await queueModule.initializeQueue();

  assert.equal(result, false, 'initializeQueue must short-circuit when workers are disabled');
});

test('queue: job producers are inert instead of writing to Redis', async () => {
  // Each of these would have issued a Redis command on a live queue.
  assert.equal(await queueModule.addPDFJob('installation-1'), null);
  assert.equal(await queueModule.addNotificationJob('status', { id: 1 }), null);
  assert.equal(await queueModule.addReportJob('stock_report'), null);
  assert.equal(await queueModule.addEmailJob('someone@example.com', 'Hi', 'template'), null);
  assert.equal(await queueModule.addLowStockCheckJob(null, true), null);
});

test('queue: metrics read zero rather than throwing', async () => {
  const metrics = await queueModule.getQueueMetrics();

  assert.ok(metrics, 'getQueueMetrics must not throw when the queues are stubs');
  assert.equal(metrics.pdf?.waiting ?? 0, 0);
});

test('queue: shutting down a disabled queue system is safe', async () => {
  await assert.doesNotReject(() => queueModule.closeQueue());
});
