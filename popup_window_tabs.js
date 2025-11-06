// Popup-specific logic for window mode: show current window tabs
(function () {
  'use strict';

  /**
   * Check if we're in a popup context (not options page)
   * @returns {boolean} True if in popup context
   */
  function isPopupContext() {
    try {
      return window.location.pathname.includes('popup.html');
    } catch (e) {
      return false;
    }
  }

  /**
   * Load current window tabs and display them as editable URL fields
   */
  async function loadCurrentWindowTabs() {
    if (!isPopupContext()) return;

    try {
      const currentWindow = await new Promise((resolve) => {
        chrome.windows.getCurrent({ populate: true }, (w) => resolve(w));
      });

      if (!currentWindow || !currentWindow.tabs) return;

      const windowTabsList = document.getElementById('windowTabsList');
      const currentWindowTabs = document.getElementById('currentWindowTabs');

      if (!windowTabsList || !currentWindowTabs) return;

      // Clear existing content
      currentWindowTabs.innerHTML = '';

      // Create editable URL fields for each tab
      currentWindow.tabs.forEach((tab, index) => {
        const item = document.createElement('div');
        item.className = 'window-url-item';
        item.draggable = true;
        item.dataset.index = index;

        // Drag handle
        const dragHandle = document.createElement('span');
        dragHandle.className = 'drag-handle';
        dragHandle.textContent = '⋮⋮';
        dragHandle.title = 'Drag to reorder';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'window-url-input';
        input.placeholder = 'https://example.com or example.com';
        input.value = tab.url || '';
        input.dataset.tabId = tab.id || '';

        // Remove button
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'remove-url-btn';
        removeBtn.textContent = '×';
        removeBtn.title = 'Remove URL';
        removeBtn.addEventListener('click', () => {
          item.remove();
          // If only one field remains, disable its remove button
          const remaining =
            currentWindowTabs.querySelectorAll('.window-url-item');
          if (remaining.length === 1) {
            const lastRemoveBtn = remaining[0].querySelector('.remove-url-btn');
            if (lastRemoveBtn) lastRemoveBtn.disabled = true;
          }
        });

        // Disable remove button if only one tab
        if (currentWindow.tabs.length === 1) {
          removeBtn.disabled = true;
        }

        // Drag and drop event handlers
        item.addEventListener('dragstart', (e) => {
          item.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/html', item.innerHTML);
        });

        item.addEventListener('dragend', () => {
          item.classList.remove('dragging');
        });

        item.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';

          const draggingItem = currentWindowTabs.querySelector('.dragging');
          if (!draggingItem || draggingItem === item) return;

          // Get all items and find positions
          const items = Array.from(
            currentWindowTabs.querySelectorAll('.window-url-item')
          );
          const currentIndex = items.indexOf(item);
          const draggingIndex = items.indexOf(draggingItem);

          if (currentIndex > draggingIndex) {
            // Insert after current item
            item.parentNode.insertBefore(draggingItem, item.nextSibling);
          } else {
            // Insert before current item
            item.parentNode.insertBefore(draggingItem, item);
          }
        });

        item.appendChild(dragHandle);
        item.appendChild(input);
        item.appendChild(removeBtn);
        currentWindowTabs.appendChild(item);
      });
    } catch (e) {
      console.error('Failed to load window tabs:', e);
    }
  }

  /**
   * Get URLs from current window tabs (from editable fields)
   * @returns {string[]} Array of URLs from input fields
   */
  function getSelectedWindowTabUrls() {
    const inputs = document.querySelectorAll(
      '#currentWindowTabs .window-url-input'
    );
    const urls = [];

    inputs.forEach((input) => {
      const url = input.value.trim();
      if (url) urls.push(url);
    });

    return urls;
  }

  // Expose functions for use by options.js
  if (typeof window !== 'undefined') {
    window.popupWindowTabs = {
      isPopupContext,
      loadCurrentWindowTabs,
      getSelectedWindowTabUrls,
    };
  }

  // Auto-load tabs when window mode is activated in popup
  window.addEventListener('DOMContentLoaded', () => {
    if (!isPopupContext()) return;

    // Listen for schedule mode changes
    const observer = new MutationObserver(() => {
      const windowTabsList = document.getElementById('windowTabsList');
      if (windowTabsList && !windowTabsList.hidden) {
        loadCurrentWindowTabs();
      }
    });

    const windowModeFields = document.getElementById('windowModeFields');
    if (windowModeFields) {
      observer.observe(windowModeFields, {
        attributes: true,
        attributeFilter: ['hidden'],
      });
    }

    // Wire up the + add url button for popup
    const addUrlBtnPopup = document.getElementById('addUrlBtnPopup');
    const currentWindowTabs = document.getElementById('currentWindowTabs');

    if (addUrlBtnPopup && currentWindowTabs) {
      addUrlBtnPopup.addEventListener('click', () => {
        const newItem = document.createElement('div');
        newItem.className = 'window-url-item';
        newItem.draggable = true;

        // Drag handle
        const dragHandle = document.createElement('span');
        dragHandle.className = 'drag-handle';
        dragHandle.textContent = '⋮⋮';
        dragHandle.title = 'Drag to reorder';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'window-url-input';
        input.placeholder = 'https://example.com or example.com';

        // Remove button
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'remove-url-btn';
        removeBtn.textContent = '×';
        removeBtn.title = 'Remove URL';
        removeBtn.addEventListener('click', () => {
          newItem.remove();
          // If only one field remains, disable its remove button
          const remaining =
            currentWindowTabs.querySelectorAll('.window-url-item');
          if (remaining.length === 1) {
            const lastRemoveBtn = remaining[0].querySelector('.remove-url-btn');
            if (lastRemoveBtn) lastRemoveBtn.disabled = true;
          }
        });

        // Drag and drop event handlers
        newItem.addEventListener('dragstart', (e) => {
          newItem.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/html', newItem.innerHTML);
        });

        newItem.addEventListener('dragend', () => {
          newItem.classList.remove('dragging');
        });

        newItem.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';

          const draggingItem = currentWindowTabs.querySelector('.dragging');
          if (!draggingItem || draggingItem === newItem) return;

          // Get all items and find positions
          const items = Array.from(
            currentWindowTabs.querySelectorAll('.window-url-item')
          );
          const currentIndex = items.indexOf(newItem);
          const draggingIndex = items.indexOf(draggingItem);

          if (currentIndex > draggingIndex) {
            // Insert after current item
            newItem.parentNode.insertBefore(draggingItem, newItem.nextSibling);
          } else {
            // Insert before current item
            newItem.parentNode.insertBefore(draggingItem, newItem);
          }
        });

        newItem.appendChild(dragHandle);
        newItem.appendChild(input);
        newItem.appendChild(removeBtn);
        currentWindowTabs.appendChild(newItem);

        // Enable all remove buttons when there are multiple items
        const allRemoveBtns =
          currentWindowTabs.querySelectorAll('.remove-url-btn');
        if (allRemoveBtns.length > 1) {
          allRemoveBtns.forEach((btn) => (btn.disabled = false));
        }
      });
    }
  });
})();
