// ══════════════════════════════════════════════════════════════
// §HEADER
// Worker: courier-names-worker — EcomModa
// Tool:   أسماء المناديب — قراءة وتعديل قايمة الاختيار `custom.courier`
//         (إضافة · حذف · ترتيب) — أداة داخلية تحت «مركز عمليات الشحن
//         والتحصيل» (قسم «أدوات أخرى»).
//
// skills: worker-builder v3.9.2 · constants v4.1.0 · html-builder — 05-10-2026
//
// 🔴 **الـ Worker ده بس — مفيش واجهة في الريبو ده.** الواجهة صفحة
//    `Courier-Names.html` جوّه `Delivery-COD-Operations-Center` (نفس نمط
//    `Partial-Delivery` و`Bosta-Orders-Upload`: الريبو المستقل Worker وبس).
//    ⛔ ومفيش `get_employees`/`verify_employee`/أي endpoint دخول هنا — الدخول
//    مرة واحدة في Worker الهب، والواجهة بتبعت `employee` من جلسة الهب.
//
// 🔴 **الأداة بتكتب على تعريف ميتافيلد، مش على أوردرات.** `custom.courier`
//    تعريفه Choice list، والقيم المسموحة هي `validations[name=choices]`
//    (JSON array نص). التعديل = `metafieldDefinitionUpdate` بالقايمة الجديدة.
//    ⛔ **صفر كتابة على أي أوردر** — لا `metafieldsSet` ولا تغيير مندوب على
//       أوردر. حذف اسم من القايمة **مابيمسحش** القيمة من الأوردرات اللي
//       عليه (شوبيفاي بتعلّمها «غير صالحة» بس) — عشان كده الحذف بيعرض
//       عدد الأوردرات المتأثرة ومحتاج تأكيد.
//
// 🔴 **ثلاث أفعال بس** (طلب أحمد 05-10-2026): `add_courier` · `remove_courier`
//    · `reorder_couriers`. ⛔ مفيش rename — تغيير اسم مندوب = قيمة جديدة على
//    الأوردرات القديمة بتفضل بالاسم القديم.
//
// 🔴 **كل فعل بيقرا القايمة الحالية من شوبيفاي ويطبّق عليها** (مش بيستبدلها
//    بنسخة الواجهة) — موظفين اتنين بيعدّلوا مع بعض ما يمسحوش تعديل بعض.
//    الاستثناء `reorder_couriers`: لازم القايمة المبعوتة تكون **نفس
//    الأسماء** بالظبط (ترتيب بس)، وإلا بيترفض «القايمة اتغيّرت».
//
// ⚠️ **وبعد كل كتابة بنعيد القراءة ونتأكد** (Step 5A ②): `userErrors: []`
//    مش معناها إن القايمة اتغيّرت فعلاً.
// ══════════════════════════════════════════════════════════════
const TOOL_NAME      = 'courier_names';
const WORKER_VERSION = '1.0.0';
const API_VERSION    = '2026-01';

// ─── §CONSTANTS::definition ───
const DEF_NAMESPACE = 'custom';
const DEF_KEY       = 'courier';

// 🔴 أسماء نظامية — الهب بيجمّع المناديب بالاسم (`dcoCourierGroup` في
//    `shared/shell.js`: `bosta` ← «Bosta» · `showroom` ← «Showroom»)، وأدوات
//    الرفع على بوسطة بتعتمد على قيمة «Bosta». حذفها بيكسر التجميع **في صمت**
//    (الصف بيروح مجموعة «مناديب»). ⛔ الحذف مرفوض هنا؛ التعديل مكانه كود.
const PROTECTED_NAMES = ['Bosta', 'Showroom'];

// 🔴 سقوف — مصدرها: حدود شوبيفاي لقوايم الاختيار + معقولية القايمة (١٣ اسم
//    وقت الإنشاء 05-10-2026). حارس لصق مش سقف تشغيلي.
const MAX_COURIERS  = 100;
const MAX_NAME_LEN  = 60;

// ─── §CONSTANTS::result vocabulary (`ecommoda-constants` §12) ───
// success · warning · error · rejected · already

