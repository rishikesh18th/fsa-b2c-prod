import { SignUp } from '@dropins/storefront-auth/containers/SignUp.js';
import { render as authRenderer } from '@dropins/storefront-auth/render.js';
import { getAttributesForm } from '@dropins/storefront-auth/api.js';
import {
  CUSTOMER_ACCOUNT_PATH,
  CUSTOMER_LOGIN_PATH,
  checkIsAuthenticated,
  authPrivacyPolicyConsentSlot,
  rootLink,
} from '../../scripts/commerce.js';

// Initialize
import '../../scripts/initializers/auth.js';

// Form code the sign-up form is built from.
const SIGN_UP_FORM_CODE = 'customer_account_create';

/**
 * Picks the option value that represents the "checked" (Yes) state of a
 * boolean customer attribute. Magento booleans use "1" (Yes) / "0" (No).
 * @param {Array<{value: string, label: string, is_default: boolean}>} options
 * @returns {string} the value to submit when the checkbox is checked
 */
function getCheckedOptionValue(options = []) {
  const byValue = options.find((o) => o.value === '1');
  if (byValue) return byValue.value;
  const byLabel = options.find((o) => /^yes$/i.test(o.label || ''));
  if (byLabel) return byLabel.value;
  const truthy = options.find((o) => o.value && o.value !== '0');
  return truthy ? truthy.value : '1';
}

/**
 * The auth dropin renders BOOLEAN customer attributes as a native checkbox
 * without a `value` attribute, so a checked box serialises to the literal
 * string "on" — which the backend rejects because the attribute only accepts
 * its option ids (e.g. "1"/"0"). This assigns the correct option id to each
 * boolean attribute checkbox so `FormData` submits a valid value (and omits it
 * entirely when unchecked, as native checkboxes do).
 * @param {Element} block The block element
 * @param {Array} booleanFields BOOLEAN attribute definitions
 */
function applyBooleanValues(block, booleanFields) {
  booleanFields.forEach((field) => {
    const names = [field.code, field.name, field.customUpperCode].filter(Boolean);
    const selector = names.map((n) => `input[type="checkbox"][name="${n}"]`).join(',');
    if (!selector) return;
    const checkedValue = getCheckedOptionValue(field.options);
    block.querySelectorAll(selector).forEach((input) => {
      if (input.value !== checkedValue) input.value = checkedValue;
    });
  });
}

/**
 * Ensures boolean customer attribute checkboxes submit valid option ids, both
 * on initial render and if the form re-renders (attribute fields load async).
 * @param {Element} block The block element
 */
async function fixBooleanCustomAttributes(block) {
  let fields;
  try {
    fields = await getAttributesForm(SIGN_UP_FORM_CODE);
  } catch (err) {
    // Non-fatal: without metadata we leave the native fields untouched.
    // eslint-disable-next-line no-console
    console.error('CreateAccount: unable to load attribute metadata', err);
    return;
  }

  const booleanFields = (fields || []).filter(
    (f) => (f.fieldType || '').toUpperCase() === 'BOOLEAN',
  );
  if (!booleanFields.length) return;

  applyBooleanValues(block, booleanFields);

  // Re-apply when the dropin re-renders the form (e.g. after async field load).
  const observer = new MutationObserver(() => applyBooleanValues(block, booleanFields));
  observer.observe(block, { childList: true, subtree: true });
}

export default async function decorate(block) {
  if (checkIsAuthenticated()) {
    window.location.href = rootLink(CUSTOMER_ACCOUNT_PATH);
  } else {
    await authRenderer.render(SignUp, {
      hideCloseBtnOnEmailConfirmation: true,
      routeSignIn: () => rootLink(CUSTOMER_LOGIN_PATH),
      routeRedirectOnSignIn: () => rootLink(CUSTOMER_ACCOUNT_PATH),
      slots: {
        ...authPrivacyPolicyConsentSlot,
      },
    })(block);

    await fixBooleanCustomAttributes(block);
  }
}
