// "Customizable Options" for the PDP (e.g. "Select Inlet Fitting", "Select
// Post-Filter") — not to be confused with Catalog Service's configurable-product
// swatches (rendered separately via the PDP dropin's ProductOptions container).
//
// Two data sources are supported, tried in this order:
//
// 1. Catalog Service's `ac_customizable_options` product attribute. The PDP
//    dropin (scripts/__dropins__/storefront-pdp/api.js) already special-cases any
//    attribute whose name starts with `ac_`: it JSON-parses the value and exposes
//    it on `product.attributes` as `{ id: 'ac_customizable_options', label, value }`
//    (value is a JSON string). This attribute is already fetched by the PDP
//    dropin's own product query, so no extra request is needed — see the
//    `pdp/data` handler in product-details.js. As of 2026-09, Adobe has confirmed
//    this attribute is only populated in their internal sandbox, not yet in
//    production Catalog Service, so this path is a no-op until they ship it.
// 2. The core Commerce GraphQL endpoint (CustomizableProductInterface), which is
//    how classic Magento customizable options are fetched today. Used whenever
//    the attribute above isn't present.
//
// Either source is normalized into the same shape and merged into the
// add-to-cart payload as `entered_options`/`selected_options` by product-details.js.
import { CORE_FETCH_GRAPHQL } from '../../scripts/commerce.js';

const AC_CUSTOMIZABLE_OPTIONS_ATTR = 'ac_customizable_options';

const CUSTOMIZABLE_OPTIONS_QUERY = `
  query CUSTOMIZABLE_OPTIONS($sku: String!) {
    products(filter: { sku: { eq: $sku } }) {
      items {
        sku
        ... on CustomizableProductInterface {
          options {
            uid
            title
            required
            sort_order
            ... on CustomizableDropDownOption { value { uid title price price_type sku sort_order } }
            ... on CustomizableRadioOption { value { uid title price price_type sku sort_order } }
            ... on CustomizableCheckboxOption { value { uid title price price_type sku sort_order } }
            ... on CustomizableMultipleOption { value { uid title price price_type sku sort_order } }
            ... on CustomizableFieldOption { value { uid price price_type sku max_characters } }
            ... on CustomizableAreaOption { value { uid price price_type sku max_characters } }
            ... on CustomizableDateOption { value { uid price price_type sku } }
          }
        }
      }
    }
  }
`;

const optionsCache = new Map();

async function fetchCustomizableOptions(sku) {
  if (optionsCache.has(sku)) return optionsCache.get(sku);
  const promise = CORE_FETCH_GRAPHQL
    .fetchGraphQl(CUSTOMIZABLE_OPTIONS_QUERY, { method: 'GET', variables: { sku } })
    .then(({ data, errors }) => {
      if (errors?.length) return [];
      return data?.products?.items?.[0]?.options || [];
    })
    .catch(() => []);
  optionsCache.set(sku, promise);
  return promise;
}

/**
 * Reads and parses the `ac_customizable_options` Catalog Service attribute off a
 * PDP dropin product model, if present.
 * @param {object} product PDP `pdp/data` payload
 * @returns {Array|null} the schema's `selectable` groups, or null if unavailable
 */
function getAcCustomizableOptionGroups(product) {
  const attr = product?.attributes?.find((a) => a.id === AC_CUSTOMIZABLE_OPTIONS_ATTR);
  if (!attr?.value) return null;
  try {
    const parsed = typeof attr.value === 'string' ? JSON.parse(attr.value) : attr.value;
    return parsed?.selectable?.length ? parsed.selectable : null;
  } catch {
    return null;
  }
}

/** Coerces Magento-style "0"/"1"/boolean flags into a real boolean. */
function toBool(flag) {
  if (typeof flag === 'boolean') return flag;
  if (flag == null) return false;
  return flag === '1' || Number(flag) === 1;
}

