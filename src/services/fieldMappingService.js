// Pure logic: decide which of our static details belongs in which form field.

// Order matters: more specific rules come first ("company name" must not become "name").
const RULES = [
  ['email', /e-?mail/],
  ['phone', /phone|mobile|\btel\b|telephone|contact\s*(no|number)|whats?app/],
  ['firstName', /first[\s_-]*name|fname|given[\s_-]*name|forename/],
  ['lastName', /last[\s_-]*name|lname|surname|family[\s_-]*name/],
  ['locationCount', /number\s+of\s+(?:practice\s+)?locations?|location\s+count/],
  ['company', /\bpractice\b(?![\s_-]*(?:zip|postal|location|count))|company|organi[sz]ation|business|firm|employer/],
  ['subject', /subject|topic|regarding|reason\s+for/],
  ['website', /website|web[\s_-]*site|\burl\b|web\s*address/],
  ['streetAddress', /street|address[\s_-]*(?:line|1|one)|mailing\s+address|postal\s+address|address/],
  ['city', /\bcity\b|town/],
  ['state', /\bstate\b|province|region/],
  ['zipCode', /\bzip(?:[\s_-]*code)?\b|postal[\s_-]*code|post[\s_-]*code/],
  ['jobTitle', /job[\s_-]*title|position|designation|occupation/],
  ['message', /message|comment|enquiry|inquiry|details|how can we help|requirement|description|tell us|your\s+needs/],
  ['name', /name/],
];

const CONSENT = /agree|consent|terms|privacy|accept|gdpr|policy|permission/i;
const NON_CONSENT_OPT_IN = /\bmarketing|newsletter|subscribe|subscription|promotional?|advertis(?:e|ing|ement)?|offers?|mailing\s+list|product\s+updates?\b/i;
const CAPTCHA_FIELD = /captcha|human[\s_-]*verification|security[\s_-]*(?:code|check)|verification[\s_-]*(?:code|text)/i;

function fieldText(d) {
  return [d.name, d.id, d.placeholder, d.label, d.ariaLabel, d.autocomplete].join(' ').toLowerCase();
}

// d: { tag, type, name, id, placeholder, label, ariaLabel, autocomplete }
// returns a contact detail key, or null when the field is not recognised
function classifyField(d) {
  const type = String(d.type || '').toLowerCase();
  if (['checkbox', 'radio', 'file', 'password', 'hidden', 'submit', 'button', 'image', 'reset', 'range', 'color'].includes(type)) {
    return null;
  }
  if (d.tag === 'select') return null;
  if (type === 'email') return 'email';
  if (type === 'tel') return 'phone';
  if (d.tag === 'textarea' || type === 'textarea') return 'message';
  if (type === 'url') return 'website';
  const hay = fieldText(d);
  if (type === 'number') {
    return /\bnumber\s+of\s+(?:practice\s+)?locations?\b|\blocation\s+count\b/.test(hay) ? 'locationCount' : null;
  }
  if (type === 'date' || type === 'time' || type === 'datetime-local' || type === 'month' || type === 'week') {
    return null;
  }
  for (const [key, re] of RULES) {
    if (re.test(hay)) return key;
  }
  return null;
}

function isConsentField(d) {
  const text = fieldText(d);
  return String(d.type).toLowerCase() === 'checkbox' && CONSENT.test(text) && !NON_CONSENT_OPT_IN.test(text);
}

function isCaptchaField(d) {
  return CAPTCHA_FIELD.test(fieldText(d));
}

// Expands the configured contact details into every key the classifier can return.
function buildFieldValues(contact) {
  const parts = String(contact.name || '').trim().split(/\s+/).filter(Boolean);
  const firstName = contact.firstName || parts[0] || '';
  const lastName = contact.lastName || parts.slice(1).join(' ') || firstName;
  return {
    name: contact.name || '',
    firstName,
    lastName,
    locationCount: contact.locationCount || '',
    email: contact.email || '',
    phone: contact.phone || '',
    company: contact.company || '',
    website: contact.website || '',
    subject: contact.subject || '',
    streetAddress: contact.streetAddress || '',
    city: contact.city || '',
    state: contact.state || '',
    zipCode: contact.zipCode || '',
    jobTitle: contact.jobTitle || '',
    message: contact.message || '',
  };
}

// options: [{ value, text }] -> the value to select, or null if nothing sensible.
function pickSelectOption(options, subject) {
  const usable = (options || []).filter(
    (o) => o.value !== '' && !/^(select|choose|please|--|—|pick)/i.test(String(o.text).trim())
  );
  if (usable.length === 0) return null;
  const wanted = String(subject || '').toLowerCase();
  const exact = wanted && usable.find((o) => String(o.text).toLowerCase().includes(wanted));
  const general = usable.find((o) => /general|enquiry|inquiry|quote|sales|contact|other/i.test(o.text));
  return (exact || general || usable[0]).value;
}

module.exports = { classifyField, isConsentField, isCaptchaField, buildFieldValues, pickSelectOption, RULES };
