// ══════════════════════════════════════════════════════════════
// §HEADER
// Worker: courier-names-worker — EcomModa
// Tool:   أسماء المناديب — قراءة وتعديل قايمة الاختيار `custom.courier`
//         (إضافة · حذف · ترتيب) — أداة داخلية تحت «مركز عمليات الشحن
//         والتحصيل» (قسم «أدوات أخرى»).
//
// skills: worker-builder v4.2.0 · constants v4.1.0 · html-builder — 24-11-2026
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
//
// 🔴 **v2.0.0 (24-11-2026) — بروفايل المندوب في D1** (طلب أحمد):
//    شوبيفاي = المصدر الوحيد لـ«مين المندوب» وترتيبه. D1 = خصائص كل اسم بس
//    (تليفونين · صورة · رقم قومي · `extra` JSON). ⛔ D1 ما بتقررش مين في القايمة
//    ولا بتخزّن الترتيب. الترتيب: **شوبيفاي الأول ثم D1** — فشل D1 = `warning`
//    مش rollback (البروفايل بيتكوّن لاحقًا).
//    🔴 **الرقم القومي في جدول منفصل `courier_sensitive`** — `courier-names-worker`
//       **وحده** بيقراه ويكتب فيه. أي أداة تانية بتقرا `courier_profiles` و
//       `courier_photos` بس (عقد القراءة في CLAUDE.md). وفتحه/تعديله **بـPIN
//       الموظف في كل مرة** (PIN في الـ body) + حد محاولات + سجل بكل فتح.
//    ⛔ **ممنوع أي قيمة حساسة (الرقم القومي) في `logs`** — بنسجّل اسم الحقل بس.
//    الصورة مش حساسة (قرار أحمد) — مصغّرة base64 في `courier_photos`.
// ══════════════════════════════════════════════════════════════
const TOOL_NAME      = 'courier_names';
const WORKER_VERSION = '2.0.0';
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

