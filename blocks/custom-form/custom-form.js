import { readBlockConfig } from '../../scripts/aem.js';

/**
 * Custom Form block.
 *
 * Renders a form built from the Custom Forms App Builder app's public
 * GraphQL API: fetches the form definition by code, builds the fields
 * (including conditional "only show when field" visibility and file
 * uploads), and submits responses back to the same endpoint.
 */

// Public GraphQL endpoint (CORS enabled, no auth). Overridable per block via
// the "endpoint" config row.
export const DEFAULT_ENDPOINT = 'https://4260392-617customform-stage.adobeio-static.net/api/v1/web/CustomFormAppId/form-graphql';

const FORM_QUERY = `query Form($code: String!) {
  customForm(code: $code) {
    code title submit_button_text success_message success_url
    pages { title fields { name type label required maxlength options
      dependency { field value } allowed_extensions max_file_size_mb } }
  }
}`;

const SUBMIT_MUTATION = `mutation Submit($code: String!, $values: [CustomFormValueInput!]!, $customerEmail: String) {
  submitCustomForm(code: $code, values: $values, customerEmail: $customerEmail) {
    success success_url success_message errors { field message }
  }
}`;

const UPLOAD_MUTATION = `mutation Upload($code: String!, $fieldName: String!, $filename: String!, $contentBase64: String!) {
  uploadCustomFormFile(code: $code, fieldName: $fieldName, filename: $filename, contentBase64: $contentBase64) { path }
}`;

/**
 * Runs a GraphQL query/mutation against the Custom Form endpoint.
 * @param {string} endpoint GraphQL endpoint URL
 * @param {string} query GraphQL query/mutation string
 * @param {Object} [variables] Query variables
 * @returns {Promise<Object>} The `data` payload
 */
