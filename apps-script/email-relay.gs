// UZES Payments — Email Relay v3 (Google Apps Script)
// Deploy: Web app → Execute as Me (uzesofficial@gmail.com) → Anyone
// After deploying paste the URL into public/js/config.js → EMAIL_RELAY_URL

// ── Logo Drive file IDs ───────────────────────────────────────────────────────
var LOGO_UNZA_ID = "1fTj_DNg_kU3qUh0yQ-FueqUECH_lTZOK";
var LOGO_UZES_ID = "1kHdRPe2WX6fUi868UfQ_mLjHDQ8zrn06";

// ── Letter template config ────────────────────────────────────────────────────
// Drive folder: INDUSTRIAL TRAINING TEMPLATE LATTER
var LETTER_TEMPLATE_FOLDER_ID = '1qf-_6ghh61sYashwdD4P-DIy7QwkKEBP';
// Script Properties key where the converted Google Doc ID is cached after first run
var TEMPLATE_DOC_ID_KEY       = 'LETTER_TEMPLATE_DOC_ID';

// ── Security ──────────────────────────────────────────────────────────────────
var MAX_EMAILS_PER_HOUR = 60;

// ─────────────────────────────────────────────────────────────────────────────

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    // 1. Token validation
    var expectedToken = PropertiesService.getScriptProperties().getProperty("RELAY_TOKEN");
    if (expectedToken && data._token !== expectedToken) {
      Logger.log("RELAY: unauthorized request — token mismatch");
      return jsonResponse({ ok: false, error: "Unauthorized" });
    }

    // 2. Rate limiting — max MAX_EMAILS_PER_HOUR per rolling hour
    var cache   = CacheService.getScriptCache();
    var rateKey = "email_count_" + Utilities.formatDate(new Date(), "UTC", "yyyyMMddHH");
    var count   = parseInt(cache.get(rateKey) || "0", 10);
    if (count >= MAX_EMAILS_PER_HOUR) {
      Logger.log("RELAY: rate limit exceeded (" + count + " this hour)");
      return jsonResponse({ ok: false, error: "Rate limit exceeded" });
    }
    cache.put(rateKey, String(count + 1), 3600);

    // 3. Require a valid destination address
    if (!data.to || !data.to.includes("@")) {
      return jsonResponse({ ok: false, error: "Invalid recipient" });
    }

    // 4. Route by type
    if (data.type === "reject") {
      sendRejectionEmail(data);
    } else if (data.type === "attachment_letter") {
      var pdf = buildLetterPdf(data);
      sendLetterEmail(data, pdf);
    } else if (data.type === "attachment_rejection") {
      sendAttachmentRejectionEmail(data);
    } else if (data.type === "placement_letter") {
      var placPdf = buildPlacementLetterPdf(data);
      sendPlacementLetterEmail(data, placPdf);
    } else {
      var pdf = buildReceiptPdf(data);
      sendReceiptEmail(data, pdf);
    }

    return jsonResponse({ ok: true });

  } catch (err) {
    Logger.log("doPost error: " + err.message);
    return jsonResponse({ ok: false, error: err.message });
  }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Payment rejection email ───────────────────────────────────────────────────
function sendRejectionEmail(d) {
  var body =
    '<p>Dear ' + esc(d.studentName || "Student") + ',</p>' +
    '<p>Your payment submission' +
    (d.category ? ' for <strong>' + esc(d.category) + '</strong>' : '') +
    (d.amount   ? ' of <strong>K ' + parseFloat(d.amount || 0).toFixed(2) + '</strong>' : '') +
    ' has been <strong style="color:#c0392b">rejected</strong>.</p>' +
    '<p><strong>Reason:</strong> ' + esc(d.reason || "No reason provided") + '</p>' +
    '<p>Please resubmit with the correct information or contact the UZES Treasurer if you have questions.</p>' +
    '<br><p>Regards,<br><strong>UZES ' + esc(d.reviewerPosition || 'Executive') + ' (' + esc(d.reviewerName || 'UZES Executive') + ') — University of Zambia Engineering Society</strong></p>';

  MailApp.sendEmail({
    to:       d.to,
    subject:  'UZES Payment Rejected' + (d.category ? ' — ' + esc(d.category) : ''),
    htmlBody: body,
    replyTo:  'uzesofficial@gmail.com',
    name:     'UZES Payments'
  });
}

