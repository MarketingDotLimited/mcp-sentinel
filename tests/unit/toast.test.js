import { test, describe, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

describe('toast.js', () => {
  let dom;
  beforeEach(() => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost' });
    global.window = dom.window;
    global.document = dom.window.document;
  });

  afterEach(() => {
    delete global.window;
    delete global.document;
  });

  test('Toast.show and types', async (t) => {
    const { Toast } = await import(`../../public/js/toast.js?t=${Date.now()}`);
    Toast.container = null; // reset state
    
    t.mock.timers.enable({ apis: ['setTimeout'] });

    Toast.init();
    assert.ok(document.querySelector('.toast-container'));

    Toast.success('Success message');
    let toast = document.querySelector('.toast.success');
    assert.ok(toast);
    assert.strictEqual(toast.querySelector('.toast-message').textContent, 'Success message');

    Toast.error('Error message');
    toast = document.querySelector('.toast.error');
    assert.ok(toast);

    Toast.info('Info message');
    toast = document.querySelector('.toast.info');
    assert.ok(toast);

    Toast.warning('Warning message');
    toast = document.querySelector('.toast.warning');
    assert.ok(toast);

    // Test close button
    const closeBtn = toast.querySelector('.toast-close');
    closeBtn.click();
    assert.ok(toast.classList.contains('toast-exit'));
    
    t.mock.timers.tick(350);
    assert.ok(!toast.parentNode); // should be removed

    // Test duration auto close
    if (Toast.container) Toast.container.innerHTML = '';
    Toast.show('Auto close', 'info', 100);
    const autoToast = document.querySelector('.toast.info');
    t.mock.timers.tick(150);
    assert.ok(autoToast.classList.contains('toast-exit'));
    t.mock.timers.tick(350);
    assert.ok(!autoToast.parentNode);
    
    // Test duration auto close when already removed manually
    if (Toast.container) Toast.container.innerHTML = '';
    Toast.show('Auto close manual remove', 'info', 100);
    const manualToast = document.querySelectorAll('.toast.info')[0];
    manualToast.parentNode.removeChild(manualToast);
    t.mock.timers.tick(500); // should not throw

    t.mock.timers.reset();
  });
});