// ══════════════════════════════════════════════════════════════
// §CORS — Option B (قايمة صارمة) — أداة كتابة
// ══════════════════════════════════════════════════════════════
const ALLOWED_ORIGINS = ['https://ecommoda-dev.github.io'];
function getCORS(request) {
  const origin  = request.headers.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  };
}

// ══════════════════════════════════════════════════════════════
// §HELPERS
// ══════════════════════════════════════════════════════════════
function json(data, status = 200, request = null) {
  const headers = { 'Content-Type': 'application/json' };
  Object.assign(headers, request ? getCORS(request) : { 'Access-Control-Allow-Origin': ALLOWED_ORIGINS[0] });
  return new Response(JSON.stringify(data), { status, headers });
}

// ─── §HELPERS::assertEnv ───
function assertEnv(env) {
  const missing = ['SHOP_DOMAIN', 'CLIENT_ID', 'CLIENT_SECRET'].filter(k => !env[k]);
  if (missing.length)
    throw new Error(`متغيّرات ناقصة: ${missing.join(' · ')} — (شغّل ?action=diag)`);
  if (!env.DB)
    throw new Error('binding قاعدة البيانات ناقص (`DB`) — ضِفه في `wrangler.toml` تحت `[[d1_databases]]` بالاسم `DB` بالحرف');
}

// ─── §HELPERS::secretFingerprint — بصمة قصيرة لسر المجموعة ───
// (`ecommoda-constants` → `references/secret-groups.md`) ⛔ ٨ خانات hex من
// SHA-256 — مش قابلة لاسترجاع القيمة.
async function secretFingerprint(secret) {
  if (!secret) return null;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return [...new Uint8Array(buf)].slice(0, 4)
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

// ══════════════════════════════════════════════════════════════
// §SHOPIFY — getAccessToken (retry) + shopifyGQL (Step 5A ①)
// ══════════════════════════════════════════════════════════════
// التوكن مشترك مع باقي Workers الستاك (نفس الـ Custom App) → ⑯ ②.
const OAUTH_MAX_ATTEMPTS = 3;

async function getAccessToken(env) {
  let lastErr = null;
  for (let attempt = 1; attempt <= OAUTH_MAX_ATTEMPTS; attempt++) {
    try {
      const resp = await fetch(`https://${env.SHOP_DOMAIN}/admin/oauth/access_token`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: env.CLIENT_ID, client_secret: env.CLIENT_SECRET,
                               grant_type: 'client_credentials' }),
      });
      if (!resp.ok) {
        const retriable = resp.status === 429 || resp.status >= 500;
        lastErr = new Error(`OAuth failed: ${resp.status}`);
        if (retriable && attempt < OAUTH_MAX_ATTEMPTS) { await sleep(700 * attempt); continue; }
        throw lastErr;
      }
      const data = await resp.json();
      if (!data.access_token) throw new Error('OAuth: No access_token in response');
      return data.access_token;
    } catch (e) {
      lastErr = e;
      if (attempt < OAUTH_MAX_ATTEMPTS) { await sleep(400 * attempt); continue; }
      throw lastErr;
    }
  }
  throw lastErr || new Error('OAuth: unknown failure');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ⑮ — آخر رصيد وآخر تكلفة، للـ diag بس (صفر اعتماد من الواجهة عليهم)
let _lastThrottle = null;
let _lastQueryCost = null;