export async function customFormGql(endpoint, query, variables = {}) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Custom Form GraphQL request failed: ${res.status}`);
  const { data, errors } = await res.json();
  if (errors?.length) throw new Error(errors.map((e) => e.message).join('; '));
  return data;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function renderField(field) {
  const wrap = document.createElement('div');
  wrap.className = 'custom-form-field';
  wrap.dataset.name = field.name;

  const label = document.createElement('label');
  label.textContent = field.label + (field.required ? ' *' : '');
  wrap.append(label);

  let input;
  if (field.type === 'textarea') {
    input = document.createElement('textarea');
    input.name = field.name;
  } else if (field.type === 'select') {
    input = document.createElement('select');
    input.name = field.name;
    input.append(document.createElement('option'));
    (field.options || []).forEach((o) => {
      const opt = document.createElement('option');
      opt.value = o;
      opt.textContent = o;
      input.append(opt);
    });
  } else if (field.type === 'multiselect') {
    input = document.createElement('select');
    input.name = field.name;
    input.multiple = true;
    (field.options || []).forEach((o) => {
      const opt = document.createElement('option');
      opt.value = o;
      opt.textContent = o;
      input.append(opt);
    });
  } else if (field.type === 'radio' || field.type === 'checkbox') {
    input = document.createElement('div');
    input.className = 'custom-form-options';
    (field.options || []).forEach((o) => {
      const id = `${field.name}_${o}`;
      const opt = document.createElement('input');
      opt.type = field.type === 'radio' ? 'radio' : 'checkbox';
      opt.name = field.name;
      opt.value = o;
      opt.id = id;
      const optLabel = document.createElement('label');
      optLabel.htmlFor = id;
      optLabel.textContent = o;
      input.append(opt, optLabel);
    });
  } else if (field.type === 'file') {
    input = document.createElement('input');
    input.type = 'file';
    input.name = field.name;
    if (field.allowed_extensions?.length) {
      input.accept = field.allowed_extensions.map((e) => `.${e}`).join(',');
    }
  } else {
    input = document.createElement('input');
    const NATIVE_INPUT_TYPES = { number: 'number', date: 'date' };
    input.type = NATIVE_INPUT_TYPES[field.type] || 'text';
    input.name = field.name;
    if (field.maxlength) input.maxLength = field.maxlength;
  }
  wrap.append(input);

  const error = document.createElement('div');
  error.className = 'custom-form-error';
  wrap.append(error);
  return wrap;
}

function fieldValue(form, field) {
  if (field.type === 'multiselect') {
    const sel = form.querySelector(`select[name="${field.name}"]`);
    return { list: [...sel.options].filter((o) => o.selected).map((o) => o.value) };
  }
  if (field.type === 'checkbox') {
    const checked = [...form.querySelectorAll(`input[name="${field.name}"]:checked`)];
    return { list: checked.map((c) => c.value) };
  }
  if (field.type === 'radio') {
    const picked = form.querySelector(`input[name="${field.name}"]:checked`);
    return { value: picked ? picked.value : '' };
  }
  if (field.type === 'file') return null;
  const input = form.querySelector(`[name="${field.name}"]`);
  return { value: input ? input.value : '' };
}

function isFieldHidden(field, values) {
  if (!field.dependency) return false;
  const actual = values[field.dependency.field];
  return String(actual == null ? '' : actual) !== field.dependency.value;
}

function updateVisibility(container, allFields, currentValues) {
  allFields.forEach((f) => {
    const row = container.querySelector(`.custom-form-field[data-name="${f.name}"]`);
    if (row) row.style.display = isFieldHidden(f, currentValues) ? 'none' : '';
  });
}

function currentDriverValues(form, allFields) {
  const out = {};
  allFields.forEach((f) => {
    const v = fieldValue(form, f);
    if (v) out[f.name] = v.list ? v.list[0] : v.value;
  });
  return out;
}

/**
 * Fetches a Custom Form's render-safe definition by code.
 * @param {string} code The form's code
 * @param {string} [endpoint] GraphQL endpoint override
 * @returns {Promise<Object|null>} The form definition, or null if not found
 */
export async function fetchFormDefinition(code, endpoint = DEFAULT_ENDPOINT) {
  const { customForm } = await customFormGql(endpoint, FORM_QUERY, { code });
  return customForm;
}

/**
 * Renders a Custom Form into `container`.
 * @param {HTMLElement} container Target element
 * @param {Object} options
 * @param {string} options.code The form's code
 * @param {string} [options.endpoint] GraphQL endpoint override
 */
export async function renderCustomForm(container, { code, endpoint = DEFAULT_ENDPOINT }) {
  container.textContent = '';
  let def;
  try {
    def = await fetchFormDefinition(code, endpoint);
  } catch (err) {
    container.textContent = `Unable to load form: ${err.message}`;
    return;
  }
  if (!def) {
    container.textContent = 'Form not available.';
    return;
  }

  let allFields = [];
  def.pages.forEach((p) => { allFields = allFields.concat(p.fields); });

  const form = document.createElement('form');
  form.className = 'custom-form-fields';
  def.pages.forEach((p) => {
    if (p.title) {
      const h = document.createElement('h4');
      h.textContent = p.title;
      form.append(h);
    }
    p.fields.forEach((f) => form.append(renderField(f)));
  });

  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.textContent = def.submit_button_text || 'Submit';
  form.append(submitBtn);

  const message = document.createElement('div');
  message.className = 'custom-form-message';

  if (def.title) {
    const h3 = document.createElement('h3');
    h3.textContent = def.title;
    container.append(h3);
  }
  container.append(form, message);

  const refreshVisibility = () => (
    updateVisibility(container, allFields, currentDriverValues(form, allFields))
  );
  form.addEventListener('input', refreshVisibility);
  refreshVisibility();

  form.addEventListener('submit', (evt) => {
    evt.preventDefault();
    message.textContent = '';
    container.querySelectorAll('.custom-form-error').forEach((e) => { e.textContent = ''; });
    submitBtn.disabled = true;

    const currentValues = currentDriverValues(form, allFields);
    const visibleFields = allFields.filter((f) => !isFieldHidden(f, currentValues));

    const uploads = visibleFields
      .filter((f) => f.type === 'file')
      .map(async (f) => {
        const input = form.querySelector(`input[name="${f.name}"]`);
        const file = input?.files?.[0];
        if (!file) return null;
        const contentBase64 = await fileToBase64(file);
        const { uploadCustomFormFile } = await customFormGql(endpoint, UPLOAD_MUTATION, {
          code, fieldName: f.name, filename: file.name, contentBase64,
        });
        return { name: f.name, value: uploadCustomFormFile.path };
      });

    Promise.all(uploads).then((fileValues) => {
      const values = visibleFields
        .filter((f) => f.type !== 'file')
        .map((f) => {
          const v = fieldValue(form, f);
          return v.list !== undefined
            ? { name: f.name, list: v.list }
            : { name: f.name, value: v.value };
        })
        .concat(fileValues.filter(Boolean).map((fv) => ({ name: fv.name, value: fv.value })));

      const emailField = allFields.find((f) => f.type === 'text' && /email/i.test(f.name));
      const customerEmail = emailField ? form.querySelector(`[name="${emailField.name}"]`)?.value : undefined;

      return customFormGql(endpoint, SUBMIT_MUTATION, { code, values, customerEmail });
    }).then(({ submitCustomForm: result }) => {
      if (result.success) {
        if (result.success_url && result.success_url !== '/') {
          window.location.href = result.success_url;
        } else {
          message.textContent = result.success_message || 'Thank you for your submission.';
        }
      } else {
        (result.errors || []).forEach((e) => {
          const row = container.querySelector(`.custom-form-field[data-name="${e.field}"] .custom-form-error`);
          if (row) row.textContent = e.message;
          else message.textContent = e.message;
        });
      }
    }).catch((err) => {
      message.textContent = err.message;
    })
      .finally(() => {
        submitBtn.disabled = false;
      });
  });
}

/**
 * loads and decorates the block
 * @param {Element} block The block element
 */
export default async function decorate(block) {
  const cfg = readBlockConfig(block);
  const code = cfg['form-code'] || cfg.code;
  block.textContent = '';
  if (!code) {
    block.textContent = 'Custom Form: missing "form-code" configuration.';
    return;
  }
  await renderCustomForm(block, { code, endpoint: cfg.endpoint || DEFAULT_ENDPOINT });
}
