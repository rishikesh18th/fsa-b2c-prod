# Footer Block

## Overview

The Footer block loads and renders the site footer from a fragment, optionally adding a multi-store selector when the storefront is configured for multistore mode. It decorates the fragment content and presents a modal-driven store switcher that lets shoppers choose a storefront region or store view.

## Integration

### Block Configuration

No block configuration is read via `readBlockConfig()`.

The block looks up the footer fragment path from metadata:

| Configuration Key | Type | Default | Description | Required | Side Effects |
|-------------------|------|---------|-------------|----------|--------------|
| `footer` metadata | string | `/footer` | URL or path to the footer fragment to load | No | Determines which footer content is rendered |

### URL Parameters

No URL query parameters are directly read by this block.

### Local Storage

No `localStorage` keys are used by this block directly.

### Events

#### Event Listeners

- None directly registered in the footer block.

#### Event Emitters

- None directly emitted by this block.

## Behavior Patterns

### Page Context Detection

- **Single-store mode**: The block loads and appends the footer fragment normally.
- **Multistore mode**: The block renders a store-switcher button and opens a modal containing store selector content.

### User Interaction Flows

1. **Footer Fragment Rendering**: The footer block reads the `footer` metadata and loads the corresponding fragment.
2. **Store Switcher Button**: In multistore mode, a button is rendered to open the store view selector modal.
3. **Store Selection Modal**: Users can select a store region or store view from the modal, and the selector handles nested lists and keyboard interaction.

### Error Handling

- **Fragment load failure**: If the store-switcher fragment cannot be loaded, the block logs the error and exits early without crashing the page.
- **Missing metadata fallback**: When `footer` metadata is absent, the block falls back to `/footer`.
- **Missing content nodes**: The block safely checks for optional DOM elements before adding classes or behaviors.

## Files

- `footer.js` - Main footer decoration logic, fragment loading, and multistore modal support
- `footer.css` - Footer layout and store-switcher styles