const GQL_MAX_ATTEMPTS = 3;
async function shopifyGQL(env, token, query, variables = {}, opName = 'query') {
  let lastErr = null;
  for (let attempt = 1; attempt <= GQL_MAX_ATTEMPTS; attempt++) {
    let resp;
    try {
      resp = await fetch(`https://${env.SHOP_DOMAIN}/admin/api/${API_VERSION}/graphql.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
        body: JSON.stringify({ query, variables }),
      });
    } catch (e) { throw new Error(`${opName}: فشل الاتصال بشوبيفاي (${e.message})`); }

    if (!resp.ok) {
      if ((resp.status === 429 || resp.status >= 500) && attempt < GQL_MAX_ATTEMPTS) { await sleep(600 * attempt); continue; }
      throw new Error(`${opName}: شوبيفاي رجّعت HTTP ${resp.status}`);
    }
    let data;
    try { data = await resp.json(); } catch { throw new Error(`${opName}: رد شوبيفاي مش JSON`); }

    if (data.errors?.length) {
      const throttled = data.errors.some(e => e.extensions?.code === 'THROTTLED');
      if (throttled && attempt < GQL_MAX_ATTEMPTS) { await sleep(900 * attempt); continue; }
      lastErr = new Error(`${opName}: ${data.errors.map(e => e.message).join(' | ')}`);
      throw lastErr;
    }
    if (!data.data) throw new Error(`${opName}: شوبيفاي رجّعت data فاضية`);

    const c = data.extensions?.cost;
    if (c) {
      if (c.throttleStatus) _lastThrottle = c.throttleStatus;
      _lastQueryCost = { op: opName, requested: c.requestedQueryCost ?? null, actual: c.actualQueryCost ?? null };
    }
    return data;
  }
  throw lastErr || new Error(`${opName}: unknown failure`);
}

// ══════════════════════════════════════════════════════════════
// §COURIERS — قراءة وكتابة تعريف `custom.courier`
// ══════════════════════════════════════════════════════════════
const DEF_QUERY = `
  query CourierDefinition($ns: String!, $key: String!) {
    metafieldDefinitions(first: 1, ownerType: ORDER, namespace: $ns, key: $key) {
      nodes { id name type { name } validationStatus validations { name value } }
    }
  }`;

const DEF_UPDATE = `
  mutation CourierDefinitionUpdate($definition: MetafieldDefinitionUpdateInput!) {
    metafieldDefinitionUpdate(definition: $definition) {
      updatedDefinition { id validationStatus validations { name value } }
      userErrors { field message code }
    }
  }`;

// ─── §COURIERS::readDefinition ───
// بترمي لو التعريف مش موجود أو شكله مش Choice list بقيم نصية — مفيش
// «قايمة فاضية» بتتفترض (قايمة فاضية بتتكتب = مسح كل المناديب).
async function readDefinition(env, token) {
  const data = await shopifyGQL(env, token, DEF_QUERY, { ns: DEF_NAMESPACE, key: DEF_KEY }, 'courierDefinition');
  const def = data.data?.metafieldDefinitions?.nodes?.[0];
  if (!def) throw new Error(`تعريف الميتافيلد ${DEF_NAMESPACE}.${DEF_KEY} على الأوردرات مش موجود`);
  if (def.type?.name !== 'single_line_text_field')
    throw new Error(`نوع ${DEF_NAMESPACE}.${DEF_KEY} بقى ${def.type?.name} — الأداة بتتعامل مع single_line_text_field بس`);
  const v = (def.validations || []).find(x => x.name === 'choices');
  if (!v) throw new Error(`تعريف ${DEF_NAMESPACE}.${DEF_KEY} مفيهوش validation اسمه choices — مش Choice list`);
  let list;
  try { list = JSON.parse(v.value); } catch { list = null; }
  if (!Array.isArray(list) || !list.every(s => typeof s === 'string'))
    throw new Error('قيمة choices مش مصفوفة نصوص — مش هنكتب فوق حاجة مش فاهمينها');
  return { id: def.id, couriers: list, validationStatus: def.validationStatus || null,
           otherValidations: (def.validations || []).filter(x => x.name !== 'choices') };
}

// ─── §COURIERS::writeCouriers ───
// بتحافظ على أي validations تانية، وبتعدّي الفحوصات التلاتة (Step 5A ②)،
// وبعدها بتعيد القراءة وتتأكد إن القايمة اتكتبت بالترتيب بالظبط (③).
async function writeCouriers(env, token, def, next) {
  const validations = [
    ...def.otherValidations.map(({ name, value }) => ({ name, value })),
    { name: 'choices', value: JSON.stringify(next) },
  ];
  const data = await shopifyGQL(env, token, DEF_UPDATE, {
    definition: { namespace: DEF_NAMESPACE, key: DEF_KEY, ownerType: 'ORDER', validations },
  }, 'courierDefinitionUpdate');
  const res  = data.data?.metafieldDefinitionUpdate;
  const errs = res?.userErrors || [];
  if (errs.length) throw new Error('metafieldDefinitionUpdate: ' + errs.map(e => e.message).join(' | '));
  if (!res?.updatedDefinition) throw new Error('metafieldDefinitionUpdate: شوبيفاي ما أكدتش العملية');

  // ③ تحقق مستقل — إعادة قراءة
  const after = await readDefinition(env, token);
  const same = after.couriers.length === next.length && after.couriers.every((n, i) => n === next[i]);
  return { verified: same, after: after.couriers, validationStatus: after.validationStatus };
}

// ─── §COURIERS::cleanName ───
// 🔴 الاسم بيتقارن بالحرف مع قيمة الميتافيلد على الأوردرات — فمفيش تعديل
//    صامت غير trim ولمّ المسافات المتكررة.
function cleanName(raw) {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null;
  const s = raw.replace(/\s+/g, ' ').trim();
  return s.length >= 1 && s.length <= MAX_NAME_LEN ? s : null;
}
const sameKey = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

// ─── §COURIERS::usage — كام أوردر عليه المندوب ده؟ (للحذف) ───
// ⚠️ `custom.courier` Admin-filterable (٣/٥ في `ecommoda-constants` §1)،
//    بس **القياس الإلزامي**: فلتر على قيمة مستحيلة (control) لازم يرجّع صفر،
//    وإلا الفلتر اتجاهل والأرقام كلها المتجر كله — وساعتها بنقول «مش موثوق»
//    بدل ما نعرض رقم غلط.
// أرقام S1 بس: `Ready` · `Shipped` · `In-Return` (قاعدة ١٢: In-Return زي Shipped).
function gqlStr(s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
async function courierUsage(env, token, name) {
  const base = `metafields.custom.courier:'${gqlStr(name)}'`;
  const q = {
    total:    base,
    ready:    `${base} AND metafields.custom.manual_status:'Ready'`,
    shipped:  `${base} AND metafields.custom.manual_status:'Shipped'`,
    inReturn: `${base} AND metafields.custom.manual_status:'In-Return'`,
    control:  `metafields.custom.courier:'__no_such_courier__'`,
  };
  const field = (alias, query) =>
    `${alias}: ordersCount(query: ${JSON.stringify(query)}, limit: 10000) { count precision }`;
  const query = `query CourierUsage { ${Object.entries(q).map(([a, s]) => field(a, s)).join('\n')} }`;
  const data = await shopifyGQL(env, token, query, {}, 'courierUsage');
  const n = k => data.data?.[k]?.count;
  const vals = ['total', 'ready', 'shipped', 'inReturn', 'control'].map(n);
  if (vals.some(v => typeof v !== 'number')) throw new Error('courierUsage: شوبيفاي ما رجّعتش العدّ كامل');
  const reliable = n('control') === 0;
  return {
    reliable,
    total: n('total'),
    active: n('ready') + n('shipped') + n('inReturn'),
    capped: ['total'].some(k => data.data?.[k]?.precision === 'AT_LEAST'),
  };
}

// ══════════════════════════════════════════════════════════════
// §LOG-REG — الحارس الديناميكي لقيم اللوج (الطبقة ٥)
// ══════════════════════════════════════════════════════════════
// نسخة تشغيلية من `log-values.json` اللي جنب الملف ده — بتتحدّث معاه في نفس
// الـ commit. 🔴 مفيش رفض كتابة أبدًا على قيمة غير مسجّلة.
const LOG_REGISTRY = {
  courier_names: new Set(['add_courier', 'remove_courier', 'reorder_couriers', 'rejected']),
};
const isRegisteredLogValue = (tool, type) => !!LOG_REGISTRY[tool]?.has(type);

const LOG_ALERT_SQL = `
  INSERT INTO log_value_alerts
    (source_tool, tool, type, first_seen, last_seen, hits,
     worker_version, sample_order_name, sample_employee, sample_notes)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(source_tool, tool, type) DO UPDATE SET
    last_seen         = excluded.last_seen,
    hits              = log_value_alerts.hits + excluded.hits,
    worker_version    = excluded.worker_version,
    sample_order_name = excluded.sample_order_name,
    sample_employee   = excluded.sample_employee,
    sample_notes      = excluded.sample_notes,
    status            = CASE WHEN log_value_alerts.status = 'ignored'
                             THEN 'ignored' ELSE 'open' END
`;

async function noteUnregisteredLogValues(db, entries) {
  const byPair = new Map();
  for (const e of entries) {
    const key = `${e.tool}\u0000${e.type}`;
    const acc = byPair.get(key);
    if (acc) { acc.hits++; continue; }
    byPair.set(key, { entry: e, hits: 1 });
  }
  const now = new Date().toISOString();
  for (const { entry, hits } of byPair.values()) {
    try {
      await db.prepare(LOG_ALERT_SQL).bind(
        TOOL_NAME, entry.tool ?? '(بدون tool)', entry.type ?? '(بدون type)',
        now, now, hits, WORKER_VERSION ?? null,
        entry.orderName ?? null, entry.employee ?? null,
        entry.notes ? String(entry.notes).slice(0, 200) : null,
      ).run();
    } catch (e) { /* متعمّد: التنبيه فهرس، وفشله أهون من تعطيل الأداة */ }
  }
}

// ══════════════════════════════════════════════════════════════
// §SHARED — writeLog (من `references/shared-functions.md` + الحارس)
// ══════════════════════════════════════════════════════════════
async function writeLog(db, entry) {
  const unregistered = !isRegisteredLogValue(entry.tool, entry.type);
  const extra = unregistered
    ? { ...(entry.extra || {}), _unregistered: true }
    : entry.extra;

  await db.prepare(`
    INSERT INTO logs
      (timestamp, tool, type, employee, order_id, order_name,
       sku, product_title, delta, value_before, value_after, notes, extra)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    entry.timestamp    ?? new Date().toISOString(),
    entry.tool,
    entry.type,
    entry.employee     ?? null,
    entry.orderId      ?? null,
    entry.orderName    ?? null,
    entry.sku          ?? null,
    entry.productTitle ?? null,
    entry.delta        ?? null,
    entry.valueBefore  ?? null,
    entry.valueAfter   ?? null,
    entry.notes        ?? null,
    extra ? JSON.stringify(extra) : null
  ).run();

  if (unregistered) await noteUnregisteredLogValues(db, [entry]);   // بعد الكتابة، مش قبلها
}

// فشل D1 يبان (Step 5A ⑦) — العملية حصلت، بس مفيش سجل.
async function tryLog(db, entry) {
  try { await writeLog(db, entry); return { logged: true, logError: null }; }
  catch (e) { return { logged: false, logError: e.message }; }
}

// ══════════════════════════════════════════════════════════════
// §ACTIONS — add / remove / reorder
// ══════════════════════════════════════════════════════════════
// عقد النتيجة (كل فعل): { ok, status, error?, warnings[], before[], after[],
//   logged, logError?, attempted, stage? }
//   · `rejected`/`already` = اتوقف قبل أي كتابة (attempted:false)
//   · `success` = اتكتب واتأكد · `warning` = اتكتب ومش مؤكَّد
//   · `error` = حاولنا وشوبيفاي رفضت
function stop(status, error, before, stage) {
  return { ok: false, status, error, warnings: [], before, after: before, attempted: false, stage };
}

async function planAndWrite(env, token, def, next, okMsg) {
  const out = { ok: true, status: 'success', warnings: [], before: def.couriers, after: next, attempted: true, stage: 'write', message: okMsg };
  try {
    const w = await writeCouriers(env, token, def, next);
    out.after = w.after;
    out.validationStatus = w.validationStatus;
    if (!w.verified) {
      out.status = 'warning';
      out.warnings.push('شوبيفاي قبلت التعديل بس القايمة اللي رجعت من القراءة التانية مش مطابقة للمطلوب — راجع القايمة على شوبيفاي (Settings → Metafields → Order → Courier)');
    }
  } catch (e) {
    out.ok = false; out.status = 'error'; out.error = e.message;
    out.after = def.couriers;   // الكتابة فشلت — القايمة لسه زي ما كانت
  }
  return out;
}

async function doAdd(env, token, body) {
  const name = cleanName(body.name);
  const def = await readDefinition(env, token);
  if (!name) return stop('rejected', `الاسم مرفوض — لازم نص من ١ لـ ${MAX_NAME_LEN} حرف بلا رموز تحكم`, def.couriers, 'preflight');
  if (def.couriers.some(c => sameKey(c, name))) {
    const ex = def.couriers.find(c => sameKey(c, name));
    return stop('already', `«${ex}» موجود في القايمة خلاص — مفيش حاجة مطلوبة`, def.couriers, 'lookup');
  }
  if (def.couriers.length >= MAX_COURIERS)
    return stop('rejected', `القايمة وصلت الحد (${MAX_COURIERS})`, def.couriers, 'preflight');
  const out = await planAndWrite(env, token, def, [...def.couriers, name], `اتضاف «${name}» في آخر القايمة`);
  out.name = name;
  return out;
}

async function doRemove(env, token, body) {
  const name = cleanName(body.name);
  const def = await readDefinition(env, token);
  if (!name) return stop('rejected', 'الاسم مرفوض', def.couriers, 'preflight');
  const hit = def.couriers.find(c => c === name) ?? def.couriers.find(c => sameKey(c, name));
  if (!hit) return stop('already', `«${name}» مش في القايمة أصلاً — مفيش حاجة مطلوبة`, def.couriers, 'lookup');
  if (PROTECTED_NAMES.some(p => sameKey(p, hit)))
    return stop('rejected', `«${hit}» اسم نظامي — الهب وأدوات بوسطة بتعتمد عليه بالاسم، وحذفه بيكسر التجميع. مش بيتحذف من هنا.`, def.couriers, 'preflight');
  if (def.couriers.length <= 1)
    return stop('rejected', 'ممنوع تفضّي القايمة — لازم يفضل مندوب واحد على الأقل', def.couriers, 'preflight');
  const out = await planAndWrite(env, token, def, def.couriers.filter(c => c !== hit), `اتحذف «${hit}» من القايمة`);
  out.name = hit;
  return out;
}

async function doReorder(env, token, body) {
  const def = await readDefinition(env, token);
  const want = Array.isArray(body.couriers) ? body.couriers : null;
  if (!want || want.length > MAX_COURIERS || !want.every(s => typeof s === 'string'))
    return stop('rejected', 'الترتيب المبعوت مش مصفوفة أسماء صالحة', def.couriers, 'preflight');
  // 🔴 ترتيب بس — نفس الأسماء بالظبط. أي اختلاف = حد تاني عدّل القايمة بعد ما
  //    الشاشة اتحمّلت، وبنرفض بدل ما نكتب فوق تعديله.
  const a = [...want].sort(), b = [...def.couriers].sort();
  if (a.length !== b.length || a.some((v, i) => v !== b[i]))
    return stop('rejected', 'القايمة اتغيّرت من حد تاني بعد ما الشاشة اتحمّلت — حدّث الصفحة وأعد الترتيب', def.couriers, 'preflight');
  if (want.every((v, i) => v === def.couriers[i]))
    return stop('already', 'الترتيب ده هو الحالي — مفيش حاجة مطلوبة', def.couriers, 'lookup');
  return await planAndWrite(env, token, def, want, 'اتحفظ الترتيب الجديد');
}

// ─── §ACTIONS::finish — سجل + رد (صف واحد لكل نداء) ───
// 🔴 صف واحد بالظبط: اتبعت لشوبيفاي (نجح/اتحذّر/اتفشل) = type الفعل،
//    واتوقف قبل أي كتابة = `rejected` (Step 5A ⑭).
function summarize(out, verb) {
  return `${verb}: ${out.status}${out.error ? ' — ' + out.error : ''}`;
}
function logFields(out, employee, verb, body) {
  return {
    employee,
    valueBefore: JSON.stringify(out.before ?? null),
    valueAfter:  JSON.stringify(out.after ?? null),
    notes:       out.message || summarize(out, verb),
    extra: {
      result: out.status === 'rejected' && !out.attempted ? 'rejected' : out.status,
      stage:  out.stage ?? null,
      name:   out.name ?? body.name ?? null,
      validationStatus: out.validationStatus ?? null,
      warnings: out.warnings?.length ? out.warnings : undefined,
      error:  out.error || undefined,
      source: TOOL_NAME,
    },
  };
}

// ══════════════════════════════════════════════════════════════
// §DIAG — فحص ذاتي بلا أي كتابة
// ══════════════════════════════════════════════════════════════
async function handleDiag(env, request) {
  const checks = [];
  const push = (ok, label, detail, hint) => checks.push({ ok, label, detail, hint });

  const s = env.WORKER_SECRET;
  const hasSecret = typeof s === 'string' && s.trim() !== '';
  push(hasSecret, 'سر الـ Worker',
       hasSecret ? `WORKER_SECRET=${String(s).length} حرف` : 'WORKER_SECRET=❌ ناقص',
       'Dashboard → Settings → Variables، وبعدها **Promote** للنسخة — من غير Promote القيمة بتفضل undefined');

  const fp = await secretFingerprint(s);
  push(!!fp, 'بصمة WORKER_SECRET', fp
    ? `بصمة ${fp} · مجموعة delivery_cod_ops — لازم تطابق باقي أعضاء المجموعة`
    : 'مفيش سر — البصمة مستحيلة',
    'لو البصمة مختلفة عن باقي الأعضاء، المجموعة مكسورة والهب هيرجّع 401 من العضو المختلف بس');

  const envKeys = { SHOP_DOMAIN: !!env.SHOP_DOMAIN, CLIENT_ID: !!env.CLIENT_ID, CLIENT_SECRET: !!env.CLIENT_SECRET, DB: !!env.DB };
  const envOk = Object.values(envKeys).every(Boolean);
  push(envOk, 'المتغيّرات', Object.entries(envKeys).map(([k, v]) => `${k}=${v ? '✓' : '❌'}`).join(' · '),
       'SHOP_DOMAIN في [vars] بتاع wrangler.toml · CLIENT_ID/CLIENT_SECRET أسرار + Promote · DB binding');

  if (env.DB) {
    try {
      const rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM logs WHERE tool = ?').bind(TOOL_NAME).first();
      // ⚠️ صفر صفوف مش دليل على حاجة (`ecommoda-constants` §7.0)
      push(true, 'D1', `متصل · ${rows?.n ?? 0} صف تحت \`${TOOL_NAME}\``);
    } catch (e) { push(false, 'D1', `FAILED: ${e.message}`, 'binding اسمه `DB` بالحرف'); }
  }

  if (envOk) {
    try {
      const token = await getAccessToken(env);
      push(true, 'OAuth شوبيفاي', 'التوكن اتجاب');
      try {
        const sc = await shopifyGQL(env, token, '{ currentAppInstallation { accessScopes { handle } } }', {}, 'accessScopes');
        const handles = (sc.data?.currentAppInstallation?.accessScopes || []).map(x => x.handle);
        const hasWrite = handles.includes('write_orders');
        push(hasWrite, 'صلاحية write_orders', hasWrite ? 'موجودة' : 'ناقصة',
             'تعديل تعريف ميتافيلد الأوردرات محتاج write_orders على الـ Custom App');
      } catch (e) { push(false, 'الصلاحيات', `FAILED: ${e.message}`); }
      try {
        const def = await readDefinition(env, token);
        push(true, 'تعريف custom.courier',
             `${def.couriers.length} مندوب · validationStatus=${def.validationStatus ?? '—'}`);
      } catch (e) { push(false, 'تعريف custom.courier', `FAILED: ${e.message}`); }
      push(true, 'throttleStatus', _lastThrottle ? JSON.stringify(_lastThrottle) : '—');
      push(true, 'actualQueryCost (آخر نداء)', _lastQueryCost ? JSON.stringify(_lastQueryCost) : '—');
    } catch (e) { push(false, 'OAuth شوبيفاي', `FAILED: ${e.message}`); }
  }

  const origin = request.headers.get('Origin') || '(بلا Origin)';
  push(ALLOWED_ORIGINS.includes(origin), 'الـ Origin', `${origin} · المسموح: ${ALLOWED_ORIGINS.join(', ')}`,
       'الواجهة لازم تتفتح من https://ecommoda-dev.github.io');

  return json({ ok: checks.every(c => c.ok), version: WORKER_VERSION, tool: TOOL_NAME, checks }, 200, request);
}

// ══════════════════════════════════════════════════════════════
// §HANDLER
// ══════════════════════════════════════════════════════════════
const MAX_LOG_LIMIT = 100;   // `get_logs` — سجل صغير للشاشة، مش تصدير

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS')
      return new Response(null, { status: 204, headers: getCORS(request) });

    // 🔴 حارس السر الغايب **قبل** فحص الـ auth (من غيره "Bearer undefined" بيعدّي)
    if (typeof env.WORKER_SECRET !== 'string' || !env.WORKER_SECRET.trim())
      return json({ ok: false, error: 'WORKER_SECRET غير مضبوط على الـ Worker', step: 'env' }, 500, request);

    const auth = request.headers.get('Authorization');
    if (!auth || auth !== `Bearer ${env.WORKER_SECRET}`)
      return json({ error: 'Unauthorized' }, 401, request);

    const url    = new URL(request.url);
    const action = url.searchParams.get('action') || '';

    try {
      if (action === 'get_config')
        return json({ ok: true, version: WORKER_VERSION, WORKER_VERSION, tool: TOOL_NAME }, 200, request);
      if (action === 'diag') return await handleDiag(env, request);

      // ─── §READ ────────────────────────────────────────────
      if (action === 'get_couriers') {
        assertEnv(env);
        const token = await getAccessToken(env);
        const def = await readDefinition(env, token);
        return json({ ok: true, couriers: def.couriers, count: def.couriers.length,
                      validationStatus: def.validationStatus, protectedNames: PROTECTED_NAMES,
                      maxCouriers: MAX_COURIERS, maxNameLen: MAX_NAME_LEN }, 200, request);
      }

      if (action === 'courier_usage') {
        assertEnv(env);
        const name = cleanName(url.searchParams.get('name'));
        if (!name) return json({ ok: false, error: 'name مطلوب' }, 400, request);
        const token = await getAccessToken(env);
        const u = await courierUsage(env, token, name);
        return json({ ok: true, name, ...u }, 200, request);
      }

      if (action === 'get_logs') {
        assertEnv(env);
        const limit  = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '30', 10) || 30, 1), MAX_LOG_LIMIT);
        const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0);
        const { results } = await env.DB.prepare(
          'SELECT timestamp, type, employee, notes, value_before, value_after, extra FROM logs WHERE tool = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?'
        ).bind(TOOL_NAME, limit, offset).all();
        return json({ ok: true, entries: results }, 200, request);
      }

      // ─── §WRITE — add_courier · remove_courier · reorder_couriers ───
      // العقد: صف سجل واحد لكل نداء، والرد بنفس شكل `out` فوق + `logged`.
      if (action === 'add_courier' || action === 'remove_courier' || action === 'reorder_couriers') {
        if (request.method !== 'POST') return json({ error: 'POST required' }, 405, request);
        assertEnv(env);
        const body = await request.json().catch(() => ({}));
        const employee = typeof body.employee === 'string' ? body.employee.trim().slice(0, 100) : '';
        if (!employee) return json({ ok: false, error: 'employee مطلوب' }, 400, request);

        const token = await getAccessToken(env);
        let out, log;
        if (action === 'add_courier') {
          out = await doAdd(env, token, body);
          log = await tryLog(env.DB, { tool: TOOL_NAME, type: out.attempted ? 'add_courier' : 'rejected',
                                       ...logFields(out, employee, 'إضافة مندوب', body) });
        } else if (action === 'remove_courier') {
          out = await doRemove(env, token, body);
          log = await tryLog(env.DB, { tool: TOOL_NAME, type: out.attempted ? 'remove_courier' : 'rejected',
                                       ...logFields(out, employee, 'حذف مندوب', body) });
        } else {
          out = await doReorder(env, token, body);
          log = await tryLog(env.DB, { tool: TOOL_NAME, type: out.attempted ? 'reorder_couriers' : 'rejected',
                                       ...logFields(out, employee, 'ترتيب المناديب', body) });
        }
        return json({ ...out, logged: log.logged, logError: log.logError }, 200, request);
      }

      return json({ error: `Unknown action: ${action}` }, 404, request);
    } catch (e) {
      return json({ ok: false, error: e.message }, 500, request);
    }
  },
};
