/*
 * Regression test for the "duplicate call schedule on the summary page" bug.
 *
 * Bug (fixed in 2a80aee): expandCallableScheduleInXml() anchored on ANY paragraph
 * containing the phrase "Redemption Amount (Call Option)". The page-1 summary
 * ("What are Callable Linear Zero Coupon Notes?") has an "Early Redemption - Issuer
 * Call Option" narrative that contains that phrase, so the old code injected a full
 * call schedule there in addition to the two real, tokenised schedule sections
 * (Key Indicative Terms + General Terms) -> every call line rendered 3x.
 *
 * Fix: only expand paragraphs that carry the real schedule tokens
 * (<<Red_AMT Trade Date + N>> / <<Trade Date + N>>). The page-1 narrative has no
 * such tokens, so it is never anchored.
 *
 * This test extracts the live expansion pipeline straight out of the dashboard
 * HTML (no build step) and runs it against a faithful reconstruction of the real
 * 12-page HSBC template structure.
 *
 * Run: node test/call-schedule-expansion.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DASHBOARD = path.join(__dirname, '..', 'callable-linear-zero-dashboard.html');

// ---- pull the expansion functions out of the single <script> block ----------
function loadExpansion() {
  const html = fs.readFileSync(DASHBOARD, 'utf8');
  const blocks = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const src = blocks.find(b => b.includes('expandCallableScheduleInXml'));
  if (!src) throw new Error('Could not find expandCallableScheduleInXml in the dashboard.');

  function grabFn(name) {
    const i = src.search(new RegExp('function ' + name + '\\s*\\('));
    if (i < 0) return '';
    let depth = 0, started = false;
    for (let k = i; k < src.length; k++) {
      const c = src[k];
      if (c === '{') { depth++; started = true; }
      else if (c === '}') { depth--; if (started && depth === 0) return src.slice(i, k + 1); }
    }
    return '';
  }
  function grabConst(name) {
    const i = src.indexOf('const ' + name);
    if (i < 0) return '';
    return src.slice(i, src.indexOf(';', i) + 1);
  }

  const fns = [
    'decodeXmlEntities', 'normalizeXmlText', 'normalizeMatchText', 'extractLinesFromParagraph',
    'isCallOptionLineText', 'countCallLinesInParagraph', 'isCallOptionLineParagraph', 'paragraphHasCallToken',
    'isBlankParagraph', 'isCallOptionHeadingParagraph', 'isStopHeadingParagraph', 'getParagraphMeta',
    'findCallOptionSections', 'xmlEscapeText', 'getParagraphOpenTag', 'getParagraphProperties',
    'getFirstTextRunProperties', 'buildCallOptionSentence', 'rebuildParagraphWithCallTokens',
    'rebuildParagraphFromLines', 'findLargestCallLineBlock', 'expandCallOptionLinesInsideParagraph',
    'buildExpandedCallParagraphBlock', 'expandCallableScheduleInXml'
  ];
  let code = grabConst('CALL_OPTION_HEADING_NORMALIZED') + '\n' + grabConst('CALL_OPTION_STOP_HEADINGS') + '\n';
  fns.forEach(n => { code += grabFn(n) + '\n'; });
  code += '\nmodule.exports = { expandCallableScheduleInXml };\n';
  const m = { exports: {} };
  new Function('module', 'exports', code)(m, m.exports);
  return m.exports.expandCallableScheduleInXml;
}

// ---- faithful reconstruction of the real template (from the term-sheet pages) ----
function para(text) {
  const enc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<w:p><w:pPr><w:pStyle w:val="Body"/></w:pPr><w:r><w:rPr><w:sz w:val="16"/></w:rPr>` +
    `<w:t xml:space="preserve">${enc}</w:t></w:r></w:p>`;
}
function heading(text) {
  const enc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<w:p><w:pPr><w:pStyle w:val="Heading"/></w:pPr><w:r>` +
    `<w:t xml:space="preserve">${enc}</w:t></w:r></w:p>`;
}

function buildTemplateXml() {
  const p = [];
  // Page 1 - summary. NOTE: the "Early Redemption - Issuer Call Option" narrative
  // contains the literal phrase "Redemption Amount (Call Option)" but NO tokens.
  p.push(heading('What are Callable Linear Zero Coupon Notes?'));
  p.push(para('Objectives: The Notes are designed for investors. Investors will receive no interest payments during life of the Notes.'));
  p.push(para('Payment on the Maturity Date: Unless an Early Redemption Event has occurred, the Notes will redeem on the Maturity Date at <<Maturity DD MMM YYYY>> of the Calculation Amount representing a linear accretion rate (LAR) of <<LAR>> without compounding.'));
  p.push(para('Early Redemption - Issuer Call Option: The Notes will redeem early if the Issuer exercises its option to redeem the Notes on any call option date. If this occurs, investors will receive the Redemption Amount (Call Option) equal to the Issue Price plus the accreted value.'));
  p.push(para('Early Redemption: In case of an early redemption, investors will receive the Fair Market Value of the Notes at the date of early redemption.'));
  p.push(para('Also, depending on the market conditions at the time of the sale, investors may lose some or all of their investment.'));
  const page1Len = p.length;

  // Key Indicative Terms - real tokenised schedule (seed lines 1..4 + maturity line).
  p.push(heading('Key Indicative Terms'));
  p.push(para('Redemption Amount (Call Option)'));
  for (let n = 1; n <= 4; n++) p.push(para(`<<Red_AMT Trade Date + ${n}>> of the Calculation Amount per Calculation Amount on <<Trade Date + ${n}>>`));
  p.push(para('Redemption at Maturity (Final Redemption Amount): <<Red_AMT Trade Date + Tenor>> of the Calculation Amount per Calculation Amount on <<Maturity DD MMM YYYY>>'));

  // General Terms of the Notes - the second real tokenised schedule.
  p.push(heading('General Terms of the Notes'));
  p.push(para('Redemption Amount (Call Option):'));
  for (let n = 1; n <= 4; n++) p.push(para(`<<Red_AMT Trade Date + ${n}>> of the Calculation Amount per Calculation Amount on <<Trade Date + ${n}>>`));
  p.push(para('Redemption at option of Noteholder (Put Option): Not applicable'));
  p.push(para('Redemption at Maturity (Final Redemption Amount): <<Red_AMT Trade Date + Tenor>> of the Calculation Amount per Calculation Amount on <<Red_AMT Trade Date + Tenor>>'));

  return { xml: '<w:body>' + p.join('\n') + '</w:body>', parts: p, page1Len };
}

// ---- assertions -------------------------------------------------------------
let passed = 0, failed = 0;
function ok(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (extra != null ? '  [' + JSON.stringify(extra) + ']' : '')); }
}
function countToken(str, n) {
  return (str.match(new RegExp('&lt;&lt;Red_AMT Trade Date \\+ ' + n + '&gt;&gt;', 'g')) || []).length;
}

console.log('\n== Call schedule expansion (tenor = 10 -> 9 call dates) ==');
const expand = loadExpansion();
const { xml, parts, page1Len } = buildTemplateXml();
const out = expand(xml, 10);

const page1Out = out.slice(0, out.indexOf('Key Indicative Terms'));
const page1HasSchedule = /Red_AMT Trade Date \+ [0-9]/.test(page1Out);
ok('page-1 summary is NOT given a call schedule', page1HasSchedule === false);

// Each numbered call line 1..9 must appear exactly twice: Key Ind. Terms + General Terms.
let allTwice = true;
for (let n = 1; n <= 9; n++) { if (countToken(out, n) !== 2) { allTwice = false; ok('call line + ' + n + ' appears exactly 2x', false, countToken(out, n)); } }
if (allTwice) ok('every call line (1..9) appears exactly 2x (the two real sections)', true);

ok('no + 10 line generated (callCount = tenor - 1 = 9)', countToken(out, 10) === 0, countToken(out, 10));
ok('maturity line <<Red_AMT Trade Date + Tenor>> is preserved', out.includes('&lt;&lt;Red_AMT Trade Date + Tenor&gt;&gt;'));

// tenor unset -> document returned unchanged.
ok('null tenor leaves the document untouched', expand(xml, null) === xml);

console.log(`\n${failed === 0 ? 'ALL PASS' : 'FAILURES'} — ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
