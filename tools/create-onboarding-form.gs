/**
 * Fork Algorithm — Client Onboarding form builder
 * ------------------------------------------------
 * WHAT THIS IS: a script that builds the client onboarding Google Form for you,
 * so you don't have to type forty questions in by hand.
 *
 * HOW TO USE IT: see docs/google-form-setup.md. Short version — paste this whole
 * file into script.google.com, run buildForm, approve the permission prompt, and
 * copy the two links it prints out.
 *
 * HEADS UP: running buildForm() a second time creates a SECOND form. If you want
 * to change a question, either edit the form in Google Forms directly, or delete
 * the old form first and run this again.
 *
 * WHY THE EXTRA TAB: a Google Form names its sheet columns after the question
 * text. Those long titles don't match the short field names used to build a
 * client's system. So this script also writes a tidy "Onboarding" tab with the
 * short names — the same columns the web onboarding page produces. Whichever way
 * a client comes in, you read one tab.
 */

var FORM_TITLE = 'Fork Algorithm — Client Onboarding';
var SHEET_NAME = 'Fork Algorithm — Leads & Onboarding';
var NORMALIZED_TAB = 'Onboarding';

var FORM_DESCRIPTION =
  "Everything here goes straight into building your system — the services you list become the " +
  "options your customer taps, and the numbers you give us are where your lead alerts land. " +
  "About 10 minutes. Have your EIN and business address handy for the last section; that's the " +
  "part the phone carriers need and it's what takes the longest to approve.";

/**
 * Every question, in order. This one list drives both the form and the tidy tab,
 * so a field name can never drift between the two.
 *
 * type: 'text' | 'paragraph' | 'choice' | 'dropdown' | 'checkbox' | 'date' | 'consent'
 * section: starts a new page before this question
 */