// ─── §CONSTANTS::profiles ───
// مصدر الأرقام: ~٥٠ مندوب × صورة مصغّرة (٢٥٦px JPEG ≈ ١٥–٣٠KB) = ~١٫٥MB كله. حد D1
// للصف الواحد ٢MB، فالسقف ١٥٠KB للصورة مضمون بفارق كبير (الواجهة بتصغّر قبل الرفع).
const MAX_PHOTO_BYTES = 150 * 1024;
const PHOTO_MIMES     = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_EXTRA_BYTES = 4000;
// 🔴 حد محاولات الـPIN الغلط (قرار 24-11-2026): ٥ محاولات ← قفل ١٠ دقايق للموظف ده.
const PIN_MAX_FAILS   = 5;
const PIN_LOCK_MS     = 10 * 60 * 1000;
// kind: person = مندوب شخص · company/showroom = أسماء نظامية بلا بيانات شخصية
const KIND_BY_PROTECTED = { bosta: 'company', showroom: 'showroom' };

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
// §PROFILES — بروفايل المندوب في D1 (v2.0.0 · 24-11-2026)
// ══════════════════════════════════════════════════════════════
// 🔴 عقد القراءة للأدوات التانية (موثّق في CLAUDE.md):
//    مسموح: `courier_profiles` · `courier_photos` (قراءة بس · بدون تعديل).
//    ⛔ ممنوع: `courier_sensitive` (الرقم القومي) و`courier_pin_attempts` —
//       الـ Worker ده وحده. حاجز الـPIN شغّال بس لو القراءة بتعدّي من هنا.
//    تغيير اسم/معنى أي عمود = ليستة فاضية عند القارئ بلا خطأ. غيّر في الاتنين معًا.
const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS courier_profiles (
     id              INTEGER PRIMARY KEY AUTOINCREMENT,
     name            TEXT    NOT NULL,
     name_norm       TEXT    NOT NULL UNIQUE,
     kind            TEXT    NOT NULL DEFAULT 'person',
     status          TEXT    NOT NULL DEFAULT 'active',
     phone_primary   TEXT,
     phone_secondary TEXT,
     extra           TEXT,
     version         INTEGER NOT NULL DEFAULT 1,
     created_at      TEXT    NOT NULL,
     created_by      TEXT,
     updated_at      TEXT    NOT NULL,
     updated_by      TEXT,
     removed_at      TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS idx_courier_profiles_status ON courier_profiles(status)`,
  `CREATE TABLE IF NOT EXISTS courier_photos (
     courier_id INTEGER PRIMARY KEY,
     mime       TEXT    NOT NULL,
     data       TEXT    NOT NULL,
     bytes      INTEGER NOT NULL,
     updated_at TEXT    NOT NULL,
     updated_by TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS courier_sensitive (
     courier_id  INTEGER PRIMARY KEY,
     national_id TEXT    NOT NULL UNIQUE,
     updated_at  TEXT    NOT NULL,
     updated_by  TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS courier_pin_attempts (
     username     TEXT PRIMARY KEY,
     fails        INTEGER NOT NULL DEFAULT 0,
     window_start TEXT,
     locked_until TEXT
   )`,
];
// CREATE IF NOT EXISTS — آمن يتكرر. بيتنفّذ مرة لكل isolate.
let _schemaReady = false;
async function ensureSchema(db) {
  if (_schemaReady) return;
  await db.batch(SCHEMA_SQL.map(q => db.prepare(q)));
  _schemaReady = true;
}

// ─── §PROFILES::validation ───
const toLatinDigits = (s) => String(s)
  .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
  .replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
const normName = (n) => String(n).replace(/\s+/g, ' ').trim().toLowerCase();
function kindFor(name) { return KIND_BY_PROTECTED[normName(name)] || 'person'; }

// موبايل مصري: 01[0125]xxxxxxxx — بيقبل +20 و0020 و20 وأرقام عربي. فاضي = null.
function normalizePhone(raw) {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  let s = toLatinDigits(raw).trim();
  if (!s) return { ok: true, value: null };
  s = s.replace(/[\s\-().]/g, '');
  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('0020')) s = s.slice(4);
  else if (s.startsWith('20') && s.length === 12) s = s.slice(2);
  if (s.length === 10 && s.startsWith('1')) s = '0' + s;
  if (!/^01[0125]\d{8}$/.test(s))
    return { ok: false, error: 'رقم التليفون لازم يكون موبايل مصري (١١ رقم بيبدأ بـ 010 أو 011 أو 012 أو 015)' };
  return { ok: true, value: s };
}

const GOV_CODES = {
  '01': 'القاهرة', '02': 'الإسكندرية', '03': 'بورسعيد', '04': 'السويس', '11': 'دمياط', '12': 'الدقهلية',
  '13': 'الشرقية', '14': 'القليوبية', '15': 'كفر الشيخ', '16': 'الغربية', '17': 'المنوفية', '18': 'البحيرة',
  '19': 'الإسماعيلية', '21': 'الجيزة', '22': 'بني سويف', '23': 'الفيوم', '24': 'المنيا', '25': 'أسيوط',
  '26': 'سوهاج', '27': 'قنا', '28': 'أسوان', '29': 'الأقصر', '31': 'البحر الأحمر', '32': 'الوادي الجديد',
  '33': 'مطروح', '34': 'شمال سيناء', '35': 'جنوب سيناء', '88': 'خارج الجمهورية',
};
// الرقم القومي المصري: ١٤ رقم — [قرن][YYMMDD][محافظة ٢][تسلسل ٤ (آخر رقم فيهم الزوجي=أنثى)][تحقق]
function validateNationalId(raw) {
  const s = toLatinDigits(raw ?? '').replace(/\s+/g, '');
  if (!/^\d{14}$/.test(s)) return { ok: false, error: 'الرقم القومي لازم يكون ١٤ رقم' };
  const century = { '2': 1900, '3': 2000 }[s[0]];
  if (!century) return { ok: false, error: 'الرقم القومي لازم يبدأ بـ 2 أو 3' };
  const y = century + Number(s.slice(1, 3)), m = Number(s.slice(3, 5)), d = Number(s.slice(5, 7));
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d || dt.getTime() > Date.now())
    return { ok: false, error: 'تاريخ الميلاد جوّه الرقم القومي مش صالح' };
  const gov = GOV_CODES[s.slice(7, 9)];
  if (!gov) return { ok: false, error: 'كود المحافظة جوّه الرقم القومي مش معروف' };
  return { ok: true, value: s, info: {
    birthDate: `${String(y)}-${s.slice(3, 5)}-${s.slice(5, 7)}`,
    gender: Number(s[12]) % 2 === 1 ? 'ذكر' : 'أنثى',
    governorate: gov,
  } };
}

// صورة: data URL → نتحقق من النوع والحجم **والـ magic bytes** (مش الـ mime المكتوب بس).
function parsePhotoDataUrl(s) {
  if (typeof s !== 'string') return { error: 'الصورة مطلوبة' };
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(s);
  if (!m) return { error: 'الصورة لازم تكون JPEG أو PNG أو WebP' };
  const mime = m[1], b64 = m[2];
  const bytes = Math.floor(b64.length * 3 / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
  if (bytes > MAX_PHOTO_BYTES)
    return { error: `الصورة كبيرة (${Math.round(bytes / 1024)}KB) — الحد ${Math.round(MAX_PHOTO_BYTES / 1024)}KB` };
  let head;
  try { head = atob(b64.slice(0, 24)); } catch { return { error: 'الصورة تالفة' }; }
  const isJpg = head.charCodeAt(0) === 0xFF && head.charCodeAt(1) === 0xD8 && head.charCodeAt(2) === 0xFF;
  const isPng = head.startsWith('\x89PNG');
  const isWebp = head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP';
  const real = isJpg ? 'image/jpeg' : isPng ? 'image/png' : isWebp ? 'image/webp' : null;
  if (!real || real !== mime) return { error: 'محتوى الملف مش مطابق لنوع الصورة' };
  return { mime, b64, bytes };
}

// extra: كائن مفاتيح نصية بقيم بسيطة. null يحذف المفتاح. ⛔ مفيش حقول حساسة هنا.
function mergeExtra(current, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { error: 'extra لازم يكون كائن' };
  const next = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (!/^[A-Za-z0-9_؀-ۿ ]{1,40}$/.test(k)) return { error: `اسم الحقل «${k}» مش صالح` };
    if (v === null) { delete next[k]; continue; }
    if (!['string', 'number', 'boolean'].includes(typeof v)) return { error: `قيمة «${k}» لازم نص أو رقم أو true/false` };
    if (typeof v === 'string' && v.length > 300) return { error: `قيمة «${k}» أطول من ٣٠٠ حرف` };
    next[k] = v;
  }
  if (Object.keys(next).length > 20) return { error: 'الحقول الإضافية أكتر من ٢٠' };
  if (JSON.stringify(next).length > MAX_EXTRA_BYTES) return { error: 'الحقول الإضافية كبيرة' };
  return { value: next };
}

// ─── §PROFILES::rows ───
const PROFILE_SELECT = `
  SELECT p.id, p.name, p.kind, p.status, p.phone_primary, p.phone_secondary, p.extra, p.version,
         p.created_at, p.updated_at, p.updated_by, p.removed_at,
         ph.updated_at AS photo_updated_at
  FROM courier_profiles p LEFT JOIN courier_photos ph ON ph.courier_id = p.id`;

function parseExtra(t) {
  try { const o = JSON.parse(t); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch { return {}; }
}
function shapeProfile(r, nidLast4) {
  const out = {
    id: r.id, name: r.name, kind: r.kind, status: r.status,
    phonePrimary: r.phone_primary, phoneSecondary: r.phone_secondary,
    extra: parseExtra(r.extra), version: r.version,
    updatedAt: r.updated_at, updatedBy: r.updated_by,
    hasPhoto: !!r.photo_updated_at, photoUpdatedAt: r.photo_updated_at || null,
  };
  if (nidLast4 !== undefined) {           // مستوى «شاشة الأداة» بس — الأدوات التانية مالهاش
    out.hasNationalId = !!nidLast4;
    out.nationalIdMasked = nidLast4 ? '•'.repeat(10) + nidLast4 : null;
  }
  return out;
}
function emptyProfile(name) {
  return { id: null, name, kind: kindFor(name), status: 'active', phonePrimary: null, phoneSecondary: null,
           extra: {}, version: 0, updatedAt: null, updatedBy: null, hasPhoto: false, photoUpdatedAt: null,
           hasNationalId: false, nationalIdMasked: null };
}
function missingFields(p) {
  if (p.kind !== 'person') return [];
  const m = [];
  if (!p.phonePrimary) m.push('phonePrimary');
  if (!p.hasPhoto) m.push('photo');
  if (!p.hasNationalId) m.push('nationalId');
  return m;
}

async function loadProfileByName(db, name) {
  return await db.prepare(`${PROFILE_SELECT} WHERE p.name_norm = ?`).bind(normName(name)).first();
}

// بروفايل لاسم موجود في قايمة شوبيفاي: ينشئه لو ناقص، ويرجّعه لو كان removed.
async function ensureProfile(db, name, employee) {
  const now = new Date().toISOString();
  const row = await db.prepare('SELECT id, name, status FROM courier_profiles WHERE name_norm = ?').bind(normName(name)).first();
  if (!row) {
    const r = await db.prepare(
      `INSERT INTO courier_profiles (name, name_norm, kind, status, version, created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, ?, 'active', 1, ?, ?, ?, ?)`
    ).bind(name, normName(name), kindFor(name), now, employee, now, employee).run();
    return { id: r.meta.last_row_id, created: true, reactivated: false };
  }
  if (row.status === 'removed' || row.name !== name) {
    await db.prepare(
      `UPDATE courier_profiles SET status = 'active', removed_at = NULL, name = ?, version = version + 1,
              updated_at = ?, updated_by = ? WHERE id = ?`
    ).bind(name, now, employee, row.id).run();
    return { id: row.id, created: false, reactivated: row.status === 'removed' };
  }
  return { id: row.id, created: false, reactivated: false };
}

// ─── §PROFILES::lifecycle — بعد add/remove على شوبيفاي ───
// 🔴 شوبيفاي الأول ثم D1. فشل D1 = warning مش rollback (البروفايل بيتكوّن لاحقًا).
//    ومانكتبش في D1 لو تعديل شوبيفاي مش مؤكَّد (status ≠ success).
async function syncProfileLifecycle(env, out, employee, mode) {
  if (!out.attempted) return;
  if (out.status !== 'success') {
    if (out.status === 'warning')
      out.warnings.push('بروفايل المندوب ما اتحدّثش لأن التعديل على شوبيفاي مش مؤكَّد — هيتحدّث عند أول تعديل على بياناته');
    return;
  }
  try {
    await ensureSchema(env.DB);
    if (mode === 'add') {
      const r = await ensureProfile(env.DB, out.name, employee);
      out.profile = r.created ? 'created' : r.reactivated ? 'reactivated' : 'existing';
      if (r.reactivated)
        out.profileNotice = `رجع البروفايل القديم لـ«${out.name}» بكل بياناته — اتأكد إنه نفس الشخص (ممكن يكون شخص تاني بنفس الاسم)`;
    } else {
      const now = new Date().toISOString();
      const r = await env.DB.prepare(
        `UPDATE courier_profiles SET status = 'removed', removed_at = ?, version = version + 1, updated_at = ?, updated_by = ?
         WHERE name_norm = ? AND status != 'removed'`
      ).bind(now, now, employee, normName(out.name)).run();
      out.profile = r.meta.changes ? 'removed' : 'none';
    }
  } catch (e) {
    out.status = 'warning';
    out.warnings.push(`الاسم اتعدّل على شوبيفاي لكن بروفايل المندوب في D1 ما اتحدّثش (${e.message}) — هيتصلّح عند أول تعديل على بياناته`);
  }
}

// ─── §PROFILES::pin — إعادة PIN لكل فتح/تعديل للرقم القومي ───
// PIN في الـ body بس (Rule 5). جدول `employees` مشترك مع Worker الهب (نفس D1).
// 🔴 حد المحاولات: ٥ غلط ← قفل ١٠ دقايق للموظف ده. العدّ في D1 مش في ذاكرة الـ isolate.
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
async function checkPin(db, username, pin) {
  await ensureSchema(db);
  if (typeof username !== 'string' || !username.trim() || typeof pin !== 'string' || !pin)
    return { ok: false, http: 400, code: 'missing', error: 'الموظف والـ PIN مطلوبين' };
  username = username.trim();
  const now = Date.now();
  const att = await db.prepare('SELECT fails, window_start, locked_until FROM courier_pin_attempts WHERE username = ?').bind(username).first();
  if (att?.locked_until && Date.parse(att.locked_until) > now) {
    const sec = Math.ceil((Date.parse(att.locked_until) - now) / 1000);
    return { ok: false, http: 429, code: 'locked', retryAfterSec: sec,
             error: `محاولات PIN غلط كتير — مقفول ${Math.ceil(sec / 60)} دقيقة` };
  }
  const emp = await db.prepare('SELECT is_active, pin FROM employees WHERE username = ?').bind(username).first();
  if (!emp || !emp.pin)
    return { ok: false, http: 403, code: 'no_pin', error: 'مفيش PIN متسجّل للموظف ده — سجّله من شاشة الدخول الأول' };
  if (!emp.is_active)
    return { ok: false, http: 403, code: 'inactive', error: 'الحساب موقوف — تواصل مع المسؤول' };
  if (!safeEqual(String(emp.pin), pin)) {
    const windowOpen = !!att?.window_start && now - Date.parse(att.window_start) < PIN_LOCK_MS;
    const fails = (windowOpen ? att.fails : 0) + 1;
    const lock = fails >= PIN_MAX_FAILS;
    await db.prepare(
      `INSERT INTO courier_pin_attempts (username, fails, window_start, locked_until) VALUES (?, ?, ?, ?)
       ON CONFLICT(username) DO UPDATE SET fails = excluded.fails, window_start = excluded.window_start, locked_until = excluded.locked_until`
    ).bind(username, lock ? 0 : fails, windowOpen ? att.window_start : new Date(now).toISOString(),
           lock ? new Date(now + PIN_LOCK_MS).toISOString() : null).run();
    return lock
      ? { ok: false, http: 429, code: 'locked', retryAfterSec: PIN_LOCK_MS / 1000, error: `PIN غلط ${PIN_MAX_FAILS} مرات — مقفول ${PIN_LOCK_MS / 60000} دقايق` }
      : { ok: false, http: 403, code: 'bad_pin', attemptsLeft: PIN_MAX_FAILS - fails, error: `PIN غلط — فاضل ${PIN_MAX_FAILS - fails} محاولات` };
  }
  if (att) await db.prepare('DELETE FROM courier_pin_attempts WHERE username = ?').bind(username).run();
  return { ok: true, username };
}

// ─── §PROFILES::actions ───
// عقد النتيجة زي الأفعال القديمة: { ok, status, error?, warnings[], attempted, stage?, fields? }
function halt(status, error, stage, extra = {}) {
  return { ok: false, status, error, warnings: [], attempted: false, stage, ...extra };
}

// المندوب لازم يكون في قايمة شوبيفاي الحالية وشخص (مش Bosta/Showroom)
async function resolvePerson(env, token, rawName) {
  const name = cleanName(rawName);
  if (!name) return { halt: halt('rejected', 'اسم المندوب مطلوب', 'preflight') };
  const def = await readDefinition(env, token);
  const hit = def.couriers.find(c => c === name) ?? def.couriers.find(c => sameKey(c, name));
  if (!hit) return { halt: halt('rejected', `«${name}» مش في قايمة المناديب على شوبيفاي — حدّث الصفحة`, 'lookup', { name }) };
  if (kindFor(hit) !== 'person')
    return { halt: halt('rejected', `«${hit}» اسم نظامي مش شخص — مالهوش بيانات شخصية`, 'preflight', { name: hit }) };
  return { name: hit };
}

async function doUpdateProfile(env, token, body, employee) {
  const r = await resolvePerson(env, token, body.name);
  if (r.halt) return r.halt;
  const name = r.name;
  const fields = [];
  const patch = {};
  if ('phonePrimary' in body) {
    const p = normalizePhone(body.phonePrimary);
    if (!p.ok) return halt('rejected', `التليفون الأساسي: ${p.error}`, 'preflight', { name });
    patch.phone_primary = p.value; fields.push('phone_primary');
  }
  if ('phoneSecondary' in body) {
    const p = normalizePhone(body.phoneSecondary);
    if (!p.ok) return halt('rejected', `التليفون الإضافي: ${p.error}`, 'preflight', { name });
    patch.phone_secondary = p.value; fields.push('phone_secondary');
  }
  if (!fields.length && !('extra' in body)) return halt('rejected', 'مفيش حقل مطلوب تعديله', 'preflight', { name });

  await ensureSchema(env.DB);
  const ensured = await ensureProfile(env.DB, name, employee);
  const cur = await env.DB.prepare('SELECT * FROM courier_profiles WHERE id = ?').bind(ensured.id).first();
  if (body.expectedVersion !== undefined && Number(body.expectedVersion) !== cur.version && !ensured.created)
    return halt('rejected', 'بيانات المندوب اتعدّلت من حد تاني بعد ما الشاشة اتحمّلت — حدّث وأعد المحاولة', 'preflight', { name });

  if ('extra' in body) {
    const m = mergeExtra(parseExtra(cur.extra), body.extra);
    if (m.error) return halt('rejected', m.error, 'preflight', { name });
    patch.extra = Object.keys(m.value).length ? JSON.stringify(m.value) : null; fields.push('extra');
  }
  const changed = Object.keys(patch).filter(k => (patch[k] ?? null) !== (cur[k] ?? null));
  if (!changed.length) return halt('already', 'البيانات دي هي المتسجّلة أصلاً — مفيش حاجة مطلوبة', 'lookup', { name });

  const now = new Date().toISOString();
  const sets = changed.map(k => `${k} = ?`).join(', ');
  const res = await env.DB.prepare(
    `UPDATE courier_profiles SET ${sets}, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ? AND version = ?`
  ).bind(...changed.map(k => patch[k]), now, employee, cur.id, cur.version).run();
  if (!res.meta.changes)
    return halt('rejected', 'بيانات المندوب اتعدّلت من حد تاني لحظة الحفظ — أعد المحاولة', 'write', { name });

  // تنبيه (مش منع): نفس رقم التليفون عند مندوب تاني
  const notices = [];
  for (const k of ['phone_primary', 'phone_secondary']) {
    if (!changed.includes(k) || !patch[k]) continue;
    const dup = await env.DB.prepare(
      `SELECT name FROM courier_profiles WHERE id != ? AND status = 'active' AND (phone_primary = ? OR phone_secondary = ?) LIMIT 1`
    ).bind(cur.id, patch[k], patch[k]).first();
    if (dup) notices.push(`الرقم ${patch[k]} متسجّل كمان للمندوب «${dup.name}»`);
  }
  const fresh = await loadProfileByName(env.DB, name);
  return { ok: true, status: 'success', warnings: [], notices, attempted: true, stage: 'write', name,
           fields: changed, message: `اتحدّثت بيانات «${name}»`, profile: shapeProfile(fresh) };
}

async function doSetPhoto(env, token, body, employee) {
  const r = await resolvePerson(env, token, body.name);
  if (r.halt) return r.halt;
  const name = r.name;
  const removing = body.dataUrl === null;
  let photo = null;
  if (!removing) {
    photo = parsePhotoDataUrl(body.dataUrl);
    if (photo.error) return halt('rejected', photo.error, 'preflight', { name });
  }
  await ensureSchema(env.DB);
  const ensured = await ensureProfile(env.DB, name, employee);
  const now = new Date().toISOString();
  if (removing) {
    const had = await env.DB.prepare('SELECT 1 AS x FROM courier_photos WHERE courier_id = ?').bind(ensured.id).first();
    if (!had) return halt('already', 'مفيش صورة متسجّلة أصلاً', 'lookup', { name });
    await env.DB.batch([
      env.DB.prepare('DELETE FROM courier_photos WHERE courier_id = ?').bind(ensured.id),
      env.DB.prepare('UPDATE courier_profiles SET version = version + 1, updated_at = ?, updated_by = ? WHERE id = ?').bind(now, employee, ensured.id),
    ]);
  } else {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO courier_photos (courier_id, mime, data, bytes, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(courier_id) DO UPDATE SET mime = excluded.mime, data = excluded.data, bytes = excluded.bytes,
                updated_at = excluded.updated_at, updated_by = excluded.updated_by`
      ).bind(ensured.id, photo.mime, photo.b64, photo.bytes, now, employee),
      env.DB.prepare('UPDATE courier_profiles SET version = version + 1, updated_at = ?, updated_by = ? WHERE id = ?').bind(now, employee, ensured.id),
    ]);
  }
  const fresh = await loadProfileByName(env.DB, name);
  return { ok: true, status: 'success', warnings: [], attempted: true, stage: 'write', name, fields: ['photo'],
           removed: removing, bytes: photo?.bytes ?? 0,
           message: removing ? `اتحذفت صورة «${name}»` : `اتحدّثت صورة «${name}»`, profile: shapeProfile(fresh) };
}

