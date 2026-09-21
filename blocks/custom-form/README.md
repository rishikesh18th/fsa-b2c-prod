# Custom Form Block

## Overview

Renders a form built from the Custom Forms App Builder app (Commerce Admin →
Custom Forms) by its code: fetches the render-safe form definition (pages,
fields, conditional "only show when field" logic) from the public Custom
Form GraphQL endpoint, builds the fields, and submits responses back to the
same endpoint. The storefront never hard-codes field lists — editing the
form in Commerce Admin changes what renders here.

## Integration

### Block Configuration

Authored as key/value rows and read via `readBlockConfig()`.

| Configuration Key | Type | Default | Description | Required |
|-------------------|------|---------|--------------|----------|
| `form-code` | string | — | The form's code, from the Forms tab in Commerce Admin | Yes |
| `endpoint` | URL | public endpoint | Override the Custom Form GraphQL endpoint | No |

### GraphQL

Config, submission, and file upload all go through a single public,
CORS-enabled, unauthenticated endpoint:

```
POST https://4260392-617customform-stage.adobeio-static.net/api/v1/web/CustomFormAppId/form-graphql
Content-Type: application/json
```

- `customForm(code: String!)` — the form definition (pages, fields, options,
  dependency, file constraints)
- `submitCustomForm(code, values, customerEmail)` — submits a response;
  returns `success`, `success_url`/`success_message`, or a per-field
  `errors` array
- `uploadCustomFormFile(code, fieldName, filename, contentBase64)` — uploads
  a file field's content ahead of submit; the returned `path` is sent as
  that field's value

### Conditional fields

A field with a `dependency { field value }` is hidden until the referenced
field's current value matches `value` (string comparison). Visibility is
re-evaluated on every `input` event and again right before submit, so
hidden fields are excluded from the submitted payload even if their inputs
still hold stale values.

## Behavior Patterns

- **Success** — if the form defines a `success_url` (other than `/`), the
  page navigates there; otherwise the form is hidden and
  `success_message` (or a generic fallback) is shown in place.
- **Field errors** — a 4xx-shaped response's `errors[]` are matched back to
  each field's `.custom-form-error` slot by `field` name; an unmatched error
  falls back to the block's general message area.
- **File fields** — uploaded via `uploadCustomFormFile` before the main
  `submitCustomForm` call, so the submit payload only ever carries the
  resulting file `path`, never raw file content.
- **Load failure** — if the code is unknown or the endpoint is unreachable,
  the block renders a plain "Unable to load form" / "Form not available"
  message instead of a broken form.

## Error Handling

- **Missing `form-code`**: the block renders a configuration-error message
  instead of attempting a request.
- **Definition fetch failure**: caught and shown as `Unable to load form:
  <message>`, no partial form is rendered.
- **Submit failure** (network/GraphQL error): shown in the block's message
  area; the submit button re-enables so the customer can retry.