var FIELDS = [
  { section: 'Your business',
    sectionHelp: 'The basics we need to set up your account and make the texts sound like you.' },

  { key: 'legal_business_name', type: 'text', required: true,
    title: 'Legal business name',
    help: 'Exactly as it appears on your business registration — this is used for carrier approval.' },
  { key: 'display_name', type: 'text', required: true,
    title: 'What name do customers know you by?',
    help: 'This is the name that appears in the text: "Hi, this is [your name here]."' },
  { key: 'business_type', type: 'choice', required: true,
    title: 'What kind of business is it?',
    choices: ['Restaurant / Food', 'Lawn & Landscaping', 'General Contractor / Construction',
              'HVAC', 'Plumbing', 'Electrical', 'Roofing', 'Cleaning', 'Pressure Washing',
              'Pest Control', 'Pool Service', 'Other'] },
  { key: 'website', type: 'text',
    title: 'Website' },
  { key: 'service_area', type: 'text', required: true,
    title: 'Service area or address',
    help: 'Cities or ZIP codes you serve. If you are a restaurant, your address is fine.' },
  { key: 'timezone', type: 'dropdown', required: true,
    title: 'Time zone',
    choices: ['Eastern (ET)', 'Central (CT)', 'Mountain (MT)', 'Arizona (MST)',
              'Pacific (PT)', 'Alaska (AKT)', 'Hawaii (HT)'] },

  { section: 'Phones & alerts',
    sectionHelp: 'Which number we watch for missed calls, and who we ping when a lead comes in.' },

  { key: 'main_business_number', type: 'text', required: true,
    title: 'Main number customers call',
    help: 'This is the number we watch. You keep it — nothing about your current line changes.' },
  { key: 'current_phone_provider', type: 'text',
    title: 'Current phone provider',
    help: 'For example Verizon, RingCentral, or whoever your line is through.' },
  { key: 'who_answers_now', type: 'text',
    title: 'Who answers calls today?' },
  { key: 'alert_sms_numbers', type: 'text', required: true,
    title: 'Which numbers should get a text when a lead comes in?',
    help: 'Separate multiple numbers with commas.' },
  { key: 'alert_emails', type: 'text', required: true,
    title: 'Which email addresses should get lead alerts?' },
  { key: 'business_hours', type: 'paragraph', required: true,
    title: 'Your business hours, one day per line',
    help: 'Like this — Mon 08:00-17:00, next line Tue 08:00-17:00, and so on. ' +
          'Write "closed" for days you are closed, e.g. Sun closed.' },
  { key: 'after_hours_message', type: 'paragraph',
    title: 'What should the text say outside your hours?',
    help: 'Leave this blank and we will write one for you.' },

  { section: 'Your services & the text',
    sectionHelp: 'These become the options your customer taps when they get the text back.' },

  { key: 'services', type: 'paragraph', required: true,
    title: 'Your services, one per line',
    help: 'Up to six. Put your most-requested service first — that is the order they appear in.' },
  { key: 'qualification_questions', type: 'checkbox', required: true,
    title: 'What should the system ask them?',
    help: 'Untick anything that does not fit how you work. Fewer questions usually means more replies.',
    choices: ['Property address', 'One-time or recurring', 'Preferred timing',
              'Photos of the job', 'Name and callback number'] },
  { key: 'custom_question', type: 'text',
    title: 'One extra question of your own',
    help: 'Optional. For example: is this for a home or a business?' },

  { section: 'Guardrails',
    sectionHelp: 'The rules the system follows so it never says something you would have to walk back.' },

  { key: 'pricing_policy', type: 'choice', required: true,
    title: 'Can it talk about price?',
    help: 'Most owners start with "never quote" — the system collects details and you set the price.',
    choices: ['Never quote a price', 'Ranges only', 'Quote from an approved list'] },
  { key: 'approved_price_ranges', type: 'paragraph',
    title: 'Your approved prices or ranges',
    help: 'Skip this unless you picked "Ranges only" or "Quote from an approved list" above.' },
  { key: 'never_say', type: 'paragraph',
    title: 'Anything it must never say or promise?',
    help: 'For example: never promise same-day service, never say we do tree removal.' },
  { key: 'minimum_job_size', type: 'text',
    title: 'Smallest job you will take' },
  { key: 'jobs_not_accepted', type: 'text',
    title: 'Jobs you do not take' },
  { key: 'offers_recurring', type: 'choice', required: true,
    title: 'Do you offer recurring service?',
    choices: ['Yes', 'No', 'Sometimes'] },
  { key: 'escalation_contact_name', type: 'text', required: true,
    title: 'Who takes urgent calls?' },
  { key: 'escalation_contact_phone', type: 'text', required: true,
    title: 'Their cell number' },
  { key: 'urgent_triggers', type: 'checkbox', required: true,
    title: 'Hand it straight to a human when…',
    choices: ['Emergency or urgent same-day', 'Property damage reported', 'Angry or legal threat',
              'Commercial or high-value lead', 'Asks for a person', 'Service we do not offer'] },
  { key: 'backup_contact', type: 'text',
    title: 'Backup contact if that person is unreachable',
    help: 'Name and number.' },

  { section: 'Where leads land',
    sectionHelp: 'What happens after the system has the details, and where you will see it all.' },

  { key: 'lead_outcome', type: 'choice', required: true,
    title: 'What should the system aim for?',
    choices: ['Booking', 'Estimate request', 'Callback only'] },
  { key: 'existing_crm', type: 'dropdown',
    title: 'Calendar or CRM you already use',
    choices: ['None / spreadsheet', 'Google Calendar', 'Jobber', 'Housecall Pro',
              'ServiceTitan', 'Toast', 'Square', 'Other'] },
  { key: 'lead_destination', type: 'text',
    title: 'Where should leads show up for you?',
    help: 'For example: a Google Sheet, plus a text to me.' },
  { key: 'google_business_profile_url', type: 'text',
    title: 'Google Business Profile link' },
  { key: 'facebook_url', type: 'text',
    title: 'Facebook page link' },
  { key: 'instagram_url', type: 'text',
    title: 'Instagram link' },
  { key: 'logo_url', type: 'text',
    title: 'Link to your logo',
    help: 'No link handy? Leave it blank and email the file over instead.' },
  { key: 'brand_tone', type: 'choice', required: true,
    title: 'How should the texts sound?',
    choices: ['Professional', 'Friendly', 'Casual'] },

  { section: 'Your starting numbers',
    sectionHelp: 'Rough estimates are fine. We use these to show you what the system recovered.' },

  { key: 'missed_calls_per_week', type: 'number', required: true,
    title: 'Missed calls in a normal week' },
  { key: 'avg_customer_value', type: 'number', required: true,
    title: 'Average value of a new customer, in dollars' },
  { key: 'current_callback_time', type: 'text',
    title: 'How long before someone usually calls them back?' },

  { section: 'Carrier registration',
    sectionHelp: 'US carriers require every business texting number to be registered. This is that ' +
                 'paperwork — it is the slowest part, so getting it right now saves you a week. ' +
                 'It has to match what the IRS has on file or they reject it.' },

  { key: 'ein', type: 'text', required: true,
    title: 'EIN / Tax ID' },
  { key: 'tier', type: 'dropdown', required: true,
    title: 'Which plan did you sign up for?',
    choices: ['Speed to Lead', 'Growth', 'Revenue Operations'] },
  { key: 'business_address', type: 'text', required: true,
    title: 'Registered business address',
    help: 'Street, city, state, ZIP — must match your IRS records.' },
  { key: 'authorized_rep_name', type: 'text', required: true,
    title: 'Authorized representative' },
  { key: 'authorized_rep_title', type: 'text', required: true,
    title: 'Their title' },
  { key: 'authorized_rep_email', type: 'email', required: true,
    title: 'Their email address' },
  { key: 'target_go_live_date', type: 'date', required: true,
    title: 'Target go-live date' },
  { key: 'consent_authorize_sms', type: 'consent', required: true,
    title: 'Authorization',
    choices: ['I authorize Fork Algorithm to register this business for text messaging and to ' +
              'send texts on its behalf.'] },
  { key: 'consent_info_accurate', type: 'consent', required: true,
    title: 'Confirmation',
    choices: ['The information above is accurate to the best of my knowledge.'] }
];