async function doSetNationalId(env, token, body, employee) {
  const r = await resolvePerson(env, token, body.name);
  if (r.halt) return r.halt;
  const name = r.name;
  const removing = body.nationalId === null;
  let nid = null;
  if (!removing) {
    nid = validateNationalId(body.nationalId);
    if (!nid.ok) return halt('rejected', nid.error, 'preflight', { name });
  }
  await ensureSchema(env.DB);
  const ensured = await ensureProfile(env.DB, name, employee);
  const cur = await env.DB.prepare('SELECT national_id FROM courier_sensitive WHERE courier_id = ?').bind(ensured.id).first();
  const now = new Date().toISOString();
  if (removing) {
    if (!cur) return halt('already', 'مفيش رقم قومي متسجّل أصلاً', 'lookup', { name });
    await env.DB.batch([
      env.DB.prepare('DELETE FROM courier_sensitive WHERE courier_id = ?').bind(ensured.id),
      env.DB.prepare('UPDATE courier_profiles SET version = version + 1, updated_at = ?, updated_by = ? WHERE id = ?').bind(now, employee, ensured.id),
    ]);
  } else {
    if (cur && cur.national_id === nid.value) return halt('already', 'الرقم ده هو المتسجّل أصلاً', 'lookup', { name });
    const dup = await env.DB.prepare(
      `SELECT p.name FROM courier_sensitive s JOIN courier_profiles p ON p.id = s.courier_id WHERE s.national_id = ? AND s.courier_id != ?`
    ).bind(nid.value, ensured.id).first();
    if (dup) return halt('rejected', `الرقم القومي ده متسجّل لمندوب تاني: «${dup.name}»`, 'preflight', { name });
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO courier_sensitive (courier_id, national_id, updated_at, updated_by) VALUES (?, ?, ?, ?)
         ON CONFLICT(courier_id) DO UPDATE SET national_id = excluded.national_id, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
      ).bind(ensured.id, nid.value, now, employee),
      env.DB.prepare('UPDATE courier_profiles SET version = version + 1, updated_at = ?, updated_by = ? WHERE id = ?').bind(now, employee, ensured.id),
    ]);
  }
  // ⛔ مفيش قيمة حساسة في الرد المسجَّل — اسم الحقل بس
  return { ok: true, status: 'success', warnings: [], attempted: true, stage: 'write', name, fields: ['national_id'],
           removed: removing, nationalIdMasked: removing ? null : '•'.repeat(10) + nid.value.slice(-4),
           message: removing ? `اتحذف الرقم القومي لـ«${name}»` : `اتسجّل الرقم القومي لـ«${name}»` };
}