const CORE_KIND_BY_TYPENAME = {
  CustomizableDropDownOption: 'select',
  CustomizableRadioOption: 'select',
  CustomizableCheckboxOption: 'choice',
  CustomizableMultipleOption: 'choice',
  CustomizableFieldOption: 'text',
  CustomizableAreaOption: 'area',
  CustomizableDateOption: 'date',
};

/** Normalizes core-GraphQL `CustomizableOptionInterface` items into the shared option shape. */
function normalizeCoreOptions(options) {
  return options
    .map((option) => {
      const kind = CORE_KIND_BY_TYPENAME[option?.__typename];
      if (!kind) return null; // e.g. CustomizableFileOption — not rendered in this pass.
      return {
        uid: option.uid,
        title: option.title,
        required: toBool(option.required),
        sortOrder: Number(option.sort_order) || 0,
        kind,
        maxLength: option.value?.max_characters,
        values: (option.value || []).map((v) => ({
          uid: v.uid,
          title: v.title,
          price: v.price != null ? { value: v.price, currency: 'USD' } : null,
          priceType: v.price_type,
        })),
      };
    })
    .filter(Boolean);
}

const AC_KIND_BY_RENDER_TYPE = {
  drop_down: 'select',
  radio: 'select',
  checkbox: 'choice',
  multiple: 'choice',
  multiselect: 'choice',
  field: 'text',
  area: 'area',
  date: 'date',
};

/** Normalizes `ac_customizable_options` selectable groups into the shared option shape. */
function normalizeAcOptions(groups) {
  return groups
    .map((group) => {
      const kind = AC_KIND_BY_RENDER_TYPE[group?.renderType];
      if (!kind) {
        console.debug(`Unsupported ac_customizable_options renderType: ${group?.renderType}`);
        return null;
      }
      return {
        uid: group.id,
        title: group.label,
        required: toBool(group.required),
        sortOrder: Number(group.sortOrder) || 0,
        maxLength: group.maxLength,
        kind,
        values: (group.values || [])
          .slice()
          .sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0))
          .map((v) => ({
            uid: v.id,
            title: v.label,
            price: v.price != null ? { value: Number(v.price), currency: 'USD' } : null,
            priceType: v.priceType,
            isDefault: !!v.isDefault,
          })),
      };
    })
    .filter(Boolean);
}

/** Renders a value's title with its price delta, e.g. `3/4" Female (+$20.00)`. */
function formatPriceDelta(price, priceType) {
  const amount = price?.value;
  if (!amount) return '';
  if (priceType === 'percent') return ` (${amount < 0 ? '-' : '+'}${Math.abs(amount)}%)`;
  const formatted = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: price.currency || 'USD',
  }).format(Math.abs(amount));
  return ` (${amount < 0 ? '-' : '+'}${formatted})`;
}

/**
 * Builds the form control for one normalized option and wires it into `selections`.
 * @param {object} option { uid, title, required, kind, maxLength, values }
 * @param {Map} selections optionUid -> { enteredValue?, selectedUids? }
 * @param {() => void} onChange called after any control change
 * @returns {HTMLElement}
 */
