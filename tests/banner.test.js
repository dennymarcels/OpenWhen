/**
 * @jest-environment jsdom
 */
const { showBanner } = require('../lib/banner');
const { getByText, queryByText } = require('@testing-library/dom');

describe('banner DOM', () => {
  beforeEach(() => { document.documentElement.innerHTML = '<head></head><body></body>'; });

  test('inserts banner with message and source', () => {
    showBanner('hello', 'testsource', null);
    expect(getByText(document.documentElement, /opened by OpenWhen \(testsource\)/)).toBeTruthy();
    expect(getByText(document.documentElement, /hello/)).toBeTruthy();
  });

  test('close button removes banner', () => {
    showBanner('x', 'y', null);
    const closeBtn = document.querySelector('.openwhen-close-btn');
    expect(closeBtn).toBeTruthy();
    closeBtn.click();
    expect(queryByText(document.documentElement, /opened by OpenWhen/)).toBeNull();
  });
});