// صف سجل لأفعال البروفايل — ⛔ مفيش قيمة حساسة: أسماء الحقول بس
function profileLogFields(out, employee, name, verb) {
  return {
    employee,
    notes: out.message || `${verb}: ${out.status}${out.error ? ' — ' + out.error : ''}`,
    extra: {
      result: out.status, stage: out.stage ?? null, name: out.name ?? name ?? null,
      fields: out.fields, removed: out.removed || undefined,
      error: out.error || undefined, source: TOOL_NAME,
    },
  };
}

// ══════════════════════════════════════════════════════════════
// §LOG-REG — الحارس الديناميكي لقيم اللوج (الطبقة ٥)
// ══════════════════════════════════════════════════════════════
// نسخة تشغيلية من `log-values.json` اللي جنب الملف ده — بتتحدّث معاه في نفس
// الـ commit. 🔴 مفيش رفض كتابة أبدًا على قيمة غير مسجّلة.
const LOG_REGISTRY = {
  courier_names: new Set(['add_courier', 'remove_courier', 'reorder_couriers', 'rejected',
                          'profile_update', 'photo_update', 'sensitive_update', 'view_sensitive']),
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
      profile: out.profile ?? undefined,
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

  if (env.DB) {
    try {
      await ensureSchema(env.DB);
      const c = await env.DB.prepare(
        `SELECT (SELECT COUNT(*) FROM courier_profiles) AS profiles, (SELECT COUNT(*) FROM courier_photos) AS photos,
                (SELECT COUNT(*) FROM courier_sensitive) AS sensitive, (SELECT COUNT(*) FROM employees WHERE is_active = 1 AND pin IS NOT NULL) AS pinEmployees`
      ).first();
      push(true, 'جداول البروفايل', `بروفايلات=${c.profiles} · صور=${c.photos} · أرقام قومية=${c.sensitive} (عدد بس)`);
      push(c.pinEmployees > 0, 'موظفين بـPIN (للرقم القومي)', `${c.pinEmployees} موظف نشط عنده PIN`,
           'فتح الرقم القومي بيتحقق من PIN جدول employees المشترك');
    } catch (e) { push(false, 'جداول البروفايل', `FAILED: ${e.message}`, 'الجداول بتتكوّن تلقائي (CREATE IF NOT EXISTS) — راجع صلاحيات D1'); }
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
        // 🔴 القايمة والترتيب من شوبيفاي بس. D1 بتضيف خصائص — وفشلها مابيوقفش القايمة.
        let profiles = {}, removedProfiles = [], profilesError = null;
        try {
          await ensureSchema(env.DB);
          const [{ results: rows }, { results: nids }] = await Promise.all([
            env.DB.prepare(PROFILE_SELECT).all(),
            env.DB.prepare('SELECT courier_id, substr(national_id, -4) AS last4 FROM courier_sensitive').all(),
          ]);
          const last4 = new Map(nids.map(n => [n.courier_id, n.last4]));
          const byNorm = new Map(rows.map(r => [normName(r.name), r]));
          for (const name of def.couriers) {
            const r = byNorm.get(normName(name));
            const sp = r ? shapeProfile({ ...r, name }, last4.get(r.id) ?? null) : emptyProfile(name);
            sp.missing = missingFields(sp);
            profiles[name] = sp;
          }
          const inList = new Set(def.couriers.map(normName));
          removedProfiles = rows.filter(r => !inList.has(normName(r.name)) && r.kind === 'person')
                                .map(r => ({ name: r.name, status: r.status }));
        } catch (e) { profilesError = e.message; }
        return json({ ok: true, couriers: def.couriers, count: def.couriers.length,
                      validationStatus: def.validationStatus, protectedNames: PROTECTED_NAMES,
                      maxCouriers: MAX_COURIERS, maxNameLen: MAX_NAME_LEN,
                      profiles, removedProfiles, profilesError,
                      maxPhotoBytes: MAX_PHOTO_BYTES }, 200, request);
      }

      // ─── §READ::profiles — للأدوات التانية (D1 بس · بلا شوبيفاي · بلا رقم قومي) ───
      // المستوى العام: اسم · نوع · تليفونين · extra · وجود صورة. ⛔ مفيش أي حقل حساس.
      if (action === 'get_courier_profiles') {
        assertEnv(env);
        await ensureSchema(env.DB);
        const status = url.searchParams.get('status') === 'all' ? null : 'active';
        const { results } = await env.DB.prepare(`${PROFILE_SELECT}${status ? ' WHERE p.status = ?' : ''} ORDER BY p.name`)
          .bind(...(status ? [status] : [])).all();
        return json({ ok: true, profiles: results.map(r => shapeProfile(r)), count: results.length }, 200, request);
      }

      // الصورة بتتجاب لوحدها (مش مع القايمة) — الـ `<img src>` مابيبعتش Authorization، فالواجهة بتجيبها كـ JSON.
      if (action === 'get_courier_photo') {
        assertEnv(env);
        await ensureSchema(env.DB);
        const name = cleanName(url.searchParams.get('name'));
        if (!name) return json({ ok: false, error: 'name مطلوب' }, 400, request);
        const row = await env.DB.prepare(
          `SELECT ph.mime, ph.data, ph.updated_at FROM courier_photos ph JOIN courier_profiles p ON p.id = ph.courier_id WHERE p.name_norm = ?`
        ).bind(normName(name)).first();
        if (!row) return json({ ok: false, error: 'مفيش صورة' }, 404, request);
        return json({ ok: true, name, mime: row.mime, updatedAt: row.updated_at,
                      dataUrl: `data:${row.mime};base64,${row.data}` }, 200, request);
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
          await syncProfileLifecycle(env, out, employee, 'add');
          log = await tryLog(env.DB, { tool: TOOL_NAME, type: out.attempted ? 'add_courier' : 'rejected',
                                       ...logFields(out, employee, 'إضافة مندوب', body) });
        } else if (action === 'remove_courier') {
          out = await doRemove(env, token, body);
          await syncProfileLifecycle(env, out, employee, 'remove');
          log = await tryLog(env.DB, { tool: TOOL_NAME, type: out.attempted ? 'remove_courier' : 'rejected',
                                       ...logFields(out, employee, 'حذف مندوب', body) });
        } else {
          out = await doReorder(env, token, body);
          log = await tryLog(env.DB, { tool: TOOL_NAME, type: out.attempted ? 'reorder_couriers' : 'rejected',
                                       ...logFields(out, employee, 'ترتيب المناديب', body) });
        }
        return json({ ...out, logged: log.logged, logError: log.logError }, 200, request);
      }

      // ─── §WRITE::profiles — update_courier_profile · set_courier_photo ───
      if (action === 'update_courier_profile' || action === 'set_courier_photo') {
        if (request.method !== 'POST') return json({ error: 'POST required' }, 405, request);
        assertEnv(env);
        if (action === 'set_courier_photo' && Number(request.headers.get('content-length') || 0) > MAX_PHOTO_BYTES * 2)
          return json({ ok: false, status: 'rejected', error: 'الطلب أكبر من المسموح' }, 413, request);
        const body = await request.json().catch(() => ({}));
        const employee = typeof body.employee === 'string' ? body.employee.trim().slice(0, 100) : '';
        if (!employee) return json({ ok: false, error: 'employee مطلوب' }, 400, request);
        const token = await getAccessToken(env);
        let out, log;
        if (action === 'update_courier_profile') {
          out = await doUpdateProfile(env, token, body, employee);
          log = await tryLog(env.DB, { tool: TOOL_NAME, type: out.attempted ? 'profile_update' : 'rejected',
                                       ...profileLogFields(out, employee, body.name, 'تعديل بيانات مندوب') });
        } else {
          out = await doSetPhoto(env, token, body, employee);
          log = await tryLog(env.DB, { tool: TOOL_NAME, type: out.attempted ? 'photo_update' : 'rejected',
                                       ...profileLogFields(out, employee, body.name, 'صورة المندوب') });
        }
        return json({ ...out, logged: log.logged, logError: log.logError }, 200, request);
      }

      // ─── §WRITE::sensitive — الرقم القومي: PIN في كل مرة ───
      if (action === 'reveal_national_id' || action === 'set_national_id') {
        if (request.method !== 'POST') return json({ error: 'POST required' }, 405, request);
        assertEnv(env);
        const body = await request.json().catch(() => ({}));
        const employee = typeof body.employee === 'string' ? body.employee.trim().slice(0, 100) : '';
        const pin = typeof body.pin === 'string' ? body.pin : '';
        const verb = action === 'reveal_national_id' ? 'فتح الرقم القومي' : 'تعديل الرقم القومي';
        const auth = await checkPin(env.DB, employee, pin);
        if (!auth.ok) {
          // كل محاولة مرفوضة بتتسجّل (سجل مراجعة) — بدون أي قيمة
          await tryLog(env.DB, { tool: TOOL_NAME, type: 'rejected', employee: employee || null,
            notes: `${verb}: PIN مرفوض (${auth.code})`,
            extra: { result: 'rejected', stage: 'preflight', reason: auth.code, name: cleanName(body.name), source: TOOL_NAME } });
          return json({ ok: false, status: 'rejected', code: auth.code, error: auth.error,
                        attemptsLeft: auth.attemptsLeft, retryAfterSec: auth.retryAfterSec }, auth.http, request);
        }

        if (action === 'reveal_national_id') {
          const name = cleanName(body.name);
          if (!name) return json({ ok: false, status: 'rejected', error: 'اسم المندوب مطلوب' }, 400, request);
          const row = await env.DB.prepare(
            `SELECT p.name, s.national_id FROM courier_profiles p JOIN courier_sensitive s ON s.courier_id = p.id WHERE p.name_norm = ?`
          ).bind(normName(name)).first();
          if (!row) {
            await tryLog(env.DB, { tool: TOOL_NAME, type: 'rejected', employee,
              notes: `${verb}: مفيش رقم قومي متسجّل لـ«${name}»`,
              extra: { result: 'already', stage: 'lookup', name, source: TOOL_NAME } });
            return json({ ok: false, status: 'already', error: `مفيش رقم قومي متسجّل لـ«${name}»` }, 200, request);
          }
          // 🔴 مفيش عرض بلا سجل — لو السجل فشل، الرقم مابيتبعتش (fail-closed)
          const lg = await tryLog(env.DB, { tool: TOOL_NAME, type: 'view_sensitive', employee,
            notes: `فتح الرقم القومي للمندوب «${row.name}»`,
            extra: { result: 'success', stage: 'lookup', name: row.name, fields: ['national_id'], source: TOOL_NAME } });
          if (!lg.logged)
            return json({ ok: false, status: 'error', error: 'ما قدرناش نسجّل عملية الفتح — مفيش عرض للرقم القومي بدون سجل', logged: false }, 500, request);
          const v = validateNationalId(row.national_id);
          return json({ ok: true, status: 'success', name: row.name, nationalId: row.national_id,
                        info: v.ok ? v.info : null, logged: true }, 200, request);
        }

        const token = await getAccessToken(env);
        const out = await doSetNationalId(env, token, body, employee);
        const log = await tryLog(env.DB, { tool: TOOL_NAME, type: out.attempted ? 'sensitive_update' : 'rejected',
                                           ...profileLogFields(out, employee, body.name, verb) });
        return json({ ...out, logged: log.logged, logError: log.logError }, 200, request);
      }

      return json({ error: `Unknown action: ${action}` }, 404, request);
    } catch (e) {
      return json({ ok: false, error: e.message }, 500, request);
    }
  },
};
