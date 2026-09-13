(function (root) {
  'use strict';

  var VERSION = 'app-cost-calculator.v1';
  var CURRENCY = 'USD';
  var UNIT_SCALE = 1000;
  var MULT_SCALE = 1000;
  var MAX_CENTS = 9999999999;
  var MAX_YEAR_CENTS = 199999999980;
  var MAX_UNIT_MILLI = 1000000000000;
  var MAX_MULT_MILLI = 1000000;
  var MONEY_FIELDS = ['builderMonthly', 'hostingMonthly', 'databaseMonthly', 'emailOtherMonthly', 'annualCosts', 'pricePerUnit', 'oneTimeSetup'];
  var UNIT_FIELDS = ['usageUnits', 'includedAllowance'];
  var MULT_FIELDS = ['lowMultiplier', 'baseMultiplier', 'highMultiplier'];
  var ALL_FIELDS = MONEY_FIELDS.concat(UNIT_FIELDS, MULT_FIELDS);
  var FORMULA = [
    'billable_units = max(0, usage_units × scenario_multiplier − included_allowance)',
    'variable_monthly = billable_units × price_per_unit',
    'fixed_monthly = builder + hosting + database + email/other + floor(annual ÷ 12)',
    'monthly_cash = fixed_monthly + variable_monthly',
    'first_year_cash = 12 × (builder + hosting + database + email/other + variable_monthly) + annual + one_time_setup'
  ];
  var ASSUMPTIONS = [
    'Currency is USD. Amounts are stored as integer cents.',
    'Usage units and multipliers use milli-precision (3 decimal places). Products truncate toward zero after scaling.',
    'Annual costs enter the monthly estimate as floor(annual_cents ÷ 12). First-year cash uses the full annual amount so remainder cents are not lost.',
    'The included allowance is subtracted from usage units once. It is not also applied as a dollar credit.',
    'Low, base, and high scenarios scale usage units only. Fixed monthly costs and the allowance stay the same.',
    'Blank fields stay unknown. An explicit 0 is a real zero and is not treated as missing.',
    'This is a planning budget from your numbers, not a vendor quote, invoice, or commitment.'
  ];
  var LIMITATIONS = [
    'Excludes tax, labor, refunds, overtime, agency fees, payment processing, legal review, insurance, currency conversion, and unquoted vendor overages.',
    'Does not rank vendors or treat any number as a verified market price.',
    'Does not guarantee a spend cap. Billing settings on a builder may be alerts, grants, or soft limits rather than a hard ceiling.',
    'No affiliate tracking, ranking, or commission is applied to these results.'
  ];

  function blank(value) {
    return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
  }

  function fail(code, message) {
    return { status: 'error', code: code, message: message };
  }

  function parseScaled(raw, options) {
    var name = options.name;
    if (blank(raw)) return { status: 'unknown' };
    var text;
    if (typeof raw === 'number') {
      if (!Number.isFinite(raw)) return fail('NONFINITE', name + ' is not a finite number.');
      if (raw < 0) return fail('NEGATIVE', name + ' cannot be negative.');
      text = String(raw);
    } else if (typeof raw === 'string') {
      text = raw.trim();
      if (text === '') return { status: 'unknown' };
      if (/^-/.test(text)) return fail('NEGATIVE', name + ' cannot be negative.');
    } else {
      return fail('INVALID', name + ' must be a non-negative decimal.');
    }
    if (!/^\d+(\.\d+)?$/.test(text)) return fail('INVALID', name + ' must be a non-negative decimal.');
    var parts = text.split('.');
    if (parts[1] && parts[1].length > options.decimals) {
      return fail('PRECISION', name + ' allows at most ' + options.decimals + ' decimal places.');
    }
    var whole = Number(parts[0]);
    var frac = Number((parts[1] || '') + '0'.repeat(options.decimals).slice((parts[1] || '').length));
    if (!Number.isSafeInteger(whole) || !Number.isSafeInteger(frac)) return fail('OVERFLOW', name + ' is too large.');
    if (whole > Math.floor(options.max / options.scale)) return fail('OVERFLOW', name + ' exceeds the supported maximum.');
    var scaled = whole * options.scale + frac;
    if (!Number.isSafeInteger(scaled) || scaled > options.max) return fail('OVERFLOW', name + ' exceeds the supported maximum.');
    return { status: 'ok', scaled: scaled, text: text };
  }

  function parseMoney(raw, name) {
    return parseScaled(raw, { name: name, scale: 100, decimals: 2, max: MAX_CENTS });
  }

  function parseUnits(raw, name) {
    return parseScaled(raw, { name: name, scale: UNIT_SCALE, decimals: 3, max: MAX_UNIT_MILLI });
  }

  function parseMultiplier(raw, name) {
    return parseScaled(raw, { name: name, scale: MULT_SCALE, decimals: 3, max: MAX_MULT_MILLI });
  }

  function parseField(id, raw) {
    if (MONEY_FIELDS.indexOf(id) !== -1) return parseMoney(raw, id);
    if (UNIT_FIELDS.indexOf(id) !== -1) return parseUnits(raw, id);
    if (MULT_FIELDS.indexOf(id) !== -1) return parseMultiplier(raw, id);
    return fail('INVALID', 'Unknown field.');
  }

  function mulDivTrunc(a, b, denom) {
    if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || !Number.isSafeInteger(denom) || denom <= 0) {
      throw Object.assign(new Error('OVERFLOW'), { code: 'OVERFLOW' });
    }
    if (a !== 0 && Math.abs(b) > Number.MAX_SAFE_INTEGER / Math.abs(a)) {
      throw Object.assign(new Error('OVERFLOW'), { code: 'OVERFLOW' });
    }
    var product = a * b;
    if (!Number.isSafeInteger(product)) throw Object.assign(new Error('OVERFLOW'), { code: 'OVERFLOW' });
    return Math.trunc(product / denom);
  }

  function addChecked(a, b, max) {
    var sum = a + b;
    if (!Number.isSafeInteger(sum) || sum > max || sum < 0) throw Object.assign(new Error('OVERFLOW'), { code: 'OVERFLOW' });
    return sum;
  }

  function moneyValue(parsed) {
    if (parsed.status === 'ok') return { kind: 'known', cents: parsed.scaled };
    if (parsed.status === 'unknown') return { kind: 'unknown' };
    return { kind: 'error', code: parsed.code, message: parsed.message };
  }

  function unitValue(parsed) {
    if (parsed.status === 'ok') return { kind: 'known', milli: parsed.scaled };
    if (parsed.status === 'unknown') return { kind: 'unknown' };
    return { kind: 'error', code: parsed.code, message: parsed.message };
  }

  function formatUsd(cents) {
    var sign = cents < 0 ? '-' : '';
    var abs = Math.abs(cents);
    var whole = String(Math.trunc(abs / 100));
    var frac = String(abs % 100).padStart(2, '0');
    var grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return sign + '$' + grouped + '.' + frac;
  }

  function incomplete(reason) {
    return { status: 'incomplete', reason: reason, cents: null, display: 'Unknown — incomplete' };
  }

  function amount(cents) {
    return { status: 'ok', cents: cents, display: formatUsd(cents) };
  }

  function errored(message) {
    return { status: 'error', reason: message, cents: null, display: 'Invalid' };
  }

  function variableCost(usage, allowance, price, multiplier) {
    if (price.kind === 'error') return errored(price.message);
    if (usage.kind === 'error') return errored(usage.message);
    if (allowance.kind === 'error') return errored(allowance.message);
    if (multiplier.kind === 'error') return errored(multiplier.message);
    if (price.kind === 'known' && price.cents === 0) {
      if (usage.kind === 'error' || multiplier.kind === 'error') return errored((usage.message || multiplier.message));
      return { status: 'ok', cents: 0, display: formatUsd(0), effectiveMilli: null, billableMilli: 0 };
    }
    if (usage.kind === 'known' && usage.milli === 0) {
      return { status: 'ok', cents: 0, display: formatUsd(0), effectiveMilli: 0, billableMilli: 0 };
    }
    if (usage.kind !== 'known' || multiplier.kind !== 'known' || price.kind !== 'known') {
      return incomplete('Usage units, price per unit, and the scenario multiplier are required unless usage or price is an explicit zero.');
    }
    var effectiveMilli;
    try {
      effectiveMilli = mulDivTrunc(usage.milli, multiplier.milli, MULT_SCALE);
    } catch (err) {
      return errored('Usage × multiplier overflowed.');
    }
    if (allowance.kind !== 'known') {
      if (effectiveMilli === 0) {
        return { status: 'ok', cents: 0, display: formatUsd(0), effectiveMilli: effectiveMilli, billableMilli: 0 };
      }
      return incomplete('Included allowance is required to compute billable usage.');
    }
    var billableMilli = Math.max(0, effectiveMilli - allowance.milli);
    try {
      var cents = mulDivTrunc(billableMilli, price.cents, UNIT_SCALE);
      return { status: 'ok', cents: cents, display: formatUsd(cents), effectiveMilli: effectiveMilli, billableMilli: billableMilli };
    } catch (err2) {
      return errored('Variable usage overflowed.');
    }
  }

  function sumKnown(parts, missingMessage) {
    var total = 0;
    for (var i = 0; i < parts.length; i += 1) {
      var part = parts[i];
      if (part.kind === 'error') return errored(part.message);
      if (part.kind !== 'known') return incomplete(missingMessage);
      try {
        total = addChecked(total, part.cents, MAX_YEAR_CENTS);
      } catch (err) {
        return errored('Fixed-cost total overflowed.');
      }
    }
    return amount(total);
  }

  function scenario(fixedMonthly, annual, oneTime, usage, allowance, price, multiplier) {
    var variable = variableCost(usage, allowance, price, multiplier);
    if (variable.status === 'error') {
      return { monthly: variable, firstYear: variable, variable: variable };
    }
    if (fixedMonthly.status !== 'ok') {
      return { monthly: fixedMonthly, firstYear: fixedMonthly, variable: variable };
    }
    if (variable.status !== 'ok') {
      return { monthly: variable, firstYear: variable, variable: variable };
    }
    var monthly;
    try {
      monthly = amount(addChecked(fixedMonthly.cents, variable.cents, MAX_YEAR_CENTS));
    } catch (err) {
      monthly = errored('Monthly total overflowed.');
    }
    if (annual.kind === 'error') return { monthly: monthly, firstYear: errored(annual.message), variable: variable };
    if (oneTime.kind === 'error') return { monthly: monthly, firstYear: errored(oneTime.message), variable: variable };
    if (annual.kind !== 'known' || oneTime.kind !== 'known') {
      return { monthly: monthly, firstYear: incomplete('Annual costs and one-time setup are required for a first-year cash estimate.'), variable: variable };
    }
    var firstYear;
    try {
      var amortizedCents = Math.trunc(annual.cents / 12);
      var repeating = addChecked(fixedMonthly.cents - amortizedCents, variable.cents, MAX_YEAR_CENTS);
      var yearRepeat = mulDivTrunc(repeating, 12, 1);
      firstYear = amount(addChecked(addChecked(yearRepeat, annual.cents, MAX_YEAR_CENTS), oneTime.cents, MAX_YEAR_CENTS));
    } catch (err2) {
      firstYear = errored('First-year total overflowed.');
    }
    return { monthly: monthly, firstYear: firstYear, variable: variable };
  }

  function emptyInputs() {
    var out = {};
    for (var i = 0; i < ALL_FIELDS.length; i += 1) out[ALL_FIELDS[i]] = '';
    return out;
  }

  function evaluate(input) {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      throw new TypeError('Expected a calculator input object.');
    }
    var parsed = {};
    var errors = [];
    var unknowns = [];
    for (var i = 0; i < ALL_FIELDS.length; i += 1) {
      var id = ALL_FIELDS[i];
      var owns = Object.hasOwn(input, id) ? input[id] : '';
      parsed[id] = parseField(id, owns);
      if (parsed[id].status === 'error') errors.push({ field: id, code: parsed[id].code, message: parsed[id].message });
      if (parsed[id].status === 'unknown') unknowns.push(id);
    }

    var builder = moneyValue(parsed.builderMonthly);
    var hosting = moneyValue(parsed.hostingMonthly);
    var database = moneyValue(parsed.databaseMonthly);
    var email = moneyValue(parsed.emailOtherMonthly);
    var annual = moneyValue(parsed.annualCosts);
    var setup = moneyValue(parsed.oneTimeSetup);
    var usage = unitValue(parsed.usageUnits);
    var allowance = unitValue(parsed.includedAllowance);
    var price = moneyValue(parsed.pricePerUnit);
    var lowMult = parsed.lowMultiplier.status === 'ok' ? { kind: 'known', milli: parsed.lowMultiplier.scaled } : parsed.lowMultiplier.status === 'unknown' ? { kind: 'unknown' } : { kind: 'error', message: parsed.lowMultiplier.message };
    var baseMult = parsed.baseMultiplier.status === 'ok' ? { kind: 'known', milli: parsed.baseMultiplier.scaled } : parsed.baseMultiplier.status === 'unknown' ? { kind: 'unknown' } : { kind: 'error', message: parsed.baseMultiplier.message };
    var highMult = parsed.highMultiplier.status === 'ok' ? { kind: 'known', milli: parsed.highMultiplier.scaled } : parsed.highMultiplier.status === 'unknown' ? { kind: 'unknown' } : { kind: 'error', message: parsed.highMultiplier.message };

    var amortized = annual.kind === 'known' ? { kind: 'known', cents: Math.trunc(annual.cents / 12) } : annual;
    var fixedMonthly = sumKnown([builder, hosting, database, email, amortized], 'Builder, hosting, database, email/other, and annual costs are required for a monthly total.');

    var low = scenario(fixedMonthly, annual, setup, usage, allowance, price, lowMult);
    var base = scenario(fixedMonthly, annual, setup, usage, allowance, price, baseMult);
    var high = scenario(fixedMonthly, annual, setup, usage, allowance, price, highMult);

    var lines = {
      builderMonthly: builder.kind === 'known' ? amount(builder.cents) : builder.kind === 'error' ? errored(builder.message) : incomplete('Not provided'),
      hostingMonthly: hosting.kind === 'known' ? amount(hosting.cents) : hosting.kind === 'error' ? errored(hosting.message) : incomplete('Not provided'),
      databaseMonthly: database.kind === 'known' ? amount(database.cents) : database.kind === 'error' ? errored(database.message) : incomplete('Not provided'),
      emailOtherMonthly: email.kind === 'known' ? amount(email.cents) : email.kind === 'error' ? errored(email.message) : incomplete('Not provided'),
      annualAmortized: amortized.kind === 'known' ? amount(amortized.cents) : amortized.kind === 'error' ? errored(amortized.message) : incomplete('Not provided'),
      annualCosts: annual.kind === 'known' ? amount(annual.cents) : annual.kind === 'error' ? errored(annual.message) : incomplete('Not provided'),
      oneTimeSetup: setup.kind === 'known' ? amount(setup.cents) : setup.kind === 'error' ? errored(setup.message) : incomplete('Not provided')
    };

    return {
      schema: VERSION,
      currency: CURRENCY,
      rounding: 'Amounts use integer cents. Unit and multiplier products truncate toward zero after milli-scaling. Monthly annual amortization uses floor(annual_cents / 12); first-year cash uses the full annual amount.',
      complete: {
        monthlyLow: low.monthly.status === 'ok',
        monthlyBase: base.monthly.status === 'ok',
        monthlyHigh: high.monthly.status === 'ok',
        firstYearLow: low.firstYear.status === 'ok',
        firstYearBase: base.firstYear.status === 'ok',
        firstYearHigh: high.firstYear.status === 'ok'
      },
      fields: parsed,
      errors: errors,
      unknowns: unknowns,
      lines: lines,
      scenarios: {
        low: low,
        base: base,
        high: high
      },
      formula: FORMULA.slice(),
      assumptions: ASSUMPTIONS.slice(),
      limitations: LIMITATIONS.slice(),
      affiliate_links_enabled: false,
      ranking: false
    };
  }

  function exportPayload(report, rawInputs) {
    return {
      schema: VERSION,
      currency: CURRENCY,
      affiliate_links_enabled: false,
      ranking: false,
      inputs: rawInputs || {},
      parsed: report.fields,
      outputs: {
        complete: report.complete,
        lines: report.lines,
        scenarios: report.scenarios
      },
      formula: report.formula,
      assumptions: report.assumptions,
      limitations: report.limitations,
      rounding: report.rounding
    };
  }

  var api = Object.freeze({
    VERSION: VERSION,
    CURRENCY: CURRENCY,
    ALL_FIELDS: Object.freeze(ALL_FIELDS.slice()),
    MAX_CENTS: MAX_CENTS,
    emptyInputs: emptyInputs,
    parseField: parseField,
    evaluate: evaluate,
    formatUsd: formatUsd,
    exportPayload: exportPayload
  });

  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AppCostCalculator = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