// ── Payment receipt PDF ───────────────────────────────────────────────────────
function buildReceiptPdf(d) {
  var receiptNo = String(d.receiptNo || "").padStart(4, "0");
  var date      = d.reviewedAt || Utilities.formatDate(new Date(), "Africa/Lusaka", "dd MMMM yyyy");
  var amount    = parseFloat(d.amount || 0).toFixed(2);

  var logoUnzaB64 = driveImageToBase64(LOGO_UNZA_ID);
  var logoUzesB64 = driveImageToBase64(LOGO_UZES_ID);
  var sigB64      = d.signatureB64 || "";
  var qrB64       = d.verifyUrl ? fetchQrCode(d.verifyUrl) : "";

  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
    '<style>' +
    '* { box-sizing: border-box; margin: 0; padding: 0; }' +
    'body { background: #fff; font-family: Arial, sans-serif; padding: 18px; }' +
    '.wrap { border: 1.5px solid #aaa; padding: 12px 18px 14px 18px; color: #000; max-width: 680px; margin: 0 auto; }' +
    '.header { display: table; width: 100%; margin-bottom: 6px; }' +
    '.header-left  { display: table-cell; width: 70px; vertical-align: top; }' +
    '.header-center { display: table-cell; text-align: center; vertical-align: top; padding: 0 8px; }' +
    '.header-right { display: table-cell; width: 70px; vertical-align: top; text-align: right; }' +
    '.logo { width: 60px; height: 60px; object-fit: contain; }' +
    '.h-title { font-size: 17px; font-weight: 900; letter-spacing: 0.3px; line-height: 1.2; }' +
    '.h-sub   { font-size: 12px; font-weight: 700; margin-top: 2px; }' +
    '.h-info  { font-size: 11px; margin-top: 1px; }' +
    'hr { border: none; border-top: 1.5px solid #000; margin: 8px 0 6px; }' +
    '.row1 { display: table; width: 100%; margin: 6px 0; }' +
    '.row1-left  { display: table-cell; font-size: 12px; vertical-align: middle; }' +
    '.row1-mid   { display: table-cell; text-align: center; vertical-align: middle; }' +
    '.row1-right { display: table-cell; text-align: right; vertical-align: middle; font-size: 12px; font-weight: 700; }' +
    '.receipt-box { border: 1.5px solid #000; padding: 2px 14px; font-size: 13px; font-weight: 700; letter-spacing: 1px; display: inline-block; }' +
    '.no-num { font-size: 20px; font-weight: 900; color: #cc0000; }' +
    '.field-row { display: table; width: 100%; margin-top: 7px; font-size: 12px; }' +
    '.fl { display: table-cell; white-space: nowrap; vertical-align: bottom; padding-right: 4px; }' +
    '.fdot { display: table-cell; width: 100%; border-bottom: 1.5px dotted #555; vertical-align: bottom; padding-bottom: 1px; padding-left: 3px; font-size: 12px; }' +
    '.fl-sm { display: table-cell; white-space: nowrap; vertical-align: bottom; padding: 0 4px; }' +
    '.fdot-sm { display: table-cell; width: 120px; border-bottom: 1.5px dotted #555; vertical-align: bottom; padding-bottom: 1px; padding-left: 3px; font-size: 12px; }' +
    '.amount-row { display: table; width: 100%; margin-top: 6px; }' +
    '.dot-fill { display: table-cell; width: 100%; border-bottom: 1.5px dotted #555; }' +
    '.k-box { display: table-cell; white-space: nowrap; }' +
    '.k-box-inner { display: inline-table; border: 1.5px solid #000; font-size: 13px; font-weight: 700; }' +
    '.kk { display: table-cell; padding: 2px 8px; border-right: 1.5px solid #000; font-weight: 900; }' +
    '.kv { display: table-cell; padding: 2px 14px; min-width: 80px; }' +
    '.sig-row { display: table; width: 100%; margin-top: 8px; font-size: 12px; }' +
    '.sig-left  { display: table-cell; width: 50%; vertical-align: bottom; }' +
    '.sig-right { display: table-cell; width: 50%; vertical-align: bottom; padding-left: 8px; }' +
    '.sig-line  { display: table; width: 100%; }' +
    '.sig-img   { max-height: 48px; max-width: 160px; display: block; margin-bottom: 2px; }' +
    '.watermark { position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; pointer-events: none; z-index: 1; }' +
    '.watermark-text { font-size: 120px; font-weight: 900; color: rgba(200,50,50,.12); transform: rotate(-45deg); white-space: nowrap; text-shadow: 2px 2px 4px rgba(0,0,0,.05); letter-spacing: 8px; }' +
    '.wrap { position: relative; }' +
    '.verify-section { display: table; width: 100%; margin-top: 12px; padding-top: 10px; border-top: 1.5px solid #000; }' +
    '.verify-left  { display: table-cell; vertical-align: middle; padding-right: 12px; }' +
    '.verify-right { display: table-cell; vertical-align: middle; text-align: right; width: 100px; }' +
    '.verify-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .6px; margin-bottom: 3px; }' +
    '.verify-sub   { font-size: 9px; color: #555; margin-bottom: 3px; }' +
    '.verify-url   { font-size: 8px; color: #222; word-break: break-all; }' +
    '.verify-qr    { width: 90px; height: 90px; }' +
    '</style></head><body><div class="wrap">' +
    (d.isTrial ? '<div class="watermark"><div class="watermark-text">TRIAL RECEIPT</div></div>' : '') +
    '<div class="header">' +
    '  <div class="header-left"><img class="logo" src="' + logoUnzaB64 + '" alt="UNZA"></div>' +
    '  <div class="header-center">' +
    '    <div class="h-title">THE UNIVERSITY OF ZAMBIA</div>' +
    '    <div class="h-sub">School of Engineering</div>' +
    '    <div class="h-info">The University of Zambia Engineering Society (UZES)</div>' +
    '    <div class="h-info">P.O. Box 32379, Lusaka&nbsp;/&nbsp;Email: uzesofficial@gmail.com</div>' +
    '  </div>' +
    '  <div class="header-right"><img class="logo" src="' + logoUzesB64 + '" alt="UZES"></div>' +
    '</div>' +

    '<hr>' +

    '<div class="row1">' +
    '  <div class="row1-left">Date: ' + date + '</div>' +
    '  <div class="row1-mid"><span class="receipt-box">RECEIPT</span></div>' +
    '  <div class="row1-right">No. <span class="no-num">' + receiptNo + '</span></div>' +
    '</div>' +

    '<div class="field-row">' +
    '  <span class="fl">Received from</span>' +
    '  <span class="fdot">' + esc(d.studentName) + '</span>' +
    '  <span class="fl-sm">Comp #</span>' +
    '  <span class="fdot-sm">' + esc(d.compNumber) + '</span>' +
    '</div>' +

    '<div class="field-row">' +
    '  <span class="fl">The Sum of (Amount in words)</span>' +
    '  <span class="fdot">' + esc(d.amountInWords) + '</span>' +
    '</div>' +

    '<div class="amount-row">' +
    '  <span class="dot-fill"></span>' +
    '  <span class="k-box"><div class="k-box-inner"><span class="kk">K</span><span class="kv">' + amount + '</span></div></span>' +
    '</div>' +

    '<div class="field-row">' +
    '  <span class="fl">Being payment for:</span>' +
    '  <span class="fdot">' + esc(d.category) + '</span>' +
    '</div>' +

    '<div class="field-row">' +
    '  <span class="fl">Payment method / Ref:</span>' +
    '  <span class="fdot">' + esc(d.method) + (d.txRef ? ' — ' + esc(d.txRef) : '') + '</span>' +
    '</div>' +

    '<div class="sig-row">' +
    '  <div class="sig-left">' +
    '    <div class="sig-line">' +
    '      <span class="fl">Received by:</span>' +
    '      <span class="fdot">' + esc(d.reviewerName) + ' (' + esc(d.reviewerPosition) + ')</span>' +
    '    </div>' +
    '  </div>' +
    '  <div class="sig-right">' +
    '    <div class="sig-line">' +
    '      <span class="fl">Sign:</span>' +
    '      <span class="fdot">' +
          (sigB64 ? '<img class="sig-img" src="' + sigB64 + '" alt="Signature">' : '&nbsp;') +
    '      </span>' +
    '    </div>' +
    '  </div>' +
    '</div>' +

    // ── QR verification section (only when verifyUrl provided) ──
    (qrB64 ? (
      '<div class="verify-section">' +
      '  <div class="verify-left">' +
      '    <div class="verify-title">Scan to verify this receipt</div>' +
      '    <div class="verify-sub">Verify authenticity instantly — no login required.</div>' +
      '    <div class="verify-url">' + esc(d.verifyUrl) + '</div>' +
      '  </div>' +
      '  <div class="verify-right"><img class="verify-qr" src="' + qrB64 + '" alt="Verify QR"></div>' +
      '</div>'
    ) : '') +

    '</div></body></html>';

  var blob      = Utilities.newBlob(html, MimeType.HTML, 'receipt.html');
  var driveFile = DriveApp.createFile(blob);
  var pdfBlob   = driveFile.getAs(MimeType.PDF).setName('UZES_Receipt_' + receiptNo + '.pdf');
  driveFile.setTrashed(true);
  return pdfBlob;
}

