/**
 * Toggle UI for the SortBy container.
 *
 * The storefront-product-discovery SortBy container renders a `Picker`, i.e. a
 * native `<select>` inside `.dropin-picker`. This replaces that select with a
 * button + dropdown panel that animates open, without touching the dropin:
 *   - the dropin's select stays in the DOM (visually hidden, see the CSS) and
 *     remains the single source of truth for label, options and current value
 *   - picking an option writes to that select and dispatches a native `change`,
 *     which is exactly what the Picker listens for, so sorting keeps working
 *     through the dropin's own code path
 *   - the panel is mirrored from the select on every render, because preact
 *     rebuilds the select whenever new sortable attributes arrive with a result
 *
 * @param {HTMLElement} sortEl - the element the SortBy dropin renders into
 * @returns {() => void} cleanup function that removes listeners and the toggle
 */
export default function initSortByToggle(sortEl) {
  const wrapper = sortEl.parentElement;
  if (!wrapper) return () => {};

  wrapper.classList.add('search__sort--toggle');

  const toggle = document.createElement('div');
  toggle.className = 'search__sort-toggle';
  toggle.innerHTML = `
    <button class="search__sort-toggle-button" type="button" aria-expanded="false" aria-haspopup="listbox">
      <span class="search__sort-toggle-label"></span>
      <span class="search__sort-toggle-value"></span>
    </button>
    <div class="search__sort-options">
      <ul role="listbox"></ul>
    </div>
  `;
  wrapper.appendChild(toggle);

  const $button = toggle.querySelector('.search__sort-toggle-button');
  const $label = toggle.querySelector('.search__sort-toggle-label');
  const $value = toggle.querySelector('.search__sort-toggle-value');
  const $list = toggle.querySelector('.search__sort-options ul');

  const getSelect = () => sortEl.querySelector('select');

  const close = () => {
    toggle.classList.remove('is-open');
    $button.setAttribute('aria-expanded', 'false');
  };

  const open = () => {
    toggle.classList.add('is-open');
    $button.setAttribute('aria-expanded', 'true');
  };

  // Mirror the dropin's select into the toggle button and the options panel.
  const sync = () => {
    const select = getSelect();
    // Skip the Picker's empty placeholder option, it is not a sort order. Until
    // the first result arrives the select holds nothing else, so there is
    // nothing to toggle yet.
    const options = select
      ? [...select.options].filter((option) => option.value)
      : [];
    if (!options.length) {
      toggle.hidden = true;
      return;
    }
    toggle.hidden = false;

    const labelText = sortEl
      .querySelector('.dropin-picker__floatingLabel')?.textContent?.trim();
    $label.textContent = labelText || 'Sort By';
    $value.textContent = select.selectedOptions[0]?.text?.trim() || '';
    $button.disabled = select.disabled;

    $list.innerHTML = '';
    options.forEach((option) => {
      const item = document.createElement('li');
      const optionButton = document.createElement('button');
      optionButton.type = 'button';
      optionButton.className = 'search__sort-option';
      optionButton.dataset.value = option.value;
      optionButton.textContent = option.text;
      optionButton.disabled = option.disabled;
      optionButton.setAttribute('role', 'option');
      optionButton.setAttribute('aria-selected', option.value === select.value);
      item.appendChild(optionButton);
      $list.appendChild(item);
    });
  };

  $button.addEventListener('click', () => {
    if (toggle.classList.contains('is-open')) close();
    else open();
  });

  // Hand the selection back to the dropin: set the value on its select and let
  // its own change handler run the search.
  $list.addEventListener('click', (e) => {
    const optionButton = e.target.closest('.search__sort-option');
    if (!optionButton) return;
    close();
    const select = getSelect();
    if (!select || select.value === optionButton.dataset.value) return;
    select.value = optionButton.dataset.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });

  const onDocumentClick = (e) => {
    if (!toggle.contains(e.target)) close();
  };

  const onKeyDown = (e) => {
    if (e.key !== 'Escape' || !toggle.classList.contains('is-open')) return;
    close();
    $button.focus();
  };

  document.addEventListener('click', onDocumentClick);
  document.addEventListener('keydown', onKeyDown);

  // Re-mirror whenever the dropin re-renders the select (new options after a
  // search, or a new value after sorting). Attributes are observed too because
  // the selected option only changes via the `selected` attribute.
  const observer = new MutationObserver(() => sync());
  observer.observe(sortEl, {
    childList: true, subtree: true, attributes: true, characterData: true,
  });

  sync();

  return () => {
    observer.disconnect();
    document.removeEventListener('click', onDocumentClick);
    document.removeEventListener('keydown', onKeyDown);
    toggle.remove();
    wrapper.classList.remove('search__sort--toggle');
  };
}