/**
 * Columns on the tidy tab, in order. These match the web onboarding page exactly,
 * so both routes produce the same shape. The agreement and signature columns stay
 * blank for form submissions — this form is intake only, signing happens elsewhere.
 */
var HEADERS = [
  'submission_id', 'submitted_at', 'intake_source',
  'legal_business_name', 'display_name', 'business_type', 'website', 'service_area', 'timezone',
  'main_business_number', 'current_phone_provider', 'who_answers_now', 'alert_sms_numbers',
  'alert_emails', 'business_hours', 'after_hours_message',
  'services', 'services_count', 'qualification_questions', 'custom_question',
  'pricing_policy', 'approved_price_ranges', 'never_say', 'minimum_job_size',
  'jobs_not_accepted', 'offers_recurring', 'escalation_contact_name',
  'escalation_contact_phone', 'urgent_triggers', 'backup_contact',
  'lead_outcome', 'existing_crm', 'lead_destination', 'google_business_profile_url',
  'facebook_url', 'instagram_url', 'logo_url', 'brand_tone',
  'missed_calls_per_week', 'avg_customer_value', 'current_callback_time', 'estimated_annual_loss',
  'ein', 'tier', 'business_address', 'authorized_rep_name', 'authorized_rep_title',
  'authorized_rep_email', 'target_go_live_date', 'consent_authorize_sms', 'consent_info_accurate',
  'agreement_version', 'agreement_tier', 'agreement_setup_fee', 'agreement_monthly_fee',
  'agreement_term_months', 'agreement_notice_days', 'agreement_year_one_total',
  'signature_name', 'signature_title', 'signature_agreed', 'consent_case_study', 'signature_date',
  'user_agent'
];


// ─────────────────────────────────────────────────────────────────────────────
// Run this one.
// ─────────────────────────────────────────────────────────────────────────────
function buildForm() {
  var form = FormApp.create(FORM_TITLE);
  form.setDescription(FORM_DESCRIPTION);
  form.setProgressBar(true);
  // Deliberately NOT calling setCollectEmail(true) — that forces respondents to
  // sign in with a Google account, and a client on a non-Google work email would
  // be locked out entirely. We ask for their email as a question instead.
  form.setConfirmationMessage(
    "Got it — thank you. We file your carrier registration next, then send your text-back " +
    "script over for approval. If anything in there was a guess, text Sisto and we will fix it."
  );

  for (var i = 0; i < FIELDS.length; i++) {
    addField(form, FIELDS[i]);
  }

  var ss = SpreadsheetApp.create(SHEET_NAME);
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());

  var tab = ss.insertSheet(NORMALIZED_TAB);
  tab.appendRow(HEADERS);
  tab.setFrozenRows(1);
  tab.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');

  PropertiesService.getScriptProperties().setProperty('SHEET_ID', ss.getId());

  ScriptApp.newTrigger('onFormSubmit').forForm(form).onFormSubmit().create();

  var out = [
    '',
    '  Done. Two links you need:',
    '',
    '  SEND THIS TO CLIENTS:  ' + form.getPublishedUrl(),
    '  EDIT THE FORM HERE:    ' + form.getEditUrl(),
    '  YOUR RESPONSES SHEET:  ' + ss.getUrl(),
    '',
    '  Submit one junk response now and check the "' + NORMALIZED_TAB + '" tab has a row.',
    '  Delete that row before you send the link to a real client.',
    ''
  ].join('\n');
  Logger.log(out);
  return out;
}