// ── Send receipt email ────────────────────────────────────────────────────────
function sendReceiptEmail(d, pdfBlob) {
  var receiptNo = String(d.receiptNo || "").padStart(4, "0");
  var org       = d.org || {};
  var orgEmail  = org.email || "uzesofficial@gmail.com";

  var body = '<p>Dear ' + esc(d.studentName) + ',</p>' +
    '<p>Your payment of <strong>K ' + parseFloat(d.amount).toFixed(2) + '</strong> ' +
    'for <strong>' + esc(d.category) + '</strong> has been confirmed.</p>' +
    '<p>Please find your official receipt attached (Receipt #' + receiptNo + ').</p>' +
    '<p>Keep this receipt for your records.</p>' +
    '<br><p>Regards,<br><strong>UZES ' + esc(d.reviewerPosition || 'Executive') + ' (' + esc(d.reviewerName || 'UZES Executive') + ') — University of Zambia Engineering Society</strong></p>';

  MailApp.sendEmail({
    to:          d.to,
    subject:     'UZES Payment Receipt #' + receiptNo + ' — ' + (d.category || 'Payment'),
    htmlBody:    body,
    attachments: [pdfBlob],
    replyTo:     orgEmail,
    name:        'UZES Payments'
  });
}

// ── QR code: fetch PNG for a URL and return as base64 data URI ───────────────
function fetchQrCode(url) {
  try {
    var apiUrl = "https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=4&ecc=M&data="
                 + encodeURIComponent(url);
    var resp = UrlFetchApp.fetch(apiUrl, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return "";
    return "data:image/png;base64," + Utilities.base64Encode(resp.getBlob().getBytes());
  } catch (e) {
    Logger.log("fetchQrCode error: " + e.message);
    return "";
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function driveImageToBase64(fileId) {
  try {
    var blob = DriveApp.getFileById(fileId).getBlob();
    var b64  = Utilities.base64Encode(blob.getBytes());
    var mime = blob.getContentType() || 'image/png';
    return 'data:' + mime + ';base64,' + b64;
  } catch (e) {
    Logger.log('driveImageToBase64 failed for ' + fileId + ': ' + e.message);
    return '';
  }
}

function imageToBase64(url) {
  if (!url) return '';
  if (url.indexOf('data:') === 0) return url;
  try {
    var resp = UrlFetchApp.fetch(url, { followRedirects: true, muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return '';
    var b64  = Utilities.base64Encode(resp.getBlob().getBytes());
    var mime = resp.getBlob().getContentType() || 'image/png';
    return 'data:' + mime + ';base64,' + b64;
  } catch (e) {
    Logger.log('imageToBase64 failed for ' + url + ': ' + e.message);
    return '';
  }
}

function esc(s) {
  return s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : '';
}

// Builds a case-insensitive regex pattern that matches a {placeholder} regardless
// of whether the key uses underscores or spaces.
// e.g. "nrc_number" → (?i)\{nrc[_ ]+number\}
// matches {nrc_number}, {nrc number}, {NRC Number}, {NRC_NUMBER}, etc.
function buildFlexPlaceholder(key) {
  var parts = String(key).toLowerCase().split(/[_\s]+/).filter(function(p) { return p.length > 0; });
  var escaped = parts.map(function(p) { return p.replace(/[.*+?^$()|[\]\\]/g, '\\$&'); });
  return '(?i)\\{' + escaped.join('[_ ]+') + '\\}';
}

// Formats a Date object or "YYYY-MM-DD" string as "June 23, 2026".
// When given a string, splits on '-' to avoid the UTC-midnight timezone shift
// that new Date("YYYY-MM-DD") causes in some environments.
function formatDate(input) {
  if (!input) return '';
  var d;
  if (input instanceof Date) {
    d = input;
  } else {
    var parts = String(input).split('-');
    if (parts.length < 3) return String(input);
    d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  }
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

// ── Attachment letter — Google Doc template approach ──────────────────────────
//
// HOW IT WORKS (automatic, no manual steps needed):
//   1. On first call, finds the Word doc (.docx) in the INDUSTRIAL TRAINING
//      TEMPLATE LATTER folder and converts it to a Google Doc via Drive API.
//      The resulting Doc ID is cached in Script Properties for all future calls.
//   2. Copies the template Doc to a temporary working copy.
//   3. Replaces every {token} using body.replaceText() — this API preserves
//      the bold/italic/font/size of the placeholder text automatically, so
//      bold {student name} → bold replacement, plain {date} → plain text.
//   4. Inserts the secretary's signature image at the signature placeholder.
//   5. Exports the filled Doc as a PDF named {studentName}_{compNumber}.pdf.
//   6. Trashes the temporary copy and returns the PDF blob.

function buildLetterPdf(d) {
  var templateDocId = getLetterTemplateDocId(d.templateDocUrl || '');
  var folder        = DriveApp.getFolderById(LETTER_TEMPLATE_FOLDER_ID);

  // 1. Copy the template into a temporary working doc
  var templateFile = DriveApp.getFileById(templateDocId);
  var tempName     = 'TEMP_' + (d.studentName || 'Student').replace(/\s+/g, '_') + '_' + Date.now();
  var tempFile     = templateFile.makeCopy(tempName, folder);

  try {
    var docObj = DocumentApp.openById(tempFile.getId());
    var body   = docObj.getBody();

    // 2. Header date: "June 23, 2026"
    var today = formatDate(new Date());

    // 3. Derive gender-based tokens from the student's registered gender.
    //    {Title} → Mr. / Ms.   {He/She} → He / She   {His/Her} → His / Her
    var isMale = (d.gender || '').toLowerCase() === 'male';
    var title  = isMale ? 'Mr.'  : 'Ms.';
    var heShe  = isMale ? 'He'   : 'She';
    var hisHer = isMale ? 'His'  : 'Her';
    var himHer = isMale ? 'Him'  : 'Her';

    // 4. Replace all text tokens.
    //    replaceText() preserves character formatting (bold/italic/font/size)
    //    of each {token} in the template — no extra logic needed.
    //    Cap versions (e.g. {Student name}) are for sentence starts;
    //    lowercase versions (e.g. {student name}) are for inline use — same value.
    var subs = {
      // Date
      'date':           today,
      'Date':           today,
      // Student identity
      'student name':   d.studentName || '',
      'Student name':   d.studentName || '',
      'student number': d.compNumber  || '',
      'Student number': d.compNumber  || '',
      // Gender (cap = sentence start, lowercase = inline)
      'Title':          title,
      'He/She':         heShe,
      'His/Her':        hisHer,
      'Him/Her':        himHer,
      'he/she':         heShe.toLowerCase(),
      'his/her':        hisHer.toLowerCase(),
      'him/her':        himHer.toLowerCase(),
      // Study details
      'department':     d.department  || '',
      'year of study':  d.yearOfStudy || '',
      'phone number':   d.phone       || '',
      // Training period — "June 23, 2026"
      'start date':     formatDate(d.startDate),
      'closing date':   formatDate(d.endDate),
      // Secretary
      'industrial training secretary name':          d.secretaryName  || '',
      'email address-industrial training secretary': d.secretaryEmail || '',
      'phone number industrial training secretary':  d.secretaryPhone || ''
    };

    for (var key in subs) {
      body.replaceText('\\{' + key + '\\}', subs[key]);
    }

    // Custom fields (secretary-defined placeholders, e.g. {nrc_number}, {nrc number}).
    // Flexible matching: case-insensitive, underscores and spaces interchangeable.
    if (d.customFields && typeof d.customFields === 'object') {
      for (var cfKey in d.customFields) {
        var cfValue = String(d.customFields[cfKey] || '');
        try {
          body.replaceText(buildFlexPlaceholder(cfKey), cfValue);
        } catch (e) {
          Logger.log('Custom field replace failed for "' + cfKey + '": ' + e.message);
        }
      }
    }

    // 4. Signature image.
    //    The Word doc has: {industrial training secretary signature- image}
    //    (note the space before "image") — regex \s+ handles any spacing.
    var sigB64   = d.secretarySignatureB64 || '';
    var sigFound = body.findText('\\{industrial training secretary signature-\\s*image\\}');
    if (sigFound) {
      var textEl   = sigFound.getElement();
      var parentPa = textEl.getParent();
      // Delete the {token} text in place
      textEl.asText().deleteText(sigFound.getStartOffset(), sigFound.getEndOffsetInclusive());
      if (sigB64) {
        try {
          var b64Data = sigB64.indexOf(',') > -1 ? sigB64.split(',')[1] : sigB64;
          var imgBlob = Utilities.newBlob(
            Utilities.base64Decode(b64Data), 'image/png', 'signature.png'
          );
          var inlineImg = parentPa.appendInlineImage(imgBlob);
          inlineImg.setWidth(120);
          inlineImg.setHeight(48);
        } catch (imgErr) {
          Logger.log('Signature image insert failed: ' + imgErr.message);
        }
      }
    }

    docObj.saveAndClose();

    // 5. Export as PDF — getBytes() forces Drive to fetch all bytes into memory NOW,
    //    before finally{} trashes the file. Without this, the blob is lazily evaluated
    //    and ends up empty by the time sendLetterEmail attaches it.
    var pdfName  = esc(d.studentName || 'Student') + '_' + esc(d.compNumber || '') + '.pdf';
    var pdfBytes = tempFile.getAs(MimeType.PDF).getBytes();
    var pdfBlob  = Utilities.newBlob(pdfBytes, MimeType.PDF, pdfName);
    return pdfBlob;

  } finally {
    // 6. Always trash the working copy — template is never touched
    tempFile.setTrashed(true);
  }
}

// Returns the Google Doc template ID.
// Priority: (1) URL passed from the secretary settings, (2) cached converted .docx.
// templateDocUrl is the full Google Docs browser URL; we extract the Doc ID from it.
function getLetterTemplateDocId(templateDocUrl) {
  // Use the URL-specified template if provided — extract Doc ID from URL path
  if (templateDocUrl) {
    var match = templateDocUrl.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      Logger.log('Using secretary-configured template Doc ID: ' + match[1]);
      return match[1];
    }
    Logger.log('templateDocUrl provided but no Doc ID found in it: ' + templateDocUrl);
  }

  // Fall back to cached / folder-based conversion path
  var props  = PropertiesService.getScriptProperties();
  var cached = props.getProperty(TEMPLATE_DOC_ID_KEY);

  // Verify the cached ID is still valid
  if (cached) {
    try {
      var f = DriveApp.getFileById(cached);
      if (f.getMimeType() === MimeType.GOOGLE_DOCS && !f.isTrashed()) {
        return cached;
      }
    } catch (e) {}
    // Stale — clear it and re-detect
    props.deleteProperty(TEMPLATE_DOC_ID_KEY);
  }

  // Check if a Google Doc already exists in the folder (manually converted)
  var folder   = DriveApp.getFolderById(LETTER_TEMPLATE_FOLDER_ID);
  var docFiles = folder.getFilesByType(MimeType.GOOGLE_DOCS);
  if (docFiles.hasNext()) {
    var existingId = docFiles.next().getId();
    props.setProperty(TEMPLATE_DOC_ID_KEY, existingId);
    Logger.log('Using existing Google Doc template: ' + existingId);
    return existingId;
  }

  // No Google Doc yet — find the .docx and convert it via Drive API
  var wordFiles = folder.getFilesByType(
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );
  if (!wordFiles.hasNext()) {
    throw new Error(
      'No letter template found in the INDUSTRIAL TRAINING TEMPLATE LATTER folder. ' +
      'Please add the Word doc (.docx) to that folder.'
    );
  }
  var wordFile  = wordFiles.next();
  var newDocId  = convertDocxToGoogleDoc(wordFile.getId(), wordFile.getName());
  props.setProperty(TEMPLATE_DOC_ID_KEY, newDocId);
  Logger.log('Converted Word doc to Google Doc: ' + newDocId);
  return newDocId;
}

// Uses the Drive v3 API to copy a .docx as a Google Doc (MIME-type conversion).
// No extra services need to be enabled — UrlFetchApp + ScriptApp.getOAuthToken() is enough.
function convertDocxToGoogleDoc(wordFileId, fileName) {
  var token = ScriptApp.getOAuthToken();
  var resp  = UrlFetchApp.fetch(
    'https://www.googleapis.com/drive/v3/files/' + wordFileId + '/copy',
    {
      method:      'POST',
      headers:     { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      payload:     JSON.stringify({
        name:    (fileName || 'Letter Template').replace(/\.docx?$/i, ''),
        mimeType: 'application/vnd.google-apps.document',
        parents:  [LETTER_TEMPLATE_FOLDER_ID]
      }),
      muteHttpExceptions: true
    }
  );
  var result = JSON.parse(resp.getContentText());
  if (!result.id) {
    throw new Error('Word→Google Doc conversion failed: ' + resp.getContentText().substring(0, 300));
  }
  return result.id;
}

// ── Industrial Training letter email ─────────────────────────────────────────
function sendLetterEmail(d, pdfBlob) {
  var secName = d.secretaryName || 'Industrial Training Secretary';
  var body =
    '<p>Dear ' + esc(d.studentName || 'Student') + ',</p>' +
    '<p>Your industrial training attachment letter has been approved. ' +
    'Please find your official letter attached to this email.</p>' +
    '<p>Present this letter to your prospective employer.</p>' +
    '<br><p>Regards,<br><strong>' + esc(secName) + '</strong><br>' +
    'Industrial Training Secretary<br>UNZA School of Engineering</p>';

  MailApp.sendEmail({
    to:          d.to,
    subject:     'Industrial Training Attachment Letter — UNZA School of Engineering',
    htmlBody:    body,
    attachments: [pdfBlob],
    replyTo:     d.secretaryEmail || 'soe@unza.zm',
    name:        'UNZA SoE — Industrial Training'
  });
}

// ── Industrial Training rejection email ──────────────────────────────────────
function sendAttachmentRejectionEmail(d) {
  var secName = d.secretaryName || 'Industrial Training Secretary';
  var body =
    '<p>Dear ' + esc(d.studentName || 'Student') + ',</p>' +
    '<p>We regret to inform you that your request for an industrial training attachment letter ' +
    'has not been approved at this time.</p>' +
    (d.reason ? '<p><strong>Reason:</strong> ' + esc(d.reason) + '</p>' : '') +
    '<p>Please contact the Industrial Training Secretary for further information.</p>' +
    '<br><p>Regards,<br><strong>' + esc(secName) + '</strong><br>' +
    'Industrial Training Secretary<br>UNZA School of Engineering</p>';

  MailApp.sendEmail({
    to:       d.to,
    subject:  'Industrial Training Attachment Request — Not Approved',
    htmlBody: body,
    replyTo:  d.secretaryEmail || 'soe@unza.zm',
    name:     'UNZA SoE — Industrial Training'
  });
}

// ── Manual setup — run once from Apps Script editor to pre-convert the Word doc ──
// Not required: conversion also happens automatically on the first letter approval.
// Run this if you want to confirm it works before a student sends their first request.
function setupLetterTemplate() {
  PropertiesService.getScriptProperties().deleteProperty(TEMPLATE_DOC_ID_KEY);
  var docId = getLetterTemplateDocId();
  Logger.log('Template Google Doc ID: ' + docId);
  Logger.log('Open it at: https://docs.google.com/document/d/' + docId + '/edit');
}

// ── Test receipt ──────────────────────────────────────────────────────────────
function testEmail() {
  var data = {
    to:              "your-test@example.com",
    studentName:     "Chanda Mwale",
    compNumber:      "23/0012345/01",
    amount:          150,
    amountInWords:   "One Hundred and Fifty Kwacha",
    category:        "Membership Dues",
    method:          "Airtel Money",
    txRef:           "0971234567",
    receiptNo:       1,
    reviewerName:    "Bwalya Tembo",
    reviewerPosition:"Treasurer",
    signatureB64:    "",
    reviewedAt:      "19 June 2026",
    isTrial:         true,   // Set to true to add "TRIAL RECEIPT" watermark; set to false for production
    org: { name:"The University of Zambia Engineering Society (UZES)", school:"School of Engineering", address:"P.O. Box 32379, Lusaka", email:"uzesofficial@gmail.com" }
  };
  var pdf = buildReceiptPdf(data);
  sendReceiptEmail(data, pdf);
  Logger.log("Test receipt email sent.");
}

// ── Test attachment letter ────────────────────────────────────────────────────
// Run THIS directly from the Apps Script editor (Run ▸ testLetterEmail).
// 1. Change `to:` to YOUR email below.
// 2. Watch the Execution log — it prints the PDF byte count + remaining mail quota
//    BEFORE sending, so we can see exactly where it fails (empty PDF, quota = 0,
//    or a thrown error) instead of a silent "Completed".
function testLetterEmail() {
  var data = {
    to:                    "tembobenny49@gmail.com",   // ← CHANGE to your email
    studentName:           "Tembo Benny",
    compNumber:            "2021487296",
    department:            "Electrical and Electronics Engineering",
    yearOfStudy:           "fourth year",
    phone:                 "0971234567",
    startDate:             "2026-07-01",
    endDate:               "2026-09-30",
    secretaryName:         "Dr. J. Mwale",
    secretaryEmail:        "dean-eng@unza.zm",
    secretaryPhone:        "0977000000",
    secretarySignatureB64: "",
    templateDocUrl:        ""   // ← paste a Google Doc URL here to test the URL-based path
  };

  Logger.log("Remaining daily mail quota BEFORE send: " + MailApp.getRemainingDailyQuota());

  var pdf;
  try {
    pdf = buildLetterPdf(data);
  } catch (err) {
    Logger.log("buildLetterPdf FAILED: " + err.message);
    return;
  }

  var size = pdf.getBytes().length;
  Logger.log("PDF built OK: " + pdf.getName() + " — " + size + " bytes");
  if (size === 0) {
    Logger.log("PDF is EMPTY (0 bytes) — Gmail will drop the attachment. Stopping.");
    return;
  }

  try {
    sendLetterEmail(data, pdf);
    Logger.log("sendLetterEmail returned with NO error. Email should be sent to " + data.to);
    Logger.log("Check inbox AND spam. Remaining quota AFTER send: " + MailApp.getRemainingDailyQuota());
  } catch (err) {
    Logger.log("sendLetterEmail FAILED: " + err.message);
  }
}

// ── Placement acceptance letter PDF ──────────────────────────────────────────
// Uses the same Google Doc template approach as buildLetterPdf.
// The TS pastes the doc URL in the Template tab under "Placement Templates".
// d.templateDocUrl is fetched from siteContent/placementLetterTemplates by the client.
function buildPlacementLetterPdf(d) {
  var templateDocId = getLetterTemplateDocId(d.templateDocUrl || '');
  var folder = DriveApp.getFolderById(LETTER_TEMPLATE_FOLDER_ID);

  var templateFile = DriveApp.getFileById(templateDocId);
  var tempName = 'TEMP_PLACE_' + (d.studentName || 'Student').replace(/\s+/g, '_') + '_' + Date.now();
  var tempFile = templateFile.makeCopy(tempName, folder);

  try {
    var docObj = DocumentApp.openById(tempFile.getId());
    var body   = docObj.getBody();

    var today  = formatDate(new Date());
    var isMale = (d.gender || '').toLowerCase() === 'male';
    var title  = isMale ? 'Mr.'  : 'Ms.';
    var heShe  = isMale ? 'He'   : 'She';
    var hisHer = isMale ? 'His'  : 'Her';
    var himHer = isMale ? 'Him'  : 'Her';

    var subs = {
      'date':              today,             'Date':              today,
      'student name':      d.studentName || '', 'Student name':   d.studentName || '',
      'student number':    d.studentNumber || '', 'Student number': d.studentNumber || '',
      'Title':             title,
      'He/She':            heShe,             'he/she':           heShe.toLowerCase(),
      'His/Her':           hisHer,            'his/her':          hisHer.toLowerCase(),
      'Him/Her':           himHer,            'him/her':          himHer.toLowerCase(),
      'company name':      d.companyName || '', 'Company name':   d.companyName || '',
      'province':          d.province || '',    'Province':       d.province || '',
      'district':          d.district || '',    'District':       d.district || '',
      'placement type':    d.placementType || '', 'Placement type': d.placementType || '',
      'type':              d.placementType || '', 'Type':           d.placementType || '',
      'department':        d.department || '',  'Department':     d.department || '',
      'year of study':     d.yearOfStudy || '',  'Year of study':  d.yearOfStudy || '',
      'phone number':      d.phone || ''
    };

    for (var key in subs) {
      body.replaceText('\\{' + key + '\\}', subs[key]);
    }

    if (d.customFields && typeof d.customFields === 'object') {
      for (var cfKey in d.customFields) {
        try {
          body.replaceText(buildFlexPlaceholder(cfKey), String(d.customFields[cfKey] || ''));
        } catch (e) {
          Logger.log('Placement custom field failed "' + cfKey + '": ' + e.message);
        }
      }
    }

    docObj.saveAndClose();

    var pdfName  = esc(d.studentName || 'Student') + '_Placement_' + esc(d.companyName || '') + '.pdf';
    var pdfBytes = tempFile.getAs(MimeType.PDF).getBytes();
    return Utilities.newBlob(pdfBytes, MimeType.PDF, pdfName);

  } finally {
    tempFile.setTrashed(true);
  }
}

// ── Placement acceptance letter email ────────────────────────────────────────
function sendPlacementLetterEmail(d, pdfBlob) {
  var body =
    '<p>Dear ' + esc(d.studentName || 'Student') + ',</p>' +
    '<p>Congratulations! You have been matched with <strong>' + esc(d.companyName || '') + '</strong> ' +
    'for your ' + esc(d.placementType || 'industrial') + ' placement.</p>' +
    '<p>Please find your official placement acceptance letter attached. Present this letter to the company.</p>' +
    '<br><p>Regards,<br><strong>Industrial Training Secretary</strong><br>UNZA School of Engineering</p>';

  MailApp.sendEmail({
    to:          d.to,
    subject:     'UZES — Placement Acceptance Letter (' + esc(d.companyName || '') + ')',
    htmlBody:    body,
    attachments: [pdfBlob],
    replyTo:     'uzesofficial@gmail.com',
    name:        'UNZA SoE — Industrial Training'
  });
}

// ── Placement expiry check — run as a 30-min time-driven trigger ──────────────
// Setup: Apps Script → Triggers → Add trigger → checkPlacementExpirations → Time-driven → Every 30 min
// Script Properties must have FIREBASE_PROJECT_ID set to your Firebase project ID.
// The OAuth token from ScriptApp gives access to Firestore REST API automatically.
function checkPlacementExpirations() {
  var projectId = PropertiesService.getScriptProperties().getProperty("FIREBASE_PROJECT_ID");
  if (!projectId) {
    Logger.log("FIREBASE_PROJECT_ID not set in Script Properties — skipping expiry check.");
    return;
  }

  var token   = ScriptApp.getOAuthToken();
  var baseUrl = "https://firestore.googleapis.com/v1/projects/" + projectId + "/databases/(default)/documents";
  var hdrs    = { "Authorization": "Bearer " + token, "Content-Type": "application/json" };
  var cutoff  = new Date(Date.now() - 48 * 60 * 60 * 1000);

  // Structured query: placements where placementStatus == "matched"
  var qResp = UrlFetchApp.fetch(baseUrl + ":runQuery", {
    method: "POST", headers: hdrs, muteHttpExceptions: true,
    payload: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "placements" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "placementStatus" },
            op: "EQUAL",
            value: { stringValue: "matched" }
          }
        }
      }
    })
  });

  var results = [];
  try { results = JSON.parse(qResp.getContentText()); } catch(e) {
    Logger.log("Query parse error: " + e.message);
    return;
  }

  var expired = 0;
  for (var i = 0; i < results.length; i++) {
    var item = results[i];
    if (!item.document) continue;

    var d = item.document;
    var matchedAtStr = d.fields.matchedAt && d.fields.matchedAt.timestampValue;
    if (!matchedAtStr) continue;

    var matchedAt = new Date(matchedAtStr);
    if (matchedAt > cutoff) continue; // Not yet expired

    var docName   = d.name;
    var uid       = docName.split("/").pop();
    var rejCount  = parseInt((d.fields.rejectionCount && d.fields.rejectionCount.integerValue) || "0", 10);
    var companyId = (d.fields.matchedCompanyId && d.fields.matchedCompanyId.stringValue) || "";

    // Restore vacancy slot before resetting placement
    if (companyId) {
      _restoreVacancySlot(baseUrl, hdrs, companyId, uid);
    }

    // Reset placement to pending
    UrlFetchApp.fetch(
      baseUrl + "/placements/" + uid +
        "?updateMask.fieldPaths=placementStatus" +
        "&updateMask.fieldPaths=rejectionCount" +
        "&updateMask.fieldPaths=matchedCompanyId" +
        "&updateMask.fieldPaths=matchedAt",
      {
        method: "PATCH", headers: hdrs, muteHttpExceptions: true,
        payload: JSON.stringify({
          fields: {
            placementStatus: { stringValue: "pending" },
            rejectionCount:  { integerValue: String(rejCount + 1) },
            matchedCompanyId: { nullValue: "NULL_VALUE" },
            matchedAt:        { nullValue: "NULL_VALUE" }
          }
        })
      }
    );

    Logger.log("Expired match reset for student: " + uid);
    expired++;
  }

  Logger.log("Expiry check done — " + expired + " match(es) expired.");
}