function buildOptionControl(option, selections, onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'product-details__custom-option';

  const label = document.createElement('label');
  label.className = 'product-details__custom-option-label';
  label.textContent = option.title;
  if (option.required) {
    const req = document.createElement('span');
    req.className = 'product-details__custom-option-required';
    req.textContent = ' *';
    req.setAttribute('aria-hidden', 'true');
    label.append(req);
  }
  wrap.append(label);

  const setSelectedUids = (uids) => {
    selections.set(option.uid, { selectedUids: uids });
    onChange();
  };
  const setEnteredValue = (value) => {
    selections.set(option.uid, { enteredValue: value });
    onChange();
  };

  if (option.kind === 'select') {
    const select = document.createElement('select');
    select.className = 'product-details__custom-option-control';
    select.required = !!option.required;
    select.setAttribute('aria-required', String(!!option.required));

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '-- Please Select --';
    select.append(placeholder);

    const defaultValue = option.values.find((v) => v.isDefault);

    (option.values || []).forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v.uid;
      opt.textContent = `${v.title}${formatPriceDelta(v.price, v.priceType)}`;
      select.append(opt);
    });

    if (defaultValue) {
      select.value = defaultValue.uid;
      selections.set(option.uid, { selectedUids: [defaultValue.uid] });
    }

    select.addEventListener('change', () => {
      setSelectedUids(select.value ? [select.value] : []);
    });
    wrap.append(select);
    return wrap;
  }

  if (option.kind === 'choice') {
    const group = document.createElement('div');
    group.className = 'product-details__custom-option-group';
    const defaultUids = [];

    (option.values || []).forEach((v) => {
      const itemLabel = document.createElement('label');
      itemLabel.className = 'product-details__custom-option-choice';

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.name = option.uid;
      input.value = v.uid;
      if (v.isDefault) {
        input.checked = true;
        defaultUids.push(v.uid);
      }

      input.addEventListener('change', () => {
        const current = new Set(selections.get(option.uid)?.selectedUids || []);
        if (input.checked) current.add(v.uid); else current.delete(v.uid);
        setSelectedUids([...current]);
      });

      itemLabel.append(input, ` ${v.title}${formatPriceDelta(v.price, v.priceType)}`);
      group.append(itemLabel);
    });

    if (defaultUids.length) selections.set(option.uid, { selectedUids: defaultUids });

    wrap.append(group);
    return wrap;
  }

  if (option.kind === 'text') {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'product-details__custom-option-control';
    input.required = !!option.required;
    if (option.maxLength) input.maxLength = option.maxLength;
    input.addEventListener('input', () => setEnteredValue(input.value.trim()));
    wrap.append(input);
    return wrap;
  }

  if (option.kind === 'area') {
    const textarea = document.createElement('textarea');
    textarea.className = 'product-details__custom-option-control';
    textarea.required = !!option.required;
    if (option.maxLength) textarea.maxLength = option.maxLength;
    textarea.addEventListener('input', () => setEnteredValue(textarea.value.trim()));
    wrap.append(textarea);
    return wrap;
  }

  if (option.kind === 'date') {
    const input = document.createElement('input');
    input.type = 'date';
    input.className = 'product-details__custom-option-control';
    input.required = !!option.required;
    input.addEventListener('input', () => setEnteredValue(input.value));
    wrap.append(input);
    return wrap;
  }

  return null;
}

/**
 * Renders the customizable-options form into `container` for the given product.
 * No-op (and clears the container) when the product has none. Best-effort — never
 * throws.
 * @param {HTMLElement} container target element
 * @param {object} product PDP `pdp/data` payload (must include sku)
 * @returns {Promise<void>}
 */
export default async function renderCustomizableOptions(container, product) {
  if (!container || !product?.sku) return;

  const acGroups = getAcCustomizableOptionGroups(product);
  const options = (acGroups
    ? normalizeAcOptions(acGroups)
    : normalizeCoreOptions(await fetchCustomizableOptions(product.sku)))
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

  container.textContent = '';
  delete container.customOptionsApi;
  if (!options.length) return;

  const selections = new Map();
  let onValidChange = null;

  const isValid = () => options.every((o) => {
    if (!o.required) return true;
    const sel = selections.get(o.uid);
    if (!sel) return false;
    return (sel.selectedUids?.length > 0) || !!sel.enteredValue;
  });

  const notifyChange = () => {
    if (onValidChange) onValidChange(isValid());
  };

  const form = document.createElement('div');
  form.className = 'product-details__custom-options-list';

  options.forEach((option) => {
    const control = buildOptionControl(option, selections, notifyChange);
    if (control) form.append(control);
  });

  container.append(form);

  container.customOptionsApi = {
    isValid,
    getSelectedOptionUids: () => options
      .flatMap((o) => selections.get(o.uid)?.selectedUids || []),
    getEnteredOptions: () => options
      .map((o) => ({ uid: o.uid, value: selections.get(o.uid)?.enteredValue }))
      .filter((entry) => entry.value),
    onValidityChange: (cb) => { onValidChange = cb; },
  };

  notifyChange();
}