function addField(form, f) {
  if (f.section) {
    var page = form.addPageBreakItem().setTitle(f.section);
    if (f.sectionHelp) page.setHelpText(f.sectionHelp);
    return;
  }

  var item;
  switch (f.type) {
    case 'paragraph':
      item = form.addParagraphTextItem();
      break;
    case 'choice':
      item = form.addMultipleChoiceItem().setChoiceValues(f.choices);
      break;
    case 'dropdown':
      item = form.addListItem().setChoiceValues(f.choices);
      break;
    case 'checkbox':
    case 'consent':
      item = form.addCheckboxItem().setChoiceValues(f.choices);
      break;
    case 'date':
      item = form.addDateItem();
      break;
    case 'email':
      item = form.addTextItem().setValidation(
        FormApp.createTextValidation().requireTextIsEmail().build());
      break;
    case 'number':
      item = form.addTextItem().setValidation(
        FormApp.createTextValidation().requireNumberGreaterThanOrEqualTo(0).build());
      break;
    default:
      item = form.addTextItem();
  }

  item.setTitle(f.title);
  if (f.help) item.setHelpText(f.help);
  if (f.required) item.setRequired(true);
}


// ─────────────────────────────────────────────────────────────────────────────
// Runs itself every time someone submits. Writes the tidy row.
// ─────────────────────────────────────────────────────────────────────────────
function onFormSubmit(e) {
  var sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!sheetId) return;

  var ss = SpreadsheetApp.openById(sheetId);
  var tab = ss.getSheetByName(NORMALIZED_TAB) || ss.insertSheet(NORMALIZED_TAB);
  if (tab.getLastRow() === 0) {
    tab.appendRow(HEADERS);
    tab.setFrozenRows(1);
  }

  var answers = readAnswers(e.response);
  var row = [];
  for (var i = 0; i < HEADERS.length; i++) {
    row.push(answers[HEADERS[i]] === undefined ? '' : answers[HEADERS[i]]);
  }
  tab.appendRow(row);
}


/** Turns a form response into an object keyed by our short field names. */
function readAnswers(response) {
  var titleToKey = {};
  for (var i = 0; i < FIELDS.length; i++) {
    if (FIELDS[i].key) titleToKey[FIELDS[i].title] = FIELDS[i];
  }

  var out = {};
  var items = response.getItemResponses();
  for (var j = 0; j < items.length; j++) {
    var field = titleToKey[items[j].getItem().getTitle()];
    if (!field) continue;
    var value = items[j].getResponse();

    if (field.type === 'consent') {
      out[field.key] = (value && value.length) ? 'yes' : 'no';
    } else if (Object.prototype.toString.call(value) === '[object Array]') {
      out[field.key] = value.join('; ');
    } else {
      out[field.key] = value;
    }
  }

  // One service per line becomes one cell, same as the web page sends.
  if (out.services) {
    var services = splitLines(out.services);
    out.services = services.join('; ');
    out.services_count = services.length;
  } else {
    out.services_count = 0;
  }

  // Same for hours — one day per line becomes "Mon 08:00-17:00; Tue …".
  if (out.business_hours) {
    out.business_hours = splitLines(out.business_hours).join('; ');
  }

  var calls = Number(out.missed_calls_per_week) || 0;
  var value = Number(out.avg_customer_value) || 0;
  out.estimated_annual_loss = calls * value * 52;

  out.submission_id = 'FA-' + Utilities.getUuid().replace(/-/g, '').substring(0, 5).toUpperCase();
  out.submitted_at = new Date().toISOString();
  out.intake_source = 'google_form';

  return out;
}


function splitLines(text) {
  var parts = String(text).split('\n');
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var line = parts[i].replace(/^\s+|\s+$/g, '');
    if (line) out.push(line);
  }
  return out;
}