function _restoreVacancySlot(baseUrl, hdrs, vacancyId, studentUid) {
  try {
    // Get student's department
    var sResp = UrlFetchApp.fetch(baseUrl + "/students/" + studentUid, {
      headers: hdrs, muteHttpExceptions: true
    });
    var sData = JSON.parse(sResp.getContentText());
    var dept  = sData.fields && sData.fields.department && sData.fields.department.stringValue;
    if (!dept) return;

    // Get current vacancy slotsRemaining
    var vResp = UrlFetchApp.fetch(baseUrl + "/vacancies/" + vacancyId, {
      headers: hdrs, muteHttpExceptions: true
    });
    var vData  = JSON.parse(vResp.getContentText());
    var slotMap = vData.fields && vData.fields.slotsRemaining && vData.fields.slotsRemaining.mapValue;
    if (!slotMap || !slotMap.fields) return;

    var updated = {};
    for (var k in slotMap.fields) {
      updated[k] = { integerValue: slotMap.fields[k].integerValue || "0" };
    }
    var cur = parseInt((updated[dept] && updated[dept].integerValue) || "0", 10);
    updated[dept] = { integerValue: String(cur + 1) };

    UrlFetchApp.fetch(
      baseUrl + "/vacancies/" + vacancyId + "?updateMask.fieldPaths=slotsRemaining",
      {
        method: "PATCH", headers: hdrs, muteHttpExceptions: true,
        payload: JSON.stringify({ fields: { slotsRemaining: { mapValue: { fields: updated } } } })
      }
    );
  } catch (err) {
    Logger.log("_restoreVacancySlot error: " + err.message);
  }
}
